import { NextResponse } from 'next/server';
import { localOnly, runtimeError } from '../helpers';
import { listWorkspaceDirectories } from '../../../../server/runtime/workspace-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const requestedPath = new URL(request.url).searchParams.get('path');
    const listing = await listWorkspaceDirectories(requestedPath === null ? undefined : requestedPath);
    return NextResponse.json(listing, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return runtimeError(error);
  }
}
