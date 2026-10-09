import 'reflect-metadata';
import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants, accessSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import * as pty from 'node-pty';
import { Not, type DataSource } from 'typeorm';
import { getPersistenceDataSource } from '../persistence/data-source';
import { RuntimeEventEntity, RuntimeRunEntity, RuntimeSessionEntity, RuntimeWorkspaceEntity, type RuntimeEventKind, type RuntimeSessionRow } from './entities';
import { parseCodexStatus } from './status';
import { canonicalWorkspace } from './workspace-paths';
import { parseRoutingDecision, parseRoutingPolicy, type RoutingDecision, type RoutingPolicySnapshot } from '../../features/settings/routing-policy';
import { getRoutingSettings } from './routing-settings';
import { runtimeEventNotifier } from './sse';

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_EVENT_BYTES = 32 * 1024;
const MAX_PROMPT_CHARS = 8000;
const IDLE_MS = Math.max(60_000, Number(process.env.ORC_RUNTIME_IDLE_MS) || 30 * 60 * 1000);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Workspace = { id: string; name: string; path: string; status: 'ready' | 'unavailable' };
type SessionStatus = 'queued' | 'starting' | 'active' | 'closing' | 'closed' | 'error' | 'interrupted';
type RuntimeEvent = { sequence: number; sessionId: string; kind: RuntimeEventKind; text?: string; dataBase64?: string; status?: SessionStatus; cols?: number; rows?: number; createdAt: string };
type SessionPublic = { id: string; runId: string; role: 'supervisor' | 'peer'; provider: 'codex'; cwd: string; nativeConversationId: string | null; model: string | null; reasoningEffort: string | null; status: SessionStatus; processConfirmed: boolean; pid: number | null; exitCode: number | null; lastSequence: number; startedAt: string | null; endedAt: string | null };
type RunPublic = { id: string; workspaceId: string; taskId: string; status: string; phase: string; prompt: string; delegation: string | null; report: string | null; reportDelivered: boolean; finalReport: string | null; routingSnapshot: RoutingPolicySnapshot | null; routingDecision: RoutingDecision | null; createdAt: string; updatedAt: string; sessions: SessionPublic[] };

type LiveProcess = { terminal: pty.IPty; lastActivity: number; closing: boolean; confirmed: boolean; markerSeen: boolean; nativePid: number | null; nativeConversationId: string | null; bootstrapReady: boolean; startup: Buffer; outputQueue: Promise<void>; exited: Promise<void>; exitDisposable: { dispose(): void }; initialPrompt: string | null; captureStatus: boolean; statusText: string; statusAttempts: number };
type CompletedAssistantTurn = { turnId: string; text: string };
type NativeTurn = { id: string; status: string; items: Array<Record<string, unknown>> };

function localHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')).toLowerCase() : host.split(':')[0]?.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function isLocalRuntimeRequest(request: Request): boolean {
  const host = request.headers.get('host');
  if (!localHost(host)) return false;
  const origin = request.headers.get('origin');
  if (!origin || ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  try {
    const originUrl = new URL(origin);
    return localHost(originUrl.host) && originUrl.host.toLowerCase() === host?.toLowerCase();
  } catch { return false; }
}

export function validWorkspaceId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'runtime_error';
}

function publicSession(row: Record<string, unknown>, processConfirmed: boolean): SessionPublic {
  return {
    id: String(row.id), runId: String(row.runId ?? row.run_id), role: row.role as SessionPublic['role'], provider: 'codex',
    cwd: String(row.cwd), nativeConversationId: row.nativeConversationId == null ? null : String(row.nativeConversationId),
    model: row.model == null ? null : String(row.model), reasoningEffort: row.reasoningEffort == null ? null : String(row.reasoningEffort),
    status: row.status as SessionStatus, processConfirmed,
    pid: row.pid == null ? null : Number(row.pid), exitCode: row.exitCode == null ? null : Number(row.exitCode),
    lastSequence: Number(row.lastSequence ?? 0), startedAt: row.startedAt ? new Date(String(row.startedAt)).toISOString() : null,
    endedAt: row.endedAt ? new Date(String(row.endedAt)).toISOString() : null,
  };
}

function codexExecutable(): string {
  const configured = process.env.ORC_CODEX_BIN;
  if (configured) return configured;
  for (const folder of (process.env.PATH || '').split(path.delimiter)) {
    if (!folder) continue;
    const candidate = path.join(folder, 'codex');
    try { accessSync(candidate, fsConstants.X_OK); return candidate; } catch {}
  }
  return 'codex';
}

function jsonLine(value: unknown): string { return `${JSON.stringify(value)}\n`; }

export function buildCodexSessionArgs(input: { cwd: string; model: string | null; reasoningEffort: string | null; nativeConversationId: string | null; resumePrompt?: string | null }): string[] {
  const args = ['--no-alt-screen', '--no-daemon', '-C', input.cwd, '-s', 'read-only', '-a', 'on-request'];
  if (input.model) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}$/.test(input.model)) throw new Error('invalid_routing_settings');
    args.push('--model', input.model);
  }
  if (input.reasoningEffort) {
    if (!['minimal', 'low', 'medium', 'high', 'xhigh'].includes(input.reasoningEffort)) throw new Error('invalid_routing_settings');
    args.push('-c', `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`);
  }
  if (input.nativeConversationId) {
    args.push('resume', input.nativeConversationId);
    if (input.resumePrompt) args.push(input.resumePrompt);
  }
  return args;
}

export function applyRoutingDecisionToPeer(peer: Pick<RuntimeSessionRow, 'model' | 'reasoningEffort'>, decision: RoutingDecision): void {
  peer.model = decision.model;
  peer.reasoningEffort = decision.effort;
}

class CodexAppServer {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: NodeJS.Timeout }>();

  private constructor(cwd: string) {
    // turbopackIgnore: true — Codex is a host-installed CLI, never a bundled dependency.
    this.child = spawnChild(/* turbopackIgnore: true */ codexExecutable(), ['app-server', '--stdio'], { cwd, env: process.env, stdio: 'pipe' });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.onData(String(chunk)));
    this.child.stderr.resume();
    this.child.on('error', error => this.rejectAll(error));
    this.child.on('exit', code => this.rejectAll(new Error(`codex_app_server_exited_${code ?? 'unknown'}`)));
  }

  static async create(cwd: string): Promise<CodexAppServer> {
    const server = new CodexAppServer(cwd);
    try {
      await server.request('initialize', { clientInfo: { name: 'orc-studio', version: '0.1.0' }, capabilities: { experimentalApi: false } });
      server.child.stdin.write(jsonLine({ method: 'initialized' }));
      return server;
    } catch (error) {
      await server.close();
      throw error;
    }
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 10_000_000) { this.rejectAll(new Error('codex_app_server_output_limit')); return; }
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const id = typeof message.id === 'number' ? message.id : null;
      if (id === null) continue;
      const pending = this.pending.get(id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (message.error) pending.reject(new Error('codex_app_server_request_failed'));
      else pending.resolve((message.result || {}) as Record<string, unknown>);
    }
  }

  private rejectAll(error: Error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }

  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`codex_app_server_timeout_${method}`)); }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(jsonLine({ id, method, params }));
    });
  }

  async readLatestCompletedMessage(threadId: string): Promise<string> {
    const turn = await this.readLatestCompletedTurn(threadId);
    return turn.text;
  }

  async readLatestCompletedTurn(threadId: string): Promise<CompletedAssistantTurn> {
    const result = await this.request('thread/read', { threadId, includeTurns: true });
    const thread = result.thread as Record<string, unknown> | undefined;
    const turns = Array.isArray(thread?.turns) ? thread.turns as Array<Record<string, unknown>> : [];
    const turn = turns.at(-1);
    if (!turn || turn.status !== 'completed') throw new Error('native_turn_not_completed');
    const items = Array.isArray(turn.items) ? turn.items as Array<Record<string, unknown>> : [];
    const text = items.filter(item => item.type === 'agentMessage' && typeof item.text === 'string')
      .map(item => String(item.text).trim()).filter(Boolean).join('\n\n').trim();
    if (!text) throw new Error('native_report_unavailable');
    return { turnId: String(turn.id), text: Buffer.byteLength(text, 'utf8') > 20_000 ? text.slice(0, 20_000) : text };
  }

  async latestTurn(threadId: string): Promise<NativeTurn | null> {
    const result = await this.request('thread/read', { threadId, includeTurns: true });
    const thread = result.thread as Record<string, unknown> | undefined;
    const turns = Array.isArray(thread?.turns) ? thread.turns as NativeTurn[] : [];
    return turns.at(-1) || null;
  }

  async hasUserMessageContaining(threadId: string, needle: string): Promise<boolean> {
    const result = await this.request('thread/read', { threadId, includeTurns: true });
    const thread = result.thread as Record<string, unknown> | undefined;
    const turns = Array.isArray(thread?.turns) ? thread.turns as Array<Record<string, unknown>> : [];
    return turns.some(turn => Array.isArray(turn.items) && (turn.items as Array<Record<string, unknown>>).some(item => {
      if (item.type !== 'userMessage' || !Array.isArray(item.content)) return false;
      return (item.content as Array<Record<string, unknown>>).some(content => typeof content.text === 'string' && content.text.includes(needle));
    }));
  }

  async completedTurnHasUserMessage(threadId: string, turnId: string, needle: string): Promise<boolean> {
    const turn = await this.latestTurn(threadId);
    return turn?.id === turnId && turn.status === 'completed' && turn.items.some(item => {
      if (item.type !== 'userMessage' || !Array.isArray(item.content)) return false;
      return (item.content as Array<Record<string, unknown>>).some(content => typeof content.text === 'string' && content.text.includes(needle));
    });
  }

  async latestTurnHasUserMessage(threadId: string, needle: string): Promise<{ turn: NativeTurn | null; found: boolean }> {
    const turn = await this.latestTurn(threadId);
    const found = Boolean(turn?.items.some(item => {
      if (item.type !== 'userMessage' || !Array.isArray(item.content)) return false;
      return (item.content as Array<Record<string, unknown>>).some(content => typeof content.text === 'string' && content.text.includes(needle));
    }));
    return { turn, found };
  }

  async close(): Promise<void> {
    this.rejectAll(new Error('codex_app_server_closed'));
    if (this.child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      let killTimer: NodeJS.Timeout | undefined;
      const settle = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); resolve(); };
      const timer = setTimeout(() => {
        this.child.kill('SIGKILL');
        killTimer = setTimeout(settle, 1000);
      }, 1500);
      this.child.once('exit', settle);
      this.child.stdin.end();
    });
  }
}

