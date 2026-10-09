import type { AppState } from './types';

export function createEmptyState(): AppState {
  return {
    workspaces: {},
    clientViewers: {},
    departments: {},
    rooms: {},
    sessions: {},
    tasks: {},
    reports: {},
    records: {},
    archives: {},
    acceptedReportIds: [],
    capacity: 0,
    ui: {
      workspaceId: null,
      clientViewerId: null,
      role: 'ceo',
      roomId: null,
      officeMode: 'merged',
      selectedSessionId: null,
      selectedRecordId: null,
      panelOpen: false,
      search: '',
      recordFilter: 'all',
    },
  };
}
