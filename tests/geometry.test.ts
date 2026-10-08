import { describe, expect, it } from 'vitest';
import { layoutOffice, seatAnchor, standingAnchor } from '../features/office/geometry';
import { spriteFrame } from '../features/office/atlas';
import { createDemoState } from '../features/studio/model/seed';
import { resizeDemoDepartments } from '../features/studio/model/allocation';

describe('approved office geometry', () => {
  it('places 64 departments on 32 work rows with one facade', () => {
    const state = resizeDemoDepartments(createDemoState(), 'demo-website', 64);
    const layout = layoutOffice(Object.values(state.rooms).filter(room => room.workspaceId === 'demo-website'));
    expect(layout.width).toBe(1586);
    expect(layout.height).toBe(13330);
    expect(layout.rooms).toHaveLength(67);
    expect(layout.sections.filter(section => section.kind === 'facade')).toHaveLength(1);
  });

  it('uses the approved destination crops for the first UI and engineering rooms', () => {
    const layout = layoutOffice(Object.values(createDemoState().rooms).filter(room => room.workspaceId === 'demo-website'));
    expect(layout.rooms.find(room => room.room.id === 'room-ui')?.destination).toEqual([8, 440, 666, 398]);
    expect(layout.rooms.find(room => room.room.id === 'room-engineering')?.destination).toEqual([912, 440, 666, 398]);
    expect(layout.rooms.find(room => room.room.id === 'room-ui')?.source).toEqual([8, 440, 666, 398]);
    expect(layout.rooms.find(room => room.room.id === 'room-engineering')?.source).toEqual([912, 440, 666, 398]);
  });

  it('keeps the three exact default-room artwork crops and Supervisor anchor', () => {
    const layout = layoutOffice(Object.values(createDemoState().rooms).filter(room => room.workspaceId === 'demo-website'));
    expect(layout.rooms.find(room => room.room.kind === 'supervisor')?.source).toEqual([478, 8, 630, 432]);
    expect(layout.rooms.find(room => room.room.kind === 'lobby')?.source).toEqual([8, 8, 490, 432]);
    expect(layout.rooms.find(room => room.room.kind === 'meeting')?.source).toEqual([1088, 8, 490, 432]);
    expect(seatAnchor(layout.rooms.find(room => room.room.kind === 'supervisor')!, 0)).toEqual({ x: 792, y: 240 });
  });

  it('keeps the approved third seats and standing anchor', () => {
    const layout = layoutOffice(Object.values(createDemoState().rooms).filter(room => room.workspaceId === 'demo-website'));
    const ui = layout.rooms.find(room => room.room.id === 'room-ui')!;
    const engineering = layout.rooms.find(room => room.room.id === 'room-engineering')!;
    expect(seatAnchor(ui, 2)).toEqual({ x: 522, y: 765 });
    expect(seatAnchor(engineering, 2)).toEqual({ x: 1393, y: 765 });
    expect(standingAnchor(ui, 2)).toEqual({ x: 522, y: 785 });
  });

  it('mirrors the seat anchor with mirrored overflow artwork', () => {
    const state = createDemoState();
    state.rooms['ui-extra-a'] = { ...state.rooms['room-ui'], id: 'ui-extra-a', name: 'UI extra A' };
    state.rooms['ui-extra-b'] = { ...state.rooms['room-ui'], id: 'ui-extra-b', name: 'UI extra B' };
    const mirrored = layoutOffice(Object.values(state.rooms).filter(room => room.workspaceId === 'demo-website')).rooms.find(room => room.room.id === 'ui-extra-b')!;
    expect(mirrored.mirrored).toBe(true);
    expect(seatAnchor(mirrored, 2).x).toBe(160);
  });
});

describe('sprite atlas crops', () => {
  it('keeps measured frames and seated head offsets from the approved atlas', () => {
    const avatars = ['Nova', 'Atlas', 'Mika', 'Sage', 'Rune'] as const;
    const offsets = avatars.map(avatar => spriteFrame(avatar, 'seated').offsetX);
    expect(offsets).toEqual([13, 15, 9, 14, 13]);
    expect(spriteFrame('Nova', 'standing').source).toEqual([96, 46, 112, 266]);
    expect(spriteFrame('Atlas', 'seated').source).toEqual([379, 917, 140, 171]);
    expect(spriteFrame('Rune', 'walking', 1).source).toEqual([1217, 640, 124, 258]);
  });
});
