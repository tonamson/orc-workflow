import { seatAnchor, standingAnchor, type LayoutRoom, type Point } from './geometry';

export type MotionTarget = { animate: (frames: Keyframe[], options: KeyframeAnimationOptions) => Animation };
export type MotionOptions = { duration: number; onFinish: () => void };

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
  const doorX = room.mirrored ? left + 18 : left + width - 18;
  const exteriorX = room.mirrored ? left - 18 : left + width + 18;
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
