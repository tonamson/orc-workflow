import { localOnly, runtimeError, runtimeService } from '../../../helpers';
import { streamRuntimeEvents } from '../../../../../../server/runtime/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  if (!localOnly(request)) {
    try {
      const { sessionId } = await context.params;
      const url = new URL(request.url);
      const rawAfter = request.headers.get('last-event-id') || url.searchParams.get('after') || '0';
      const after = Number(rawAfter);
      if (!Number.isSafeInteger(after) || after < 0) return Response.json({ error: 'invalid_sequence' }, { status: 400 });
      const service = runtimeService();
      if (!request.headers.get('accept')?.includes('text/event-stream')) {
        return Response.json({ events: await service.listEvents(sessionId, after) }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return streamRuntimeEvents(request, sessionId, (cursor, limit) => service.listEvents(sessionId, cursor, limit), after);
    } catch (error) { return runtimeError(error); }
  }
  return Response.json({ error: 'local_runtime_only' }, { status: 403 });
}
