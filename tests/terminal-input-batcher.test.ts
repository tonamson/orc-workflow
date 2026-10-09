import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTerminalInputBatcher, MAX_TERMINAL_INPUT_BATCH_BYTES, MAX_PENDING_TERMINAL_INPUT_BYTES } from '../features/sessions/terminal-input-batcher';

afterEach(() => vi.useRealTimers());

describe('terminal input batching', () => {
  it('coalesces typed characters while a request is slow and preserves special-key order', async () => {
    vi.useFakeTimers();
    const acknowledgements: Array<() => void> = [];
    const send = vi.fn((_sessionId: string, _data: string) => new Promise<void>(resolve => acknowledgements.push(resolve)));
    const queue = createTerminalInputBatcher(send);

    queue.enqueue('session-a', 'r');
    queue.enqueue('session-a', 'e');
    await vi.advanceTimersByTimeAsync(12);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenNthCalledWith(1, 'session-a', 're');

    queue.enqueue('session-a', 'p');
    queue.enqueue('session-a', '\r');
    expect(send).toHaveBeenCalledTimes(1);
    acknowledgements[0]();
    await vi.runAllTicks();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, 'session-a', 'p\r');
    acknowledgements[1]();
    await vi.runAllTicks();
    queue.dispose();
  });

  it('flushes escape/control keys immediately and keeps each UTF-8 batch under the server limit', async () => {
    vi.useFakeTimers();
    const acknowledgements: Array<() => void> = [];
    const send = vi.fn((_sessionId: string, _data: string) => new Promise<void>(resolve => acknowledgements.push(resolve)));
    const queue = createTerminalInputBatcher(send);

    queue.enqueue('session-a', '\u001b[A');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenNthCalledWith(1, 'session-a', '\u001b[A');
    acknowledgements.shift()?.();
    await vi.runAllTicks();
    await Promise.resolve();

    const paste = '🙂'.repeat(MAX_TERMINAL_INPUT_BATCH_BYTES / 4 + 1);
    queue.enqueue('session-a', paste);
    await vi.advanceTimersByTimeAsync(12);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[1]).toBe('🙂'.repeat(MAX_TERMINAL_INPUT_BATCH_BYTES / 4));
    expect(new TextEncoder().encode(send.mock.calls[1]?.[1]).byteLength).toBe(MAX_TERMINAL_INPUT_BATCH_BYTES);
    acknowledgements.shift()?.();
    await vi.runAllTicks();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[1]).toBe('🙂');
    acknowledgements.shift()?.();
    await vi.runAllTicks();
    queue.dispose();
  });

  it('clears unsent input when a session disconnects or selection changes', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const queue = createTerminalInputBatcher(send);

    queue.enqueue('old-session', 'old prompt text');
    queue.clear('old-session');
    queue.enqueue('new-session', 'new prompt');
    await vi.advanceTimersByTimeAsync(12);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('new-session', 'new prompt');
    queue.dispose();
  });

  it('drops queued text on disconnect even when an earlier request is still awaiting its acknowledgement', async () => {
    vi.useFakeTimers();
    let acknowledge!: () => void;
    const send = vi.fn((_sessionId: string, _data: string) => new Promise<void>(resolve => { acknowledge = resolve; }));
    const queue = createTerminalInputBatcher(send);

    queue.enqueue('session-a', '\r');
    expect(send).toHaveBeenCalledWith('session-a', '\r');
    queue.enqueue('session-a', 'must not be replayed');
    queue.clear('session-a');
    acknowledge();
    await vi.runAllTicks();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it('bounds pending bytes and drops buffered data instead of replaying it after overflow', async () => {
    vi.useFakeTimers();
    let acknowledgeFirst!: () => void;
    const send = vi.fn((_sessionId: string, _data: string) => new Promise<void>(resolve => { acknowledgeFirst = resolve; }));
    const onOverflow = vi.fn();
    const queue = createTerminalInputBatcher(send, { onOverflow });

    queue.enqueue('session-a', 'x');
    await vi.advanceTimersByTimeAsync(12);
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.enqueue('session-a', 'y'.repeat(MAX_PENDING_TERMINAL_INPUT_BYTES))).toBe(true);
    expect(queue.enqueue('session-a', 'z')).toBe(false);
    expect(onOverflow).toHaveBeenCalledWith('session-a');

    acknowledgeFirst();
    await vi.runAllTicks();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it('does not retry uncertain input after a failed acknowledgement until explicitly reset', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(new Error('lost acknowledgement')).mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const queue = createTerminalInputBatcher(send, { onFailure });

    queue.enqueue('session-a', 'one');
    await vi.advanceTimersByTimeAsync(12);
    await vi.runAllTicks();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith('session-a');

    expect(queue.enqueue('session-a', 'two')).toBe(false);
    queue.reset('session-a');
    expect(queue.enqueue('session-a', 'three')).toBe(true);
    await vi.advanceTimersByTimeAsync(12);
    await vi.runAllTicks();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, 'session-a', 'three');
    queue.dispose();
  });

  it('cancels pending input on disposal', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const queue = createTerminalInputBatcher(send);

    queue.enqueue('session-a', 'pending');
    queue.dispose();
    await vi.advanceTimersByTimeAsync(12);

    expect(send).not.toHaveBeenCalled();
    expect(queue.enqueue('session-a', 'after-dispose')).toBe(false);
  });
});
