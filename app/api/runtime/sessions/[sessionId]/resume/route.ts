import { NextResponse } from 'next/server';
import { localOnly, runtimeError, runtimeService } from '../../../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const denied = localOnly(request); if (denied) return denied;
  try { const { sessionId } = await context.params; const session = await runtimeService().resumeSession(sessionId); return NextResponse.json({ session }); }
  catch (error) { return runtimeError(error); }
}
