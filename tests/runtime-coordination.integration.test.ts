import 'dotenv/config';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { createPersistenceDataSource } from '../server/persistence/data-source';
import { NativeRuntimeService } from '../server/runtime/service';
import { RuntimeRunEntity, RuntimeSessionEntity, RuntimeWorkspaceEntity } from '../server/runtime/entities';
import { createDefaultRoutingPolicy } from '../features/settings/routing-policy';

const boundary = vi.hoisted(() => ({
  terminals: [] as Array<{ writes: string[]; args: string[]; emit(data: string): void; exit(): void }>,
  turns: new Map<string, Array<Record<string, unknown>>>(),
  readGate: null as null | (() => Promise<void>),
  spawnFailure: false,
}));
vi.mock('node-pty', () => ({
  spawn: (_bin: string, _args: string[], options: { env: Record<string, string> }) => {
    if (boundary.spawnFailure) throw new Error('native_spawn_failed');
    let onData: (data: string) => void = () => {};
    let onExit: (event: { exitCode: number }) => void = () => {};
    const terminal = {
      writes: [] as string[], args: JSON.parse(options.env.ORC_RUNTIME_CODEX_ARGS) as string[],
      write(data: string) { this.writes.push(data); }, resize() {},
      kill() { queueMicrotask(() => onExit({ exitCode: 0 })); },
      onData(callback: typeof onData) { onData = callback; return { dispose() {} }; },
      onExit(callback: typeof onExit) { onExit = callback; return { dispose() {} }; },
      emit(data: string) { onData(data); }, exit() { onExit({ exitCode: 0 }); },
    };
    boundary.terminals.push(terminal);
    return terminal;
  },
}));
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stdout = stdout; child.stderr = { resume() {} }; child.exitCode = null;
    child.stdin = {
      write(line: string) {
        const request = JSON.parse(line) as { id?: number; method: string; params: { threadId?: string } };
        if (!request.id) return;
        void (async () => {
          if (request.method === 'thread/read' && boundary.readGate) await boundary.readGate();
          const result = request.method === 'thread/read' ? { thread: { turns: boundary.turns.get(request.params.threadId!) || [] } } : {};
          stdout.emit('data', JSON.stringify({ id: request.id, result }) + '\n');
        })();
      },
      end() { child.exitCode = 0; child.emit('exit', 0); },
    };
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
    return child;
  }};
});

const databaseUrl = process.env.ORC_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await delay(5); }
  throw new Error('test boundary did not settle');
}