export class NativeRuntimeService {
  private sourcePromise: Promise<DataSource>;
  private live = new Map<string, LiveProcess>();
  private recovered = false;
  private recoveryPromise: Promise<void> | null = null;
  private resuming = new Set<string>();
  private delegating = new Set<string>();
  private handingOff = new Set<string>();
  private pendingReports = new Map<string, { token: string; delivery: Promise<void> }>();
  private launchEpochs = new Map<string, number>();
  private closingRuns = new Set<string>();

  constructor(sourcePromise = getPersistenceDataSource()) { this.sourcePromise = sourcePromise; }

  private async source() { return this.sourcePromise; }

  private assertLaunchCurrent(runId: string, epoch: number): void {
    if (this.closingRuns.has(runId) || (this.launchEpochs.get(runId) || 0) !== epoch) throw new Error('session_not_resumable');
  }

  private async saveLaunchRun(run: import('./entities').RuntimeRunRow, epoch: number): Promise<void> {
    const source = await this.source();
    await source.transaction(async manager => {
      const repo = manager.getRepository(RuntimeRunEntity);
      const current = await repo.createQueryBuilder('run').setLock('pessimistic_write').where('run.id = :id', { id: run.id }).getOneOrFail();
      if (current.phase === 'done') throw new Error('session_not_resumable');
      this.assertLaunchCurrent(run.id, epoch);
      await repo.save(run);
    });
  }

  private trackReportHandoff(runId: string, cwd: string, nativeId: string, token: string): void {
    if (this.pendingReports.get(runId)?.token === token) return;
    const pending = { token, delivery: Promise.resolve() };
    this.pendingReports.set(runId, pending);
    pending.delivery = this.confirmReportHandoff(runId, cwd, nativeId, token, pending)
      .catch(() => undefined)
      .finally(() => { if (this.pendingReports.get(runId) === pending) this.pendingReports.delete(runId); });
  }

  private supervisorRoutingPrompt(taskId: string, request: string, snapshot: RoutingPolicySnapshot, continuation = false): string {
    const restartPrefix = continuation ? 'The server restarted while this Supervisor turn was unfinished. Continue in this same native conversation and return the required JSON routing decision using the saved policy below.\n\n' : '';
    return `${restartPrefix}You are the ORC Supervisor for task ${taskId}. Do not use tools, read files, spawn subagents, or attempt the original task yourself. Select exactly one task category and one effort from that category's configured allowedEfforts. ORC derives provider and model from the saved policy; you may not choose either. Return only a JSON object matching {"taskKind":"coding|planning|review","effort":"<one allowed value>","reason":"<brief rationale>","instruction":"<precise bounded task for one read-only peer>"}. Require concrete evidence, a concise report, and explicit limitations. Configured routing snapshot revision ${snapshot.revision}; saved task profiles: ${JSON.stringify(snapshot.policy.profiles)}. User request: ${request}`;
  }

  private async latestNativeTurn(cwd: string, nativeConversationId: string): Promise<NativeTurn | null> {
    const appServer = await CodexAppServer.create(cwd);
    try { return await appServer.latestTurn(nativeConversationId); }
    finally { await appServer.close(); }
  }

  private async recover(): Promise<void> {
    if (this.recovered) return;
    if (!this.recoveryPromise) {
      this.recoveryPromise = (async () => {
        const source = await this.source();
        const sessions = source.getRepository(RuntimeSessionEntity);
        const active = await sessions.findBy([{ status: 'starting' }, { status: 'active' }, { status: 'closing' }]);
        for (const session of active) {
          session.status = 'interrupted'; session.endedAt = new Date(); session.pid = null;
          await sessions.save(session);
          await this.appendEvent(session.id, { kind: 'status', status: 'interrupted', text: 'The server restarted; this PTY is no longer attached. Resume the saved Codex conversation explicitly to continue.' });
        }
        const runs = await source.getRepository(RuntimeRunEntity).findBy([{ status: 'starting' }, { status: 'active' }, { status: 'reporting' }, { status: 'closing' }]);
        for (const run of runs) { run.status = 'interrupted'; await source.getRepository(RuntimeRunEntity).save(run); }
        this.recovered = true;
      })().catch(error => { this.recoveryPromise = null; throw error; });
    }
    await this.recoveryPromise;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    await this.recover();
    const repo = (await this.source()).getRepository(RuntimeWorkspaceEntity);
    const rows = await repo.find({ order: { name: 'ASC' } });
    return Promise.all(rows.map(async row => {
      let status: Workspace['status'] = 'ready';
      try { status = (await stat(await realpath(row.path))).isDirectory() ? 'ready' : 'unavailable'; } catch { status = 'unavailable'; }
      return { id: row.id, name: row.name, path: row.path, status };
    }));
  }

  async registerWorkspace(input: { id: unknown; name: unknown; path: unknown }): Promise<Workspace> {
    await this.recover();
    if (!validWorkspaceId(input.id) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160) throw new Error('invalid_workspace');
    const canonical = await canonicalWorkspace(input.path);
    const repo = (await this.source()).getRepository(RuntimeWorkspaceEntity);
    const existing = await repo.findOneBy([{ id: input.id }, { path: canonical }]);
    if (existing && (existing.id !== input.id || existing.path !== canonical)) throw new Error('workspace_already_registered');
    const workspace = repo.create({ id: input.id, name: input.name.trim(), path: canonical, createdAt: existing?.createdAt || new Date(), updatedAt: new Date() });
    await repo.save(workspace);
    return { id: workspace.id, name: workspace.name, path: workspace.path, status: 'ready' };
  }

