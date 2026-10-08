import type { AppState, Session, StudioEvent } from './types';
import { canAssignToSession } from './allocation';

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
      if (!event.workspaceId || !state.workspaces[event.workspaceId]) return state;
      return { ...state, ui: { ...state.ui, workspaceId: event.workspaceId, roomId: null, selectedSessionId: null, selectedRecordId: null } };
    case 'ui.navigate': return { ...state, ui: { ...state.ui, roomId: event.roomId, selectedRecordId: null } };
    case 'ui.role': return { ...state, ui: { ...state.ui, role: event.role, selectedSessionId: event.role === 'client' ? null : state.ui.selectedSessionId } };
    case 'ui.client': return { ...state, ui: { ...state.ui, clientViewerId: event.clientViewerId } };
    case 'ui.mode': return { ...state, ui: { ...state.ui, officeMode: event.mode } };
    case 'ui.panel': return { ...state, ui: { ...state.ui, panelOpen: event.open } };
    case 'ui.search': return { ...state, ui: { ...state.ui, search: event.search } };
    case 'ui.record-filter': return { ...state, ui: { ...state.ui, recordFilter: event.filter } };
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
