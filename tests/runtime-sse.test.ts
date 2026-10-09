import { describe, expect, it } from 'vitest';
import { streamRuntimeEvents } from '../server/runtime/sse';

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

describe('runtime event stream', () => {
  it('continues polling after the initial event backlog is empty', async () => {
    let event: { sequence: number; kind: string; dataBase64: string } | null = null;
    let polls = 0;
    const request = new Request('http://localhost/api/runtime/events');
    const response = streamRuntimeEvents(request, async (after) => {
      polls++;
      return event && event.sequence > after ? [event] : [];
    }, 0);
    const reader = response.body!.getReader();
    const pendingRead = reader.read();

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
    const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events', { signal: abort.signal }), async () => [], 0);
    const reader = response.body!.getReader();
    const pendingRead = reader.read();
    abort.abort();
    expect((await pendingRead).done).toBe(true);
  });

  it('does not enqueue into a canceled controller when a database poll finishes late', async () => {
    let releasePoll!: (events: { sequence: number; kind: string; dataBase64: string }[]) => void;
    const response = streamRuntimeEvents(new Request('http://localhost/api/runtime/events'), () => new Promise(resolve => { releasePoll = resolve; }), 0);
    const reader = response.body!.getReader();
    const pendingRead = reader.read();
    await delay(0);
    await reader.cancel();
    releasePoll([{ sequence: 1, kind: 'output', dataBase64: Buffer.from('late').toString('base64') }]);
    expect((await pendingRead).done).toBe(true);
  });
});
