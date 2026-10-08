import type { AppState, ProjectRecord, Room, Session, Workspace } from './types';

export function canAccessWorkspace(state: AppState, workspaceId: string): boolean {
  const workspace = state.workspaces[workspaceId];
  if (!workspace) return false;
  if (state.ui.role !== 'client') return true;
  const viewer = state.ui.clientViewerId ? state.clientViewers[state.ui.clientViewerId] : null;
  return Boolean(viewer && viewer.customerId === workspace.customerId && viewer.allowedWorkspaceIds.includes(workspaceId));
}

export function visibleWorkspaces(state: AppState): Workspace[] {
  return Object.values(state.workspaces).filter(workspace => canAccessWorkspace(state, workspace.id));
}

export function visibleRooms(state: AppState): Room[] {
  const workspaceId = state.ui.workspaceId;
  if (!workspaceId || !canAccessWorkspace(state, workspaceId)) return [];
  return Object.values(state.rooms).filter(room => {
    if (room.workspaceId !== workspaceId) return false;
    if (state.ui.role === 'client') return room.kind === 'lobby';
    if (state.ui.role === 'employee') return room.kind !== 'lobby';
    return true;
  });
}

export function visibleRecords(state: AppState, roomId: string): ProjectRecord[] {
  const room = visibleRooms(state).find(candidate => candidate.id === roomId);
  if (!room) return [];
  return Object.values(state.records).filter(record => {
    if (record.workspaceId !== room.workspaceId || record.roomId !== room.id) return false;
    if (state.ui.role === 'client') return record.audience === 'shared';
    if (state.ui.role === 'employee') return record.audience === 'internal';
    return true;
  });
}

export function projectProgress(state: AppState, workspaceId: string): { done: number; total: number; percent: number } {
  const tasks = Object.values(state.tasks).filter(task => task.workspaceId === workspaceId);
  const done = tasks.filter(task => task.status === 'done').length;
  const total = tasks.length;
  return { done, total, percent: total ? Math.round(done / total * 100) : 0 };
}

export function canSelectSession(state: AppState, sessionId: string): boolean {
  if (state.ui.role === 'client') return false;
  const session = state.sessions[sessionId];
  return Boolean(session && session.workspaceId === state.ui.workspaceId && canAccessWorkspace(state, session.workspaceId) && visibleRooms(state).some(room => room.id === session.roomId));
}

export function roomSessions(state: AppState, roomId: string): Session[] {
  return Object.values(state.sessions).filter(session => session.roomId === roomId).sort((a, b) => a.seatSlot - b.seatSlot);
}

export function runningSessions(state: AppState): Session[] {
  return Object.values(state.sessions);
}

export function visibleActors(state: AppState, roomId: string): Session[] {
  if (!visibleRooms(state).some(room => room.id === roomId) || state.ui.role === 'client') return [];
  return roomSessions(state, roomId).filter(session => session.processConfirmed);
}
