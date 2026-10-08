import { describe, expect, it } from 'vitest';
import { canAccessWorkspace, canSelectSession, visibleRecords, visibleRooms, visibleWorkspaces } from '../features/studio/model/selectors';
import { createDemoState } from '../features/studio/model/seed';
import { studioReducer } from '../features/studio/model/reducer';

describe('role and workspace visibility', () => {
  it('shows only the granted client lobby and shared records', () => {
    const state = studioReducer(createDemoState(), { type: 'ui.role', role: 'client' });
    expect(visibleRooms(state).map(room => room.kind)).toEqual(['lobby']);
    expect(visibleWorkspaces(state).map(workspace => workspace.id)).toEqual(['demo-website']);
    expect(canAccessWorkspace(state, 'demo-empty')).toBe(false);
    expect(visibleRecords(state, state.ui.roomId!).every(record => record.audience === 'shared')).toBe(true);
    expect(state.ui.selectedSessionId).toBeNull();
  });

  it('prevents client role from using a direct foreign workspace or room id', () => {
    let state = studioReducer(createDemoState(), { type: 'ui.role', role: 'client' });
    const prior = state;
    state = studioReducer(state, { type: 'ui.workspace', workspaceId: 'demo-empty' });
    expect(state).toBe(prior);
    expect(studioReducer(state, { type: 'ui.navigate', roomId: 'room-ui' })).toBe(state);
    expect(visibleRecords(state, 'demo-empty-lobby')).toEqual([]);
  });

  it('requires both customer ownership and an explicit grant', () => {
    let state = createDemoState();
    state.clientViewers['client-a'] = { ...state.clientViewers['client-a'], allowedWorkspaceIds: ['demo-empty'] };
    state = studioReducer(state, { type: 'ui.role', role: 'client' });
    expect(canAccessWorkspace(state, 'demo-empty')).toBe(false);
    expect(visibleWorkspaces(state)).toEqual([]);
  });

  it('clears internal selections on role/account changes and supports no-grant accounts', () => {
    let state = createDemoState();
    state = studioReducer(state, { type: 'ui.role', role: 'client' });
    expect(state.ui.roomId).toBe('demo-website-lobby');
    expect(state.ui.selectedSessionId).toBeNull();
    expect(state.ui.selectedRecordId).toBeNull();
    state = studioReducer(state, { type: 'ui.client', clientViewerId: 'client-b' });
    expect(state.ui.workspaceId).toBe('demo-empty');
    expect(state.ui.roomId).toBe('demo-empty-lobby');
    expect(visibleWorkspaces(state).map(workspace => workspace.id)).toEqual(['demo-empty']);
    state = studioReducer(state, { type: 'ui.client', clientViewerId: 'client-none' });
    expect(state.ui.workspaceId).toBeNull();
    expect(state.ui.roomId).toBeNull();
    expect(visibleRooms(state)).toEqual([]);
    expect(visibleRecords(state, 'demo-website-lobby')).toEqual([]);
  });

  it('rejects hidden sessions and cross-customer record selection', () => {
    let state = studioReducer(createDemoState(), { type: 'ui.role', role: 'client' });
    expect(canSelectSession(state, 'session-atlas')).toBe(false);
    state = studioReducer(state, { type: 'ui.select-record', recordId: 'record-mobile-project' });
    expect(state.ui.selectedRecordId).toBeNull();
    expect(visibleRecords(state, 'demo-website-lobby').some(record => record.id === 'record-mobile-project')).toBe(false);
  });

  it('keeps all sessions when switching between permitted contexts', () => {
    let state = createDemoState();
    const count = Object.keys(state.sessions).length;
    state = studioReducer(state, { type: 'ui.workspace', workspaceId: 'demo-empty' });
    expect(Object.keys(state.sessions)).toHaveLength(count);
    expect(state.ui.workspaceId).toBe('demo-empty');
  });

  it('hides lobby from employees and commercial notes from non-CEOs', () => {
    let state = studioReducer(createDemoState(), { type: 'ui.role', role: 'employee' });
    expect(visibleRooms(state).some(room => room.kind === 'lobby')).toBe(false);
    expect(visibleRecords(state, 'demo-website-meeting').every(record => record.audience === 'internal')).toBe(true);
    expect(visibleRecords(state, 'demo-website-lobby')).toEqual([]);
  });
});
