import { describe, expect, it } from 'vitest';
import { assignTask, resizeDemoDepartments } from '../features/studio/model/allocation';
import { roomSessions, runningSessions, visibleActors } from '../features/studio/model/selectors';
import { createDemoState } from '../features/studio/model/seed';
import { studioReducer } from '../features/studio/model/reducer';

describe('session allocation', () => {
  it('keeps a department lead unique and allocates a fourth session to an overflow room', () => {
    const state = createDemoState();
    state.capacity = 10;
    state.tasks['task-overflow-a'] = { id: 'task-overflow-a', workspaceId: 'demo-website', departmentId: 'dept-ui', requiredSkills: ['new-skill'], status: 'queued', sessionId: null, title: 'Extra task A' };
    state.tasks['task-overflow-b'] = { id: 'task-overflow-b', workspaceId: 'demo-website', departmentId: 'dept-ui', requiredSkills: ['new-skill'], status: 'queued', sessionId: null, title: 'Extra task B' };
    const third = assignTask(state, 'task-overflow-a', 'claude');
    expect(third.outcome).toBe('starting');
    const fourth = assignTask(third.state, 'task-overflow-b', 'claude');
    expect(fourth.outcome).toBe('starting');
    const next = fourth.state;
    expect(roomSessions(next, 'room-ui')).toHaveLength(3);
    const overflowRoom = Object.values(next.rooms).find(room => room.departmentId === 'dept-ui' && room.id !== 'room-ui');
    expect(overflowRoom).toBeDefined();
    expect(roomSessions(next, overflowRoom!.id)).toHaveLength(1);
    const allocated = [...roomSessions(next, 'room-ui'), ...roomSessions(next, overflowRoom!.id)];
    expect(new Set(allocated.map(session => session.id)).size).toBe(4);
    expect(new Set(roomSessions(next, 'room-ui').map(session => session.seatSlot))).toEqual(new Set([0, 1, 2]));
    expect(allocated.filter(session => session.role === 'lead')).toHaveLength(1);
    expect(next.departments['dept-ui'].leadSessionId).toBe('session-atlas');
  });

  it('reuses a skill-matched available session without increasing session count', () => {
    const state = createDemoState();
    state.tasks['task-reuse'] = { id: 'task-reuse', workspaceId: 'demo-website', departmentId: 'dept-ui', requiredSkills: ['design-review'], status: 'queued', sessionId: null, title: 'Small UI fix' };
    const result = assignTask(state, 'task-reuse', 'claude');
    expect(result.outcome).toBe('reused');
    expect(Object.keys(result.state.sessions)).toHaveLength(5);
    expect(result.sessionId).toBe('session-atlas');
  });

  it('queues work when all six lifecycle reservations occupy capacity', () => {
    const state = createDemoState();
    state.capacity = 6;
    state.tasks['task-capacity'] = { id: 'task-capacity', workspaceId: 'demo-website', departmentId: 'dept-ui', requiredSkills: ['frontend'], status: 'queued', sessionId: null, title: 'Queued task' };
    const base = state.sessions['session-rune'];
    state.sessions['reservation-six'] = { ...base, id: 'reservation-six', lifecycle: 'disconnected' };
    const result = assignTask(state, 'task-capacity', 'claude');
    expect(result.outcome).toBe('queued');
    expect(result.sessionId).toBeNull();
    expect(Object.keys(result.state.sessions)).toHaveLength(6);
    expect(runningSessions(result.state)).toHaveLength(6);
  });

  it('64 empty departments do not create CLI sessions', () => {
    const next = resizeDemoDepartments(createDemoState(), 'demo-website', 64);
    expect(runningSessions(next)).toHaveLength(5);
    expect(Object.values(next.departments).filter(d => d.workspaceId === 'demo-website')).toHaveLength(64);
  });

  it('preserves referenced departments and rooms when resizing down', () => {
    const expanded = resizeDemoDepartments(createDemoState(), 'demo-website', 64);
    const resized = resizeDemoDepartments(expanded, 'demo-website', 1);
    expect(resized.departments['dept-ui']).toBeDefined();
    expect(resized.departments['dept-engineering']).toBeDefined();
    expect(resized.rooms['room-ui']).toBeDefined();
    expect(resized.rooms['room-engineering']).toBeDefined();
    expect(Object.values(resized.departments).filter(d => d.workspaceId === 'demo-website').length).toBeGreaterThanOrEqual(2);
  });

  it('closing one session leaves other seat assignments unchanged', () => {
    const state = createDemoState();
    const seat = state.sessions['session-mika'].seatSlot;
    const closing = studioReducer(state, { type: 'session.closed', sessionId: 'session-atlas' });
    expect(closing.sessions['session-atlas']).toBeUndefined();
    expect(closing.sessions['session-mika'].seatSlot).toBe(seat);
  });
});

