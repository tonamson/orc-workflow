import { describe, expect, it } from 'vitest';
import { assignTask, resizeDemoDepartments } from '../features/studio/model/allocation';
import { roomSessions, runningSessions } from '../features/studio/model/selectors';
import { createDemoState } from '../features/studio/model/seed';
import { studioReducer } from '../features/studio/model/reducer';

describe('session allocation', () => {
  it('keeps a department lead unique and allocates a fourth session to an overflow room', () => {
    const state = createDemoState();
    const first = state.sessions['session-atlas'];
    const added = ['session-extra-1', 'session-extra-2'];
    let next = { ...state, sessions: { ...state.sessions }, rooms: { ...state.rooms } };
    added.forEach((id, index) => {
      next.sessions[id] = { ...first, id, agentName: `Worker ${index}`, avatar: index ? 'Rune' : 'Mika', role: 'peer', seatSlot: (index + 1) as 1 | 2, messages: [] };
    });
    next.sessions['session-extra-2'] = { ...next.sessions['session-extra-2'], roomId: 'room-ui-overflow', seatSlot: 0 };
    next.rooms['room-ui-overflow'] = { ...state.rooms['room-ui'], id: 'room-ui-overflow', name: 'UI & UX · Phòng 02' };
    expect(roomSessions(next, 'room-ui')).toHaveLength(3);
    expect(roomSessions(next, 'room-ui-overflow')).toHaveLength(1);
    expect(new Set([...roomSessions(next, 'room-ui'), ...roomSessions(next, 'room-ui-overflow')].map(session => session.id)).size).toBe(4);
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
});
