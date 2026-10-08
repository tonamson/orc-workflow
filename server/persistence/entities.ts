import { EntitySchema } from 'typeorm';

export type StudioSnapshotRow = {
  stateId: string;
  revision: number;
  state: Record<string, unknown>;
  updatedAt: Date;
};

export const StudioSnapshotEntity = new EntitySchema<StudioSnapshotRow>({
  name: 'StudioSnapshot',
  tableName: 'studio_snapshot',
  columns: {
    stateId: { type: String, primary: true, name: 'state_id', length: 100 },
    revision: { type: Number, name: 'revision' },
    state: { type: 'jsonb', name: 'state' },
    updatedAt: { type: 'timestamptz', name: 'updated_at' },
  },
});

export type StudioEventRow = {
  stateId: string;
  eventId: string;
  revision: number;
  eventType: string;
  payload: Record<string, unknown>;
  role: string;
  workspaceId: string;
  createdAt: Date;
};

export const StudioEventEntity = new EntitySchema<StudioEventRow>({
  name: 'StudioEvent',
  tableName: 'studio_event',
  columns: {
    stateId: { type: String, primary: true, name: 'state_id', length: 100 },
    eventId: { type: String, primary: true, name: 'event_id', length: 160 },
    revision: { type: Number, name: 'revision' },
    eventType: { type: String, name: 'event_type', length: 80 },
    payload: { type: 'jsonb', name: 'payload' },
    role: { type: String, name: 'actor_role', length: 16 },
    workspaceId: { type: String, name: 'workspace_id', length: 160 },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
  },
  indices: [
    { name: 'studio_event_state_revision_uq', unique: true, columns: ['stateId', 'revision'] },
    { name: 'studio_event_workspace_created_idx', columns: ['workspaceId', 'createdAt'] },
  ],
});

export type CliConversationReferenceRow = {
  stateId: string;
  sessionId: string;
  workspaceId: string;
  provider: string;
  nativeConversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const CliConversationReferenceEntity = new EntitySchema<CliConversationReferenceRow>({
  name: 'CliConversationReference',
  tableName: 'cli_conversation_reference',
  columns: {
    stateId: { type: String, primary: true, name: 'state_id', length: 100 },
    sessionId: { type: String, primary: true, name: 'session_id', length: 160 },
    workspaceId: { type: String, name: 'workspace_id', length: 160 },
    provider: { type: String, name: 'provider', length: 32 },
    nativeConversationId: { type: String, name: 'native_conversation_id', length: 512, nullable: true },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
    updatedAt: { type: 'timestamptz', name: 'updated_at', updateDate: true },
  },
  indices: [{ name: 'cli_conversation_workspace_idx', columns: ['workspaceId'] }],
});
