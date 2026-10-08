'use client';

import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';
import type { DemoAdapter } from './adapter';
import { assignmentQueueReason, isOverflowDemoScenario } from '../studio/model/allocation';
import { taskForSession } from '../sessions/display';

export function DemoControls({ state, dispatch, adapter }: { state: AppState; dispatch: Dispatch<StudioEvent>; adapter: DemoAdapter }) {
  const sessions = Object.values(state.sessions).filter(session => session.workspaceId === state.ui.workspaceId);
  const reports = Object.values(state.reports).filter(report => report.workspaceId === state.ui.workspaceId && report.status !== 'accepted');
  const session = sessions.find(item => item.id === state.ui.selectedSessionId) ?? sessions[0];
  const task = Object.values(state.tasks).find(item => item.workspaceId === state.ui.workspaceId && item.status === 'approval');
  const currentTask = session ? taskForSession(state, session.id) : null;
  const workTask = currentTask?.status === 'working' ? currentTask : null;
  const reportableTask = currentTask && ['working', 'approval', 'blocked'].includes(currentTask.status) ? currentTask : null;
  const assignedTask = currentTask?.status === 'assigned' ? currentTask : null;
  const queuedTask = Object.values(state.tasks).find(item => item.workspaceId === state.ui.workspaceId && item.status === 'queued');
  const report = reports[0];
  if (state.ui.role === 'client') return null;
  return <div className="demo-controls" aria-label="Điều khiển demo">
    <span>Mô phỏng</span>
    {state.ui.role === 'ceo' && state.ui.workspaceId === 'demo-website' && (isOverflowDemoScenario(state)
      ? <button onClick={() => dispatch({ type: 'demo.seed-reset' })}>Khôi phục demo mẫu</button>
      : <button title="Thay dữ liệu mô phỏng workspace bằng kịch bản 4 phiên cùng phòng ban." onClick={() => dispatch({ type: 'demo.overflow-reset' })}>Kịch bản overflow · đặt lại demo</button>)}
    {session && <>
      <button disabled={!queuedTask} onClick={() => adapter.receive(session.id)}>Nhận việc</button>
      <button disabled={!reportableTask} title={reportableTask ? 'Gửi báo cáo mô phỏng cho nhiệm vụ hiện tại.' : 'Phiên này chưa có nhiệm vụ đang thực hiện để báo cáo.'} onClick={() => adapter.submitReport(session.id)}>Gửi báo cáo</button>
      {session.lifecycle === 'disconnected' ? <button onClick={() => dispatch({ type: 'session.reconnected', sessionId: session.id })}>Kết nối lại</button> : <button onClick={() => dispatch({ type: 'session.disconnected', sessionId: session.id })}>Ngắt kết nối</button>}
      {session.lifecycle === 'closing' ? <><button onClick={() => dispatch({ type: 'session.closed', sessionId: session.id })}>Xác nhận đóng</button><button onClick={() => dispatch({ type: 'session.close-failed', sessionId: session.id, message: 'CLI demo không xác nhận yêu cầu.' })}>Đóng thất bại</button></> : <button onClick={() => adapter.close(session.id)}>{session.lifecycle === 'error' ? 'Thử đóng lại' : 'Yêu cầu đóng'}</button>}
    </>}
    {queuedTask && <small>{assignmentQueueReason(state, queuedTask.id)}</small>}
    {assignedTask && <button onClick={() => dispatch({ type: 'task.status', taskId: assignedTask.id, status: 'working' })}>Bắt đầu làm việc</button>}
    {workTask && <button onClick={() => dispatch({ type: 'task.status', taskId: workTask.id, status: 'approval' })}>Yêu cầu duyệt</button>}
    {task && <><button onClick={() => adapter.respond(task.id, true)}>Duyệt yêu cầu</button><button onClick={() => adapter.respond(task.id, false)}>Từ chối</button></>}
    {state.ui.role === 'ceo' && report?.status === 'submitted' && <button onClick={() => dispatch({ type: 'report.reviewed', reportId: report.id })}>Rà soát báo cáo</button>}
    {state.ui.role === 'ceo' && report?.status === 'reviewed' && <button onClick={() => dispatch({ type: 'report.accepted', reportId: report.id })}>Chấp thuận</button>}
  </div>;
}
