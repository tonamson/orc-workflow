import { describe, expect, it, vi } from 'vitest';
import { createDemoAdapter } from '../features/demo/adapter';
import { routeFor, startMotion, type MotionTarget } from '../features/office/motion';
import { layoutOffice } from '../features/office/geometry';
import { createDemoState } from '../features/studio/model/seed';
import { studioReducer } from '../features/studio/model/reducer';

describe('agent motion and demo cleanup', () => {
  const room = layoutOffice(Object.values(createDemoState().rooms)).rooms.find(item => item.room.id === 'room-ui')!;
  it('routes assigned agents through the doorway aisle to a standing seat', () => {
    const points = routeFor(room, 2, 'assign', null);
    expect(points.at(-1)).toEqual({ x: 522, y: 785 });
    expect(points.some(point => point.y === 720)).toBe(true);
  });
  it('keeps the Supervisor route inside its own room', () => {
    const supervisor = layoutOffice(Object.values(createDemoState().rooms)).rooms.find(item => item.room.kind === 'supervisor')!;
    const route = routeFor(supervisor, 0, 'exit', null);
    expect(Math.max(...route.map(point => point.y))).toBeLessThan(supervisor.source[1] + supervisor.source[3] + 30);
  });
  it('reports beside the Lead and uses the exit when this room has no Lead', () => {
    const report = routeFor(room, 1, 'report', 0);
    expect(report.at(-1)).not.toEqual({ x: 195, y: 785 });
    expect(routeFor(room, 1, 'report', null).at(-1)?.y).toBe(810);
  });
  it('disposes pending demo events without changing the later workspace', () => {
    vi.useFakeTimers();
    let state = createDemoState();
    state = studioReducer(state, { type: 'session.start-requested', id: 'session-pending', workspaceId: 'demo-website', roomId: 'room-ui', agentName: 'Pending', avatar: 'Mika', provider: 'codex', model: null, reasoning: { kind: 'unknown' }, skills: ['frontend'] });
    const adapter = createDemoAdapter(() => state, event => { state = studioReducer(state, event); });
    adapter.receive('session-pending');
    adapter.dispose();
    state = studioReducer(state, { type: 'ui.workspace', workspaceId: 'demo-empty' });
    vi.runAllTimers();
    expect(state.ui.workspaceId).toBe('demo-empty');
    expect(state.sessions['session-pending'].lifecycle).toBe('starting');
    vi.useRealTimers();
  });
  it('receive assigns queued work to an existing eligible session', () => {
    vi.useFakeTimers();
    let state = createDemoState();
    const adapter = createDemoAdapter(() => state, event => { state = studioReducer(state, event); });
    adapter.receive('session-nova');
    vi.runAllTimers();
    const task = state.tasks['task-10'];
    expect(task.status).toBe('assigned');
    expect(task.sessionId).toBe('session-sage');
    expect(state.sessions[task.sessionId!].lifecycle).toBe('active');
    adapter.dispose();
    vi.useRealTimers();
  });
  it('receive creates a confirmed reservation when eligible sessions are busy', () => {
    vi.useFakeTimers();
    let state = createDemoState();
    state.tasks['task-10'] = { ...state.tasks['task-10'], status: 'assigned', sessionId: 'session-sage' };
    state.tasks['task-08'] = { ...state.tasks['task-08'], status: 'assigned', sessionId: 'session-rune' };
    state.tasks['task-11'] = { ...state.tasks['task-11'], status: 'assigned', sessionId: 'session-atlas' };
    const adapter = createDemoAdapter(() => state, event => { state = studioReducer(state, event); });
    adapter.receive('session-nova');
    vi.runAllTimers();
    const task = state.tasks['task-12'];
    expect(task.status).toBe('assigned');
    expect(task.sessionId).toMatch(/^session-demo-receive-/);
    expect(state.sessions[task.sessionId!].lifecycle).toBe('active');
    expect(state.sessions[task.sessionId!].processConfirmed).toBe(true);
    adapter.dispose();
    vi.useRealTimers();
  });
  it('cancels Web Animations without completing the lifecycle', () => {
    const onFinish = vi.fn(); const cancel = vi.fn();
    const target = { animate: vi.fn(() => ({ cancel, pause: vi.fn(), play: vi.fn(), finished: Promise.resolve() })) } as unknown as MotionTarget;
    const motion = startMotion(target, [{ x: 0, y: 0 }, { x: 8, y: 0 }], { duration: 100, onFinish });
    motion.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    return Promise.resolve().then(() => expect(onFinish).not.toHaveBeenCalled());
  });
});
