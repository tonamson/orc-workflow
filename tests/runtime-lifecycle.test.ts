import { describe, expect, it } from 'vitest';
import { advanceWorkspaceScope, applyTerminalResizeInOrder, createTerminalResizeGate, isRuntimeEventAfterBaseline, isWorkspaceScopeCurrent, replayTerminalEvents, sessionConnectionLabel, workspaceConnectionLabel } from '../features/sessions/runtime-lifecycle';

describe('runtime event history boundary', () => {
  it('keeps events at or before the selected session snapshot out of live state', () => {
    expect(isRuntimeEventAfterBaseline(1202, 1203)).toBe(false);
    expect(isRuntimeEventAfterBaseline(1203, 1203)).toBe(false);
  });

  it('allows events created after the selected session snapshot to update live state', () => {
    expect(isRuntimeEventAfterBaseline(1204, 1203)).toBe(true);
  });
});

describe('terminal attach replay and resize', () => {
  it('coalesces repeated same-size resizes for one process but resizes a changed viewport or resumed process', async () => {
    const gate = createTerminalResizeGate();
    let calls = 0;
    const resize = async () => { calls += 1; return true; };

    expect(await gate('session-a', 'started-1', 92, 30, resize)).toBe(true);
    expect(await gate('session-a', 'started-1', 92, 30, resize)).toBe(false);
    expect(await gate('session-a', 'started-1', 80, 30, resize)).toBe(true);
    expect(await gate('session-a', 'started-2', 92, 30, resize)).toBe(true);
    expect(calls).toBe(3);
  });

  it('coalesces overlapping observer and stream-open resize requests', async () => {
    const gate = createTerminalResizeGate();
    let calls = 0;
    let resolveResize!: (result: boolean) => void;
    const resize = () => { calls += 1; return new Promise<boolean>(resolve => { resolveResize = resolve; }); };

    const observerRequest = gate('session-a', 'started-1', 92, 30, resize);
    const streamRequest = gate('session-a', 'started-1', 92, 30, resize);
    expect(calls).toBe(1);
    expect(await streamRequest).toBe(false);
    resolveResize(true);
    expect(await observerRequest).toBe(true);
  });

  it('applies recorded PTY sizes after prior replayed output and before subsequent output', async () => {
    const applied: string[] = [];
    const queued: string[] = [];
    await replayTerminalEvents([
      { sequence: 1, kind: 'output', label: 'initial width' },
      { sequence: 2, kind: 'resize', cols: 240, rows: 30 },
      { sequence: 3, kind: 'output', label: 'wide terminal redraw' },
      { sequence: 4, kind: 'resize', cols: 92, rows: 30 },
      { sequence: 5, kind: 'output', label: 'current-width redraw' },
    ], event => { queued.push(event.kind === 'resize' ? `resize:${event.cols}x${event.rows}` : `output:${event.label}`); }, async () => {
      applied.push(...queued.splice(0));
    });

    expect(applied).toEqual([
      'output:initial width', 'resize:240x30', 'output:wide terminal redraw',
      'resize:92x30', 'output:current-width redraw',
    ]);
  });

  it('commits a trailing resize event once so replay can advance its sequence watermark', async () => {
    const sequences: number[] = [];
    const sizes: string[] = [];
    const terminal = { write: (_data: Uint8Array, callback?: () => void) => callback?.(), resize: (cols: number, rows: number) => sizes.push(`${cols}x${rows}`) };
    await replayTerminalEvents([{ sequence: 12, kind: 'resize', cols: 92, rows: 30 }], event => {
      sequences.push(event.sequence);
      applyTerminalResizeInOrder(terminal, event.cols!, event.rows!);
    }, async () => undefined);

    expect(sequences).toEqual([12]);
    expect(sizes).toEqual(['92x30']);
  });

  it('stops replay after cancellation during the flush before a resize', async () => {
    let cancelled = false;
    let signalFlushStarted!: () => void;
    let finishFlush!: () => void;
    const flushStarted = new Promise<void>(resolve => { signalFlushStarted = resolve; });
    const written: string[] = [];
    const replay = replayTerminalEvents([
      { sequence: 1, kind: 'output', label: 'before switch' },
      { sequence: 2, kind: 'resize', cols: 240, rows: 30 },
      { sequence: 3, kind: 'output', label: 'old session after switch' },
    ], event => written.push(`${event.kind}:${event.label ?? event.cols}`), () => new Promise<void>(resolve => { finishFlush = resolve; signalFlushStarted(); }), () => cancelled);

    await flushStarted;
    cancelled = true;
    finishFlush();
    await replay;

    expect(written).toEqual(['output:before switch']);
  });
});

describe('workspace-scoped async operations', () => {
  it('accepts a deferred result when the workspace scope stays current', async () => {
    let current = advanceWorkspaceScope({ workspaceId: null, generation: 0 }, 'A');
    const captured = current;
    let resolveRequest!: (value: string) => void;
    const request = new Promise<string>(resolve => { resolveRequest = resolve; });
    const applied = request.then(value => isWorkspaceScopeCurrent(captured, current) ? value : null);

    current = advanceWorkspaceScope(current, 'A');
    resolveRequest('current A response');

    expect(await applied).toBe('current A response');
  });

  it('rejects a deferred result after switching A to B and back to A', async () => {
    let current = advanceWorkspaceScope({ workspaceId: null, generation: 0 }, 'A');
    const captured = current;
    let resolveRequest!: (value: string) => void;
    const request = new Promise<string>(resolve => { resolveRequest = resolve; });
    const applied = request.then(value => isWorkspaceScopeCurrent(captured, current) ? value : null);

    current = advanceWorkspaceScope(current, 'B');
    current = advanceWorkspaceScope(current, 'A');
    resolveRequest('stale A response');

    expect(await applied).toBeNull();
  });

  it('rejects a deferred result after its component is disposed', async () => {
    const current = advanceWorkspaceScope({ workspaceId: null, generation: 0 }, 'A');
    const captured = current;
    let mounted = true;
    let resolveRequest!: (value: string) => void;
    const request = new Promise<string>(resolve => { resolveRequest = resolve; });
    const applied = request.then(value => isWorkspaceScopeCurrent(captured, current, mounted) ? value : null);
    mounted = false;
    resolveRequest('late response');

    expect(await applied).toBeNull();
  });
});

describe('runtime connection health labels', () => {
  it('preserves last-known session counts while marking server state unverified', () => {
    expect(workspaceConnectionLabel(1, 'Đang chạy', 'unknown')).toBe('1 phiên · Chưa xác minh · mất kết nối máy chủ');
    expect(workspaceConnectionLabel(0, 'Chưa kết nối CLI', 'unknown')).toBe('Máy chủ mất kết nối · trạng thái CLI chưa xác minh');
  });

  it('shows terminal and server disconnects without changing process confirmation', () => {
    expect(sessionConnectionLabel('active', true, false, 'available')).toBe('Mất kết nối terminal · đang khôi phục');
    expect(sessionConnectionLabel('active', true, false, 'available', false)).toBe('Đang chạy');
    expect(sessionConnectionLabel('active', true, false, 'unknown')).toBe('Chưa xác minh · mất kết nối máy chủ');
    expect(sessionConnectionLabel('active', false, false, 'unknown')).toBe('Máy chủ không phản hồi');
  });
});
