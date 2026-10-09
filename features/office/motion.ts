import { seatAnchor, standingAnchor, type LayoutRoom, type Point } from './geometry';

export type MotionTarget = { animate: (frames: Keyframe[], options: KeyframeAnimationOptions) => Animation };
export type MotionOptions = { duration: number; onFinish: () => void };

function sourceToOffice(room: LayoutRoom, point: Point): Point {
  const [sx, sy, sw, sh] = room.source;
  const [dx, dy, dw, dh] = room.destination;
  return { x: dx + ((point.x - sx) / sw) * dw, y: dy + ((point.y - sy) / sh) * dh };
}

function centralDoorX(room: LayoutRoom): number {
  const [left, , width] = room.source;
  const sourceRight = room.room.template === 'ui';
  return sourceRight !== room.mirrored ? left + width - 18 : left + 18;
}

export function officeReportRoute(room: LayoutRoom, slot: number): Point[] {
  const start = sourceToOffice(room, seatAnchor(room, slot));
  const workDoor = sourceToOffice(room, { x: centralDoorX(room), y: 810 });
  return [start, sourceToOffice(room, { x: seatAnchor(room, slot).x, y: 810 }), workDoor,
    { x: 793, y: workDoor.y }, { x: 793, y: 440 }, { x: 793, y: 424 }, { x: 793, y: 330 }];
}

export function officeExitRoute(officeHeight = 992): Point[] {
  const entrance = officeHeight - 92;
  return [{ x: 793, y: 330 }, { x: 793, y: 424 }, { x: 793, y: 810 }, { x: 793, y: entrance }, { x: 793, y: officeHeight + 100 }];
}

export function routeFor(room: LayoutRoom, slot: number, phase: 'assign' | 'report' | 'exit', leadSlot: number | null): Point[] {
  const [left, , width] = room.source;
  const x = phase === 'assign' ? standingAnchor(room, slot) : seatAnchor(room, slot);
  if (room.room.template === 'supervisor') {
    const [, top, , height] = room.source;
    const door = { x: left + width - 18, y: top + height - 18 };
    const aisle = { x: door.x - 78, y: door.y - 50 };
    if (phase === 'exit' || (phase === 'report' && leadSlot === null)) return [x, aisle, door, { x: door.x, y: door.y + 28 }];
    if (phase === 'assign') return [{ x: door.x, y: door.y + 28 }, door, aisle, x];
    const lead = seatAnchor(room, leadSlot!);
    return [x, aisle, { x: lead.x + 62, y: lead.y }];
  }
  const doorX = centralDoorX(room);
  const exteriorX = doorX > left + width / 2 ? left + width + 18 : left - 18;
  const door = { x: doorX, y: 810 };
  const exterior = { x: exteriorX, y: 810 };
  const aisle = { x: left + width / 2, y: 810 };
  if (phase === 'exit' || (phase === 'report' && leadSlot === null)) return [x, { x: x.x, y: 810 }, aisle, door, exterior];
  if (phase === 'assign') return [exterior, door, aisle, { x: x.x, y: 810 }, x];
  if (leadSlot === slot) return [x, { x: x.x, y: 810 }, aisle, door, exterior];
  const lead = seatAnchor(room, leadSlot!);
  const besideLead = { x: lead.x + (slot < leadSlot! ? 58 : -58), y: standingAnchor(room, leadSlot!).y };
  return [x, { x: x.x, y: 810 }, { x: besideLead.x, y: 810 }, besideLead];
}

export function startMotion(target: MotionTarget, points: Point[], options: MotionOptions): { cancel(): void; pause(): void; play(): void } {
  const animation = target.animate(points.map(point => ({ left: `${point.x}%`, top: `${point.y}%` })), { duration: options.duration, easing: 'linear', fill: 'forwards' });
  let cancelled = false;
  void animation.finished.then(() => { if (!cancelled) options.onFinish(); }).catch(() => undefined);
  return { cancel() { cancelled = true; animation.cancel(); }, pause() { animation.pause(); }, play() { animation.play(); } };
}
