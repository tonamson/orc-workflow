import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { createDemoState } from '../../features/studio/model/seed';
import { studioReducer } from '../../features/studio/model/reducer';
import type { AppState } from '../../features/studio/model/types';
import { eventBelongsToContext, validateMutationRequest, type DemoRequestContext, type StudioMutationRequest } from './validation';
import { StudioEventEntity, StudioSnapshotEntity, CliConversationReferenceEntity } from './entities';

export type PersistenceResult = { status: 'applied' | 'duplicate' | 'conflict' | 'rejected'; revision: number; state: AppState; code?: string };
type PersistedState = Omit<AppState, 'ui'>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export class StudioPersistenceStore {
  constructor(private readonly source: DataSource, private readonly stateId = 'studio') {}

  private mergeUi(state: PersistedState, ui = createDemoState().ui): AppState {
    return { ...state, ui };
  }

  async load(): Promise<{ state: AppState; revision: number }> {
    const repo = this.source.getRepository(StudioSnapshotEntity);
    let row = await repo.findOneBy({ stateId: this.stateId });
    if (!row) {
      const seed = createDemoState();
      const initial = { stateId: this.stateId, revision: 0, state: this.withoutUi(seed), updatedAt: new Date() };
      await repo.createQueryBuilder().insert().values(initial as never).orIgnore().execute();
      row = await repo.findOneBy({ stateId: this.stateId });
    }
    if (!row) throw new Error('Could not initialize studio persistence snapshot.');
    const state = this.mergeUi(row.state as PersistedState);
    await this.ensureConversationReferences(state);
    return { state, revision: row.revision };
  }

  private withoutUi(state: AppState): PersistedState {
    const { ui: _localViewState, ...persisted } = state;
    return persisted;
  }

  async findConversationReference(sessionId: string) {
    return this.source.getRepository(CliConversationReferenceEntity).findOneBy({ stateId: this.stateId, sessionId });
  }

  private async ensureConversationReferences(state: AppState): Promise<void> {
    const sessions = [...Object.values(state.sessions), ...Object.values(state.archives)];
    const repo = this.source.getRepository(CliConversationReferenceEntity);
    if (sessions.length) await repo.createQueryBuilder().insert().values(sessions.map(session => ({ stateId: this.stateId, sessionId: session.id, workspaceId: session.workspaceId, provider: session.provider, nativeConversationId: null, createdAt: new Date(), updatedAt: new Date() })) as never).orIgnore().execute();
  }

  async apply(input: StudioMutationRequest | unknown): Promise<PersistenceResult> {
    const validated = validateMutationRequest(input);
    if (!validated.ok) {
      const current = await this.load();
      return { ...current, status: 'rejected', code: validated.code };
    }
    const request = validated.value;
    return this.source.transaction(async manager => {
      const snapshots = manager.getRepository(StudioSnapshotEntity);
      const row = await snapshots.createQueryBuilder('snapshot').setLock('pessimistic_write').where('snapshot.state_id = :stateId', { stateId: this.stateId }).getOne();
      if (!row) throw new Error('Studio snapshot is missing.');
      const previous = await manager.getRepository(StudioEventEntity).findOneBy({ stateId: this.stateId, eventId: request.eventId });
      const current = this.mergeUi(row.state as PersistedState, this.requestUi(row.state as PersistedState, request.context));
      if (previous) {
        const samePayload = stableJson(previous.payload) === stableJson(request.event)
          && previous.role === request.context.role && previous.workspaceId === request.context.workspaceId;
        return samePayload
          ? { status: 'duplicate', revision: row.revision, state: current }
          : { status: 'rejected', revision: row.revision, state: current, code: 'idempotency_key_reused' };
      }
      if (request.expectedRevision !== row.revision) return { status: 'conflict', revision: row.revision, state: current, code: 'stale_revision' };
      if (!eventBelongsToContext(current, request.event, request.context)) return { status: 'rejected', revision: row.revision, state: current, code: 'forbidden' };
      const next = studioReducer(current, request.event);
      if (next === current) return { status: 'rejected', revision: row.revision, state: current, code: 'invalid_transition' };
      const revision = row.revision + 1;
      await manager.getRepository(StudioEventEntity).insert({ stateId: this.stateId, eventId: request.eventId, revision, eventType: request.event.type, payload: request.event as never, role: request.context.role, workspaceId: request.context.workspaceId, createdAt: new Date() });
      await snapshots.update({ stateId: this.stateId }, { revision, state: this.withoutUi(next), updatedAt: new Date() });
      await this.syncConversationReferences(manager, next);
      return { status: 'applied', revision, state: next };
    });
  }

  private requestUi(state: PersistedState, context: DemoRequestContext): AppState['ui'] {
    const base = createDemoState().ui;
    return { ...base, role: context.role, workspaceId: state.workspaces[context.workspaceId] ? context.workspaceId : base.workspaceId, clientViewerId: context.clientViewerId };
  }

  private async syncConversationReferences(manager: import('typeorm').EntityManager, state: AppState): Promise<void> {
    const sessions = [...Object.values(state.sessions), ...Object.values(state.archives)];
    const repo = manager.getRepository(CliConversationReferenceEntity);
    for (const session of sessions) {
      await repo.createQueryBuilder().insert().values({ stateId: this.stateId, sessionId: session.id, workspaceId: session.workspaceId, provider: session.provider, nativeConversationId: null, createdAt: new Date(), updatedAt: new Date() }).orUpdate(['workspace_id', 'provider', 'updated_at'], ['state_id', 'session_id'], { skipUpdateIfNoValuesChanged: true }).execute();
    }
  }
}
