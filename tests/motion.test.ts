import { describe, expect, it, vi } from 'vitest';
import { officeExitRoute, officeReportRoute, routeFor, startMotion, type MotionTarget } from '../features/office/motion';
import { layoutOffice } from '../features/office/geometry';
import { createDemoState } from '../features/studio/model/seed';

describe('office motion geometry', () => {
  const room = layoutOffice(Object.values(createDemoState().rooms)).rooms.find(item => item.room.id === 'room-ui')!;
  it('routes assigned agents through the doorway aisle to a standing seat', () => {
    const points = routeFor(room, 2, 'assign', null);
    expect(points.at(-1)).toEqual({ x: 522, y: 785 });
    expect(points.some(point => point.y === 810)).toBe(true);
    expect(points.some(point => point.y === 720)).toBe(false);
  });
  it('keeps the Supervisor route inside its own room', () => {
    const supervisor = layoutOffice(Object.values(createDemoState().rooms)).rooms.find(item => item.room.kind === 'supervisor')!;
    const route = routeFor(supervisor, 0, 'exit', null);
    expect(Math.max(...route.map(point => point.y))).toBeLessThan(supervisor.source[1] + supervisor.source[3] + 30);
  });
  it('reports beside the Lead and uses the exit when this room has no Lead', () => {
    expect(routeFor(room, 1, 'report', 0).at(-1)).toEqual({ x: 137, y: 785 });
    expect(routeFor(room, 1, 'report', null).at(-1)?.y).toBe(810);
    expect(routeFor(room, 1, 'report', 1).at(-1)?.y).toBe(810);
  });
  it('pairs each template and mirror doorway with its outside edge and reports through the hall to the desk', () => {
    const state = createDemoState();
    state.rooms['extra-engineering'] = { ...state.rooms['room-engineering'], id: 'extra-engineering', name: 'Extra engineering' };
    state.rooms['extra-ui'] = { ...state.rooms['room-ui'], id: 'extra-ui', name: 'Extra UI' };
    const rooms = layoutOffice(Object.values(state.rooms)).rooms;
    const cases = [
      { id: 'room-ui', door: 656, outside: 692 },
      { id: 'room-engineering', door: 930, outside: 894 },
      { id: 'extra-engineering', door: 1560, outside: 1596 },
      { id: 'extra-ui', door: 26, outside: -10 },
    ];
    for (const item of cases) {
      const room = rooms.find(candidate => candidate.room.id === item.id)!;
      const route = routeFor(room, 1, 'exit', null);
      expect(room.mirrored).toBe(item.id.startsWith('extra-'));
      expect(route.at(-2)?.x).toBe(item.door);
      expect(route.at(-1)?.x).toBe(item.outside);
    }
    const ui = rooms.find(item => item.room.id === 'room-ui')!;
    const report = officeReportRoute(ui, 1);
    expect(report.at(-1)).toEqual({ x: 793, y: 330 });
    expect(report).toContainEqual({ x: 793, y: 424 });
    expect(report).toContainEqual({ x: 793, y: 810 });
    expect(officeExitRoute(1000).at(-1)?.y).toBeGreaterThan(1000 + 52 * 300 / 180);
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
