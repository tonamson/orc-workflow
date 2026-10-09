import type { AppState, Session, Task } from './types';

const unfinished = new Set(['queued', 'assigned', 'working', 'approval', 'blocked', 'reporting']);

function hasSkills(session: Session, skills: string[]): boolean {
  return skills.every(skill => session.skills.includes(skill));
}

function hasOpenTask(state: AppState, sessionId: string): boolean {
  return Object.values(state.tasks).some(task => task.sessionId === sessionId && unfinished.has(task.status));
}

export function canAssignToSession(state: AppState, task: Task, session: Session): boolean {
  const room = state.rooms[session.roomId];
  return session.workspaceId === task.workspaceId && room?.workspaceId === task.workspaceId && room.departmentId === task.departmentId
    && session.lifecycle === 'active' && session.processConfirmed && hasSkills(session, task.requiredSkills) && !hasOpenTask(state, session.id);
}
