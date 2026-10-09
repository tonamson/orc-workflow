import { NextResponse } from 'next/server';
import { localOnly, parseJson, runtimeError, runtimeService } from '../../../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const denied = localOnly(request); if (denied) return denied;
  try {
    const { sessionId } = await context.params;
    const body = await parseJson(request);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_terminal_size' }, { status: 400 });
    const size = body as { cols?: unknown; rows?: unknown };
    await runtimeService().resize(sessionId, size.cols, size.rows);
    return NextResponse.json({ resized: true });
  } catch (error) { return runtimeError(error); }
}
