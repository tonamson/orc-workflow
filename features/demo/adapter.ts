import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';

export function createDemoAdapter(getState: () => AppState, dispatch: Dispatch<StudioEvent>) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  const schedule = (workspaceId: string, delay: number, run: (state: AppState) => void) => {
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
        schedule(current.workspaceId, 650, latest => {
          if (latest.sessions[sessionId]?.lifecycle === 'starting') dispatch({ type: 'session.started', sessionId });
        });
        return;
      }
      const roomDepartmentId = state.rooms[current.roomId]?.departmentId;
      const task = Object.values(state.tasks).find(item => item.workspaceId === current.workspaceId && item.status === 'queued' && (!roomDepartmentId || item.departmentId === roomDepartmentId));
      if (task) dispatch({ type: 'task.assign-requested', taskId: task.id, provider: current.provider });
      if (!task) return;
      schedule(current.workspaceId, 650, latest => {
        const assignedSessionId = latest.tasks[task.id]?.sessionId;
        if (!assignedSessionId) return;
        if (latest.sessions[assignedSessionId]?.lifecycle === 'starting') dispatch({ type: 'session.started', sessionId: assignedSessionId });
        dispatch({ type: 'ui.select-session', sessionId: assignedSessionId });
      });
    },
    submitReport(sessionId: string) {
      const state = getState();
      const task = Object.values(state.tasks).find(item => item.sessionId === sessionId && item.status !== 'done');
      if (!task) return;
      dispatch({ type: 'task.status', taskId: task.id, status: 'reporting' });
      schedule(task.workspaceId, 700, latest => {
        if (latest.tasks[task.id]?.status !== 'reporting' || latest.tasks[task.id]?.sessionId !== sessionId) return;
        dispatch({ type: 'report.submitted', report: { id: `report-${task.id}`, workspaceId: task.workspaceId, taskId: task.id, sessionId, content: `Báo cáo mô phỏng: ${task.title} đã hoàn thành.`, status: 'submitted' } });
      });
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
