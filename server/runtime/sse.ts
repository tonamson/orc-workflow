export type SequencedRuntimeEvent = { sequence: number; kind: string } & Record<string, unknown>;

type RuntimeEventSubscription = {
  readonly notified: boolean;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
  dispose(): void;
};

export class RuntimeEventNotifier {
  private readonly subscriptions = new Map<string, Set<RuntimeEventSubscriptionImpl>>();

  subscribe(sessionId: string): RuntimeEventSubscription {
    const subscription = new RuntimeEventSubscriptionImpl(() => {
      const current = this.subscriptions.get(sessionId);
      current?.delete(subscription);
      if (current?.size === 0) this.subscriptions.delete(sessionId);
    });
    const listeners = this.subscriptions.get(sessionId) ?? new Set<RuntimeEventSubscriptionImpl>();
    listeners.add(subscription);
    this.subscriptions.set(sessionId, listeners);
    return subscription;
  }

  notify(sessionId: string): void {
    for (const subscription of [...(this.subscriptions.get(sessionId) ?? [])]) {
      try { subscription.notify(); } catch { /* A stream listener must never break a committed write. */ }
    }
  }

  subscriptionCount(sessionId: string): number {
    return this.subscriptions.get(sessionId)?.size ?? 0;
  }
}

class RuntimeEventSubscriptionImpl implements RuntimeEventSubscription {
  private didNotify = false;
  private disposed = false;
  private readonly waiters = new Set<() => void>();

  constructor(private readonly onDispose: () => void) {}

  get notified(): boolean { return this.didNotify; }

  notify(): void {
    if (this.disposed) return;
    this.didNotify = true;
    for (const resolve of [...this.waiters]) resolve();
  }

  wait(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (this.didNotify || this.disposed || signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.waiters.delete(finish);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      this.waiters.add(finish);
      signal.addEventListener('abort', finish, { once: true });
      timer = setTimeout(finish, milliseconds);
      if (this.didNotify || this.disposed || signal.aborted) finish();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const resolve of [...this.waiters]) resolve();
    this.onDispose();
  }
}

export const runtimeEventNotifier = new RuntimeEventNotifier();

export function streamRuntimeEvents(
  request: Request,
  sessionId: string,
  listEvents: (after: number, limit: number) => Promise<SequencedRuntimeEvent[]>,
  after: number,
  notifier = runtimeEventNotifier,
): Response {
  const encoder = new TextEncoder();
  let cursor = after;
  let stopped = false;
  let cancelled = false;
  let lastHeartbeat = Date.now();
  let activeSubscription: RuntimeEventSubscription | undefined;
  const stopController = new AbortController();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopController.abort();
    activeSubscription?.dispose();
    request.signal.removeEventListener('abort', stop);
  };
  request.signal.addEventListener('abort', stop, { once: true });
  if (request.signal.aborted) stop();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (stopped) {
        if (!cancelled) controller.close();
        return;
      }
      controller.enqueue(encoder.encode(': connected\n\n'));
    },
    async pull(controller) {
      while (!stopped) {
        const subscription = notifier.subscribe(sessionId);
        activeSubscription = subscription;
        try {
          const events = await listEvents(cursor, 200);
          if (stopped) {
            subscription.dispose();
            if (!cancelled) controller.close();
            return;
          }
          if (events.length) {
            subscription.dispose();
            activeSubscription = undefined;
            for (const event of events) {
              cursor = event.sequence;
              controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`));
            }
            lastHeartbeat = Date.now();
            return;
          }
          if (Date.now() - lastHeartbeat > 15_000) {
            subscription.dispose();
            activeSubscription = undefined;
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
            lastHeartbeat = Date.now();
            return;
          }
          await subscription.wait(250, stopController.signal);
          subscription.dispose();
          activeSubscription = undefined;
        } catch (error) {
          subscription.dispose();
          activeSubscription = undefined;
          if (stopped) {
            if (!cancelled) controller.close();
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
    cancel() {
      cancelled = true;
      stop();
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
