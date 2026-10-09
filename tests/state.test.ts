import { describe, expect, it } from 'vitest';
import { createDemoState } from '../features/studio/model/seed';
import { createEmptyState } from '../features/studio/model/empty';
import { studioReducer } from '../features/studio/model/reducer';
import { visibleActors } from '../features/studio/model/selectors';
import { isLocalOnlyEvent } from '../features/studio/persistence-events';
import { sessionDisplay } from '../features/sessions/display';

describe('operational state', () => {
  it('starts with no workspace, rooms, sessions, tasks, or records', () => {
    const state = createEmptyState();
    expect(Object.keys(state.workspaces)).toHaveLength(0);
    expect(Object.keys(state.rooms)).toHaveLength(0);
    expect(Object.keys(state.sessions)).toHaveLength(0);
    expect(Object.keys(state.tasks)).toHaveLength(0);
    expect(Object.keys(state.records)).toHaveLength(0);
    expect(state.ui.workspaceId).toBeNull();
    expect(state.ui.selectedSessionId).toBeNull();
    expect(state.ui.panelOpen).toBe(false);
  });

  it('never falls back to a demo workspace when changing the local role context', () => {
    const state = studioReducer(createEmptyState(), { type: 'ui.role', role: 'employee' });
    expect(state.ui.workspaceId).toBeNull();
    expect(Object.keys(state.workspaces)).toHaveLength(0);
  });

  it('projects only runtime-registered workspaces into office navigation', () => {
    const registered = studioReducer(createEmptyState(), { type: 'runtime.workspaces', workspaces: [{ id: 'src', name: 'Source', path: '/repo/source', status: 'ready' }] });
    const state = studioReducer(registered, { type: 'ui.workspace', workspaceId: 'src' });
    expect(Object.keys(state.workspaces)).toEqual(['src']);
    expect(state.workspaces.src.repoPath).toBe('/repo/source');
    expect(Object.keys(state.sessions)).toHaveLength(0);
    expect(Object.values(state.rooms).map(room => room.workspaceId)).toEqual(['src', 'src', 'src']);
    expect(isLocalOnlyEvent({ type: 'runtime.workspaces', workspaces: [{ id: 'src', name: 'Source', path: '/repo/source', status: 'ready' }] })).toBe(true);
  });

  it('keeps the empty terminal open across workspace list refreshes', () => {
    const workspaces = [{ id: 'src', name: 'Source', path: '/repo/source', status: 'ready' as const }];
    let state = studioReducer(createEmptyState(), { type: 'runtime.workspaces', workspaces });
    state = studioReducer(state, { type: 'ui.workspace', workspaceId: 'src' });
    state = studioReducer(state, { type: 'ui.panel', open: true });
    expect(state.ui.panelOpen).toBe(true);
    state = studioReducer(state, { type: 'runtime.workspaces', workspaces });
    expect(state.ui.panelOpen).toBe(true);
    expect(state.ui.workspaceId).toBe('src');
  });

  it('shows a native actor only when the runtime confirms its process', () => {
    const registered = studioReducer(createEmptyState(), { type: 'runtime.workspaces', workspaces: [{ id: 'src', name: 'Source', path: '/repo/source', status: 'ready' }] });
    const state = studioReducer(registered, { type: 'ui.workspace', workspaceId: 'src' });
    const run = {
      id: 'run-1', workspaceId: 'src', taskId: 'task-1', status: 'active', phase: 'supervisor_delegation' as const, prompt: 'Inspect the repository', report: null,
      sessions: [{ id: 'session-1', role: 'supervisor' as const, status: 'active', processConfirmed: false, nativeConversationId: null, model: null, reasoningEffort: null, lastSequence: 0, startedAt: null }],
    };
    const unconfirmed = studioReducer(state, { type: 'runtime.run', run });
    expect(isLocalOnlyEvent({ type: 'runtime.run', run })).toBe(true);
    expect(unconfirmed.sessions['session-1'].processConfirmed).toBe(false);
    expect(visibleActors(unconfirmed, 'src-supervisor')).toHaveLength(0);

    const confirmed = studioReducer(state, { type: 'runtime.run', run: { ...run, sessions: [{ ...run.sessions[0], processConfirmed: true }] } });
    expect(confirmed.sessions['session-1'].processConfirmed).toBe(true);
    expect(visibleActors(confirmed, 'src-supervisor').map(session => session.id)).toEqual(['session-1']);
    expect(isLocalOnlyEvent({ type: 'record.updated', recordId: 'r1', content: 'persist me', updatedAt: 1 })).toBe(false);
  });

  it('maps task status and office motion only from runtime-confirmed transitions', () => {
    const registered = studioReducer(createEmptyState(), { type: 'runtime.workspaces', workspaces: [{ id: 'src', name: 'Source', path: '/repo/source', status: 'ready' }] });
    const state = studioReducer(registered, { type: 'ui.workspace', workspaceId: 'src' });
    const supervisor = { id: 'supervisor-1', role: 'supervisor' as const, status: 'active', processConfirmed: true, nativeConversationId: 'native-s', model: 'codex', reasoningEffort: 'high', lastSequence: 1, startedAt: '2026-10-08T00:00:00.000Z' };
    const peer = { id: 'peer-1', role: 'peer' as const, status: 'queued', processConfirmed: false, nativeConversationId: null, model: null, reasoningEffort: null, lastSequence: 0, startedAt: null };
    const initial = { id: 'run-1', workspaceId: 'src', taskId: 'task-1', status: 'active', phase: 'supervisor_delegation' as const, prompt: 'Inspect', report: null, sessions: [supervisor, peer] };
    let next = studioReducer(state, { type: 'runtime.run', run: initial });
    expect(next.tasks['runtime-run-1'].status).toBe('working');
    expect(sessionDisplay(next, next.sessions['supervisor-1']).state).toBe('Đang làm việc');

    const peerRunning = { ...initial, phase: 'peer_running' as const, sessions: [supervisor, { ...peer, status: 'active', processConfirmed: true, nativeConversationId: 'native-p', model: 'codex', reasoningEffort: 'medium', lastSequence: 1, startedAt: '2026-10-08T00:01:00.000Z' }] };
    next = studioReducer(next, { type: 'runtime.run', run: peerRunning });
    expect(next.tasks['runtime-run-1'].status).toBe('working');
    expect(next.sessions['peer-1'].runtimeMotion?.phase).toBe('assign');
    expect(visibleActors(next, 'src-agents').map(session => session.id)).toContain('peer-1');
    expect(sessionDisplay(next, next.sessions['supervisor-1']).state).toBe('Đang theo dõi Agent');

    const reporting = { ...peerRunning, phase: 'supervisor_reporting' as const, status: 'reporting', report: 'Completed read-only review.' };
    next = studioReducer(next, { type: 'runtime.run', run: reporting });
    expect(next.tasks['runtime-run-1'].status).toBe('reporting');
    expect(next.sessions['peer-1'].runtimeMotion?.phase).toBe('report');
    expect(sessionDisplay(next, next.sessions['supervisor-1']).state).toBe('Đang rà soát báo cáo Agent');

    const beforeClose = next;
    const closedRun = { ...reporting, phase: 'done' as const, status: 'done', finalReport: 'Accepted and summarized.', sessions: [{ ...supervisor, status: 'closed', processConfirmed: false }, { ...reporting.sessions[1], status: 'closed', processConfirmed: false }] };
    next = studioReducer(next, { type: 'runtime.run', run: closedRun });
    expect(next.tasks['runtime-run-1'].status).toBe('done');
    const departure = next.sessions['peer-1'];
    expect(departure).toMatchObject({ processConfirmed: false, runtimeMotion: { phase: 'exit', origin: 'supervisor-desk' } });
    expect(visibleActors(next, 'src-supervisor').map(session => session.id)).toContain('peer-1');
    next = studioReducer(next, { type: 'runtime.run', run: closedRun });
    next = studioReducer(next, { type: 'runtime.run', run: closedRun });
    expect(visibleActors(next, 'src-supervisor').map(session => session.id)).toContain('peer-1');
    next = studioReducer(next, { type: 'runtime.motion-finished', sessionId: 'peer-1', sequence: departure.runtimeMotion!.sequence });
    expect(visibleActors(next, 'src-supervisor')).toHaveLength(0);
    expect(next.sessions['peer-1']).toBeUndefined();
    next = studioReducer(next, { type: 'runtime.run', run: closedRun });
    expect(visibleActors(next, 'src-supervisor')).toHaveLength(0);

    const interrupted = studioReducer(beforeClose, { type: 'runtime.run', run: { ...reporting, phase: 'done', status: 'interrupted', sessions: [{ ...supervisor, status: 'closed', processConfirmed: false }, { ...reporting.sessions[1], status: 'closed', processConfirmed: false }] } });
    expect(visibleActors(interrupted, 'src-supervisor')).toHaveLength(0);

    const blocked = studioReducer(next, { type: 'runtime.run', run: { ...reporting, status: 'error' } });
    expect(blocked.tasks['runtime-run-1'].status).toBe('blocked');
  });

  it('rehydrates every persisted run in a workspace and preserves earlier projections on live updates', () => {
    const registered = studioReducer(createEmptyState(), { type: 'runtime.workspaces', workspaces: [{ id: 'src', name: 'Source', path: '/repo/source', status: 'ready' }] });
    const baseRun = { id: 'run-a', workspaceId: 'src', taskId: 'same-title', status: 'done', phase: 'done' as const, prompt: 'First task', report: null, sessions: [] };
    const secondRun = { ...baseRun, id: 'run-b', prompt: 'Second task' };
    let next = studioReducer(registered, { type: 'runtime.runs', workspaceId: 'src', runs: [baseRun, secondRun] });
    expect(next.tasks['runtime-run-a']?.title).toBe('same-title');
    expect(next.tasks['runtime-run-b']?.title).toBe('same-title');
    expect(next.rooms['src-agents']?.kind).toBe('work');

    const liveRun = { ...baseRun, status: 'active', phase: 'peer_running' as const, sessions: [{ id: 'session-a', role: 'peer' as const, status: 'active', processConfirmed: true, nativeConversationId: 'native-a', model: 'codex', reasoningEffort: 'high', lastSequence: 10, startedAt: '2026-10-08T00:00:00.000Z' }] };
    next = studioReducer(next, { type: 'runtime.run', run: liveRun });
    const motionSequence = next.sessions['session-a']?.runtimeMotion?.sequence;
    next = studioReducer(next, { type: 'runtime.runs', workspaceId: 'src', runs: [liveRun, secondRun] });
    expect(next.tasks['runtime-run-b']?.status).toBe('done');
    expect(next.tasks['runtime-run-a']?.status).toBe('working');
    expect(next.sessions['session-a']?.processConfirmed).toBe(true);
    expect(next.sessions['session-a']?.runtimeMotion?.sequence).toBe(motionSequence);

    const reportRun = { ...liveRun, status: 'reporting', phase: 'supervisor_reporting' as const, report: 'Agent report received.' };
    next = studioReducer(next, { type: 'runtime.run', run: reportRun });
    const reportSequence = next.sessions['session-a']?.runtimeMotion?.sequence;
    expect(next.sessions['session-a']?.runtimeMotion?.phase).toBe('report');
    next = studioReducer(next, { type: 'runtime.motion-finished', sessionId: 'session-a', sequence: reportSequence! });
    expect(next.sessions['session-a']?.runtimeMotion?.completed).toBe(true);
    next = studioReducer(next, { type: 'runtime.runs', workspaceId: 'src', runs: [reportRun, secondRun] });
    expect(next.sessions['session-a']?.runtimeMotion?.sequence).toBe(reportSequence);
    expect(next.sessions['session-a']?.runtimeMotion?.completed).toBe(true);
  });
});

describe('initial demo state', () => {
  it('starts on the office with no selected detail panel', () => {
    const state = createDemoState();
    expect(state.ui.selectedSessionId).toBeNull();
    expect(state.ui.selectedRecordId).toBeNull();
    expect(state.ui.panelOpen).toBe(false);
  });

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

});