describe('session lifecycle and reports', () => {
  it('keeps closing reservations until a confirmed close and ignores late events', () => {
    const state = createDemoState();
    const requested = studioReducer(state, { type: 'session.close-requested', sessionId: 'session-mika' });
    expect(requested.sessions['session-mika'].lifecycle).toBe('closing');
    expect(requested.sessions['session-mika'].seatSlot).toBe(1);
    expect(visibleActors(requested, 'room-ui').map(session => session.id)).toContain('session-mika');
    const failed = studioReducer(requested, { type: 'session.close-failed', sessionId: 'session-mika', message: 'still running' });
    expect(failed.sessions['session-mika'].lifecycle).toBe('error');
    const closed = studioReducer(failed, { type: 'session.closed', sessionId: 'session-mika' });
    expect(closed.sessions['session-mika']).toBeUndefined();
    expect(closed.archives['session-mika']).toBeDefined();
    const late = studioReducer(closed, { type: 'session.config', sessionId: 'session-mika', provider: 'gemini', model: 'late', reasoning: { kind: 'unknown' } });
    expect(late.sessions['session-mika']).toBeUndefined();
    expect(studioReducer(late, { type: 'session.started', sessionId: 'session-mika' }).sessions['session-mika']).toBeUndefined();
    expect(studioReducer(late, { type: 'session.message', sessionId: 'session-mika', message: { id: 'late', kind: 'output', text: 'late', timestamp: 1 } }).sessions['session-mika']).toBeUndefined();
  });

  it('does not let out-of-order lifecycle events cancel a close attempt', () => {
    const state = createDemoState();
    const closing = studioReducer(state, { type: 'session.close-requested', sessionId: 'session-mika' });
    expect(studioReducer(closing, { type: 'session.disconnected', sessionId: 'session-mika' })).toBe(closing);
    expect(studioReducer(state, { type: 'session.close-failed', sessionId: 'session-mika', message: 'unsolicited' })).toBe(state);
  });

  it('accepts each reviewed report once; submitted reports never complete tasks', () => {
    const state = createDemoState();
    const report = { id: 'report-task-09', workspaceId: 'demo-website', taskId: 'task-09', sessionId: 'session-mika', content: 'Done', status: 'submitted' as const };
    state.tasks['task-09'] = { ...state.tasks['task-09'], status: 'reporting' };
    let next = studioReducer(state, { type: 'report.submitted', report });
    expect(next.tasks['task-09'].status).toBe('reporting');
    next = studioReducer(next, { type: 'report.accepted', reportId: report.id });
    expect(next.tasks['task-09'].status).toBe('reporting');
    next = studioReducer(next, { type: 'report.reviewed', reportId: report.id });
    next = studioReducer(next, { type: 'report.accepted', reportId: report.id });
    expect(next.tasks['task-09'].status).toBe('done');
    expect(next.acceptedReportIds).toEqual([report.id]);
    const duplicate = studioReducer(next, { type: 'report.accepted', reportId: report.id });
    expect(duplicate.acceptedReportIds).toHaveLength(1);
  });

  it('rejects a report from another session or a task that is not reporting', () => {
    const state = createDemoState();
    state.tasks['task-09'] = { ...state.tasks['task-09'], status: 'reporting' };
    const task = state.tasks['task-09'];
    const wrongSession = { id: 'report-spoof', workspaceId: task.workspaceId, taskId: task.id, sessionId: 'session-rune', content: 'spoof', status: 'submitted' as const };
    expect(studioReducer(state, { type: 'report.submitted', report: wrongSession })).toBe(state);
    const notReporting = { ...state, tasks: { ...state.tasks, 'task-09': { ...task, status: 'queued' as const } } };
    const sameSession = { ...wrongSession, id: 'report-queued', sessionId: task.sessionId! };
    expect(studioReducer(notReporting, { type: 'report.submitted', report: sameSession })).toBe(notReporting);
  });

  it('rejects assignments to mismatched, busy, or unconfirmed sessions', () => {
    const state = createDemoState();
    state.tasks['task-assign'] = { id: 'task-assign', workspaceId: 'demo-website', departmentId: 'dept-ui', requiredSkills: ['design-review'], status: 'queued', sessionId: null, title: 'Assign safely' };
    expect(studioReducer(state, { type: 'task.assigned', taskId: 'task-assign', sessionId: 'session-sage' })).toBe(state);
    const validAssignment = studioReducer(state, { type: 'task.assigned', taskId: 'task-assign', sessionId: 'session-atlas' });
    expect(validAssignment.tasks['task-assign'].status).toBe('assigned');
    const unconfirmed = { ...state, sessions: { ...state.sessions, 'session-atlas': { ...state.sessions['session-atlas'], lifecycle: 'starting' as const, processConfirmed: false } } };
    expect(studioReducer(unconfirmed, { type: 'task.assigned', taskId: 'task-assign', sessionId: 'session-atlas' })).toBe(unconfirmed);
    const busy = { ...state, tasks: { ...state.tasks, 'task-busy': { ...state.tasks['task-09'], id: 'task-busy', status: 'working' as const, sessionId: 'session-atlas' } } };
    expect(studioReducer(busy, { type: 'task.assigned', taskId: 'task-assign', sessionId: 'session-atlas' })).toBe(busy);
  });

  it('cannot rewind an accepted task through a generic status event', () => {
    const state = createDemoState();
    state.tasks['task-09'] = { ...state.tasks['task-09'], status: 'done' };
    expect(studioReducer(state, { type: 'task.status', taskId: 'task-09', status: 'working' })).toBe(state);
  });
});
