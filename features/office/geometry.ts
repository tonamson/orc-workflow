import type { Room } from '../studio/model/types';

export type Point = { x: number; y: number };
export type Box = [number, number, number, number];
export type OfficeSection = { kind: 'top' | 'work-row' | 'facade'; source: Box; destination: Box };
export type LayoutRoom = { room: Room; source: Box; destination: Box; mirrored: boolean; officeRow: number | null; officeSlot: number | null };
export type OfficeLayout = { width: number; height: number; rooms: LayoutRoom[]; sections: OfficeSection[] };

export const OFFICE_WORLD = { width: 1586, topHeight: 440, rowHeight: 398, facadeY: 838, facadeHeight: 154 } as const;

const roomBoxes: Record<Room['template'], Box> = {
  ui: [8, 440, 666, 398],
  engineering: [912, 440, 666, 398],
  supervisor: [478, 8, 630, 432],
  lobby: [8, 8, 490, 432],
  meeting: [1088, 8, 490, 432],
};

function section(kind: OfficeSection['kind'], source: Box, destination: Box): OfficeSection { return { kind, source, destination }; }

export function layoutOffice(rooms: Room[]): OfficeLayout {
  const fixedRooms = rooms.filter(room => room.kind !== 'work');
  const workRooms = rooms.filter(room => room.kind === 'work');
  const rows = Math.max(1, Math.ceil(workRooms.length / 2));
  const height = OFFICE_WORLD.topHeight + rows * OFFICE_WORLD.rowHeight + OFFICE_WORLD.facadeHeight;
  const sections: OfficeSection[] = [section('top', [0, 0, OFFICE_WORLD.width, OFFICE_WORLD.topHeight], [0, 0, OFFICE_WORLD.width, OFFICE_WORLD.topHeight])];
  for (let row = 0; row < rows; row += 1) {
    const y = OFFICE_WORLD.topHeight + row * OFFICE_WORLD.rowHeight;
    sections.push(section('work-row', [0, OFFICE_WORLD.topHeight, OFFICE_WORLD.width, OFFICE_WORLD.rowHeight], [0, y, OFFICE_WORLD.width, OFFICE_WORLD.rowHeight]));
    if (row < rows - 1) sections.push(section('work-row', [706, 761, 180, 40], [706, y + 365, 180, 33]));
  }
  const facadeY = OFFICE_WORLD.topHeight + rows * OFFICE_WORLD.rowHeight;
  sections.push(section('facade', [0, OFFICE_WORLD.facadeY, OFFICE_WORLD.width, OFFICE_WORLD.facadeHeight], [0, facadeY, OFFICE_WORLD.width, OFFICE_WORLD.facadeHeight]));

  const layoutRooms: LayoutRoom[] = fixedRooms.map(room => {
    const box = roomBoxes[room.template];
    return { room, source: [...box], destination: [...box], mirrored: false, officeRow: null, officeSlot: null };
  });
  workRooms.forEach((room, index) => {
    const officeRow = Math.floor(index / 2);
    const officeSlot = index % 2;
    const source = roomBoxes[room.template];
    const x = officeSlot === 0 ? 8 : 912;
    const y = OFFICE_WORLD.topHeight + officeRow * OFFICE_WORLD.rowHeight;
    const mirrored = (room.template === 'engineering' && officeSlot === 0) || (room.template === 'ui' && officeSlot === 1);
    layoutRooms.push({ room, source: [...source], destination: [x, y, 666, 398], mirrored, officeRow, officeSlot });
  });
  return { width: OFFICE_WORLD.width, height, rooms: layoutRooms, sections };
}

export function seatAnchor(room: LayoutRoom, slot: number): Point {
  const slotIndex = Math.max(0, Math.min(2, Math.floor(slot)));
  if (room.room.template === 'supervisor') return { x: 792, y: 240 };
  const xValues = room.room.template === 'engineering' ? [1055, 1225, 1393] : [195, 355, 522];
  const unmirroredX = xValues[slotIndex];
  const x = room.mirrored ? room.source[0] + room.source[2] - (unmirroredX - room.source[0]) : unmirroredX;
  return { x, y: 765 };
}

export function standingAnchor(room: LayoutRoom, slot: number): Point {
  const anchor = seatAnchor(room, slot);
  return { x: anchor.x, y: room.room.template === 'supervisor' ? 240 : 785 };
}

export function pointPercent(room: LayoutRoom, point: Point): Point {
  return { x: ((point.x - room.source[0]) / room.source[2]) * 100, y: ((point.y - room.source[1]) / room.source[3]) * 100 };
}
