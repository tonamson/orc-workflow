'use client';

import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';
import type { DemoAdapter } from './adapter';

export function DemoControls({ state, dispatch, adapter }: { state: AppState; dispatch: Dispatch<StudioEvent>; adapter: DemoAdapter }) {
  const sessions = Object.values(state.sessions).filter(session => session.workspaceId === state.ui.workspaceId);
  const reports = Object.values(state.reports).filter(report => report.workspaceId === state.ui.workspaceId && report.status !== 'accepted');
  const session = sessions.find(item => item.id === state.ui.selectedSessionId) ?? sessions[0];
  const task = Object.values(state.tasks).find(item => item.workspaceId === state.ui.workspaceId && item.status === 'approval');
  const workTask = Object.values(state.tasks).find(item => item.workspaceId === state.ui.workspaceId && item.sessionId === session?.id && item.status === 'working');
  const report = reports[0];
  if (state.ui.role === 'client') return null;
  return <div className="demo-controls" aria-label="Điều khiển demo">
    <span>Mô phỏng</span>
    {session && <>
      <button onClick={() => adapter.receive(session.id)}>Nhận việc</button>
      <button onClick={() => adapter.submitReport(session.id)}>Gửi báo cáo</button>
      {session.lifecycle === 'disconnected' ? <button onClick={() => dispatch({ type: 'session.reconnected', sessionId: session.id })}>Kết nối lại</button> : <button onClick={() => dispatch({ type: 'session.disconnected', sessionId: session.id })}>Ngắt kết nối</button>}
      {session.lifecycle === 'closing' ? <><button onClick={() => dispatch({ type: 'session.closed', sessionId: session.id })}>Xác nhận đóng</button><button onClick={() => dispatch({ type: 'session.close-failed', sessionId: session.id, message: 'CLI demo không xác nhận yêu cầu.' })}>Đóng thất bại</button></> : <button onClick={() => adapter.close(session.id)}>{session.lifecycle === 'error' ? 'Thử đóng lại' : 'Yêu cầu đóng'}</button>}
    </>}
    {workTask && <button onClick={() => dispatch({ type: 'task.status', taskId: workTask.id, status: 'approval' })}>Yêu cầu duyệt</button>}
    {task && <><button onClick={() => adapter.respond(task.id, true)}>Duyệt yêu cầu</button><button onClick={() => adapter.respond(task.id, false)}>Từ chối</button></>}
    {report?.status === 'submitted' && <button onClick={() => dispatch({ type: 'report.reviewed', reportId: report.id })}>Rà soát báo cáo</button>}
    {report?.status === 'reviewed' && <button onClick={() => dispatch({ type: 'report.accepted', reportId: report.id })}>Chấp thuận</button>}
  </div>;
}
