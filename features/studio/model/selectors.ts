import type { AppState, Session } from './types';

export function roomSessions(state: AppState, roomId: string): Session[] {
  return Object.values(state.sessions).filter(session => session.roomId === roomId).sort((a, b) => a.seatSlot - b.seatSlot);
}

export function runningSessions(state: AppState): Session[] {
  return Object.values(state.sessions);
}

export function visibleActors(state: AppState, roomId: string): Session[] {
  return roomSessions(state, roomId).filter(session => session.processConfirmed && session.lifecycle !== 'closing');
}
