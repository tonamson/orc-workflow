import { NextResponse } from 'next/server';
import { localOnly, parseJson, runtimeError, runtimeService } from '../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = localOnly(request); if (denied) return denied;
  try { return NextResponse.json({ workspaces: await runtimeService().listWorkspaces() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return runtimeError(error); }
}

export async function POST(request: Request) {
  const denied = localOnly(request); if (denied) return denied;
  try {
    const body = await parseJson(request);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_workspace' }, { status: 400 });
    const workspace = await runtimeService().registerWorkspace(body as { id: unknown; name: unknown; path: unknown });
    return NextResponse.json({ workspace }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return runtimeError(error); }
}
