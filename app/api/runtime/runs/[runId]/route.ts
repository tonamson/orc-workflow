import { NextResponse } from 'next/server';
import { localOnly, runtimeError, runtimeService } from '../../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const denied = localOnly(request); if (denied) return denied;
  try { const { runId } = await context.params; return NextResponse.json({ run: await runtimeService().getRun(runId) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return runtimeError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ runId: string }> }) {
  const denied = localOnly(request); if (denied) return denied;
  try { const { runId } = await context.params; await runtimeService().closeRun(runId); return NextResponse.json({ closed: true }); }
  catch (error) { return runtimeError(error); }
}
