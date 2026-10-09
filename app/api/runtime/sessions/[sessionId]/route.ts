import { NextResponse } from 'next/server';
import { localOnly, runtimeError, runtimeService } from '../../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const denied = localOnly(request); if (denied) return denied;
  try { const { sessionId } = await context.params; return NextResponse.json({ session: await runtimeService().getSession(sessionId) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return runtimeError(error); }
}
