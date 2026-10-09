const pollingStatuses = new Set(['starting', 'active', 'closing', 'reporting']);

const statusLabels: Record<string, string> = {
  starting: 'Đang mở',
  active: 'Đang chạy',
  closing: 'Đang đóng',
  closed: 'Đã đóng',
  done: 'Đã hoàn tất',
  reporting: 'Đang rà soát',
  error: 'Lỗi runtime',
  interrupted: 'Đã gián đoạn',
  queued: 'Đang chờ',
};

export type WorkspaceScope = { workspaceId: string | null; generation: number };
export type ServerHealth = 'checking' | 'available' | 'unknown';

export function advanceWorkspaceScope(current: WorkspaceScope, workspaceId: string | null): WorkspaceScope {
  return current.workspaceId === workspaceId ? current : { workspaceId, generation: current.generation + 1 };
}

export function isWorkspaceScopeCurrent(captured: WorkspaceScope, current: WorkspaceScope, mounted = true): boolean {
  return mounted && captured.workspaceId === current.workspaceId && captured.generation === current.generation;
}

export function shouldPollRuntimeRun(status: string): boolean {
  return pollingStatuses.has(status);
}

export function isRuntimeEventAfterBaseline(sequence: number, baseline: number): boolean {
  return sequence > baseline;
}

export type TerminalResize = { kind: string; cols?: number; rows?: number };

export function applyTerminalResizeInOrder(terminal: { write(data: Uint8Array, callback?: () => void): void; resize(cols: number, rows: number): void }, cols: number, rows: number): void {
  terminal.write(new Uint8Array(), () => terminal.resize(cols, rows));
}

export async function replayTerminalEvents<Event extends TerminalResize>(events: Event[], writeEvent: (event: Event) => void, flushWrites: () => Promise<void>, isCancelled: () => boolean = () => false): Promise<void> {
  for (const event of events) {
    if (isCancelled()) return;
    if (event.kind === 'resize' && Number.isInteger(event.cols) && Number.isInteger(event.rows)) {
      await flushWrites();
      if (isCancelled()) return;
    }
    writeEvent(event);
  }
  if (!isCancelled()) await flushWrites();
}

export function createTerminalResizeGate() {
  const sent = new Map<string, string>();
  const pending = new Set<string>();
  return async (sessionId: string, processStartedAt: string | null, cols: number, rows: number, resize: () => Promise<boolean>): Promise<boolean> => {
    const processKey = `${sessionId}:${processStartedAt ?? 'unknown'}`;
    const sizeKey = `${cols}x${rows}`;
    const requestKey = `${processKey}:${sizeKey}`;
    if ((processStartedAt && sent.get(processKey) === sizeKey) || pending.has(requestKey)) return false;
    pending.add(requestKey);
    try {
      const applied = await resize();
      if (applied && processStartedAt) sent.set(processKey, sizeKey);
      return applied;
    } finally {
      pending.delete(requestKey);
    }
  };
}

export function runtimeStatusLabel(status?: string): string {
  return status ? statusLabels[status] ?? status : 'Chưa kết nối CLI';
}

export function workspaceConnectionLabel(sessionCount: number, runtimeStatus: string, serverHealth: ServerHealth): string {
  if (serverHealth === 'unknown') return sessionCount
    ? `${sessionCount} phiên · Chưa xác minh · mất kết nối máy chủ`
    : 'Máy chủ mất kết nối · trạng thái CLI chưa xác minh';
  if (serverHealth === 'checking' && sessionCount) return `${sessionCount} phiên · Đang xác minh máy chủ`;
  return sessionCount ? `${sessionCount} phiên · ${runtimeStatus}` : 'Chưa kết nối CLI';
}

export function sessionConnectionLabel(status: string | undefined, processConfirmed: boolean, terminalConnected: boolean, serverHealth: ServerHealth, terminalSelected = true): string {
  if (serverHealth === 'unknown') return processConfirmed ? 'Chưa xác minh · mất kết nối máy chủ' : 'Máy chủ không phản hồi';
  if (serverHealth === 'checking' && processConfirmed) return 'Đang xác minh kết nối máy chủ';
  if (status === 'active' && processConfirmed && terminalSelected && !terminalConnected) return 'Mất kết nối terminal · đang khôi phục';
  return runtimeStatusLabel(status);
}
