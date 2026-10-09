import { NextResponse } from 'next/server';
import { localOnly, runtimeError, runtimeService } from '../../../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const denied = localOnly(request); if (denied) return denied;
  try {
    const { runId } = await context.params;
    if (Number(request.headers.get('content-length') || 0) > 0) return NextResponse.json({ error: 'report_content_must_come_from_native_peer' }, { status: 400 });
    const run = await runtimeService().submitReport(runId);
    return NextResponse.json({ run }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return runtimeError(error); }
}
