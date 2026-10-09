import { EntitySchema } from 'typeorm';

export type RuntimeWorkspaceRow = { id: string; name: string; path: string; createdAt: Date; updatedAt: Date };
export const RuntimeWorkspaceEntity = new EntitySchema<RuntimeWorkspaceRow>({
  name: 'RuntimeWorkspace', tableName: 'runtime_workspace',
  columns: {
    id: { type: String, primary: true, length: 100 }, name: { type: String, length: 160 },
    path: { type: String, length: 2048 }, createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
    updatedAt: { type: 'timestamptz', name: 'updated_at', updateDate: true },
  },
});

export type RuntimeRunRow = { id: string; workspaceId: string; taskId: string; prompt: string; status: string; phase: string; delegation: string | null; delegationTurnId: string | null; report: string | null; reportTurnId: string | null; reportDelivered: boolean; finalReport: string | null; finalTurnId: string | null; routingSnapshot: unknown | null; routingDecision: unknown | null; createdAt: Date; updatedAt: Date };
export const RuntimeRunEntity = new EntitySchema<RuntimeRunRow>({
  name: 'RuntimeRun', tableName: 'runtime_run',
  columns: {
    id: { type: String, primary: true, length: 100 }, workspaceId: { type: String, name: 'workspace_id', length: 100 },
    taskId: { type: String, name: 'task_id', length: 160 }, prompt: { type: 'text' }, status: { type: String, length: 24 },
    phase: { type: String, length: 32 }, delegation: { type: 'text', nullable: true }, delegationTurnId: { type: String, name: 'delegation_turn_id', length: 128, nullable: true },
    report: { type: 'text', nullable: true }, reportTurnId: { type: String, name: 'report_turn_id', length: 128, nullable: true }, reportDelivered: { type: Boolean, name: 'report_delivered', default: false },
    finalReport: { type: 'text', name: 'final_report', nullable: true }, finalTurnId: { type: String, name: 'final_turn_id', length: 128, nullable: true },
    routingSnapshot: { type: 'jsonb', name: 'routing_snapshot', nullable: true }, routingDecision: { type: 'jsonb', name: 'routing_decision', nullable: true },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
    updatedAt: { type: 'timestamptz', name: 'updated_at', updateDate: true },
  }, indices: [{ name: 'runtime_run_workspace_created_idx', columns: ['workspaceId', 'createdAt'] }],
});

export type RuntimeSessionRow = { id: string; runId: string; role: string; provider: string; cwd: string; nativeConversationId: string | null; model: string | null; reasoningEffort: string | null; status: string; pid: number | null; exitCode: number | null; lastSequence: number; outputBytes: number; startedAt: Date | null; endedAt: Date | null; createdAt: Date; updatedAt: Date };
export const RuntimeSessionEntity = new EntitySchema<RuntimeSessionRow>({
  name: 'RuntimeSession', tableName: 'runtime_session',
  columns: {
    id: { type: String, primary: true, length: 100 }, runId: { type: String, name: 'run_id', length: 100 },
    role: { type: String, length: 16 }, provider: { type: String, length: 32 }, cwd: { type: String, length: 2048 },
    nativeConversationId: { type: String, name: 'native_conversation_id', length: 128, nullable: true },
    model: { type: String, length: 160, nullable: true }, reasoningEffort: { type: String, name: 'reasoning_effort', length: 32, nullable: true },
    status: { type: String, length: 24 }, pid: { type: Number, nullable: true }, exitCode: { type: Number, name: 'exit_code', nullable: true },
    lastSequence: { type: Number, name: 'last_sequence', default: 0 }, outputBytes: { type: Number, name: 'output_bytes', default: 0 }, startedAt: { type: 'timestamptz', name: 'started_at', nullable: true },
    endedAt: { type: 'timestamptz', name: 'ended_at', nullable: true }, createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
    updatedAt: { type: 'timestamptz', name: 'updated_at', updateDate: true },
  }, indices: [{ name: 'runtime_session_run_role_uq', unique: true, columns: ['runId', 'role'] }],
});

export type RuntimeEventKind = 'status' | 'output' | 'resize' | 'error' | 'exit';
export type RuntimeEventRow = { sessionId: string; sequence: number; kind: RuntimeEventKind; text: string | null; dataBase64: string | null; status: string | null; createdAt: Date };
export const RuntimeEventEntity = new EntitySchema<RuntimeEventRow>({
  name: 'RuntimeEvent', tableName: 'runtime_event',
  columns: {
    sessionId: { type: String, primary: true, name: 'session_id', length: 100 }, sequence: { type: Number, primary: true },
    kind: { type: String, length: 16 }, text: { type: 'text', nullable: true }, dataBase64: { type: 'text', name: 'data_base64', nullable: true }, status: { type: String, length: 24, nullable: true },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
  }, indices: [{ name: 'runtime_event_created_idx', columns: ['sessionId', 'createdAt'] }],
});

export type RuntimeRoutingSettingsRow = { id: string; revision: number; policy: unknown; createdAt: Date; updatedAt: Date };
export const RuntimeRoutingSettingsEntity = new EntitySchema<RuntimeRoutingSettingsRow>({
  name: 'RuntimeRoutingSettings', tableName: 'runtime_routing_settings',
  columns: {
    id: { type: String, primary: true, length: 16 }, revision: { type: Number }, policy: { type: 'jsonb' },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true }, updatedAt: { type: 'timestamptz', name: 'updated_at', updateDate: true },
  },
});
