import type { AppState, StudioEvent } from './types';

export function studioReducer(state: AppState, event: StudioEvent): AppState {
  switch (event.type) {
    case 'ui.workspace':
      if (!event.workspaceId || !state.workspaces[event.workspaceId]) return state;
      return { ...state, ui: { ...state.ui, workspaceId: event.workspaceId, roomId: null, selectedSessionId: null, selectedRecordId: null } };
    case 'ui.navigate': return { ...state, ui: { ...state.ui, roomId: event.roomId, selectedRecordId: null } };
    case 'ui.role': return { ...state, ui: { ...state.ui, role: event.role, selectedSessionId: event.role === 'client' ? null : state.ui.selectedSessionId } };
    case 'ui.client': return { ...state, ui: { ...state.ui, clientViewerId: event.clientViewerId } };
    case 'ui.mode': return { ...state, ui: { ...state.ui, officeMode: event.mode } };
    case 'ui.panel': return { ...state, ui: { ...state.ui, panelOpen: event.open } };
    case 'ui.search': return { ...state, ui: { ...state.ui, search: event.search } };
    case 'ui.record-filter': return { ...state, ui: { ...state.ui, recordFilter: event.filter } };
    default: return state;
  }
}
