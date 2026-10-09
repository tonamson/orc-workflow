import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { NativeRuntimeService } from '../server/runtime/service';
import { RuntimeEventNotifier, runtimeEventNotifier, streamRuntimeEvents } from '../server/runtime/sse';

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function readNextSseEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  while (true) {
    const result = await reader.read();
    if (result.done || !new TextDecoder().decode(result.value).startsWith(':')) return result;
  }
}

function eventServiceHarness() {
  let row: { id: string; lastSequence: number; outputBytes: number; updatedAt: Date } = { id: 'session-service', lastSequence: 0, outputBytes: 0, updatedAt: new Date(0) };
  let failNextTransaction = false;
  const events: Array<{ sequence: number; kind: string; text?: string; dataBase64?: string }> = [];
  const source = {
    async transaction(work: (manager: unknown) => Promise<void>) {
      const stagedRow = { ...row };
      const stagedEvents: Array<{ sequence: number; kind: string; text?: string; dataBase64?: string }> = [];
      const repo = {
        createQueryBuilder() {
          return { setLock() { return this; }, where() { return this; }, async getOne() { return stagedRow; } };
        },
        async save(value: typeof stagedRow) { Object.assign(stagedRow, value); },
        async insert(value: typeof events[number]) { stagedEvents.push(value); },
      };
      await work({ getRepository: () => repo });
      if (failNextTransaction) {
        failNextTransaction = false;
        throw new Error('transaction_failed');
      }
      row = stagedRow;
      events.push(...stagedEvents);
    },
  } as unknown as DataSource;
  const service = new NativeRuntimeService(Promise.resolve(source)) as unknown as {
    appendEvent(sessionId: string, event: { kind: 'status'; status?: string; text?: string }): Promise<void>;
    appendOutput(sessionId: string, bytes: Buffer): Promise<void>;
  };
  return { service, events, failNext: () => { failNextTransaction = true; } };
}

