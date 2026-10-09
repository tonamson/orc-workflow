import { NextResponse } from 'next/server';
import { getPersistenceDataSource } from '../../../../server/persistence/data-source';
import { getRoutingSettings, saveRoutingSettings } from '../../../../server/runtime/routing-settings';
import { localOnly, parseJson, runtimeError } from '../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = localOnly(request); if (denied) return denied;
  try { return NextResponse.json(await getRoutingSettings(await getPersistenceDataSource()), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return runtimeError(error); }
}

export async function PUT(request: Request) {
  const denied = localOnly(request); if (denied) return denied;
  try {
    const body = await parseJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_routing_settings');
    const { expectedRevision, policy } = body as Record<string, unknown>;
    return NextResponse.json(await saveRoutingSettings(await getPersistenceDataSource(), expectedRevision, policy), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return runtimeError(error); }
}
