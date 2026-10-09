import { NextResponse } from 'next/server';
import { localOnly, parseJson, runtimeError, runtimeService } from '../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = localOnly(request); if (denied) return denied;
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspaceId') || undefined;
    if (workspaceId && !/^[a-zA-Z0-9_-]{1,100}$/.test(workspaceId)) return NextResponse.json({ error: 'invalid_workspace' }, { status: 400 });
    return NextResponse.json({ runs: await runtimeService().listRuns(workspaceId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return runtimeError(error); }
}

export async function POST(request: Request) {
  const denied = localOnly(request); if (denied) return denied;
  try {
    const body = await parseJson(request);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_run' }, { status: 400 });
    const run = await runtimeService().createRun(body as { workspaceId: unknown; taskId: unknown; prompt: unknown });
    return NextResponse.json({ run }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return runtimeError(error); }
}
