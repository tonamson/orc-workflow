import { NextResponse } from 'next/server';
import { localOnly, parseJson, runtimeError, runtimeService } from '../../../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const denied = localOnly(request); if (denied) return denied;
  try {
    const { sessionId } = await context.params;
    const body = await parseJson(request);
    if (!body || typeof body !== 'object' || !('data' in body)) return NextResponse.json({ error: 'invalid_terminal_input' }, { status: 400 });
    await runtimeService().writeInput(sessionId, (body as { data: unknown }).data);
    return NextResponse.json({ written: true });
  } catch (error) { return runtimeError(error); }
}