suite('native runtime coordination with PostgreSQL and simulated native boundaries', () => {
  let source: DataSource;
  let service: NativeRuntimeService;
  let workspacePath: string | null = null;
  const workspaceId = 'coordination-test-' + randomUUID();
  const runIds: string[] = [];
  beforeAll(async () => {
    if (!new URL(databaseUrl!).pathname.toLowerCase().includes('test')) throw new Error('Dedicated test database required');
    source = createPersistenceDataSource(databaseUrl!); await source.initialize(); await source.runMigrations();
    workspacePath = await mkdtemp(path.join(process.cwd(), '.runtime-coordination-test-'));
    await source.getRepository(RuntimeWorkspaceEntity).save({ id: workspaceId, name: 'Coordination tests', path: workspacePath, createdAt: new Date(), updatedAt: new Date() });
  });
  beforeEach(async () => {
    boundary.terminals.length = 0; boundary.turns.clear(); boundary.readGate = null; boundary.spawnFailure = false;
    service = new NativeRuntimeService(Promise.resolve(source));
    await service.listWorkspaces();
  });
  afterEach(async () => {
    boundary.readGate = null;
    for (const id of runIds) await service.closeRun(id);
    vi.useRealTimers();
    for (const id of runIds.splice(0)) await source.getRepository(RuntimeRunEntity).delete({ id });
  });
  afterAll(async () => {
    if (source?.isInitialized) {
      await source.getRepository(RuntimeWorkspaceEntity).delete({ id: workspaceId });
      await source.destroy();
    }
    if (workspacePath) await rm(workspacePath, { recursive: true, force: true });
  });
  async function seed(phase = 'supervisor_delegation', peerStatus = 'queued', peerNative: string | null = null) {
    const id = randomUUID(); runIds.push(id);
    const supervisorId = randomUUID(), peerId = randomUUID(), supervisorNative = randomUUID();
    const policy = createDefaultRoutingPolicy();
    policy.profiles.review = { ...policy.profiles.review, provider: 'codex', model: 'test-model', allowedEfforts: ['high'] };
    await source.getRepository(RuntimeRunEntity).save({
      id, workspaceId, taskId: 'bounded-review', prompt: 'Inspect coordination.', status: 'interrupted', phase,
      delegation: 'Inspect coordination with evidence.', delegationTurnId: 'delegation-turn', report: null, reportTurnId: null,
      reportDelivered: false, finalReport: null, finalTurnId: null, routingSnapshot: { revision: 7, policy },
      routingDecision: { taskKind: 'review', provider: 'codex', model: 'test-model', effort: 'high', reason: 'Review', instruction: 'Inspect coordination with evidence.' },
      createdAt: new Date(), updatedAt: new Date(),
    });
    for (const [sessionId, role, native, status] of [[supervisorId, 'supervisor', supervisorNative, 'interrupted'], [peerId, 'peer', peerNative, peerStatus]] as const) {
      await source.getRepository(RuntimeSessionEntity).save({ id: sessionId, runId: id, role, provider: 'codex', cwd: workspacePath!, nativeConversationId: native, model: role === 'peer' ? 'test-model' : null, reasoningEffort: role === 'peer' ? 'high' : null, status, pid: null, exitCode: null, lastSequence: 0, outputBytes: 0, startedAt: null, endedAt: null, createdAt: new Date(), updatedAt: new Date() });
    }
    boundary.turns.set(supervisorNative, [{ id: 'delegation-turn', status: 'completed', items: [{ type: 'agentMessage', text: '{"taskKind":"review","effort":"high","reason":"Review","instruction":"Inspect coordination with evidence."}' }] }]);
    return { id, supervisorId, peerId, supervisorNative };
  }
  function activate(sessionId: string, terminalIndex = boundary.terminals.length - 1) {
    boundary.terminals[terminalIndex].emit('\u001bP0;ORC_RUNTIME_READY:' + sessionId + ':1234\u001b\\Native ready');
  }

  it.each(['error', 'interrupted', 'closed'])('retries a %s peer bootstrap before UUID capture using the saved routing snapshot', async status => {
    const run = await seed('peer_running', status);
    await service.delegatePeer(run.id);
    expect(boundary.terminals).toHaveLength(1);
    expect(boundary.terminals[0].args).toContain('test-model');
    expect((await service.getRun(run.id)).routingSnapshot?.revision).toBe(7);
    expect((await service.getSession(run.peerId)).status).toBe('starting');
  });

  it('does not duplicate a peer whose native UUID was already persisted', async () => {
    const run = await seed('peer_running', 'interrupted', randomUUID());
    await service.delegatePeer(run.id);
    expect(boundary.terminals).toHaveLength(0);
    expect((await service.getSession(run.peerId)).nativeConversationId).not.toBeNull();
  });

  it('keeps one pending report paste while native history has not acknowledged its token', async () => {
    const peerNative = randomUUID();
    const run = await seed('peer_running', 'interrupted', peerNative);
    boundary.turns.set(peerNative, [{ id: 'peer-report-turn', status: 'completed', items: [{ type: 'agentMessage', text: 'Evidence and limitations.' }] }]);
    await service.resumeSession(run.supervisorId); activate(run.supervisorId);
    await until(() => boundary.terminals.length === 1);
    await until(async () => (await service.getSession(run.supervisorId)).processConfirmed);
    await service.submitReport(run.id); await service.submitReport(run.id);
    expect(boundary.terminals[0].writes.filter(text => text.includes('ORC_REPORT_'))).toHaveLength(1);
    expect((await service.getRun(run.id)).reportDelivered).toBe(false);
  });

  it('fences a delegation waiting on native history when close completes', async () => {
    const run = await seed();
    const saved = await source.getRepository(RuntimeRunEntity).findOneByOrFail({ id: run.id }); saved.delegation = null; saved.routingDecision = null; await source.getRepository(RuntimeRunEntity).save(saved);
    const entered = deferred(), release = deferred();
    boundary.readGate = async () => { entered.resolve(); await release.promise; };
    const launch = service.delegatePeer(run.id); const result = launch.catch(error => error as Error);
    await entered.promise; await service.closeRun(run.id); release.resolve();
    await result;
    expect(boundary.terminals).toHaveLength(0);
    expect((await service.getRun(run.id)).status).toBe('interrupted');
    expect((await service.getSession(run.peerId)).status).not.toBe('starting');
  });

  it('fences resume during a native-history read and permits a later explicit resume', async () => {
    const run = await seed();
    const entered = deferred(), release = deferred();
    boundary.readGate = async () => { entered.resolve(); await release.promise; };
    const launch = service.resumeSession(run.supervisorId); const result = launch.catch(error => error as Error);
    await entered.promise; await service.closeRun(run.id); release.resolve(); await result;
    expect(boundary.terminals).toHaveLength(0);
    expect((await service.getRun(run.id)).status).toBe('interrupted');
    boundary.readGate = null;
    await service.resumeSession(run.supervisorId);
    expect(boundary.terminals[0].args.slice(-2)).toEqual(['resume', run.supervisorNative]);
  });

  it('rejects a resume while a different run has a starting session', async () => {
    const first = await seed(); const second = await seed();
    await service.resumeSession(first.supervisorId);
    await expect(service.resumeSession(second.supervisorId)).rejects.toThrow('runtime_busy');
    expect(boundary.terminals).toHaveLength(1);
    expect((await service.getSession(second.supervisorId)).status).toBe('interrupted');
  });

  it('admits supervisor and peer resumes for the same run with their exact UUIDs', async () => {
    const native = randomUUID(); const run = await seed('peer_running', 'interrupted', native);
    boundary.turns.set(native, [{ id: 'peer-turn', status: 'completed', items: [] }]);
    await service.resumeSession(run.supervisorId); await service.resumeSession(run.peerId);
    expect(boundary.terminals.map(terminal => terminal.args.slice(-2))).toEqual([['resume', run.supervisorNative], ['resume', native]]);
  });
  it('recovers a persisted starting peer after server restart before UUID capture', async () => {
    const run = await seed('peer_running', 'starting');
    service = new NativeRuntimeService(Promise.resolve(source));
    await service.listWorkspaces();
    expect((await service.getSession(run.peerId)).status).toBe('interrupted');
    await service.delegatePeer(run.id);
    expect(boundary.terminals).toHaveLength(1);
    expect(boundary.terminals[0].args).not.toContain('resume');
    expect((await service.getRun(run.id)).routingSnapshot?.revision).toBe(7);
  });

  it('retries after actual asynchronous status-capture timeout without submitting the task twice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = await seed();
    await service.delegatePeer(run.id); activate(run.peerId);
    await until(() => boundary.terminals[0].writes.length === 0);
    await delay(30);
    await vi.advanceTimersByTimeAsync(3000);
    for (let attempt = 0; attempt < 3; attempt++) { await vi.advanceTimersByTimeAsync(7000); await delay(20); }
    await until(async () => !(await service.getSession(run.peerId)).processConfirmed);
    expect((await service.getSession(run.peerId))).toMatchObject({ status: 'error', nativeConversationId: null });
    expect(boundary.terminals[0].writes.some(text => text.includes('single delegated peer'))).toBe(false);
    await service.delegatePeer(run.id);
    expect(boundary.terminals).toHaveLength(2);
    expect((await service.getRun(run.id)).status).toBe('active');
  });

  it('close prevents delayed bootstrap status requests and task entry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = await seed();
    await service.delegatePeer(run.id); activate(run.peerId);
    await delay(30);
    await service.closeRun(run.id);
    await vi.advanceTimersByTimeAsync(24000);
    expect(boundary.terminals[0].writes).toEqual([]);
    expect((await service.getSession(run.peerId))).toMatchObject({ status: 'closed', nativeConversationId: null });
    expect((await service.getRun(run.id)).status).toBe('interrupted');
  });

  it.each(['starting', 'active', 'closing'])('rejects cross-run resume against an opposite-role %s session', async status => {
    const first = await seed('peer_running', status, randomUUID());
    const second = await seed();
    await expect(service.resumeSession(second.supervisorId)).rejects.toThrow('runtime_busy');
    expect(boundary.terminals).toHaveLength(0);
    expect((await service.getSession(second.supervisorId))).toMatchObject({ status: 'interrupted', nativeConversationId: second.supervisorNative });
    expect((await service.getSession(first.peerId)).status).toBe(status);
  });

  it('serializes concurrent cross-run resumes under the global admission lock', async () => {
    const first = await seed('peer_running', 'interrupted', randomUUID()); const second = await seed();
    const results = await Promise.allSettled([service.resumeSession(first.peerId), service.resumeSession(second.supervisorId)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.message).toBe('runtime_busy');
    expect(boundary.terminals).toHaveLength(1);
  });

  async function reportingRun() {
    const native = randomUUID(); const run = await seed('peer_running', 'interrupted', native);
    boundary.turns.set(native, [{ id: 'peer-report-turn', status: 'completed', items: [{ type: 'agentMessage', text: 'Evidence and limitations.' }] }]);
    await service.resumeSession(run.supervisorId); activate(run.supervisorId);
    await delay(20);
    return run;
  }
  function acknowledge(run: { id: string; supervisorNative: string }, completed = false) {
    boundary.turns.set(run.supervisorNative, [{
      id: 'final-turn', status: completed ? 'completed' : 'inProgress', items: [
        { type: 'userMessage', content: [{ type: 'text', text: 'ORC_REPORT_' + run.id + '_peer-report-turn' }] },
        ...(completed ? [{ type: 'agentMessage', text: 'Final evidence and limitations.' }] : []),
      ],
    }]);
  }

  it('native-history acknowledgement marks delivery and finalization keeps token validation', async () => {
    const run = await reportingRun();
    await service.submitReport(run.id); acknowledge(run);
    await service.submitReport(run.id);
    // The confirmation poll owns delivery until the token is present in persisted native history.
    await until(async () => (await service.getRun(run.id)).reportDelivered);
    expect((await service.getRun(run.id)).reportDelivered).toBe(true);
    await expect(service.finalizeRun(run.id)).rejects.toThrow('native_turn_not_completed');
    acknowledge(run, true);
    expect((await service.finalizeRun(run.id))).toMatchObject({ phase: 'done', status: 'done', finalReport: 'Final evidence and limitations.' });
    expect(boundary.terminals[0].writes.filter(text => text.includes('ORC_REPORT_'))).toHaveLength(1);
  });

  it('retries a timed-out unacknowledged handoff after the pending delivery expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = await reportingRun();
    await service.submitReport(run.id);
    for (let attempt = 0; attempt < 24; attempt++) { await vi.advanceTimersByTimeAsync(500); await delay(10); }
    await service.submitReport(run.id);
    expect(boundary.terminals[0].writes.filter(text => text.includes('ORC_REPORT_'))).toHaveLength(2);
    expect((await service.getRun(run.id)).reportDelivered).toBe(false);
  });

  it('does not hold a pending delivery when the supervisor is unavailable', async () => {
    const native = randomUUID(); const run = await seed('peer_running', 'interrupted', native);
    boundary.turns.set(native, [{ id: 'peer-report-turn', status: 'completed', items: [{ type: 'agentMessage', text: 'Evidence and limitations.' }] }]);
    await service.submitReport(run.id);
    expect((await service.getRun(run.id)).reportDelivered).toBe(false);
    await service.resumeSession(run.supervisorId); activate(run.supervisorId);
    await delay(20);
    await service.submitReport(run.id);
    expect(boundary.terminals[0].args.at(-1)).toContain('ORC_REPORT_');
    expect(boundary.terminals[0].writes.filter(text => text.includes('ORC_REPORT_'))).toHaveLength(0);
  });

  it('after restart reconciles an acknowledged report without pasting it again', async () => {
    const native = randomUUID(); const run = await seed('supervisor_reporting', 'interrupted', native);
    const row = await source.getRepository(RuntimeRunEntity).findOneByOrFail({ id: run.id });
    row.report = 'Evidence and limitations.'; row.reportTurnId = 'peer-report-turn';
    await source.getRepository(RuntimeRunEntity).save(row);
    acknowledge(run, true);
    service = new NativeRuntimeService(Promise.resolve(source));
    await service.resumeSession(run.supervisorId);
    expect(boundary.terminals[0].args.slice(-2)).toEqual(['resume', run.supervisorNative]);
    expect((await service.getRun(run.id)).reportDelivered).toBe(true);
  });

  it('close cancels a pending acknowledgement blocked in native history', async () => {
    const run = await reportingRun();
    await service.submitReport(run.id);
    const entered = deferred(), release = deferred();
    boundary.readGate = async () => { entered.resolve(); await release.promise; };
    await entered.promise;
    acknowledge(run);
    await service.closeRun(run.id); release.resolve();
    await delay(30);
    expect((await service.getRun(run.id))).toMatchObject({ status: 'interrupted', reportDelivered: false });
  });

  it('close fences a report send paused before its native-history check returns', async () => {
    const run = await reportingRun();
    const row = await source.getRepository(RuntimeRunEntity).findOneByOrFail({ id: run.id });
    row.report = 'Evidence and limitations.'; row.reportTurnId = 'peer-report-turn'; row.phase = 'supervisor_reporting'; row.status = 'reporting';
    await source.getRepository(RuntimeRunEntity).save(row);
    const entered = deferred(), release = deferred();
    boundary.readGate = async () => { entered.resolve(); await release.promise; };
    const handoff = service.submitReport(run.id);
    await entered.promise; await service.closeRun(run.id); release.resolve();
    await handoff;
    expect(boundary.terminals[0].writes.filter(text => text.includes('ORC_REPORT_'))).toHaveLength(0);
    expect((await service.getRun(run.id))).toMatchObject({ status: 'interrupted', reportDelivered: false });
  });

  it('close fences resume paused in its initial persistence read', async () => {
    const run = await seed();
    const repo = source.getRepository(RuntimeSessionEntity), original = repo.findOneBy.bind(repo);
    const entered = deferred(), release = deferred(); let first = true;
    const spy = vi.spyOn(repo, 'findOneBy').mockImplementation(async where => {
      const row = await original(where);
      if (first && !Array.isArray(where) && where.id === run.supervisorId) { first = false; entered.resolve(); await release.promise; }
      return row;
    });
    try {
      const launch = service.resumeSession(run.supervisorId); const result = launch.catch(error => error as Error);
      await entered.promise; await service.closeRun(run.id); release.resolve(); await result;
      expect(boundary.terminals).toHaveLength(0);
      expect((await service.getRun(run.id)).status).toBe('interrupted');
    } finally { spy.mockRestore(); release.resolve(); }
  });

  it('close preserves closed session state when UUID persistence was already waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = await seed(), native = randomUUID();
    await service.delegatePeer(run.id); activate(run.peerId);
    await delay(30); await vi.advanceTimersByTimeAsync(3000);
    const repo = source.getRepository(RuntimeSessionEntity);
    const originalSave = repo.save.bind(repo), originalUpdate = repo.update.bind(repo);
    const entered = deferred(), release = deferred(); let waiting = true, finished = false;
    async function pause(nativeId: unknown) {
      if (waiting && nativeId === native) { waiting = false; entered.resolve(); await release.promise; }
    }
    const saveSpy = vi.spyOn(repo, 'save').mockImplementation((async (row: import('../server/runtime/entities').RuntimeSessionRow) => {
      await pause(row.nativeConversationId);
      const saved = await originalSave(row); if (row.nativeConversationId === native) finished = true;
      return saved;
    }) as typeof repo.save);
    const updateSpy = vi.spyOn(repo, 'update').mockImplementation(async (criteria, partial) => {
      await pause(partial.nativeConversationId);
      const result = await originalUpdate(criteria, partial); if (partial.nativeConversationId === native) finished = true;
      return result;
    });
    try {
      boundary.terminals[0].emit('Model: test-model (reasoning high, summaries auto)\nModel provider: openai\nSession: ' + native + '\nWeekly limit: 45%');
      await entered.promise; await service.closeRun(run.id); release.resolve();
      await until(() => finished); await delay(30);
      expect((await service.getSession(run.peerId)).status).toBe('closed');
      expect((await service.getRun(run.id)).status).toBe('interrupted');
      expect(boundary.terminals[0].writes.some(text => text.includes('single delegated peer'))).toBe(false);
    } finally { saveSpy.mockRestore(); updateSpy.mockRestore(); release.resolve(); }
  });

  it('close prevents stale model-mismatch failure after the routing snapshot read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = await seed(), native = randomUUID();
    await service.delegatePeer(run.id); activate(run.peerId);
    await delay(30); await vi.advanceTimersByTimeAsync(3000);
    const repo = source.getRepository(RuntimeRunEntity), original = repo.findOneBy.bind(repo);
    const entered = deferred(), release = deferred(); let waiting = true;
    const spy = vi.spyOn(repo, 'findOneBy').mockImplementation(async where => {
      const row = await original(where);
      if (waiting && !Array.isArray(where) && where.id === run.id) { waiting = false; entered.resolve(); await release.promise; }
      return row;
    });
    try {
      boundary.terminals[0].emit('Model: wrong-model (reasoning low, summaries auto)\nModel provider: openai\nSession: ' + native + '\nWeekly limit: 45%');
      await entered.promise; await service.closeRun(run.id); release.resolve();
      await delay(50);
      expect((await service.getSession(run.peerId))).toMatchObject({ status: 'closed', nativeConversationId: native });
      expect((await service.getRun(run.id)).status).toBe('interrupted');
      expect(boundary.terminals[0].writes.some(text => text.includes('single delegated peer'))).toBe(false);
    } finally { spy.mockRestore(); release.resolve(); }
  });

  it('close fences finalization waiting for an acknowledged native final turn', async () => {
    const run = await reportingRun();
    await service.submitReport(run.id); acknowledge(run, true);
    await until(async () => (await service.getRun(run.id)).reportDelivered);
    const entered = deferred(), release = deferred();
    boundary.readGate = async () => { entered.resolve(); await release.promise; };
    const finalize = service.finalizeRun(run.id); const result = finalize.catch(error => error as Error);
    await entered.promise; await service.closeRun(run.id); release.resolve(); await result;
    expect((await service.getRun(run.id))).toMatchObject({ status: 'interrupted', phase: 'supervisor_reporting', finalReport: null });
  });

  it('close fences failed launch cleanup already waiting to persist a session error', async () => {
    const run = await seed(); boundary.spawnFailure = true;
    const repo = source.getRepository(RuntimeSessionEntity);
    const originalSave = repo.save.bind(repo), originalUpdate = repo.update.bind(repo);
    const entered = deferred(), release = deferred(); let waiting = true;
    async function pause(id: unknown, status: unknown) {
      if (waiting && id === run.peerId && status === 'error') { waiting = false; entered.resolve(); await release.promise; }
    }
    const saveSpy = vi.spyOn(repo, 'save').mockImplementation((async (row: import('../server/runtime/entities').RuntimeSessionRow) => {
      await pause(row.id, row.status); return originalSave(row);
    }) as typeof repo.save);
    const updateSpy = vi.spyOn(repo, 'update').mockImplementation(async (criteria, partial) => {
      await pause(typeof criteria === 'object' && !Array.isArray(criteria) && criteria !== null && 'id' in criteria ? criteria.id : null, partial.status);
      return originalUpdate(criteria, partial);
    });
    try {
      const launch = service.delegatePeer(run.id); const result = launch.catch(error => error as Error);
      await entered.promise; await service.closeRun(run.id); release.resolve(); await result;
      expect((await service.getSession(run.peerId)).status).toBe('closed');
      expect((await service.getRun(run.id)).status).toBe('interrupted');
    } finally { saveSpy.mockRestore(); updateSpy.mockRestore(); release.resolve(); boundary.spawnFailure = false; }
  });

});