  async createRun(input: { workspaceId: unknown; taskId: unknown; prompt: unknown }): Promise<RunPublic> {
    await this.recover();
    if (!validWorkspaceId(input.workspaceId) || typeof input.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(input.taskId)
      || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > MAX_PROMPT_CHARS) throw new Error('invalid_run');
    const source = await this.source();
    const settings = await getRoutingSettings(source);
    if (!settings.configured) throw new Error('routing_settings_not_configured');
    if (!settings.policy.supervisor || settings.policy.supervisor.provider !== 'codex') throw new Error('routing_provider_runner_unsupported');
    const workspace = await source.getRepository(RuntimeWorkspaceEntity).findOneBy({ id: input.workspaceId });
    if (!workspace) throw new Error('workspace_not_found');
    const cwd = await canonicalWorkspace(workspace.path);
    const runRepo = source.getRepository(RuntimeRunEntity);
    const runId = randomUUID();
    const sessionIds = { supervisor: randomUUID(), peer: randomUUID() };
    const run = await source.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [4815162342]);
      const transactionRuns = manager.getRepository(RuntimeRunEntity);
      const activeSession = await manager.getRepository(RuntimeSessionEntity).findOneBy([{ status: 'starting' }, { status: 'active' }, { status: 'closing' }]);
      if (activeSession) throw new Error('runtime_busy');
      const created = transactionRuns.create({ id: runId, workspaceId: workspace.id, taskId: input.taskId as string, prompt: (input.prompt as string).trim(), status: 'starting', phase: 'supervisor_delegation', delegation: null, delegationTurnId: null, report: null, reportTurnId: null, reportDelivered: false, finalReport: null, finalTurnId: null, routingSnapshot: { revision: settings.revision, policy: settings.policy }, routingDecision: null, createdAt: new Date(), updatedAt: new Date() });
      await transactionRuns.save(created);
      const sessionRepo = manager.getRepository(RuntimeSessionEntity);
      await sessionRepo.save(sessionRepo.create({ id: sessionIds.supervisor, runId, role: 'supervisor', provider: 'codex', cwd, nativeConversationId: null, model: settings.policy.supervisor.model, reasoningEffort: settings.policy.supervisor.effort,
        status: 'starting', pid: null, exitCode: null, lastSequence: 0, outputBytes: 0, startedAt: null, endedAt: null, createdAt: new Date(), updatedAt: new Date() }));
      await sessionRepo.save(sessionRepo.create({ id: sessionIds.peer, runId, role: 'peer', provider: 'codex', cwd, nativeConversationId: null, model: null, reasoningEffort: null,
        status: 'queued', pid: null, exitCode: null, lastSequence: 0, outputBytes: 0, startedAt: null, endedAt: null, createdAt: new Date(), updatedAt: new Date() }));
      return created;
    });
    const sessionRepo = source.getRepository(RuntimeSessionEntity);
    try {
      const supervisorPrompt = this.supervisorRoutingPrompt(input.taskId as string, (input.prompt as string).trim(), { revision: settings.revision, policy: settings.policy });
      await this.spawnSession(sessionIds.supervisor, supervisorPrompt, true);
    } catch (error) {
      await this.failRun(runId, errMessage(error));
      await this.closeRun(runId);
      throw new Error(errMessage(error));
    }
    return this.getRun(runId);
  }

  async listRuns(workspaceId?: string): Promise<RunPublic[]> {
    await this.recover();
    const repo = (await this.source()).getRepository(RuntimeRunEntity);
    const runs = await repo.find({ where: workspaceId ? { workspaceId } : {}, order: { createdAt: 'DESC' }, take: 20 });
    return Promise.all(runs.map(run => this.getRun(run.id)));
  }

  private async nativeTurn(sessionId: string): Promise<{ session: import('./entities').RuntimeSessionRow; turn: CompletedAssistantTurn }> {
    const source = await this.source();
    const session = await source.getRepository(RuntimeSessionEntity).findOneBy({ id: sessionId });
    if (!session) throw new Error('session_not_found');
    if (!session.nativeConversationId || !UUID_RE.test(session.nativeConversationId)) throw new Error('native_conversation_unknown');
    const appServer = await CodexAppServer.create(session.cwd);
    try { return { session, turn: await appServer.readLatestCompletedTurn(session.nativeConversationId) }; }
    finally { await appServer.close(); }
  }

  async delegatePeer(runId: string): Promise<RunPublic> {
    const epoch = this.launchEpochs.get(runId) || 0;
    await this.recover();
    this.assertLaunchCurrent(runId, epoch);
    if (this.delegating.has(runId)) throw new Error('runtime_busy');
    this.delegating.add(runId);
    try {
      const source = await this.source();
      const runRepo = source.getRepository(RuntimeRunEntity);
      let run = await source.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock($1)', [4815162342]);
        const repo = manager.getRepository(RuntimeRunEntity);
        const current = await repo.createQueryBuilder('run').setLock('pessimistic_write').where('run.id = :id', { id: runId }).getOne();
        if (!current) throw new Error('run_not_found');
        this.assertLaunchCurrent(runId, epoch);
        if (current.phase === 'peer_running') {
          const peer = await manager.getRepository(RuntimeSessionEntity).findOneBy({ runId, role: 'peer' });
          // No UUID means bootstrap never reached task submission. Reuse the saved choice.
          if (!peer || peer.nativeConversationId || !['error', 'interrupted', 'closed'].includes(peer.status)) return current;
          if (this.live.has(peer.id)) throw new Error('runtime_busy');
          current.phase = 'delegating';
        }
        if (current.phase === 'supervisor_reporting' || current.phase === 'done') return current;
        if (current.phase !== 'supervisor_delegation' && current.phase !== 'delegating') throw new Error('run_not_delegatable');
        current.phase = 'delegating'; current.status = 'active'; current.updatedAt = new Date();
        await repo.save(current); return current;
      });
      if (run.phase !== 'delegating') return this.getRun(runId);

      const supervisor = await source.getRepository(RuntimeSessionEntity).findOneBy({ runId, role: 'supervisor' });
      const peer = await source.getRepository(RuntimeSessionEntity).findOneBy({ runId, role: 'peer' });
      if (!supervisor || !peer) throw new Error('run_session_missing');
      if (peer.nativeConversationId) {
        if (!this.live.has(peer.id) && !['active', 'starting'].includes(peer.status)) {
          const appServer = await CodexAppServer.create(peer.cwd);
          let continuation: string | null = null;
          try {
            const latest = await appServer.latestTurn(peer.nativeConversationId);
            if (!latest || latest.status !== 'completed') continuation = `Continue the original delegated read-only task in this same conversation. Original task: ${run.prompt}\nSupervisor delegation: ${run.delegation || ''}`;
          } finally { await appServer.close(); }
          this.assertLaunchCurrent(runId, epoch);
          await this.spawnSession(peer.id, continuation, false, { runId, epoch });
        }
        run = await runRepo.findOneByOrFail({ id: runId });
        run.phase = 'peer_running'; run.status = 'active'; run.updatedAt = new Date(); await this.saveLaunchRun(run, epoch);
        return this.getRun(runId);
      }
      const snapshot = run.routingSnapshot as RoutingPolicySnapshot | null;
      const cachedDecision = run.routingDecision as RoutingDecision | null;
      const retryUnsupportedDecision = snapshot !== null && cachedDecision !== null && cachedDecision.provider !== 'codex' && !peer.nativeConversationId;
      if (!run.delegation || retryUnsupportedDecision) {
        const { turn } = await this.nativeTurn(supervisor.id);
        if (snapshot) {
          let decision: RoutingDecision;
          try { decision = parseRoutingDecision(turn.text, parseRoutingPolicy(snapshot.policy)); }
          catch { throw new Error('invalid_routing_decision'); }
          if (retryUnsupportedDecision && turn.turnId === run.delegationTurnId) throw new Error('routing_provider_runner_unsupported');
          run.routingDecision = decision;
          run.delegation = decision.instruction;
          run.delegationTurnId = turn.turnId;
          run.updatedAt = new Date();
          await this.saveLaunchRun(run, epoch);
          if (decision.provider !== 'codex') throw new Error('routing_provider_runner_unsupported');
        } else {
          // Pre-routing runs retain the original free-text delegation behavior.
          run.delegation = turn.text.slice(0, 20_000);
          run.delegationTurnId = turn.turnId;
        }
        run.updatedAt = new Date();
        await this.saveLaunchRun(run, epoch);
      }
      if (snapshot) {
        const decision = run.routingDecision as RoutingDecision | null;
        if (decision?.provider !== 'codex') throw new Error('routing_provider_runner_unsupported');
        // Reapply the persisted choice so retries after any checkpoint use the same configured runner.
        applyRoutingDecisionToPeer(peer, decision);
      }
      await source.transaction(async manager => {
        const sessions = manager.getRepository(RuntimeSessionEntity);
        await sessions.createQueryBuilder('session').setLock('pessimistic_write').where('session.id = :id', { id: peer.id }).getOneOrFail();
        this.assertLaunchCurrent(runId, epoch);
        peer.status = 'starting'; peer.pid = null; peer.exitCode = null; peer.endedAt = null; peer.updatedAt = new Date();
        await sessions.save(peer);
      });
      const delegatedPrompt = `You are the single delegated peer for task ${run.taskId}. Carry out the original request only within the supervisor's bounded delegation. Use read-only inspection, do not modify files, cite concrete evidence, and report limitations. Original request: ${run.prompt}\n\nSupervisor delegation:\n${run.delegation}`;
      this.assertLaunchCurrent(runId, epoch);
      await this.spawnSession(peer.id, delegatedPrompt, true, { runId, epoch });
      run = await runRepo.findOneByOrFail({ id: runId });
      run.phase = 'peer_running'; run.status = 'active'; run.updatedAt = new Date(); await this.saveLaunchRun(run, epoch);
      return this.getRun(runId);
    } catch (error) {
      if ((this.launchEpochs.get(runId) || 0) !== epoch || this.closingRuns.has(runId)) throw error;
      if (errMessage(error) === 'runtime_busy') throw error;
      if (['native_turn_not_completed', 'native_report_unavailable'].includes(errMessage(error))) {
        const runRepo = (await this.source()).getRepository(RuntimeRunEntity);
        await runRepo.update({ id: runId, phase: 'delegating' }, { phase: 'supervisor_delegation', status: 'active', updatedAt: new Date() });
        throw new Error('supervisor_turn_not_ready');
      }
      if (['invalid_routing_decision', 'routing_provider_runner_unsupported'].includes(errMessage(error))) {
        const runRepo = (await this.source()).getRepository(RuntimeRunEntity);
        await runRepo.update({ id: runId, phase: 'delegating' }, { phase: 'supervisor_delegation', status: 'active', updatedAt: new Date() });
        throw error;
      }
      await this.failRun(runId, errMessage(error), epoch);
      if ((this.launchEpochs.get(runId) || 0) === epoch && !this.closingRuns.has(runId)) await this.closeRun(runId);
      throw error;
    } finally { this.delegating.delete(runId); }
  }

  private async failRun(runId: string, message: string, epoch?: number) {
    if (epoch !== undefined && ((this.launchEpochs.get(runId) || 0) !== epoch || this.closingRuns.has(runId))) return;
    const source = await this.source();
    const sessions = await source.getRepository(RuntimeSessionEntity).findBy({ runId });
    for (const session of sessions) {
      if (this.live.has(session.id)) continue;
      if (session.status === 'starting' || session.status === 'queued') {
        if (epoch !== undefined && ((this.launchEpochs.get(runId) || 0) !== epoch || this.closingRuns.has(runId))) return;
        const failed = await source.getRepository(RuntimeSessionEntity).update({ id: session.id, status: session.status }, { status: 'error', endedAt: new Date(), updatedAt: new Date() });
        if (!failed.affected || (epoch !== undefined && ((this.launchEpochs.get(runId) || 0) !== epoch || this.closingRuns.has(runId)))) continue;
        await this.appendEvent(session.id, { kind: 'error', status: 'error', text: message });
      }
    }
    const run = await source.getRepository(RuntimeRunEntity).findOneBy({ id: runId });
    if (run && run.phase !== 'done') {
      if (epoch !== undefined && ((this.launchEpochs.get(runId) || 0) !== epoch || this.closingRuns.has(runId))) return;
      run.status = 'error'; run.updatedAt = new Date();
      if (epoch === undefined) await source.getRepository(RuntimeRunEntity).save(run);
      else {
        try { await this.saveLaunchRun(run, epoch); }
        catch (error) { if ((this.launchEpochs.get(runId) || 0) === epoch && !this.closingRuns.has(runId)) throw error; }
      }
    }
  }

  private async spawnSession(sessionId: string, initialPrompt: string | null, createNewConversation = false, launch?: { runId: string; epoch: number }): Promise<void> {
    const source = await this.source();
    const repo = source.getRepository(RuntimeSessionEntity);
    const row = await repo.findOneByOrFail({ id: sessionId });
    const epoch = launch?.epoch ?? (this.launchEpochs.get(row.runId) || 0);
    this.assertLaunchCurrent(row.runId, epoch);
    if (row.nativeConversationId && !UUID_RE.test(row.nativeConversationId)) throw new Error('native_conversation_unknown');
    if (!row.nativeConversationId && (!createNewConversation || !initialPrompt)) throw new Error('native_conversation_id_required');
    if (this.live.has(sessionId)) throw new Error('session_already_attached');
    const args = buildCodexSessionArgs({ ...row, resumePrompt: initialPrompt });
    const markerPrefix = `\u001bP0;ORC_RUNTIME_READY:${sessionId}:`;
    const markerSuffix = '\u001b\\';
    const watchdog = `
      const { spawn } = require('node:child_process');
      const parent = Number(process.env.ORC_RUNTIME_PARENT_PID);
      const bin = process.env.ORC_RUNTIME_CODEX_BIN;
      const args = JSON.parse(process.env.ORC_RUNTIME_CODEX_ARGS || '[]');
      const child = spawn(bin, args, { cwd: process.cwd(), env: process.env, stdio: ['inherit', 'inherit', 'inherit'], detached: true });
      let stopping = false;
      const stop = () => { if (stopping) return; stopping = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {} setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1200).unref(); };
      process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('SIGHUP', stop);
      process.on('SIGWINCH', () => { try { process.kill(-child.pid, 'SIGWINCH'); } catch {} });
      const check = setInterval(() => { try { process.kill(parent, 0); } catch { clearInterval(check); stop(); } }, 1000); check.unref();
      child.on('error', () => process.exit(127));
      child.once('spawn', () => process.stdout.write(${JSON.stringify(markerPrefix)} + child.pid + ${JSON.stringify(markerSuffix)}));
      child.on('exit', (code) => { clearInterval(check); process.exit(code ?? 1); });
    `;
    const env = {
      ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor',
      ORC_RUNTIME_PARENT_PID: String(process.pid), ORC_RUNTIME_CODEX_BIN: codexExecutable(),
      ORC_RUNTIME_CODEX_ARGS: JSON.stringify(args),
    };
    const starting = await repo.update({ id: sessionId, status: 'starting' }, { pid: null, startedAt: new Date(), updatedAt: new Date() });
    if (!starting.affected) throw new Error('session_not_resumable');
    this.assertLaunchCurrent(row.runId, epoch);
    const terminal = pty.spawn(process.execPath, ['-e', watchdog], { name: 'xterm-256color', cols: 100, rows: 30, cwd: row.cwd, env, encoding: null, handleFlowControl: true });
    let resolveExit!: () => void;
    const exited = new Promise<void>(resolve => { resolveExit = resolve; });
    const processEntry: LiveProcess = { terminal, lastActivity: Date.now(), closing: false, confirmed: false, markerSeen: false, nativePid: null, nativeConversationId: row.nativeConversationId, bootstrapReady: !createNewConversation, startup: Buffer.alloc(0), outputQueue: Promise.resolve(), exited, exitDisposable: { dispose() {} }, initialPrompt: createNewConversation ? initialPrompt : null, captureStatus: false, statusText: '', statusAttempts: 0 };
    this.live.set(sessionId, processEntry);
    row.pid = null; row.status = 'starting'; row.startedAt = new Date(); row.updatedAt = new Date();
    const stopAfterStartupPersistenceFailure = async (error: unknown) => {
      processEntry.closing = true;
      try { await this.failRun(row.runId, errMessage(error), epoch); } catch { /* persistence failure must still terminate the child */ }
      try { terminal.kill('SIGTERM'); } catch {}
    };
    processEntry.outputQueue = this.appendEvent(sessionId, { kind: 'status', status: 'starting', text: createNewConversation ? 'Starting a native Codex TUI; capturing its exact /status session UUID before sending the task.' : 'Resuming the persisted Codex conversation in a PTY.' })
      .then(() => this.appendEvent(sessionId, { kind: 'resize', text: JSON.stringify({ cols: 100, rows: 30 }) }))
      .catch(stopAfterStartupPersistenceFailure);
    const failStatusCapture = async () => {
      processEntry.captureStatus = false;
      await repo.update({ id: sessionId, status: 'active' }, { status: 'error', endedAt: new Date(), pid: null, updatedAt: new Date() });
      await this.appendEvent(sessionId, { kind: 'error', status: 'error', text: 'Codex did not expose its exact session UUID through /status; task was not sent.' });
      await this.failRun(row.runId, 'codex_session_id_capture_failed', epoch);
      processEntry.closing = true;
      try { terminal.kill('SIGTERM'); } catch {}
    };
    const requestSessionStatus = () => {
      if (!processEntry.initialPrompt || processEntry.nativeConversationId || processEntry.closing || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
      if (processEntry.statusAttempts >= 3) { void failStatusCapture(); return; }
      processEntry.statusAttempts++;
      const attempt = processEntry.statusAttempts;
      processEntry.captureStatus = true;
      processEntry.statusText = '';
      terminal.write('/status');
      setTimeout(() => { if (processEntry.captureStatus && attempt === processEntry.statusAttempts && !processEntry.closing && (this.launchEpochs.get(row.runId) || 0) === epoch) terminal.write('\r'); }, 300).unref();
      setTimeout(() => {
        if (processEntry.captureStatus && attempt === processEntry.statusAttempts) {
          processEntry.captureStatus = false;
          requestSessionStatus();
        }
      }, 7000).unref();
    };
    const captureSessionStatus = (bytes: Buffer) => {
      if (!processEntry.captureStatus || !processEntry.initialPrompt || processEntry.closing || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
      processEntry.statusText = (processEntry.statusText + bytes.toString('utf8')).slice(-32_000);
      const status = parseCodexStatus(processEntry.statusText);
      if (!status) return;
      processEntry.captureStatus = false;
      const nativeId = status.nativeConversationId;
      const prompt = processEntry.initialPrompt;
      processEntry.nativeConversationId = nativeId;
      void (async () => {
        const captured = await repo.findOneByOrFail({ id: sessionId });
        if (processEntry.closing || this.live.get(sessionId) !== processEntry || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
        if (captured.nativeConversationId && captured.nativeConversationId !== nativeId) throw new Error('native_conversation_id_mismatch');
        captured.nativeConversationId = nativeId;
        if (status.model) captured.model = status.model;
        if (status.reasoningEffort) captured.reasoningEffort = status.reasoningEffort;
        captured.updatedAt = new Date();
        const capturedIdentity = await repo.update({ id: sessionId, status: 'active' }, {
          nativeConversationId: nativeId, model: captured.model, reasoningEffort: captured.reasoningEffort, updatedAt: new Date(),
        });
        if (!capturedIdentity.affected || processEntry.closing || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
        const parentRun = await source.getRepository(RuntimeRunEntity).findOneBy({ id: row.runId });
        if (processEntry.closing || this.live.get(sessionId) !== processEntry || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
        const snapshot = parentRun?.routingSnapshot as RoutingPolicySnapshot | null | undefined;
        if (snapshot) {
          const expectedEffort = row.role === 'supervisor' ? snapshot.policy.supervisor.effort : (parentRun?.routingDecision as RoutingDecision | null)?.effort;
          const expectedModel = row.role === 'supervisor' ? snapshot.policy.supervisor.model : (parentRun?.routingDecision as RoutingDecision | null)?.model;
          const modelMismatch = expectedModel !== null && expectedModel !== undefined && (!status.model || status.model.toLowerCase() !== expectedModel.trim().toLowerCase());
          if (!expectedEffort || !status.model || !status.reasoningEffort || status.reasoningEffort !== expectedEffort || modelMismatch) {
            processEntry.closing = true;
            await this.appendEvent(sessionId, { kind: 'error', status: 'error', text: `Codex /status did not confirm the configured ${row.role} model and effort; task was not sent.` });
            await repo.update({ id: sessionId, status: 'active' }, { status: 'error', endedAt: new Date(), pid: null, updatedAt: new Date() });
            await this.failRun(row.runId, 'routing_session_configuration_mismatch', epoch);
            try { terminal.kill('SIGTERM'); } catch {}
            return;
          }
        }
        processEntry.outputQueue = processEntry.outputQueue.then(async () => {
          const latest = await repo.findOneByOrFail({ id: sessionId });
          if (latest.nativeConversationId && latest.nativeConversationId !== nativeId) throw new Error('native_conversation_id_mismatch');
          if (processEntry.closing || this.live.get(sessionId) !== processEntry || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
          latest.nativeConversationId = nativeId;
          if (status.model) latest.model = status.model;
          if (status.reasoningEffort) latest.reasoningEffort = status.reasoningEffort;
          latest.updatedAt = new Date();
          const savedIdentity = await repo.update({ id: sessionId, status: 'active' }, {
            nativeConversationId: nativeId, model: latest.model, reasoningEffort: latest.reasoningEffort, updatedAt: new Date(),
          });
          if (!savedIdentity.affected) return;
          if (processEntry.closing || this.live.get(sessionId) !== processEntry || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
          await this.appendEvent(sessionId, { kind: 'status', status: 'active', text: 'Exact native UUID and effective model/effort captured from Codex /status; sending the original task in this TUI.' });
          if (processEntry.closing || this.live.get(sessionId) !== processEntry || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
          terminal.write(`\u001b[200~${prompt}\u001b[201~`);
          setTimeout(() => { if (!processEntry.closing && this.live.get(sessionId) === processEntry && (this.launchEpochs.get(row.runId) || 0) === epoch) { terminal.write('\r'); processEntry.bootstrapReady = true; } }, 300).unref();
          processEntry.initialPrompt = null;
        });
      })().catch(error => { void this.failRun(row.runId, errMessage(error), epoch); });
    };
    const confirmNativeOutput = (output: Buffer) => {
      if (!output.length || processEntry.confirmed || processEntry.nativePid === null) return;
      processEntry.confirmed = true;
      const nativePid = processEntry.nativePid;
      processEntry.outputQueue = processEntry.outputQueue.then(async () => {
        if (processEntry.closing || this.live.get(sessionId) !== processEntry || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
        const confirmed = await repo.update({ id: sessionId, status: 'starting' }, { status: 'active', pid: nativePid, updatedAt: new Date() });
        if (!confirmed.affected || processEntry.closing || (this.launchEpochs.get(row.runId) || 0) !== epoch) return;
        await this.appendEvent(sessionId, { kind: 'status', status: 'active', text: createNewConversation ? 'Native Codex TUI is active; reading its session identity before task submission.' : 'Native Codex process is attached to the persisted conversation.' });
        await this.appendOutput(sessionId, output);
        const parentRun = await source.getRepository(RuntimeRunEntity).findOneBy({ id: row.runId });
        if (parentRun && parentRun.status === 'starting') { parentRun.status = 'active'; parentRun.updatedAt = new Date(); await this.saveLaunchRun(parentRun, epoch); }
        if (createNewConversation) setTimeout(requestSessionStatus, 3000).unref();
      }).catch(error => this.failRun(row.runId, errMessage(error), epoch));
    };
    terminal.onData(data => {
      processEntry.lastActivity = Date.now();
      if (processEntry.closing) return;
      const bytes = Buffer.from(data);
      if (!processEntry.markerSeen) {
        processEntry.startup = Buffer.concat([processEntry.startup, bytes]);
        const found = processEntry.startup.indexOf(Buffer.from(markerPrefix));
        if (found < 0) {
          if (processEntry.startup.length > 256 * 1024 && !processEntry.closing) {
            processEntry.closing = true;
            processEntry.outputQueue = processEntry.outputQueue.then(() => this.appendEvent(sessionId, { kind: 'error', status: 'error', text: 'PTY startup marker was not observed.' })).then(() => { terminal.kill('SIGTERM'); });
          }
          return;
        }
        const pidEnd = processEntry.startup.indexOf(Buffer.from(markerSuffix), found + markerPrefix.length);
        if (pidEnd < 0) return;
        const nativePid = Number(processEntry.startup.subarray(found + markerPrefix.length, pidEnd).toString('ascii'));
        if (!Number.isSafeInteger(nativePid) || nativePid < 1) return;
        processEntry.nativePid = nativePid;
        processEntry.markerSeen = true;
        const afterMarker = processEntry.startup.subarray(pidEnd + Buffer.byteLength(markerSuffix));
        const beforeMarker = processEntry.startup.subarray(0, found);
        processEntry.startup = Buffer.concat([beforeMarker, afterMarker]);
        if (!processEntry.startup.length) return;
        const terminalOutput = processEntry.startup;
        processEntry.startup = Buffer.alloc(0);
        confirmNativeOutput(terminalOutput);
        return;
      }
      if (!processEntry.confirmed) { confirmNativeOutput(bytes); return; }
      processEntry.outputQueue = processEntry.outputQueue.then(() => this.appendOutput(sessionId, bytes)).catch(error => this.failRun(row.runId, errMessage(error), epoch));
      captureSessionStatus(bytes);
    });
    processEntry.exitDisposable = terminal.onExit(({ exitCode }) => { void this.onExit(sessionId, exitCode, processEntry).catch(() => undefined).finally(resolveExit); });
    setTimeout(() => void this.closeIfIdle(sessionId), IDLE_MS + 250).unref();
  }

  private async appendOutput(sessionId: string, bytes: Buffer): Promise<void> {
    if (!bytes.length) return;
    const source = await this.source();
    let offset = 0;
    while (offset < bytes.length) {
      let limitReached = false;
      let inserted = false;
      await source.transaction(async manager => {
        const sessions = manager.getRepository(RuntimeSessionEntity);
        const current = await sessions.createQueryBuilder('session').setLock('pessimistic_write').where('session.id = :id', { id: sessionId }).getOne();
        if (!current || current.outputBytes >= MAX_OUTPUT_BYTES) { limitReached = true; return; }
        const data = bytes.subarray(offset, Math.min(bytes.length, offset + MAX_EVENT_BYTES, offset + (MAX_OUTPUT_BYTES - current.outputBytes)));
        const sequence = current.lastSequence + 1;
        current.lastSequence = sequence; current.outputBytes += data.length; current.updatedAt = new Date();
        await sessions.save(current);
        await manager.getRepository(RuntimeEventEntity).insert({ sessionId, sequence, kind: 'output', text: null, dataBase64: data.toString('base64'), status: null, createdAt: new Date() });
        offset += data.length;
        inserted = true;
        if (current.outputBytes >= MAX_OUTPUT_BYTES) limitReached = true;
      });
      if (inserted) runtimeEventNotifier.notify(sessionId);
      if (limitReached) {
        await this.appendEvent(sessionId, { kind: 'error', status: 'error', text: 'The 10 MiB PTY output limit was reached; the terminal was stopped to keep runtime storage bounded.' });
        await this.closeSession(sessionId);
        return;
      }
    }
  }

  private async appendEvent(sessionId: string, event: { kind: 'status' | 'resize' | 'error' | 'exit'; status?: string; text?: string }): Promise<void> {
    const source = await this.source();
    let inserted = false;
    await source.transaction(async manager => {
      const repo = manager.getRepository(RuntimeSessionEntity);
      const row = await repo.createQueryBuilder('session').setLock('pessimistic_write').where('session.id = :id', { id: sessionId }).getOne();
      if (!row) return;
      const sequence = row.lastSequence + 1;
      row.lastSequence = sequence; row.updatedAt = new Date(); await repo.save(row);
      await manager.getRepository(RuntimeEventEntity).insert({ sessionId, sequence, kind: event.kind, text: event.text?.slice(0, MAX_EVENT_BYTES), dataBase64: null, status: event.status || null, createdAt: new Date() });
      inserted = true;
    });
    if (inserted) runtimeEventNotifier.notify(sessionId);
  }

  private async onExit(sessionId: string, exitCode: number, entry?: LiveProcess): Promise<void> {
    if (entry) await entry.outputQueue.catch(() => undefined);
    const processEntry = this.live.get(sessionId);
    if (processEntry) { processEntry.exitDisposable.dispose(); this.live.delete(sessionId); }
    const source = await this.source();
    const session = await source.getRepository(RuntimeSessionEntity).findOneBy({ id: sessionId });
    if (!session || ['closed', 'interrupted', 'error'].includes(session.status)) return;
    session.exitCode = exitCode; session.endedAt = new Date(); session.pid = null; session.status = processEntry?.closing || exitCode === 0 ? 'closed' : 'error'; session.updatedAt = new Date();
    await source.getRepository(RuntimeSessionEntity).save(session);
    await this.appendEvent(sessionId, { kind: 'exit', status: session.status, text: `Codex terminal exited with code ${exitCode}.` });
    const run = await source.getRepository(RuntimeRunEntity).findOneBy({ id: session.runId });
    if (run && run.phase !== 'done') {
      const sessions = await source.getRepository(RuntimeSessionEntity).findBy({ runId: run.id });
      run.status = sessions.some(item => item.status === 'error') ? 'error' : sessions.every(item => ['queued', 'closed', 'error', 'interrupted'].includes(item.status)) ? 'interrupted' : 'active';
      run.updatedAt = new Date(); await source.getRepository(RuntimeRunEntity).save(run);
    }
  }

  private async closeIfIdle(sessionId: string) {
    const current = this.live.get(sessionId);
    if (!current || current.closing) return;
    if (Date.now() - current.lastActivity >= IDLE_MS) await this.closeSession(sessionId);
    else setTimeout(() => void this.closeIfIdle(sessionId), IDLE_MS + 250).unref();
  }

  async getRun(runId: string): Promise<RunPublic> {
    await this.recover();
    const source = await this.source();
    const run = await source.getRepository(RuntimeRunEntity).findOneBy({ id: runId });
    if (!run) throw new Error('run_not_found');
    const sessions = await source.getRepository(RuntimeSessionEntity).find({ where: { runId }, order: { role: 'ASC' } });
    return {
      id: run.id, workspaceId: run.workspaceId, taskId: run.taskId, status: run.status, phase: run.phase, prompt: run.prompt,
      delegation: run.delegation, report: run.report, reportDelivered: run.reportDelivered, finalReport: run.finalReport,
      routingSnapshot: run.routingSnapshot as RoutingPolicySnapshot | null, routingDecision: run.routingDecision as RoutingDecision | null,
      createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(), sessions: sessions.map(session => publicSession(session as unknown as Record<string, unknown>, this.live.get(session.id)?.confirmed === true)),
    };
  }

  async getSession(sessionId: string): Promise<SessionPublic> {
    await this.recover();
    const row = await (await this.source()).getRepository(RuntimeSessionEntity).findOneBy({ id: sessionId });
    if (!row) throw new Error('session_not_found');
    return publicSession(row as unknown as Record<string, unknown>, this.live.get(sessionId)?.confirmed === true);
  }

  async listEvents(sessionId: string, after = 0, limit = 500): Promise<RuntimeEvent[]> {
    await this.recover();
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('invalid_sequence');
    if (!(await (await this.source()).getRepository(RuntimeSessionEntity).existsBy({ id: sessionId }))) throw new Error('session_not_found');
    const rows = await (await this.source()).getRepository(RuntimeEventEntity).createQueryBuilder('event')
      .where('event.session_id = :sessionId AND event.sequence > :after', { sessionId, after })
      .orderBy('event.sequence', 'ASC').take(Math.min(1000, Math.max(1, limit))).getMany();
    return rows.map(row => {
      let resize: { cols?: number; rows?: number } = {};
      if (row.kind === 'resize' && row.text) {
        try {
          const dimensions = JSON.parse(row.text) as { cols?: unknown; rows?: unknown };
          if (Number.isInteger(dimensions.cols) && Number.isInteger(dimensions.rows)) resize = { cols: dimensions.cols as number, rows: dimensions.rows as number };
        } catch { /* malformed historical resize markers are ignored by terminal clients */ }
      }
      return { sequence: row.sequence, sessionId, kind: row.kind as RuntimeEvent['kind'], ...(row.text ? { text: row.text } : {}), ...(row.dataBase64 ? { dataBase64: row.dataBase64 } : {}), ...(row.status ? { status: row.status as SessionStatus } : {}), ...resize, createdAt: row.createdAt.toISOString() };
    });
  }

  async writeInput(sessionId: string, data: unknown): Promise<void> {
    if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_INPUT_BYTES) throw new Error('invalid_terminal_input');
    const processEntry = this.live.get(sessionId);
    if (!processEntry || processEntry.closing) throw new Error('session_not_attached');
    if (!processEntry.nativeConversationId || !processEntry.bootstrapReady) throw new Error('session_bootstrapping');
    processEntry.lastActivity = Date.now(); processEntry.terminal.write(data);
  }

  async resize(sessionId: string, cols: unknown, rows: unknown): Promise<void> {
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) throw new Error('invalid_terminal_size');
    const processEntry = this.live.get(sessionId);
    if (!processEntry || processEntry.closing) throw new Error('session_not_attached');
    const nextCols = Math.max(20, Math.min(240, cols as number));
    const nextRows = Math.max(5, Math.min(100, rows as number));
    processEntry.lastActivity = Date.now();
    const resizeEvent = processEntry.outputQueue.then(async () => {
      if (this.live.get(sessionId) !== processEntry || processEntry.closing) throw new Error('session_not_attached');
      await this.appendEvent(sessionId, { kind: 'resize', text: JSON.stringify({ cols: nextCols, rows: nextRows }) });
      processEntry.terminal.resize(nextCols, nextRows);
    });
    processEntry.outputQueue = resizeEvent.catch(() => undefined);
    await resizeEvent;
  }

  async closeSession(sessionId: string): Promise<SessionPublic> {
    const processEntry = this.live.get(sessionId);
    if (processEntry && !processEntry.closing) {
      processEntry.closing = true;
      const source = await this.source();
      const session = await source.getRepository(RuntimeSessionEntity).findOneBy({ id: sessionId });
      if (session && session.status !== 'closing') { session.status = 'closing'; session.updatedAt = new Date(); await source.getRepository(RuntimeSessionEntity).save(session); await this.appendEvent(sessionId, { kind: 'status', status: 'closing', text: 'Close requested; waiting for the terminal process to exit.' }); }
      processEntry.terminal.kill('SIGTERM');
      const timer = setTimeout(() => { try { processEntry.terminal.kill('SIGKILL'); } catch {} }, 1800);
      timer.unref();
    }
    return this.getSession(sessionId);
  }

  async closeRun(runId: string): Promise<void> {
    this.launchEpochs.set(runId, (this.launchEpochs.get(runId) || 0) + 1);
    this.closingRuns.add(runId);
    this.pendingReports.delete(runId);
    try {
      const source = await this.source();
      const sessions = await source.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock($1)', [4815162342]);
        const repo = manager.getRepository(RuntimeRunEntity);
        const run = await repo.createQueryBuilder('run').setLock('pessimistic_write').where('run.id = :id', { id: runId }).getOne();
        if (run && !['done', 'error'].includes(run.status)) {
          run.status = 'interrupted'; run.updatedAt = new Date(); await repo.save(run);
        }
        const sessionRepo = manager.getRepository(RuntimeSessionEntity);
        const rows = await sessionRepo.findBy({ runId });
        for (const session of rows) {
          const entry = this.live.get(session.id);
          if (entry) entry.closing = true;
          else if (['starting', 'queued', 'active', 'closing'].includes(session.status)) {
            session.status = 'closed'; session.pid = null; session.endedAt = new Date(); session.updatedAt = new Date();
            await sessionRepo.save(session);
          }
        }
        return rows;
      });
      const processes = sessions.map(session => this.live.get(session.id)).filter((entry): entry is LiveProcess => Boolean(entry));
      for (const entry of processes) {
        try { entry.terminal.kill('SIGTERM'); } catch {}
        const timer = setTimeout(() => { try { entry.terminal.kill('SIGKILL'); } catch {} }, 1800); timer.unref();
      }
      if (processes.length) {
        await Promise.race([
          Promise.all(processes.map(entry => entry.exited)),
          new Promise(resolve => setTimeout(resolve, 5000)),
        ]);
      }
    } finally { this.closingRuns.delete(runId); }
  }

  async submitReport(runId: string): Promise<RunPublic> {
    const epoch = this.launchEpochs.get(runId) || 0;
    await this.recover();
    this.assertLaunchCurrent(runId, epoch);
    if (this.handingOff.has(runId)) throw new Error('runtime_busy');
    this.handingOff.add(runId);
    try {
    const source = await this.source();
    const run = await source.getRepository(RuntimeRunEntity).findOneBy({ id: runId });
    if (!run) throw new Error('run_not_found');
    const peer = await source.getRepository(RuntimeSessionEntity).findOneBy({ runId, role: 'peer' });
    const supervisor = await source.getRepository(RuntimeSessionEntity).findOneBy({ runId, role: 'supervisor' });
    if (!peer || !supervisor || !peer.nativeConversationId || !['peer_running', 'supervisor_reporting'].includes(run.phase)) throw new Error('peer_not_reporting');
    if (!run.report) {
      const { turn } = await this.nativeTurn(peer.id);
      run.report = turn.text.slice(0, 20_000); run.reportTurnId = turn.turnId; run.phase = 'supervisor_reporting'; run.status = 'reporting'; run.reportDelivered = false;
      run.updatedAt = new Date(); await this.saveLaunchRun(run, epoch);
    }
    const liveSupervisor = this.live.get(supervisor.id);
    const token = `ORC_REPORT_${run.id}_${run.reportTurnId}`;
    if (run.reportDelivered) {
      const appServer = await CodexAppServer.create(supervisor.cwd);
      try { run.reportDelivered = await appServer.hasUserMessageContaining(supervisor.nativeConversationId!, token); }
      finally { await appServer.close(); }
      if (!run.reportDelivered && (this.launchEpochs.get(runId) || 0) === epoch) {
        await source.getRepository(RuntimeRunEntity).update({ id: runId, phase: 'supervisor_reporting', status: 'reporting', reportTurnId: run.reportTurnId! }, { reportDelivered: false, updatedAt: new Date() });
      }
    }
    if (!run.reportDelivered && this.pendingReports.get(runId)?.token !== token && liveSupervisor?.confirmed && !liveSupervisor.closing) {
      const appServer = await CodexAppServer.create(supervisor.cwd);
      try {
        const delivered = await appServer.hasUserMessageContaining(supervisor.nativeConversationId!, token);
        if ((this.launchEpochs.get(runId) || 0) !== epoch || this.closingRuns.has(runId) || liveSupervisor.closing || this.live.get(supervisor.id) !== liveSupervisor) return this.getRun(runId);
        if (delivered) run.reportDelivered = true;
        else {
          const handoff = `${token}\nPeer report for task ${run.taskId}:\n${run.report}\n\nSummarize the peer's actual result. Keep the summary read-only and include limitations.`;
          liveSupervisor.lastActivity = Date.now(); liveSupervisor.terminal.write(`\u001b[200~${handoff}\u001b[201~\r`);
          this.trackReportHandoff(run.id, supervisor.cwd, supervisor.nativeConversationId!, token);
        }
      } finally { await appServer.close(); }
      if (run.reportDelivered && (this.launchEpochs.get(runId) || 0) === epoch) {
        await source.getRepository(RuntimeRunEntity).update({ id: runId, phase: 'supervisor_reporting', status: 'reporting', reportTurnId: run.reportTurnId! }, { reportDelivered: true, updatedAt: new Date() });
      }
    }
    return this.getRun(runId);
    } finally { this.handingOff.delete(runId); }
  }

  private async confirmReportHandoff(runId: string, cwd: string, nativeId: string, token: string, pending: { token: string; delivery: Promise<void> }): Promise<void> {
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (this.pendingReports.get(runId) !== pending) return;
      try {
        const appServer = await CodexAppServer.create(cwd);
        let confirmed = false;
        try { confirmed = await appServer.hasUserMessageContaining(nativeId, token); }
        finally { await appServer.close(); }
        if (this.pendingReports.get(runId) !== pending) return;
        if (!confirmed) continue;
        const repo = (await this.source()).getRepository(RuntimeRunEntity);
        const run = await repo.findOneBy({ id: runId });
        if (run && this.pendingReports.get(runId) === pending && token === `ORC_REPORT_${run.id}_${run.reportTurnId}`) {
          await repo.update({ id: runId, phase: 'supervisor_reporting', status: 'reporting', reportTurnId: run.reportTurnId! }, { reportDelivered: true, updatedAt: new Date() });
        }
        return;
      } catch { /* Recovery reconciles from the exact native thread history. */ }
    }
  }

  async finalizeRun(runId: string): Promise<RunPublic> {
    const epoch = this.launchEpochs.get(runId) || 0;
    await this.recover();
    this.assertLaunchCurrent(runId, epoch);
    const source = await this.source();
    const repo = source.getRepository(RuntimeRunEntity);
    const run = await repo.findOneBy({ id: runId });
    if (!run) throw new Error('run_not_found');
    if (run.finalReport && run.finalTurnId) return this.getRun(runId);
    if (run.phase !== 'supervisor_reporting' || !run.report || !run.reportDelivered) throw new Error('supervisor_report_not_ready');
    const supervisor = await source.getRepository(RuntimeSessionEntity).findOneBy({ runId, role: 'supervisor' });
    if (!supervisor?.nativeConversationId) throw new Error('native_conversation_unknown');
    const { turn } = await this.nativeTurn(supervisor.id);
    const token = `ORC_REPORT_${run.id}_${run.reportTurnId}`;
    const appServer = await CodexAppServer.create(supervisor.cwd);
    let acknowledged = false;
    try { acknowledged = await appServer.completedTurnHasUserMessage(supervisor.nativeConversationId, turn.turnId, token); }
    finally { await appServer.close(); }
    if (!acknowledged || turn.turnId === run.delegationTurnId) throw new Error('supervisor_report_not_ready');
    run.finalReport = turn.text; run.finalTurnId = turn.turnId; run.phase = 'done'; run.status = 'done'; run.updatedAt = new Date();
    await this.saveLaunchRun(run, epoch);
    await this.closeRun(runId);
    return this.getRun(runId);
  }

  async resumeSession(sessionId: string): Promise<SessionPublic> {
    const invocationEpochs = new Map(this.launchEpochs);
    await this.recover();
    const source = await this.source();
    if (this.resuming.has(sessionId) || this.live.has(sessionId)) throw new Error('session_not_resumable');
    const sessions = source.getRepository(RuntimeSessionEntity);
    const existing = await sessions.findOneBy({ id: sessionId });
    if (!existing) throw new Error('session_not_found');
    if (!existing.nativeConversationId || !UUID_RE.test(existing.nativeConversationId)) throw new Error('native_conversation_unknown');
    const existingRun = await source.getRepository(RuntimeRunEntity).findOneBy({ id: existing.runId });
    if (!existingRun || existingRun.phase === 'done') throw new Error('session_not_resumable');
    const epoch = invocationEpochs.get(existing.runId) || 0;
    this.assertLaunchCurrent(existing.runId, epoch);
    this.resuming.add(sessionId);
    let row: import('./entities').RuntimeSessionRow | null = null;
    try {
      row = await source.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock($1)', [4815162342]);
        const repo = manager.getRepository(RuntimeSessionEntity);
        const session = await repo.createQueryBuilder('session').setLock('pessimistic_write').where('session.id = :id', { id: sessionId }).getOne();
        if (!session) throw new Error('session_not_found');
        if (!session.nativeConversationId || !UUID_RE.test(session.nativeConversationId)) throw new Error('native_conversation_unknown');
        if (!['interrupted', 'closed', 'error'].includes(session.status)) throw new Error('session_not_resumable');
        const run = await manager.getRepository(RuntimeRunEntity).createQueryBuilder('run').setLock('pessimistic_write').where('run.id = :id', { id: session.runId }).getOne();
        if (!run || run.phase === 'done') throw new Error('session_not_resumable');
        this.assertLaunchCurrent(session.runId, epoch);
        const busy = await repo.findOneBy([
          { runId: Not(session.runId), status: 'starting' },
          { runId: Not(session.runId), status: 'active' },
          { runId: Not(session.runId), status: 'closing' },
        ]);
        if (busy) throw new Error('runtime_busy');
        session.status = 'starting'; session.pid = null; session.exitCode = null; session.startedAt = null; session.endedAt = null; session.updatedAt = new Date();
        await repo.save(session); return session;
      });
      const runRepo = source.getRepository(RuntimeRunEntity);
      const run = await runRepo.findOneBy({ id: row.runId });
      if (!run || run.phase === 'done') throw new Error('session_not_resumable');
      let prompt: string | null = null;
      if (row.role === 'supervisor' && run.report && run.reportTurnId) {
        const token = `ORC_REPORT_${run.id}_${run.reportTurnId}`;
        const appServer = await CodexAppServer.create(row.cwd);
        let handoff: { turn: NativeTurn | null; found: boolean };
        try { handoff = await appServer.latestTurnHasUserMessage(row.nativeConversationId!, token); }
        finally { await appServer.close(); }
        if (handoff.found) {
          run.reportDelivered = true; run.updatedAt = new Date(); await this.saveLaunchRun(run, epoch);
          if (handoff.turn?.status !== 'completed') prompt = `${token}\nContinue the final summary in this same supervisor conversation for the peer report already provided in the interrupted preceding turn. Do not request or reprocess the peer report; finish the supervisor's read-only summary and limitations.`;
        } else {
          run.reportDelivered = false;
          prompt = `${token}\nThe server restarted before this report handoff was recorded in native history. Continue the original supervisor task ${run.taskId} using the peer report and provide the requested read-only final summary. Peer report:\n${run.report}`;
        }
      } else if (row.role === 'supervisor' && run.phase === 'supervisor_delegation') {
        const turn = await this.latestNativeTurn(row.cwd, row.nativeConversationId!);
        if (!turn || turn.status !== 'completed') {
          const snapshot = run.routingSnapshot as RoutingPolicySnapshot | null;
          prompt = snapshot
            ? this.supervisorRoutingPrompt(run.taskId, run.prompt, snapshot, true)
            : `The server restarted while the original supervisor task was unfinished. Continue that task in this same conversation. Do not use tools, read files, spawn subagents, or solve the original request yourself. ORC will launch exactly one separate read-only peer after you return. Write only a precise, bounded, self-contained delegation instruction for that peer, based on the original user task: ${run.prompt}. Require concrete evidence, a concise report, and explicit limitations.`;
        }
      } else if (row.role === 'peer' && run.phase === 'peer_running') {
        const appServer = await CodexAppServer.create(row.cwd);
        try {
          const turn = await appServer.latestTurn(row.nativeConversationId!);
          if (!turn || turn.status !== 'completed') prompt = `The server restarted while your original delegated read-only task was unfinished. Continue that task in this same conversation. Original task: ${run.prompt}\nSupervisor delegation: ${run.delegation || ''}`;
        } finally { await appServer.close(); }
      }
      run.status = run.phase === 'supervisor_reporting' ? 'reporting' : 'active'; run.updatedAt = new Date(); await this.saveLaunchRun(run, epoch);
      this.assertLaunchCurrent(row.runId, epoch);
      await this.spawnSession(sessionId, prompt, false, { runId: row.runId, epoch });
      if (row.role === 'supervisor' && run.report && run.reportTurnId) this.trackReportHandoff(run.id, row.cwd, row.nativeConversationId!, `ORC_REPORT_${run.id}_${run.reportTurnId}`);
      return this.getSession(sessionId);
    } catch (error) {
      if (row && (this.launchEpochs.get(row.runId) || 0) === epoch && !this.closingRuns.has(row.runId)) {
        await sessions.update({ id: sessionId, status: 'starting' }, { status: 'error', endedAt: new Date(), pid: null, updatedAt: new Date() });
        await this.appendEvent(sessionId, { kind: 'error', status: 'error', text: errMessage(error) });
        const runRepo = source.getRepository(RuntimeRunEntity);
        const run = await runRepo.findOneBy({ id: row.runId });
        if (run && run.phase !== 'done') { run.status = 'interrupted'; run.updatedAt = new Date(); await this.saveLaunchRun(run, epoch); }
      }
      throw error;
    } finally { this.resuming.delete(sessionId); }
  }

  async closeAll(): Promise<void> {
    const entries = [...this.live.entries()];
    await Promise.all(entries.map(([id]) => this.closeSession(id).catch(() => undefined)));
    await Promise.race([Promise.all(entries.map(([, entry]) => entry.exited)), new Promise(resolve => setTimeout(resolve, 5000))]);
    for (const [id, entry] of entries) { if (this.live.get(id) === entry) { try { entry.terminal.kill('SIGKILL'); } catch {} } }
    await Promise.race([Promise.all(entries.map(([, entry]) => entry.exited)), new Promise(resolve => setTimeout(resolve, 1500))]);
  }
}

declare global { var __orcNativeRuntimeService: NativeRuntimeService | undefined; }

export function getNativeRuntimeService(): NativeRuntimeService {
  if (!globalThis.__orcNativeRuntimeService) {
    globalThis.__orcNativeRuntimeService = new NativeRuntimeService();
    const service = globalThis.__orcNativeRuntimeService;
    const shutdown = () => { void service.closeAll().finally(() => process.exit(0)); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  }
  return globalThis.__orcNativeRuntimeService;
}
