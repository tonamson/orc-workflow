import type { AppState, Session, StudioEvent } from './types';
import { canAssignToSession, resizeDemoDepartments } from './allocation';
import { canAccessWorkspace, canSelectSession, visibleRecords, visibleRooms } from './selectors';

function appendStatus(session: Session, text: string, lifecycle: Session['lifecycle'] = session.lifecycle): Session {
  const timestamp = session.lastUpdate + 1;
  return { ...session, lifecycle, lastUpdate: timestamp, messages: [...session.messages, { id: `status-${timestamp}`, kind: 'status', text, timestamp }] };
}

function locateSlot(state: AppState, roomId: string): 0 | 1 | 2 | null {
  const occupied = new Set(Object.values(state.sessions).filter(session => session.roomId === roomId).map(session => session.seatSlot));
  return ([0, 1, 2] as const).find(slot => !occupied.has(slot)) ?? null;
}

export function studioReducer(state: AppState, event: StudioEvent): AppState {
  switch (event.type) {
    case 'ui.workspace':
      if (!event.workspaceId || !canAccessWorkspace(state, event.workspaceId)) return state;
      return { ...state, ui: { ...state.ui, workspaceId: event.workspaceId, roomId: state.ui.role === 'client' ? `${event.workspaceId}-lobby` : null, selectedSessionId: null, selectedRecordId: null, panelOpen: false } };
    case 'ui.navigate': {
      if (event.roomId !== null && !visibleRooms(state).some(room => room.id === event.roomId)) return state;
      return { ...state, ui: { ...state.ui, roomId: event.roomId, selectedSessionId: null, selectedRecordId: null, panelOpen: false } };
    }
    case 'ui.role': {
      if (event.role === 'client') {
        const viewer = state.ui.clientViewerId ? state.clientViewers[state.ui.clientViewerId] : null;
        const candidate = viewer && Object.values(state.workspaces).find(workspace => workspace.id === state.ui.workspaceId && workspace.customerId === viewer.customerId && viewer.allowedWorkspaceIds.includes(workspace.id));
        const clientViewerId = viewer ? viewer.id : 'client-a';
        const activeViewer = viewer ?? state.clientViewers[clientViewerId];
        const available = activeViewer ? Object.values(state.workspaces).filter(workspace => workspace.customerId === activeViewer.customerId && activeViewer.allowedWorkspaceIds.includes(workspace.id)) : [];
        const workspace = candidate ?? available[0];
        return { ...state, ui: { ...state.ui, role: 'client', clientViewerId, workspaceId: workspace?.id ?? null, roomId: workspace ? `${workspace.id}-lobby` : null, selectedSessionId: null, selectedRecordId: null, panelOpen: false } };
      }
      const workspaceId = state.ui.workspaceId && state.workspaces[state.ui.workspaceId] ? state.ui.workspaceId : 'demo-website';
      const next: AppState = { ...state, ui: { ...state.ui, role: event.role, workspaceId, roomId: state.ui.roomId, selectedSessionId: state.ui.selectedSessionId, selectedRecordId: state.ui.selectedRecordId } };
      const currentRoom = state.ui.roomId ? state.rooms[state.ui.roomId] : null;
      if (!currentRoom || currentRoom.workspaceId !== workspaceId || (event.role === 'employee' && currentRoom.kind === 'lobby')) {
        next.ui.roomId = event.role === 'employee' ? `${workspaceId}-meeting` : null;
      }
      const selectedSessionId = state.ui.selectedSessionId;
      if (selectedSessionId && !canSelectSession(next, selectedSessionId)) next.ui.selectedSessionId = null;
      const selectedRecordId = state.ui.selectedRecordId;
      const selectedRecord = selectedRecordId ? state.records[selectedRecordId] : null;
      if (!selectedRecord || !visibleRecords(next, selectedRecord.roomId).some(record => record.id === selectedRecordId)) next.ui.selectedRecordId = null;
      next.ui.panelOpen = Boolean(next.ui.selectedSessionId || next.ui.selectedRecordId) && state.ui.panelOpen;
      return next;
    }
    case 'ui.client': {
      if (!event.clientViewerId || !state.clientViewers[event.clientViewerId]) return state;
      if (state.ui.role !== 'client') return { ...state, ui: { ...state.ui, clientViewerId: event.clientViewerId } };
      const viewer = state.clientViewers[event.clientViewerId];
      const available = Object.values(state.workspaces).filter(workspace => workspace.customerId === viewer.customerId && viewer.allowedWorkspaceIds.includes(workspace.id));
      const workspace = available.find(candidate => candidate.id === state.ui.workspaceId) ?? available[0];
      return { ...state, ui: { ...state.ui, clientViewerId: viewer.id, workspaceId: workspace?.id ?? null, roomId: workspace ? `${workspace.id}-lobby` : null, selectedSessionId: null, selectedRecordId: null, panelOpen: false } };
    }
    case 'ui.mode': return { ...state, ui: { ...state.ui, officeMode: event.mode } };
    case 'ui.panel': return { ...state, ui: { ...state.ui, panelOpen: event.open } };
    case 'ui.select-session': {
      if (event.sessionId === null) return { ...state, ui: { ...state.ui, selectedSessionId: null, panelOpen: false } };
      if (!canSelectSession(state, event.sessionId)) return state;
      return { ...state, ui: { ...state.ui, roomId: state.sessions[event.sessionId].roomId, selectedSessionId: event.sessionId, selectedRecordId: null, panelOpen: true } };
    }
    case 'ui.select-record': {
      if (event.recordId === null) return { ...state, ui: { ...state.ui, selectedRecordId: null, panelOpen: false } };
      const record = state.records[event.recordId];
      if (!record || !visibleRecords(state, record.roomId).some(candidate => candidate.id === event.recordId)) return state;
      return { ...state, ui: { ...state.ui, roomId: record.roomId, selectedSessionId: null, selectedRecordId: record.id, panelOpen: true } };
    }
    case 'ui.search': return { ...state, ui: { ...state.ui, search: event.search } };
    case 'ui.record-filter': return { ...state, ui: { ...state.ui, recordFilter: event.filter } };
    case 'ui.departments-resize': {
      if (state.ui.role === 'client' || !state.ui.workspaceId) return state;
      return resizeDemoDepartments(state, state.ui.workspaceId, event.count);
    }
    case 'ui.department-create': {
      const name = event.name.trim(); const workspaceId = state.ui.workspaceId;
      if (!name || !workspaceId || state.ui.role === 'client') return state;
      const departments = Object.values(state.departments).filter(department => department.workspaceId === workspaceId);
      let index = 1; let id = `${workspaceId}-created-${String(index).padStart(2, '0')}`;
      while (state.departments[id]) { index += 1; id = `${workspaceId}-created-${String(index).padStart(2, '0')}`; }
      const template = departments.length % 2 ? 'engineering' : 'ui';
      const roomId = `${id}-room-01`;
      return {
        ...state,
        departments: { ...state.departments, [id]: { id, workspaceId, name, leadSessionId: null } },
        rooms: { ...state.rooms, [roomId]: { id: roomId, workspaceId, departmentId: id, name, kind: 'work', template } },
      };
    }
    case 'session.start-requested': {
      const room = state.rooms[event.roomId];
      if (state.sessions[event.id] || state.archives[event.id] || !room || room.workspaceId !== event.workspaceId || Object.keys(state.sessions).length >= state.capacity) return state;
      const seatSlot = locateSlot(state, room.id);
      if (seatSlot === null) return state;
      const session: Session = { id: event.id, workspaceId: event.workspaceId, roomId: event.roomId, seatSlot, agentName: event.agentName, avatar: event.avatar, role: room.departmentId && !state.departments[room.departmentId]?.leadSessionId ? 'lead' : 'peer', provider: event.provider, model: event.model, reasoning: event.reasoning, skills: [...event.skills], lifecycle: 'starting', processConfirmed: false, lastUpdate: 0, messages: [] };
      const departments = room.departmentId && session.role === 'lead' ? { ...state.departments, [room.departmentId]: { ...state.departments[room.departmentId], leadSessionId: event.id } } : state.departments;
      return { ...state, sessions: { ...state.sessions, [event.id]: session }, departments };
    }
    case 'session.started': {
      const session = state.sessions[event.sessionId];
      if (!session || session.lifecycle !== 'starting') return state;
      return { ...state, sessions: { ...state.sessions, [session.id]: { ...session, lifecycle: 'active', processConfirmed: true, lastUpdate: session.lastUpdate + 1 } } };
    }
    case 'session.config': {
      const session = state.sessions[event.sessionId];
      if (!session || !session.processConfirmed || session.lifecycle === 'closing') return state;
      return { ...state, sessions: { ...state.sessions, [session.id]: { ...session, provider: event.provider, model: event.model, reasoning: event.reasoning, lastUpdate: session.lastUpdate + 1 } } };
    }
    case 'session.message': {
      const session = state.sessions[event.sessionId];
      if (!session || !session.processConfirmed || session.lifecycle === 'closing') return state;
      return { ...state, sessions: { ...state.sessions, [session.id]: { ...session, lastUpdate: event.message.timestamp, messages: [...session.messages, event.message] } } };
    }
    case 'session.disconnected': {
      const session = state.sessions[event.sessionId];
      if (!session || !session.processConfirmed || session.lifecycle === 'closing') return state;
      return { ...state, sessions: { ...state.sessions, [session.id]: appendStatus(session, 'Mất kết nối · tiến trình chưa được xác nhận đã dừng.', 'disconnected') } };
    }
    case 'session.reconnected': {
      const session = state.sessions[event.sessionId];
      if (!session || session.lifecycle !== 'disconnected') return state;
      return { ...state, sessions: { ...state.sessions, [session.id]: appendStatus(session, 'Đã kết nối lại.', 'active') } };
    }
    case 'session.close-requested': {
      const session = state.sessions[event.sessionId];
      if (!session || !session.processConfirmed || session.lifecycle === 'closing') return state;
      return { ...state, sessions: { ...state.sessions, [session.id]: appendStatus(session, 'Đang yêu cầu đóng phiên · vẫn chiếm slot.', 'closing') } };
    }
    case 'session.close-failed': {
      const session = state.sessions[event.sessionId];
      if (!session || session.lifecycle !== 'closing') return state;
      return { ...state, sessions: { ...state.sessions, [session.id]: { ...appendStatus(session, `Đóng phiên thất bại: ${event.message}`, 'error'), closeError: event.message } } };
    }
    case 'session.closed': {
      const session = state.sessions[event.sessionId];
      if (!session) return state;
      const sessions = { ...state.sessions }; delete sessions[event.sessionId];
      const departments = { ...state.departments };
      Object.values(departments).forEach(department => { if (department.leadSessionId === event.sessionId) departments[department.id] = { ...department, leadSessionId: null }; });
      const tasks = { ...state.tasks };
      Object.values(tasks).forEach(task => { if (task.sessionId === event.sessionId && task.status !== 'done') tasks[task.id] = { ...task, sessionId: null, status: 'queued' }; });
      const ui = state.ui.selectedSessionId === event.sessionId ? { ...state.ui, selectedSessionId: null, panelOpen: false } : state.ui;
      return { ...state, sessions, departments, tasks, archives: { ...state.archives, [session.id]: session }, ui };
    }
    case 'task.assigned': {
      const task = state.tasks[event.taskId]; const session = state.sessions[event.sessionId];
      if (!task || !session || task.status !== 'queued' || !canAssignToSession(state, task, session)) return state;
      return { ...state, tasks: { ...state.tasks, [task.id]: { ...task, sessionId: session.id, status: 'assigned' } } };
    }
    case 'task.status': {
      const task = state.tasks[event.taskId];
      if (!task || task.status === 'done' || event.status === 'done') return state;
      return { ...state, tasks: { ...state.tasks, [task.id]: { ...task, status: event.status } } };
    }
    case 'approval.responded': {
      const task = state.tasks[event.taskId];
      if (!task || task.status !== 'approval') return state;
      return { ...state, tasks: { ...state.tasks, [task.id]: { ...task, status: event.accepted ? 'reporting' : 'working' } } };
    }
    case 'report.submitted': {
      const task = state.tasks[event.report.taskId]; const session = state.sessions[event.report.sessionId];
      if (!task || !session || task.status !== 'reporting' || task.sessionId !== session.id || event.report.workspaceId !== task.workspaceId || session.workspaceId !== task.workspaceId || event.report.status !== 'submitted' || state.reports[event.report.id]) return state;
      return { ...state, reports: { ...state.reports, [event.report.id]: event.report } };
    }
    case 'report.reviewed': {
      const report = state.reports[event.reportId];
      if (!report || report.status !== 'submitted') return state;
      return { ...state, reports: { ...state.reports, [report.id]: { ...report, status: 'reviewed' } } };
    }
    case 'report.accepted': {
      const report = state.reports[event.reportId];
      if (!report || report.status !== 'reviewed' || state.acceptedReportIds.includes(report.id)) return state;
      const task = state.tasks[report.taskId];
      if (!task || task.workspaceId !== report.workspaceId) return state;
      return { ...state, reports: { ...state.reports, [report.id]: { ...report, status: 'accepted' } }, acceptedReportIds: [...state.acceptedReportIds, report.id], tasks: { ...state.tasks, [task.id]: { ...task, status: 'done' } } };
    }
    case 'record.updated': {
      const record = state.records[event.recordId];
      if (!record || record.workspaceId !== state.ui.workspaceId || state.ui.role === 'client' || (record.audience === 'ceo' && state.ui.role !== 'ceo')) return state;
      if (state.ui.role === 'employee' && record.audience !== 'internal') return state;
      return { ...state, records: { ...state.records, [record.id]: { ...record, content: event.content, updatedAt: event.updatedAt } } };
    }
  }
}