describe('runtime event stream', () => {
  it('flushes a connection comment before waiting on the initial database read', async () => {
    let queryStarted = false;
    let releaseQuery!: () => void;
    const pendingQuery = new Promise<void>(resolve => { releaseQuery = resolve; });
    const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events'), 'session-connect', async () => {
      queryStarted = true;
      await pendingQuery;
      return [];
    }, 0, new RuntimeEventNotifier());
    const reader = response.body!.getReader();

    try {
      const result = await Promise.race([
        reader.read(),
        delay(100).then(() => { throw new Error('SSE did not flush its connection comment immediately'); }),
      ]);
      expect(new TextDecoder().decode(result.value)).toBe(': connected\n\n');
      expect(queryStarted).toBe(true);
    } finally {
      await reader.cancel();
      releaseQuery();
    }
  });

  it('wakes immediately when a committed session event is published', async () => {
    const notifier = new RuntimeEventNotifier();
    let event: { sequence: number; kind: string } | null = null;
    let polls = 0;
    const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events'), 'session-fast', async after => {
      polls++;
      return event && event.sequence > after ? [event] : [];
    }, 0, notifier);
    const reader = response.body!.getReader();
    const pendingRead = readNextSseEvent(reader);
    await vi.waitFor(() => expect(polls).toBeGreaterThan(0));

    event = { sequence: 1, kind: 'output' };
    notifier.notify('session-fast');
    const result = await Promise.race([
      pendingRead,
      delay(100).then(() => { throw new Error('SSE waited for the fallback poll after a local event'); }),
    ]);

    expect(new TextDecoder().decode(result.value)).toContain('"sequence":1');
    await reader.cancel();
  });

  it('does not miss a notification published while the database query is in flight', async () => {
    const notifier = new RuntimeEventNotifier();
    let polls = 0;
    const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events'), 'session-race', async () => {
      polls++;
      if (polls === 1) {
        notifier.notify('session-race');
        return [];
      }
      return [{ sequence: 1, kind: 'status' }];
    }, 0, notifier);
    const reader = response.body!.getReader();

    const result = await Promise.race([
      readNextSseEvent(reader),
      delay(100).then(() => { throw new Error('Notification during the query was lost'); }),
    ]);

    expect(polls).toBeGreaterThanOrEqual(2);
    expect(new TextDecoder().decode(result.value)).toContain('"sequence":1');
    await reader.cancel();
  });

  it('removes its wake timer and listener when the stream is canceled while caught up', async () => {
    vi.useFakeTimers();
    const notifier = new RuntimeEventNotifier();
    try {
      const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events'), 'session-cancel', async () => [], 0, notifier);
      const reader = response.body!.getReader();
      const pendingRead = readNextSseEvent(reader);
      await vi.waitFor(() => expect(notifier.subscriptionCount('session-cancel')).toBe(1));

      await reader.cancel();
      expect(notifier.subscriptionCount('session-cancel')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      notifier.notify('session-cancel');
      expect((await pendingRead).done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies listeners only after an event transaction commits', async () => {
    const sessionId = 'session-service';
    const harness = eventServiceHarness();
    let polls = 0;
    const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events'), sessionId, async after => {
      polls++;
      return harness.events.filter(event => event.sequence > after);
    }, 0, runtimeEventNotifier);
    const reader = response.body!.getReader();
    const pendingRead = readNextSseEvent(reader);
    await vi.waitFor(() => expect(polls).toBeGreaterThan(0));

    harness.failNext();
    await expect(harness.service.appendEvent(sessionId, { kind: 'status', status: 'active' })).rejects.toThrow('transaction_failed');
    const noEarlyWake = await Promise.race([pendingRead.then(() => 'woke'), delay(50).then(() => 'still-waiting')]);
    expect(noEarlyWake).toBe('still-waiting');

    await harness.service.appendEvent(sessionId, { kind: 'status', status: 'active' });
    const result = await Promise.race([
      pendingRead,
      delay(100).then(() => { throw new Error('Committed event did not wake the stream'); }),
    ]);
    expect(harness.events).toHaveLength(1);
    expect(new TextDecoder().decode(result.value)).toContain('"sequence":1');
    await reader.cancel();
  });

  it('notifies an output listener only after the output chunk transaction commits', async () => {
    const sessionId = 'session-output-commit';
    const harness = eventServiceHarness();
    let polls = 0;
    const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events'), sessionId, async after => {
      polls++;
      return harness.events.filter(event => event.sequence > after);
    }, 0, runtimeEventNotifier);
    const reader = response.body!.getReader();
    const pendingRead = readNextSseEvent(reader);
    await vi.waitFor(() => expect(polls).toBeGreaterThan(0));

    harness.failNext();
    await expect(harness.service.appendOutput(sessionId, Buffer.from('echo'))).rejects.toThrow('transaction_failed');
    const noEarlyWake = await Promise.race([pendingRead.then(() => 'woke'), delay(50).then(() => 'still-waiting')]);
    expect(noEarlyWake).toBe('still-waiting');

    await harness.service.appendOutput(sessionId, Buffer.from('echo'));
    const result = await Promise.race([
      pendingRead,
      delay(100).then(() => { throw new Error('Committed PTY output did not wake the stream'); }),
    ]);
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]?.dataBase64).toBe(Buffer.from('echo').toString('base64'));
    expect(new TextDecoder().decode(result.value)).toContain('"sequence":1');
    await reader.cancel();
  });

  it('continues polling after the initial event backlog is empty', async () => {
    let event: { sequence: number; kind: string; dataBase64: string } | null = null;
    let polls = 0;
    const request = new Request('http://localhost/api/runtime/events');
    const response = streamRuntimeEvents(request, 'session-fallback', async (after) => {
      polls++;
      return event && event.sequence > after ? [event] : [];
    }, 0, new RuntimeEventNotifier());
    const reader = response.body!.getReader();
    const pendingRead = readNextSseEvent(reader);

    await delay(325);
    event = { sequence: 1, kind: 'output', dataBase64: Buffer.from('later TUI output').toString('base64') };
    const result = await Promise.race([
      pendingRead,
      delay(1500).then(() => { throw new Error('SSE stopped polling while caught up'); }),
    ]);

    expect(result.done).toBe(false);
    expect(new TextDecoder().decode(result.value)).toContain(Buffer.from('later TUI output').toString('base64'));
    expect(polls).toBeGreaterThan(1);
    await reader.cancel();
  });

  it('closes when the client aborts while caught up', async () => {
    const abort = new AbortController();
    const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events', { signal: abort.signal }), 'session-abort', async () => [], 0, new RuntimeEventNotifier());
    const reader = response.body!.getReader();
    const pendingRead = readNextSseEvent(reader);
    abort.abort();
    expect((await pendingRead).done).toBe(true);
  });

  it('does not enqueue into a canceled controller when a database poll finishes late', async () => {
    let releasePoll!: (events: { sequence: number; kind: string; dataBase64: string }[]) => void;
    const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events'), 'session-late-cancel', () => new Promise(resolve => { releasePoll = resolve; }), 0, new RuntimeEventNotifier());
    const reader = response.body!.getReader();
    const pendingRead = readNextSseEvent(reader);
    await delay(0);
    await reader.cancel();
    releasePoll([{ sequence: 1, kind: 'output', dataBase64: Buffer.from('late').toString('base64') }]);
    expect((await pendingRead).done).toBe(true);
  });
});
