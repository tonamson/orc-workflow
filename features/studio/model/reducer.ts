import type { AppState, Session, StudioEvent } from './types';
import { canAssignToSession } from './allocation';
import { canAccessWorkspace, canSelectSession, visibleRecords, visibleRooms } from './selectors';

function reportBindingIsCurrent(state: AppState, report: AppState['reports'][string]): boolean {
  const task = state.tasks[report.taskId];
  const session = state.sessions[report.sessionId];
  return Boolean(task && session && task.status === 'reporting' && task.sessionId === report.sessionId
    && task.workspaceId === report.workspaceId && session.workspaceId === report.workspaceId
    && session.processConfirmed && canAccessWorkspace(state, report.workspaceId));
}

function appendStatus(session: Session, text: string, lifecycle: Session['lifecycle'] = session.lifecycle): Session {
  const timestamp = session.lastUpdate + 1;
  return { ...session, lifecycle, lastUpdate: timestamp, messages: [...session.messages, { id: `status-${timestamp}`, kind: 'status' as const, text, timestamp }].slice(-500) };
}

export function studioReducer(state: AppState, event: StudioEvent): AppState {
  switch (event.type) {
    case 'persistence.hydrate': return { ...event.state, workspaces: { ...event.state.workspaces, ...state.workspaces }, rooms: { ...event.state.rooms, ...state.rooms }, sessions: { ...event.state.sessions, ...state.sessions }, ui: state.ui };
    case 'ui.workspace':
      if (event.workspaceId === null) return { ...state, ui: { ...state.ui, workspaceId: null, roomId: null, selectedSessionId: null, selectedRecordId: null, panelOpen: false } };
      if (!canAccessWorkspace(state, event.workspaceId)) return state;
      return { ...state, ui: { ...state.ui, workspaceId: event.workspaceId, roomId: state.ui.role === 'client' ? `${event.workspaceId}-lobby` : null, selectedSessionId: null, selectedRecordId: null, panelOpen: false } };
    case 'runtime.workspaces': {
      const workspaces = Object.fromEntries(event.workspaces.map(workspace => [workspace.id, { id: workspace.id, customerId: '', name: workspace.name, repoPath: workspace.path }]));
      const rooms: AppState['rooms'] = {};
      event.workspaces.forEach(workspace => {
        const entries: AppState['rooms'][string][] = [
          { id: `${workspace.id}-supervisor`, workspaceId: workspace.id, departmentId: null, name: 'Điều phối', kind: 'supervisor', template: 'supervisor' },
          { id: `${workspace.id}-lobby`, workspaceId: workspace.id, departmentId: null, name: 'Phòng khách', kind: 'lobby', template: 'lobby' },
          { id: `${workspace.id}-meeting`, workspaceId: workspace.id, departmentId: null, name: 'Phòng họp', kind: 'meeting', template: 'meeting' },
        ];
        entries.forEach(room => { rooms[room.id] = room; });
      });
      Object.values(state.rooms).filter(room => Object.values(state.sessions).some(session => session.roomId === room.id)).forEach(room => { rooms[room.id] = room; });
      const workspaceId = state.ui.workspaceId && workspaces[state.ui.workspaceId] ? state.ui.workspaceId : null;
      const roomId = workspaceId && state.ui.roomId && rooms[state.ui.roomId]?.workspaceId === workspaceId ? state.ui.roomId : null;
      const selectedSessionId = workspaceId && state.ui.selectedSessionId && state.sessions[state.ui.selectedSessionId]?.workspaceId === workspaceId ? state.ui.selectedSessionId : null;
      const selectedRecordId = workspaceId && state.ui.selectedRecordId && state.records[state.ui.selectedRecordId]?.workspaceId === workspaceId ? state.ui.selectedRecordId : null;
      return { ...state, workspaces, rooms, ui: { ...state.ui, workspaceId, roomId, selectedSessionId, selectedRecordId, panelOpen: workspaceId ? state.ui.panelOpen : false } };
    }
    case 'runtime.runs': {
      if (event.workspaceId === null) return {
        ...state,
        sessions: Object.fromEntries(Object.entries(state.sessions).filter(([, session]) => !session.nativeRuntime)),
        tasks: Object.fromEntries(Object.entries(state.tasks).filter(([, task]) => !task.id.startsWith('runtime-'))),
      };
      const runIds = new Set(event.runs.map(run => run.id));
      const base = {
        ...state,
        sessions: Object.fromEntries(Object.entries(state.sessions).filter(([, session]) => !session.nativeRuntime || session.workspaceId !== event.workspaceId || (session.runtimeRunId && runIds.has(session.runtimeRunId)))),
        tasks: Object.fromEntries(Object.entries(state.tasks).filter(([, task]) => !task.id.startsWith('runtime-') || task.workspaceId !== event.workspaceId || runIds.has(task.id.slice('runtime-'.length)))),
      };
      return event.runs.reduce((current, run) => studioReducer(current, { type: 'runtime.run', run }), base);
    }
    case 'runtime.run': {
      if (!event.run) return { ...state, sessions: Object.fromEntries(Object.entries(state.sessions).filter(([, session]) => !session.nativeRuntime)), tasks: Object.fromEntries(Object.entries(state.tasks).filter(([, task]) => !task.id.startsWith('runtime-'))) };
      const run = event.run;
      const workRoomId = `${run.workspaceId}-agents`;
      const supervisorRoomId = `${run.workspaceId}-supervisor`;
      const departmentId = `${run.workspaceId}-runtime-department`;
      const rooms = { ...state.rooms,
        [supervisorRoomId]: state.rooms[supervisorRoomId] ?? { id: supervisorRoomId, workspaceId: run.workspaceId, departmentId: null, name: 'Supervisor', kind: 'supervisor' as const, template: 'supervisor' as const },
        [workRoomId]: { id: workRoomId, workspaceId: run.workspaceId, departmentId, name: 'Agent', kind: 'work' as const, template: 'engineering' as const },
      };
      const departments = { ...state.departments, [departmentId]: { id: departmentId, workspaceId: run.workspaceId, name: 'Agent', leadSessionId: null } };
      const existing = { ...state.sessions };
      Object.values(existing).filter(session => session.nativeRuntime && session.runtimeRunId === run.id).forEach(session => { delete existing[session.id]; });
      const sessions = run.sessions.reduce((all, item, seatSlot) => {
        const roomId = item.role === 'supervisor' ? supervisorRoomId : workRoomId;
        const lifecycle = item.status === 'active' ? 'active' as const : item.status === 'starting' ? 'starting' as const : item.status === 'closing' ? 'closing' as const : item.status === 'error' ? 'error' as const : 'disconnected' as const;
        const previous = state.sessions[item.id];
        if (item.status === 'closed') {
          if (previous?.runtimeMotion?.phase === 'exit' && !previous.runtimeMotion.completed) {
            all[item.id] = previous;
            return all;
          }
          if (item.role === 'peer' && run.status === 'done' && run.phase === 'done' && previous?.processConfirmed) {
            all[item.id] = { ...previous, roomId: supervisorRoomId, lifecycle: 'disconnected', processConfirmed: false,
              runtimeMotion: { phase: 'exit', sequence: (previous.runtimeMotion?.sequence ?? 0) + 1, origin: 'supervisor-desk' } };
          }
          return all;
        }
        const runtimeMotion = item.role === 'peer' && item.processConfirmed && !previous?.processConfirmed && run.phase === 'peer_running'
          ? { phase: 'assign' as const, sequence: (previous?.runtimeMotion?.sequence ?? 0) + 1 }
          : item.role === 'peer' && run.phase === 'supervisor_reporting' && state.tasks[`runtime-${run.id}`]?.status !== 'reporting'
            ? { phase: 'report' as const, sequence: (previous?.runtimeMotion?.sequence ?? 0) + 1 }
          : previous?.runtimeMotion;
        all[item.id] = { id: item.id, workspaceId: run.workspaceId, roomId, seatSlot: Math.min(seatSlot, 2) as 0 | 1 | 2, agentName: item.role === 'supervisor' ? 'Codex Supervisor' : 'Codex Agent', avatar: item.role === 'supervisor' ? 'Nova' : 'Atlas', role: item.role === 'supervisor' ? 'supervisor' : 'peer', provider: 'codex', model: item.model, reasoning: item.reasoningEffort ? { kind: 'effort', value: item.reasoningEffort } : { kind: 'unknown' }, skills: [], lifecycle, processConfirmed: item.processConfirmed, lastUpdate: item.startedAt ? Date.parse(item.startedAt) : 0, messages: previous?.messages ?? [], nativeRuntime: true, runtimeRunId: run.id, ...(runtimeMotion ? { runtimeMotion } : {}) };
        return all;
      }, existing as AppState['sessions']);
      const taskStatus = run.status === 'done' ? 'done' as const : run.status === 'error' || run.status === 'interrupted' || run.status === 'closed' ? 'blocked' as const : run.phase === 'supervisor_reporting' || run.status === 'reporting' ? 'reporting' as const : run.phase === 'delegating' ? 'assigned' as const : 'working' as const;
      const taskSessionId = run.phase === 'supervisor_delegation' ? run.sessions.find(item => item.role === 'supervisor')?.id : run.sessions.find(item => item.role === 'peer')?.id;
      const task = { id: `runtime-${run.id}`, workspaceId: run.workspaceId, departmentId, requiredSkills: [], status: taskStatus, sessionId: taskSessionId ?? null, title: run.taskId };
      return { ...state, rooms, departments, sessions, tasks: { ...state.tasks, [task.id]: task } };
    }
    case 'runtime.motion-finished': {
      const session = state.sessions[event.sessionId];
      if (!session?.runtimeMotion || session.runtimeMotion.sequence !== event.sequence) return state;
      if (session.runtimeMotion.phase === 'report') return { ...state, sessions: { ...state.sessions, [session.id]: { ...session, runtimeMotion: { ...session.runtimeMotion, completed: true } } } };
      if (session.runtimeMotion.phase === 'exit' && session.nativeRuntime && !session.processConfirmed) {
        const sessions = { ...state.sessions }; delete sessions[session.id];
        return { ...state, sessions };
      }
      const updated = { ...session };
      delete updated.runtimeMotion;
      return { ...state, sessions: { ...state.sessions, [session.id]: updated } };
    }
    case 'ui.navigate': {
      if (event.roomId !== null && !visibleRooms(state).some(room => room.id === event.roomId)) return state;
      return { ...state, ui: { ...state.ui, roomId: event.roomId, selectedSessionId: null, selectedRecordId: null, panelOpen: false } };
    }
    case 'ui.role': {
      if (event.role === 'client') {
        const viewer = state.ui.clientViewerId ? state.clientViewers[state.ui.clientViewerId] : null;
        const candidate = viewer && Object.values(state.workspaces).find(workspace => workspace.id === state.ui.workspaceId && workspace.customerId === viewer.customerId && viewer.allowedWorkspaceIds.includes(workspace.id));
        const clientViewerId = viewer?.id ?? 'client-a';
        const activeViewer = viewer ?? state.clientViewers[clientViewerId];
        const available = activeViewer ? Object.values(state.workspaces).filter(workspace => workspace.customerId === activeViewer.customerId && activeViewer.allowedWorkspaceIds.includes(workspace.id)) : [];
        const workspace = candidate ?? available[0];
        return { ...state, ui: { ...state.ui, role: 'client', clientViewerId, workspaceId: workspace?.id ?? null, roomId: workspace ? `${workspace.id}-lobby` : null, selectedSessionId: null, selectedRecordId: null, panelOpen: false } };
      }
      const workspaceId = state.ui.workspaceId && state.workspaces[state.ui.workspaceId] ? state.ui.workspaceId : null;
      const next: AppState = { ...state, ui: { ...state.ui, role: event.role, workspaceId, roomId: state.ui.roomId, selectedSessionId: state.ui.selectedSessionId, selectedRecordId: state.ui.selectedRecordId } };
      const currentRoom = state.ui.roomId ? state.rooms[state.ui.roomId] : null;
      if (!currentRoom || currentRoom.workspaceId !== workspaceId || (event.role === 'employee' && currentRoom.kind === 'lobby')) {
        next.ui.roomId = event.role === 'employee' ? Object.values(next.rooms).find(room => room.workspaceId === workspaceId && room.kind === 'meeting')?.id ?? null : null;
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
      return { ...state, sessions: { ...state.sessions, [session.id]: { ...session, lastUpdate: event.message.timestamp, messages: [...session.messages, event.message].slice(-500) } } };
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
      if (!session || session.lifecycle !== 'closing' && session.lifecycle !== 'error') return state;
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
      return { ...state, tasks: { ...state.tasks, [task.id]: { ...task, status: 'working' } } };
    }
    case 'report.submitted': {
      const task = state.tasks[event.report.taskId]; const session = state.sessions[event.report.sessionId];
      if (state.ui.role === 'client' || event.report.workspaceId !== state.ui.workspaceId || !task || !session || task.status !== 'reporting' || task.sessionId !== session.id || event.report.workspaceId !== task.workspaceId || session.workspaceId !== task.workspaceId || !session.processConfirmed || event.report.status !== 'submitted' || state.reports[event.report.id]) return state;
      return { ...state, reports: { ...state.reports, [event.report.id]: event.report } };
    }
    case 'report.reviewed': {
      const report = state.reports[event.reportId];
      if (state.ui.role !== 'ceo' || !report || report.workspaceId !== state.ui.workspaceId || report.status !== 'submitted' || !reportBindingIsCurrent(state, report)) return state;
      return { ...state, reports: { ...state.reports, [report.id]: { ...report, status: 'reviewed' } } };
    }
    case 'report.accepted': {
      const report = state.reports[event.reportId];
      if (state.ui.role !== 'ceo' || !report || report.workspaceId !== state.ui.workspaceId || report.status !== 'reviewed' || state.acceptedReportIds.includes(report.id) || !reportBindingIsCurrent(state, report)) return state;
      const task = state.tasks[report.taskId];
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
