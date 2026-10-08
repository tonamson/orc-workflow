export type Role = 'ceo' | 'employee' | 'client';
export type Provider = 'codex' | 'claude' | 'gemini' | 'opencode';
export type Avatar = 'Nova' | 'Atlas' | 'Mika' | 'Sage' | 'Rune';
export type Reasoning =
  | { kind: 'effort' | 'thinking-level' | 'thinking-budget' | 'variant'; value: string | number }
  | { kind: 'unknown' | 'unsupported' };
export type Workspace = { id: string; customerId: string; name: string; repoPath: string };
export type ClientViewer = { id: string; customerId: string; allowedWorkspaceIds: string[] };
export type TerminalMessage = { id: string; kind: 'input' | 'output' | 'status'; text: string; timestamp: number };
export type Session = {
  id: string; workspaceId: string; roomId: string; seatSlot: 0 | 1 | 2; agentName: string; avatar: Avatar;
  role: 'supervisor' | 'lead' | 'peer'; provider: Provider; model: string | null; reasoning: Reasoning;
  skills: string[]; lifecycle: 'starting' | 'active' | 'closing' | 'disconnected' | 'error';
  processConfirmed: boolean; lastUpdate: number; messages: TerminalMessage[]; closeError?: string;
};
export type Room = { id: string; workspaceId: string; departmentId: string | null; name: string; kind: 'work' | 'supervisor' | 'lobby' | 'meeting'; template: 'ui' | 'engineering' | 'supervisor' | 'lobby' | 'meeting' };
export type Department = { id: string; workspaceId: string; name: string; leadSessionId: string | null };
export type TaskStatus = 'queued' | 'assigned' | 'working' | 'approval' | 'blocked' | 'reporting' | 'done';
export type Task = { id: string; workspaceId: string; departmentId: string; requiredSkills: string[]; status: TaskStatus; sessionId: string | null; title: string };
export type Report = { id: string; workspaceId: string; taskId: string; sessionId: string; content: string; status: 'submitted' | 'reviewed' | 'accepted' };
export type ProjectRecord = { id: string; workspaceId: string; roomId: string; type: 'project' | 'contract' | 'minutes' | 'progress' | 'delivery' | 'requirements' | 'checklist' | 'reference' | 'commercial'; name: string; summary: string; content: string; audience: 'internal' | 'shared' | 'ceo'; updatedAt: number };

export type AppState = {
  workspaces: Record<string, Workspace>; clientViewers: Record<string, ClientViewer>; departments: Record<string, Department>;
  rooms: Record<string, Room>; sessions: Record<string, Session>; tasks: Record<string, Task>; reports: Record<string, Report>;
  records: Record<string, ProjectRecord>; archives: Record<string, Session>; acceptedReportIds: string[]; capacity: number;
  ui: { workspaceId: string | null; clientViewerId: string | null; role: Role; roomId: string | null; officeMode: 'merged' | 'cards'; selectedSessionId: string | null; selectedRecordId: string | null; panelOpen: boolean; search: string; recordFilter: string };
};

export type StudioEvent =
  | { type: 'ui.navigate'; roomId: string | null }
  | { type: 'ui.role'; role: Role }
  | { type: 'ui.client'; clientViewerId: string | null }
  | { type: 'ui.workspace'; workspaceId: string | null }
  | { type: 'ui.mode'; mode: 'merged' | 'cards' }
  | { type: 'ui.panel'; open: boolean }
  | { type: 'ui.select-session'; sessionId: string | null }
  | { type: 'ui.select-record'; recordId: string | null }
  | { type: 'ui.search'; search: string }
  | { type: 'ui.record-filter'; filter: string }
  | { type: 'persistence.hydrate'; state: AppState }
  | { type: 'ui.departments-resize'; count: number }
  | { type: 'ui.department-create'; name: string }
  | { type: 'demo.overflow-reset' }
  | { type: 'demo.seed-reset' }
  | { type: 'session.start-requested'; id: string; workspaceId: string; roomId: string; agentName: string; avatar: Avatar; provider: Provider; model: string | null; reasoning: Reasoning; skills: string[] }
  | { type: 'session.started'; sessionId: string }
  | { type: 'session.config'; sessionId: string; provider: Provider; model: string | null; reasoning: Reasoning }
  | { type: 'session.message'; sessionId: string; message: TerminalMessage }
  | { type: 'session.disconnected'; sessionId: string }
  | { type: 'session.reconnected'; sessionId: string }
  | { type: 'session.close-requested'; sessionId: string }
  | { type: 'session.close-failed'; sessionId: string; message: string }
  | { type: 'session.closed'; sessionId: string }
  | { type: 'task.assigned'; taskId: string; sessionId: string }
  | { type: 'task.assign-requested'; taskId: string; provider: Provider }
  | { type: 'task.status'; taskId: string; status: TaskStatus }
  | { type: 'approval.responded'; taskId: string; accepted: boolean }
  | { type: 'report.submitted'; report: Report }
  | { type: 'report.reviewed'; reportId: string }
  | { type: 'report.accepted'; reportId: string }
  | { type: 'record.updated'; recordId: string; content: string; updatedAt: number };

export type Dispatch<T> = (event: T) => void;
