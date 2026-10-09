export type SequencedRuntimeEvent = { sequence: number; kind: string } & Record<string, unknown>;

export function streamRuntimeEvents(
  request: Request,
  listEvents: (after: number, limit: number) => Promise<SequencedRuntimeEvent[]>,
  after: number,
): Response {
  const encoder = new TextEncoder();
  let cursor = after;
  let stopped = false;
  let cancelled = false;
  let lastHeartbeat = Date.now();
  const stop = () => { stopped = true; };
  request.signal.addEventListener('abort', stop, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (!stopped) {
        try {
          const events = await listEvents(cursor, 200);
          if (stopped) {
            if (!cancelled) controller.close();
            request.signal.removeEventListener('abort', stop);
            return;
          }
          if (events.length) {
            for (const event of events) {
              cursor = event.sequence;
              controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`));
            }
            lastHeartbeat = Date.now();
            return;
          }
          if (Date.now() - lastHeartbeat > 15_000) {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
            lastHeartbeat = Date.now();
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        } catch (error) {
          if (stopped) {
            if (!cancelled) controller.close();
            request.signal.removeEventListener('abort', stop);
            return;
          }
          stopped = true;
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'runtime_error' })}\n\n`));
          controller.close();
          request.signal.removeEventListener('abort', stop);
          return;
        }
      }
      if (!cancelled) controller.close();
      request.signal.removeEventListener('abort', stop);
    },
    cancel() { cancelled = true; stopped = true; request.signal.removeEventListener('abort', stop); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
