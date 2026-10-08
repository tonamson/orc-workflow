import { describe, expect, it } from 'vitest';
import { layoutOffice } from '../features/office/geometry';
import { createDemoState } from '../features/studio/model/seed';
import { visibleRooms } from '../features/studio/model/selectors';

describe('stable room order after JSONB round trips', () => {
  it('keeps fixed-room navigation and UI/Engineering layout stable when dictionary keys reorder', () => {
    const state = createDemoState();
    const shuffled = {
      ...state,
      rooms: Object.fromEntries(Object.entries(state.rooms).reverse()),
      departments: Object.fromEntries(Object.entries(state.departments).reverse()),
    };
    expect(visibleRooms(shuffled).map(room => room.id)).toEqual(visibleRooms(state).map(room => room.id));
    expect(layoutOffice(visibleRooms(shuffled)).rooms.map(room => room.room.id)).toEqual(layoutOffice(visibleRooms(state)).rooms.map(room => room.room.id));
  });
});
