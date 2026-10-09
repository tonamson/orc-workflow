import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultRoutingPolicy, type RoutingDecision, type RoutingPolicy, type RoutingSettingsEnvelope } from '../features/settings/routing-policy';
import { createPersistenceDataSource } from '../server/persistence/data-source';
import { NativeRuntimeService } from '../server/runtime/service';
import { RuntimeEventEntity, RuntimeRoutingSettingsEntity, RuntimeRunEntity, RuntimeSessionEntity, RuntimeWorkspaceEntity } from '../server/runtime/entities';
import { getRoutingSettings, saveRoutingSettings } from '../server/runtime/routing-settings';
import type { DataSource } from 'typeorm';

const databaseUrl = process.env.ORC_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('PostgreSQL global routing settings integration', () => {
  let source: DataSource;
  const workspaceId = `routing-test-${randomUUID()}`;
  const runId = randomUUID();
  let priorPolicy: ReturnType<typeof createDefaultRoutingPolicy> | null = null;
  let priorConfigured = false;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!url.pathname.toLowerCase().includes('test')) throw new Error('ORC_TEST_DATABASE_URL must target a dedicated database with "test" in its name.');
    source = createPersistenceDataSource(databaseUrl!);
    await source.initialize();
    await source.runMigrations();
    const existing = await getRoutingSettings(source);
    priorConfigured = existing.configured;
    if (existing.configured) priorPolicy = existing.policy;
  });

  afterAll(async () => {
    if (!source?.isInitialized) return;
    await source.getRepository(RuntimeRunEntity).delete({ id: runId });
    await source.getRepository(RuntimeWorkspaceEntity).delete({ id: workspaceId });
    const current = await getRoutingSettings(source);
    if (current.configured) {
      if (priorConfigured && priorPolicy) await saveRoutingSettings(source, current.revision, priorPolicy);
      else await source.getRepository(RuntimeRoutingSettingsEntity).delete({ id: 'global' });
    }
    await source.destroy();
  });

  it('saves and reloads settings, rejects stale revisions, and preserves a run snapshot after global changes', async () => {
    const initial = await getRoutingSettings(source);
    expect(Number.isSafeInteger(initial.revision)).toBe(true);
    if (!priorConfigured) expect(initial.revision).toBe(0);
    const firstPolicy = { ...createDefaultRoutingPolicy(), supervisor: { ...createDefaultRoutingPolicy().supervisor, model: 'gpt-6.1-codex' } };
    const saved = await saveRoutingSettings(source, initial.revision, firstPolicy);
    expect(saved.configured).toBe(true);
    expect(saved.policy.supervisor.model).toBe('gpt-6.1-codex');
    await expect(saveRoutingSettings(source, initial.revision, firstPolicy)).rejects.toThrow('routing_settings_revision_conflict');
    const reloaded = await getRoutingSettings(source);
    expect(reloaded.revision).toBe(saved.revision);
    expect(reloaded.policy).toEqual(saved.policy);

    await source.getRepository(RuntimeWorkspaceEntity).save({ id: workspaceId, name: 'Routing integration', path: '/tmp', createdAt: new Date(), updatedAt: new Date() });
    const snapshot = { revision: saved.revision, policy: saved.policy };
    await source.getRepository(RuntimeRunEntity).save({ id: runId, workspaceId, taskId: 'snapshot', prompt: 'test', status: 'active', phase: 'supervisor_delegation', delegation: null, delegationTurnId: null, report: null, reportTurnId: null, reportDelivered: false, finalReport: null, finalTurnId: null, routingSnapshot: snapshot, routingDecision: null, createdAt: new Date(), updatedAt: new Date() });
    const changed = { ...firstPolicy, supervisor: { ...firstPolicy.supervisor, model: 'gpt-6.1-codex-mini' } };
    await saveRoutingSettings(source, saved.revision, changed);
    expect((await source.getRepository(RuntimeRunEntity).findOneByOrFail({ id: runId })).routingSnapshot).toEqual(snapshot);
  });
});

type FakeTurn = { turnId: string; text: string };
type SpawnRecord = { sessionId: string; prompt: string | null; createNewConversation: boolean; model: string | null; effort: string | null };
type ServiceHooks = {
  spawnSession(sessionId: string, prompt: string | null, createNewConversation?: boolean): Promise<void>;
  nativeTurn(sessionId: string): Promise<{ session: unknown; turn: FakeTurn }>;
  latestNativeTurn(cwd: string, nativeConversationId: string): Promise<{ id: string; status: string; items: Array<Record<string, unknown>> } | null>;
};

function policyWithReviewModel(model = 'gpt-6.1-codex'): RoutingPolicy {
  const policy = createDefaultRoutingPolicy();
  return { ...policy, profiles: { ...policy.profiles, review: { ...policy.profiles.review, model, allowedEfforts: ['medium', 'high'] } } };
}
function nativeDecision(taskKind = 'review', effort = 'high', instruction = 'Inspect the changed runtime files.'): string {
  return JSON.stringify({ taskKind, effort, reason: 'A bounded evidence review is appropriate.', instruction });
}

