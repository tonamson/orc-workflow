import { describe, expect, it } from 'vitest';
import { createDemoState } from '../features/studio/model/seed';
import { studioReducer } from '../features/studio/model/reducer';

describe('initial demo state', () => {
  it('seeds two separate workspaces with explicit sessions and rooms', () => {
    const state = createDemoState();
    const firstRooms = Object.values(state.rooms).filter(room => room.workspaceId === 'demo-website');
    const secondRooms = Object.values(state.rooms).filter(room => room.workspaceId === 'demo-empty');

    expect(Object.values(state.sessions).map(session => session.agentName)).toEqual(['Nova', 'Atlas', 'Mika', 'Sage', 'Rune']);
    expect(Object.values(state.departments).filter(department => department.workspaceId === 'demo-website')).toHaveLength(2);
    expect(firstRooms.filter(room => room.kind === 'work')).toHaveLength(2);
    expect(firstRooms.filter(room => room.kind !== 'work')).toHaveLength(3);
    expect(secondRooms.length).toBeGreaterThan(0);
    expect(Object.values(state.sessions).every(session => session.workspaceId !== 'demo-empty')).toBe(true);
  });

  it('workspace switch preserves all five sessions', () => {
    const state = createDemoState();
    const next = studioReducer(state, { type: 'ui.workspace', workspaceId: 'demo-empty' });
    expect(Object.keys(next.sessions)).toHaveLength(5);
    expect(next.ui.workspaceId).toBe('demo-empty');
  });

  it('navigation does not create sessions', () => {
    const state = createDemoState();
    const next = studioReducer(state, { type: 'ui.navigate', roomId: 'meeting-demo' });
    expect(Object.keys(next.sessions)).toHaveLength(5);
  });

  it('creating an empty department adds a room but no CLI session', () => {
    const state = createDemoState();
    const next = studioReducer(state, { type: 'ui.department-create', name: 'Content Lab' });
    expect(Object.keys(next.sessions)).toHaveLength(5);
    const created = Object.values(next.departments).find(department => department.name === 'Content Lab');
    expect(created).toBeDefined();
    expect(Object.values(next.rooms).some(room => room.departmentId === created?.id)).toBe(true);
  });
});
