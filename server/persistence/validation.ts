import type { AppState, Avatar, Provider, Reasoning, Role, StudioEvent, TaskStatus } from '../../features/studio/model/types';

export type DemoRequestContext = { role: Role; workspaceId: string; clientViewerId: string | null };
export type StudioMutationRequest = { eventId: string; expectedRevision: number; context: DemoRequestContext; event: StudioEvent };
export type ValidationResult = { ok: true; value: StudioMutationRequest } | { ok: false; code: 'invalid_request' | 'invalid_event' };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const isText = (value: unknown, max = 100_000): value is string => typeof value === 'string' && value.length <= max;
const providers: Provider[] = ['codex', 'claude', 'gemini', 'opencode'];
const roles: Role[] = ['ceo', 'employee', 'client'];
const avatars: Avatar[] = ['Nova', 'Atlas', 'Mika', 'Sage', 'Rune'];
const taskStatuses: TaskStatus[] = ['queued', 'assigned', 'working', 'approval', 'blocked', 'reporting', 'done'];

function isReasoning(value: unknown): value is Reasoning {
  if (!isRecord(value)) return false;
  if (value.kind === 'unknown' || value.kind === 'unsupported') return true;
  if (!['effort', 'thinking-level', 'thinking-budget', 'variant'].includes(String(value.kind))) return false;
  return typeof value.value === 'string' ? isText(value.value, 160) : typeof value.value === 'number' && Number.isFinite(value.value);
}

function isDomainEvent(value: unknown): value is StudioEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'demo.overflow-reset':
    case 'demo.seed-reset': return Object.keys(value).length === 1;
    case 'session.start-requested': return isId(value.id) && isId(value.workspaceId) && isId(value.roomId) && isText(value.agentName, 120) && avatars.includes(value.avatar as Avatar) && providers.includes(value.provider as Provider) && (value.model === null || isText(value.model, 200)) && isReasoning(value.reasoning) && Array.isArray(value.skills) && value.skills.length <= 100 && value.skills.every(skill => isText(skill, 120));
    case 'session.started':
    case 'session.disconnected':
    case 'session.reconnected':
    case 'session.close-requested':
    case 'session.closed': return isId(value.sessionId);
    case 'session.config': return isId(value.sessionId) && providers.includes(value.provider as Provider) && (value.model === null || isText(value.model, 200)) && isReasoning(value.reasoning);
    case 'session.message': return isId(value.sessionId) && isRecord(value.message) && isId(value.message.id) && ['input', 'output', 'status'].includes(String(value.message.kind)) && isText(value.message.text, 500_000) && typeof value.message.timestamp === 'number' && Number.isFinite(value.message.timestamp);
    case 'session.close-failed': return isId(value.sessionId) && isText(value.message, 2000);
    case 'task.assigned': return isId(value.taskId) && isId(value.sessionId);
    case 'task.assign-requested': return isId(value.taskId) && providers.includes(value.provider as Provider);
    case 'task.status': return isId(value.taskId) && taskStatuses.includes(value.status as TaskStatus);
    case 'approval.responded': return isId(value.taskId) && typeof value.accepted === 'boolean';
    case 'report.submitted': return isRecord(value.report) && isId(value.report.id) && isId(value.report.workspaceId) && isId(value.report.taskId) && isId(value.report.sessionId) && isText(value.report.content, 500_000) && value.report.status === 'submitted';
    case 'report.reviewed':
    case 'report.accepted': return isId(value.reportId);
    case 'record.updated': return isId(value.recordId) && isText(value.content, 1_000_000) && typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt);
    case 'ui.departments-resize': return Number.isInteger(value.count) && Number(value.count) >= 0 && Number(value.count) <= 100;
    case 'ui.department-create': return isText(value.name, 120) && String(value.name).trim().length > 0;
    default: return false;
  }
}

export function validateMutationRequest(value: unknown): ValidationResult {
  if (!isRecord(value) || !isId(value.eventId) || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0 || !isRecord(value.context)) return { ok: false, code: 'invalid_request' };
  const context = value.context;
  if (!roles.includes(context.role as Role) || !isId(context.workspaceId) || !(context.clientViewerId === null || isId(context.clientViewerId))) return { ok: false, code: 'invalid_request' };
  if (!isDomainEvent(value.event) || value.event.type === 'persistence.hydrate' || (value.event.type.startsWith('ui.') && !['ui.departments-resize', 'ui.department-create'].includes(value.event.type))) return { ok: false, code: 'invalid_event' };
  return {
    ok: true,
    value: {
      eventId: value.eventId,
      expectedRevision: Number(value.expectedRevision),
      context: { role: context.role as Role, workspaceId: context.workspaceId, clientViewerId: context.clientViewerId as string | null },
      event: value.event,
    },
  };
}

export function eventBelongsToContext(state: AppState, event: StudioEvent, context: DemoRequestContext): boolean {
  if (context.role === 'client' || !state.workspaces[context.workspaceId]) return false;
  if (event.type.startsWith('demo.')) return context.role === 'ceo' && context.workspaceId === 'demo-website';
  let workspaceId: string | undefined;
  if (event.type === 'session.start-requested') workspaceId = event.workspaceId;
  else if (event.type === 'ui.department-create' || event.type === 'ui.departments-resize') workspaceId = context.workspaceId;
  else if (event.type.startsWith('session.')) {
    const id = 'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : '';
    workspaceId = state.sessions[id]?.workspaceId ?? state.archives[id]?.workspaceId;
  } else if (event.type.startsWith('task.') || event.type === 'approval.responded') {
    const id = 'taskId' in event && typeof event.taskId === 'string' ? event.taskId : '';
    workspaceId = state.tasks[id]?.workspaceId;
  } else if (event.type === 'report.submitted') workspaceId = event.report.workspaceId;
  else if (event.type === 'report.reviewed' || event.type === 'report.accepted') workspaceId = state.reports[event.reportId]?.workspaceId;
  else if (event.type === 'record.updated') workspaceId = state.records[event.recordId]?.workspaceId;
  return workspaceId === context.workspaceId;
}
