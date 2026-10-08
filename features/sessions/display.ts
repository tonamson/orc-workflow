import type { AppState, Session, Task, TaskStatus } from '../studio/model/types';

const taskLabels: Record<TaskStatus, string> = {
  queued: 'Đang chờ giao việc', assigned: 'Đã nhận việc', working: 'Đang làm việc', approval: 'Chờ duyệt',
  blocked: 'Bị chặn', reporting: 'Đang bàn giao', done: 'Đã hoàn tất',
};

export function taskForSession(state: AppState, sessionId: string): Task | null {
  const tasks = Object.values(state.tasks).filter(task => task.sessionId === sessionId);
  const unfinished = tasks.filter(task => task.status !== 'done');
  return (unfinished.length ? unfinished : tasks).at(-1) ?? null;
}

export function sessionDisplay(state: AppState, session: Session): { role: string; state: string; tone: string; task: Task | null; taskState: string } {
  const task = taskForSession(state, session.id);
  const lifecycle: Partial<Record<Session['lifecycle'], { state: string; tone: string }>> = {
    starting: { state: 'Đang khởi động', tone: 'starting' },
    closing: { state: 'Đang đóng · vẫn chiếm slot', tone: 'closing' },
    disconnected: { state: 'Mất kết nối · tiến trình còn tồn tại', tone: 'disconnected' },
    error: { state: 'Đóng phiên gặp lỗi', tone: 'error' },
  };
  const status = lifecycle[session.lifecycle] ?? (task
    ? { state: taskLabels[task.status], tone: task.status }
    : { state: 'Sẵn sàng', tone: 'ready' });
  const role = session.role === 'supervisor' ? 'Supervisor' : session.role === 'lead' ? 'Lead' : 'Peer';
  return { role, ...status, task, taskState: task ? taskLabels[task.status] : 'Không có nhiệm vụ' };
}

export function formatSessionUpdate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Chưa đồng bộ';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}
