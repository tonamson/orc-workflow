import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';
import { canAssignToSession } from '../studio/model/allocation';
import type { Avatar, Provider } from '../studio/model/types';

export function createDemoAdapter(getState: () => AppState, dispatch: Dispatch<StudioEvent>) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  const schedule = (sessionId: string, delay: number, run: (state: AppState) => void, workspaceHint?: string) => {
    const workspaceId = getState().sessions[sessionId]?.workspaceId ?? workspaceHint;
    const timer = setTimeout(() => {
      timers.delete(timer);
      const state = getState();
      if (!disposed && workspaceId && state.ui.workspaceId === workspaceId) run(state);
    }, delay);
    timers.add(timer);
  };
  return {
    receive(sessionId: string) {
      const state = getState();
      const current = state.sessions[sessionId];
      if (!current) return;
      if (current.lifecycle === 'starting') {
        schedule(sessionId, 650, () => dispatch({ type: 'session.started', sessionId }));
        return;
      }
      const roomDepartmentId = state.rooms[current.roomId]?.departmentId;
      const task = Object.values(state.tasks).find(item => item.workspaceId === current.workspaceId && item.status === 'queued' && (!roomDepartmentId || item.departmentId === roomDepartmentId));
      if (!task) return;
      if (canAssignToSession(state, task, current)) { dispatch({ type: 'task.assigned', taskId: task.id, sessionId }); dispatch({ type: 'ui.select-session', sessionId }); return; }
      const reusable = Object.values(state.sessions).find(session => canAssignToSession(state, task, session));
      if (reusable) { dispatch({ type: 'task.assigned', taskId: task.id, sessionId: reusable.id }); dispatch({ type: 'ui.select-session', sessionId: reusable.id }); return; }
      if (Object.keys(state.sessions).length >= state.capacity) return;
      const department = state.departments[task.departmentId];
      const room = Object.values(state.rooms).find(item => item.departmentId === department?.id && ([0,1,2] as const).some(slot => !Object.values(state.sessions).some(session => session.roomId === item.id && session.seatSlot === slot)));
      if (!department || !room) return;
      const avatar: Avatar = (['Nova','Atlas','Mika','Sage','Rune'] as const)[Object.keys(state.sessions).length % 5];
      const provider: Provider = current.provider;
      const newId = `session-demo-receive-${Date.now()}`;
      const newSlot = ([0,1,2] as const).find(slot => !Object.values(state.sessions).some(session => session.roomId === room.id && session.seatSlot === slot));
      if (newSlot === undefined) return;
      dispatch({ type: 'session.start-requested', id: newId, workspaceId: task.workspaceId, roomId: room.id, agentName: `Agent ${avatar}`, avatar, provider, model: null, reasoning: { kind: 'unknown' }, skills: [...task.requiredSkills] });
      schedule(newId, 650, () => {
        dispatch({ type: 'session.started', sessionId: newId });
        dispatch({ type: 'task.assigned', taskId: task.id, sessionId: newId });
        dispatch({ type: 'ui.select-session', sessionId: newId });
      }, task.workspaceId);
    },
    submitReport(sessionId: string) {
      const state = getState();
      const task = Object.values(state.tasks).find(item => item.sessionId === sessionId && item.status !== 'done');
      if (!task) return;
      dispatch({ type: 'task.status', taskId: task.id, status: 'reporting' });
      schedule(sessionId, 700, () => dispatch({ type: 'report.submitted', report: { id: `report-${task.id}`, workspaceId: task.workspaceId, taskId: task.id, sessionId, content: `Báo cáo mô phỏng: ${task.title} đã hoàn thành.`, status: 'submitted' } }));
    },
    respond(taskId: string, accepted: boolean) {
      if (!disposed) dispatch({ type: 'approval.responded', taskId, accepted });
    },
    close(sessionId: string) {
      if (disposed || !getState().sessions[sessionId]) return;
      dispatch({ type: 'session.close-requested', sessionId });
    },
    dispose() {
      disposed = true;
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    },
  };
}

export type DemoAdapter = ReturnType<typeof createDemoAdapter>;
