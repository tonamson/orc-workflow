import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { createPersistenceDataSource } from '../server/persistence/data-source';
import { RuntimeEventEntity } from '../server/runtime/entities';
import { StudioPersistenceStore } from '../server/persistence/store';
import type { StudioEvent } from '../features/studio/model/types';
import { createDemoState } from '../features/studio/model/seed';

const databaseUrl = process.env.ORC_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('PostgreSQL studio persistence integration', () => {
  let dataSource: DataSource;
  let stateId: string;
  let store: StudioPersistenceStore;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!url.pathname.toLowerCase().includes('test')) throw new Error('ORC_TEST_DATABASE_URL must target a dedicated database with "test" in its name.');
    dataSource = createPersistenceDataSource(databaseUrl!);
    await dataSource.initialize();
    await dataSource.runMigrations();
    stateId = `test-${randomUUID()}`;
    store = new StudioPersistenceStore(dataSource, stateId, createDemoState);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    if (stateId) {
      await dataSource.query('DELETE FROM studio_event WHERE state_id = $1', [stateId]);
      await dataSource.query('DELETE FROM cli_conversation_reference WHERE state_id = $1', [stateId]);
      await dataSource.query('DELETE FROM studio_snapshot WHERE state_id = $1', [stateId]);
    }
    await dataSource.destroy();
  });

  it('seeds once, persists notes and effective model changes, and exposes nullable native conversation IDs', async () => {
    const initial = await store.load();
    expect(initial.revision).toBe(0);
    expect((await store.load()).revision).toBe(0);
    expect(await store.findConversationReference('session-atlas')).toMatchObject({ stateId, workspaceId: 'demo-website', provider: 'claude', nativeConversationId: null });
    const note = await store.apply({ eventId: 'note-1', expectedRevision: 0, context: { role: 'ceo', workspaceId: 'demo-website', clientViewerId: null }, event: { type: 'record.updated', recordId: 'record-project', content: 'Persisted project note', updatedAt: 123 } });
    expect(note.status).toBe('applied');
    const model = await store.apply({ eventId: 'model-1', expectedRevision: 1, context: { role: 'ceo', workspaceId: 'demo-website', clientViewerId: null }, event: { type: 'session.config', sessionId: 'session-atlas', provider: 'claude', model: 'claude-sonnet-persisted', reasoning: { kind: 'thinking-level', value: 'medium' } } });
    expect(model.status).toBe('applied');
    const loaded = await store.load();
    expect(loaded.state.records['record-project'].content).toBe('Persisted project note');
    expect(loaded.state.sessions['session-atlas'].model).toBe('claude-sonnet-persisted');
    expect(await store.findConversationReference('session-atlas')).toMatchObject({ stateId, workspaceId: 'demo-website', provider: 'claude', nativeConversationId: null });
  });

  it('rejects stale writes and applies concurrent events in only one revision', async () => {
    const current = await store.load();
    const expectedRevision = current.revision;
    const context = { role: 'ceo' as const, workspaceId: 'demo-website', clientViewerId: null };
    const results = await Promise.all([
      store.apply({ eventId: 'race-1', expectedRevision, context, event: { type: 'session.config', sessionId: 'session-atlas', provider: 'claude', model: 'race-a', reasoning: { kind: 'unknown' } } }),
      store.apply({ eventId: 'race-2', expectedRevision, context, event: { type: 'session.config', sessionId: 'session-atlas', provider: 'claude', model: 'race-b', reasoning: { kind: 'unknown' } } }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(['applied', 'conflict']);
    const after = await store.load();
    expect(after.revision).toBe(expectedRevision + 1);
  });

  it('deduplicates retries and records task reports and transcript events without progress duplication', async () => {
    let revision = (await store.load()).revision;
    const context = { role: 'ceo' as const, workspaceId: 'demo-website', clientViewerId: null };
    const send = async (eventId: string, event: StudioEvent) => {
      const result = await store.apply({ eventId, expectedRevision: revision, context, event });
      if (result.status === 'applied') revision = result.revision;
      return result;
    };
    await send('reporting', { type: 'task.status', taskId: 'task-09', status: 'reporting' });
    const submitted = { type: 'report.submitted' as const, report: { id: 'report-it', workspaceId: 'demo-website', taskId: 'task-09', sessionId: 'session-mika', content: 'Persisted report', status: 'submitted' as const } };
    expect((await send('report-submit', submitted)).status).toBe('applied');
    expect((await store.apply({ eventId: 'report-submit', expectedRevision: 2, context, event: submitted })).status).toBe('duplicate');
    expect((await store.apply({ eventId: 'report-submit', expectedRevision: 2, context, event: { ...submitted, report: { ...submitted.report, content: 'different payload' } } })).code).toBe('idempotency_key_reused');
    await send('report-review', { type: 'report.reviewed', reportId: 'report-it' });
    await send('report-accept', { type: 'report.accepted', reportId: 'report-it' });
    await send('transcript-1', { type: 'session.message', sessionId: 'session-mika', message: { id: 'persisted-message', kind: 'output', text: 'Stored beyond the bounded in-memory transcript window.', timestamp: 456 } });
    expect((await store.load()).state.acceptedReportIds).toContain('report-it');
    expect((await store.load()).state.tasks['task-09'].status).toBe('done');
    expect((await store.load()).state.sessions['session-mika'].messages.at(-1)?.id).toBe('persisted-message');
  });

  it('archives sessions while retaining their empty native conversation reference', async () => {
    let revision = (await store.load()).revision;
    const context = { role: 'ceo' as const, workspaceId: 'demo-website', clientViewerId: null };
    const requested = await store.apply({ eventId: 'close-request', expectedRevision: revision, context, event: { type: 'session.close-requested', sessionId: 'session-atlas' } });
    expect(requested.status).toBe('applied');
    revision = requested.revision;
    const closed = await store.apply({ eventId: 'close-confirmed', expectedRevision: revision, context, event: { type: 'session.closed', sessionId: 'session-atlas' } });
    expect(closed.status).toBe('applied');
    expect(closed.state.sessions['session-atlas']).toBeUndefined();
    expect(closed.state.archives['session-atlas']).toBeDefined();
    expect(await store.findConversationReference('session-atlas')).toMatchObject({ nativeConversationId: null });
  });

  it('persists runtime PTY resize markers under the runtime event kind constraint', async () => {
    const suffix = randomUUID();
    const workspaceId = `test-${suffix}`;
    const runId = randomUUID();
    const sessionId = randomUUID();
    try {
      await dataSource.query('INSERT INTO runtime_workspace (id, name, path) VALUES ($1, $2, $3)', [workspaceId, 'Resize event integration', `/tmp/orc-resize-${suffix}`]);
      await dataSource.query(`INSERT INTO runtime_run (id, workspace_id, task_id, prompt, status, phase)
        VALUES ($1, $2, $3, $4, 'active', 'supervisor_delegation')`, [runId, workspaceId, 'resize-integration', 'Persist a resize marker']);
      await dataSource.query(`INSERT INTO runtime_session (id, run_id, role, provider, cwd, status)
        VALUES ($1, $2, 'supervisor', 'codex', $3, 'closed')`, [sessionId, runId, `/tmp/orc-resize-${suffix}`]);
      await dataSource.getRepository(RuntimeEventEntity).insert({ sessionId, sequence: 1, kind: 'resize', text: JSON.stringify({ cols: 92, rows: 30 }), dataBase64: null, status: null, createdAt: new Date() });

      const [event] = await dataSource.query('SELECT kind, text FROM runtime_event WHERE session_id = $1 AND sequence = 1', [sessionId]);
      expect(event).toMatchObject({ kind: 'resize', text: '{"cols":92,"rows":30}' });
    } finally {
      await dataSource.query('DELETE FROM runtime_workspace WHERE id = $1', [workspaceId]);
    }
  });

  it('rolls back the aggregate revision when the event journal insert fails', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `orc_test_fail_${suffix}`;
    const triggerName = `orc_test_fail_${suffix}`;
    await dataSource.query(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_id = 'force-rollback' THEN RAISE EXCEPTION 'injected rollback'; END IF; RETURN NEW; END $$`);
    await dataSource.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON studio_event FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);
    const before = await store.load();
    try {
      await expect(store.apply({ eventId: 'force-rollback', expectedRevision: before.revision, context: { role: 'ceo', workspaceId: 'demo-website', clientViewerId: null }, event: { type: 'session.config', sessionId: 'session-mika', provider: 'claude', model: 'must-rollback', reasoning: { kind: 'unknown' } } })).rejects.toThrow(/injected rollback/);
      const after = await store.load();
      expect(after.revision).toBe(before.revision);
      expect(after.state.sessions['session-mika'].model).toBe(before.state.sessions['session-mika'].model);
    } finally {
      await dataSource.query(`DROP TRIGGER IF EXISTS ${triggerName} ON studio_event`);
      await dataSource.query(`DROP FUNCTION IF EXISTS public.${functionName}()`);
    }
  });
});
