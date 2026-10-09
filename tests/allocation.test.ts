import { describe, expect, it } from 'vitest';
import { visibleActors } from '../features/studio/model/selectors';
import { createDemoState } from '../features/studio/model/seed';
import { studioReducer } from '../features/studio/model/reducer';

describe('session lifecycle', () => {
  it('closing one session leaves other seat assignments unchanged', () => {
    const state = studioReducer(createDemoState(), { type: 'session.close-requested', sessionId: 'session-atlas' });
    const seat = state.sessions['session-mika'].seatSlot;
    const closing = studioReducer(state, { type: 'session.closed', sessionId: 'session-atlas' });
    expect(closing.sessions['session-atlas']).toBeUndefined();
    expect(closing.sessions['session-mika'].seatSlot).toBe(seat);
  });
});

describe('session lifecycle and reports', () => {
  it('returns an accepted approval to working and only enters reporting on an explicit report action', () => {
    let state = createDemoState();
    state.tasks['task-09'] = { ...state.tasks['task-09'], status: 'approval', sessionId: 'session-mika' };
    state = studioReducer(state, { type: 'approval.responded', taskId: 'task-09', accepted: true });
    expect(state.tasks['task-09'].status).toBe('working');
    expect(Object.keys(state.reports)).toHaveLength(0);

    state = studioReducer(state, { type: 'task.status', taskId: 'task-09', status: 'reporting' });
    expect(state.tasks['task-09'].status).toBe('reporting');
    expect(Object.keys(state.reports)).toHaveLength(0);
    state = studioReducer(state, { type: 'report.submitted', report: { id: 'report-task-09', workspaceId: 'demo-website', taskId: 'task-09', sessionId: 'session-mika', content: 'Explicit report', status: 'submitted' } });
    expect(state.reports['report-task-09']?.content).toBe('Explicit report');
    expect(state.tasks['task-09'].status).toBe('reporting');
  });

  it('keeps closing reservations until a confirmed close and ignores late events', () => {
    const state = createDemoState();
    expect(studioReducer(state, { type: 'session.closed', sessionId: 'session-mika' })).toBe(state);
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

  it('rejects review/acceptance outside the active CEO workspace and after reassignment', () => {
    let state = createDemoState();
    state.tasks['task-09'] = { ...state.tasks['task-09'], status: 'reporting' };
    const report = { id: 'bound-report', workspaceId: 'demo-website', taskId: 'task-09', sessionId: 'session-mika', content: 'Done', status: 'submitted' as const };
    state = studioReducer(state, { type: 'report.submitted', report });
    const employee = studioReducer(state, { type: 'ui.role', role: 'employee' });
    expect(studioReducer(employee, { type: 'report.reviewed', reportId: report.id })).toBe(employee);
    const wrongWorkspace = { ...state, ui: { ...state.ui, workspaceId: 'demo-empty' } };
    expect(studioReducer(wrongWorkspace, { type: 'report.reviewed', reportId: report.id })).toBe(wrongWorkspace);
    const reviewed = studioReducer(state, { type: 'report.reviewed', reportId: report.id });
    const reassigned = { ...reviewed, tasks: { ...reviewed.tasks, 'task-09': { ...reviewed.tasks['task-09'], sessionId: 'session-atlas', status: 'assigned' as const } } };
    expect(studioReducer(reassigned, { type: 'report.accepted', reportId: report.id })).toBe(reassigned);
    expect(reassigned.acceptedReportIds).toEqual([]);
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