suite('PostgreSQL native routing service integration', () => {
  let serviceSource: DataSource;
  let workspaceId: string;
  let priorConfigured = false;
  let priorPolicy: RoutingPolicy | null = null;
  const runIds: string[] = [];

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!url.pathname.toLowerCase().includes('test')) throw new Error('ORC_TEST_DATABASE_URL must target a dedicated database with "test" in its name.');
    serviceSource = createPersistenceDataSource(databaseUrl!);
    await serviceSource.initialize();
    await serviceSource.runMigrations();
    const prior = await getRoutingSettings(serviceSource);
    priorConfigured = prior.configured;
    priorPolicy = prior.configured ? prior.policy : null;
    workspaceId = `routing-service-test-${randomUUID()}`;
    await serviceSource.getRepository(RuntimeWorkspaceEntity).save({ id: workspaceId, name: 'Routing service test', path: process.cwd(), createdAt: new Date(), updatedAt: new Date() });
  });

  afterEach(async () => {
    for (const runId of runIds.splice(0)) await serviceSource.getRepository(RuntimeRunEntity).delete({ id: runId });
  });

  afterAll(async () => {
    if (!serviceSource?.isInitialized) return;
    await serviceSource.getRepository(RuntimeWorkspaceEntity).delete({ id: workspaceId });
    const current = await getRoutingSettings(serviceSource);
    if (priorConfigured && priorPolicy) await saveRoutingSettings(serviceSource, current.revision, priorPolicy);
    else if (current.configured) await serviceSource.getRepository(RuntimeRoutingSettingsEntity).delete({ id: 'global' });
    await serviceSource.destroy();
  });

  async function configure(policy: RoutingPolicy): Promise<RoutingSettingsEnvelope> {
    const current = await getRoutingSettings(serviceSource);
    return saveRoutingSettings(serviceSource, current.revision, policy);
  }

  async function makeRun(policy: RoutingPolicy) {
    await configure(policy);
    const service = new NativeRuntimeService(Promise.resolve(serviceSource));
    const calls: SpawnRecord[] = [];
    const hooks = service as unknown as ServiceHooks;
    hooks.spawnSession = async (sessionId, prompt, createNewConversation = false) => {
      const session = await serviceSource.getRepository(RuntimeSessionEntity).findOneByOrFail({ id: sessionId });
      calls.push({ sessionId, prompt, createNewConversation, model: session.model, effort: session.reasoningEffort });
    };
    const run = await service.createRun({ workspaceId, taskId: `task-${randomUUID()}`, prompt: 'Review the current routing change.' });
    runIds.push(run.id);
    return { service, calls, run };
  }

  it('rolls invalid native output back to a retryable Supervisor without a peer spawn', async () => {
    const { service, calls, run } = await makeRun(policyWithReviewModel());
    (service as unknown as ServiceHooks).nativeTurn = async () => ({ session: null, turn: { turnId: 'bad-turn', text: nativeDecision('review', 'xhigh') } });

    await expect(service.delegatePeer(run.id)).rejects.toThrow('invalid_routing_decision');
    const persisted = await serviceSource.getRepository(RuntimeRunEntity).findOneByOrFail({ id: run.id });
    const sessions = await serviceSource.getRepository(RuntimeSessionEntity).find({ where: { runId: run.id } });
    expect(persisted).toMatchObject({ phase: 'supervisor_delegation', status: 'active', delegation: null, routingDecision: null });
    expect(sessions.find(session => session.role === 'supervisor')?.status).toBe('starting');
    expect(sessions.find(session => session.role === 'peer')).toMatchObject({ status: 'queued', model: null, reasoningEffort: null, nativeConversationId: null });
    expect(calls).toHaveLength(1);
  });

  it('persists unsupported routing without peer spawn and accepts only a newer corrected Supervisor turn', async () => {
    const { service, calls, run } = await makeRun(policyWithReviewModel());
    const turns: FakeTurn[] = [
      { turnId: 'unsupported-turn', text: nativeDecision('coding', 'high', 'Inspect the code using the configured runner.') },
      { turnId: 'corrected-turn', text: nativeDecision('review', 'high', 'Review the changed code with Codex.') },
    ];
    (service as unknown as ServiceHooks).nativeTurn = async () => ({ session: null, turn: turns.shift()! });

    await expect(service.delegatePeer(run.id)).rejects.toThrow('routing_provider_runner_unsupported');
    const blocked = await serviceSource.getRepository(RuntimeRunEntity).findOneByOrFail({ id: run.id });
    expect(blocked).toMatchObject({ phase: 'supervisor_delegation', status: 'active', delegationTurnId: 'unsupported-turn', routingDecision: { taskKind: 'coding', provider: 'agy' } });
    expect(calls).toHaveLength(1);
    expect((await serviceSource.getRepository(RuntimeSessionEntity).findOneByOrFail({ runId: run.id, role: 'peer' })).status).toBe('queued');

    const corrected = await service.delegatePeer(run.id);
    expect(corrected.phase).toBe('peer_running');
    expect(corrected.routingDecision).toMatchObject({ taskKind: 'review', provider: 'codex', model: 'gpt-6.1-codex', effort: 'high' });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ sessionId: expect.any(String), createNewConversation: true, model: 'gpt-6.1-codex', effort: 'high' });
  });

  it('restores the immutable cached decision onto an unconfigured queued peer before spawn', async () => {
    const savedPolicy = policyWithReviewModel('gpt-6.1-codex');
    const { service, calls, run } = await makeRun(savedPolicy);
    const decision: RoutingDecision = { taskKind: 'review', provider: 'codex', model: 'gpt-6.1-codex', effort: 'high', reason: 'Review category selected.', instruction: 'Review changed files.' };
    await serviceSource.getRepository(RuntimeRunEntity).update({ id: run.id }, { delegation: decision.instruction, delegationTurnId: 'cached-turn', routingDecision: decision });
    await serviceSource.getRepository(RuntimeSessionEntity).update({ runId: run.id, role: 'peer' }, { model: null, reasoningEffort: null, status: 'queued' });
    await configure(policyWithReviewModel('gpt-6.1-codex-mini'));
    (service as unknown as ServiceHooks).nativeTurn = async () => { throw new Error('cached decision must not reread Supervisor'); };

    const completed = await service.delegatePeer(run.id);
    const peer = await serviceSource.getRepository(RuntimeSessionEntity).findOneByOrFail({ runId: run.id, role: 'peer' });
    expect(completed.phase).toBe('peer_running');
    expect(completed.routingSnapshot?.policy.profiles.review.model).toBe('gpt-6.1-codex');
    expect(peer).toMatchObject({ model: 'gpt-6.1-codex', reasoningEffort: 'high', status: 'starting' });
    expect(calls.at(-1)).toMatchObject({ model: 'gpt-6.1-codex', effort: 'high' });
  });

  it('resumes an interrupted routed Supervisor with the saved JSON policy prompt, ignoring changed globals', async () => {
    const saved = await configure(policyWithReviewModel('snapshot-only-model'));
    const runId = randomUUID();
    const supervisorId = randomUUID();
    const nativeConversationId = '01a11c18-372d-7680-ba09-bf1485adf176';
    await serviceSource.getRepository(RuntimeRunEntity).save({
      id: runId, workspaceId, taskId: 'resume-routing', prompt: 'Inspect the saved task.', status: 'interrupted', phase: 'supervisor_delegation',
      delegation: null, delegationTurnId: null, report: null, reportTurnId: null, reportDelivered: false, finalReport: null, finalTurnId: null,
      routingSnapshot: { revision: saved.revision, policy: saved.policy }, routingDecision: null, createdAt: new Date(), updatedAt: new Date(),
    });
    runIds.push(runId);
    await serviceSource.getRepository(RuntimeSessionEntity).save({
      id: supervisorId, runId, role: 'supervisor', provider: 'codex', cwd: process.cwd(), nativeConversationId, model: 'actual-saved-codex-model', reasoningEffort: 'high',
      status: 'interrupted', pid: null, exitCode: null, lastSequence: 0, outputBytes: 0, startedAt: null, endedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });
    const service = new NativeRuntimeService(Promise.resolve(serviceSource));
    const launches: Array<{ sessionId: string; prompt: string | null; createNewConversation: boolean; model: string | null; effort: string | null }> = [];
    const hooks = service as unknown as ServiceHooks;
    hooks.latestNativeTurn = async () => ({ id: 'unfinished-native-turn', status: 'inProgress', items: [] });
    hooks.spawnSession = async (sessionId, prompt, createNewConversation = false) => {
      const row = await serviceSource.getRepository(RuntimeSessionEntity).findOneByOrFail({ id: sessionId });
      launches.push({ sessionId, prompt, createNewConversation, model: row.model, effort: row.reasoningEffort });
    };
    await configure(policyWithReviewModel('global-current-model'));

    await service.resumeSession(supervisorId);

    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({ sessionId: supervisorId, createNewConversation: false, model: 'actual-saved-codex-model', effort: 'high' });
    expect(launches[0].prompt).toContain('server restarted while this Supervisor turn was unfinished');
    expect(launches[0].prompt).toContain('Return only a JSON object matching');
    expect(launches[0].prompt).toContain('snapshot-only-model');
    expect(launches[0].prompt).not.toContain('global-current-model');
    expect(launches[0].prompt).toContain('Inspect the saved task.');
  });
});
