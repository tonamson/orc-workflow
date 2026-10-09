import { NextResponse } from 'next/server';
import { ROUTING_PROVIDERS } from '../../../../features/settings/routing-policy';
import { checkCliReadiness } from '../../../../server/runtime/cli-readiness';
import { localOnly, parseJson } from '../helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const body = await parseJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_request');
    const record = body as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || !ROUTING_PROVIDERS.some(item => item.id === record.provider)) throw new Error('invalid_request');
    const result = await checkCliReadiness(record.provider as typeof ROUTING_PROVIDERS[number]['id']);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error && error.message === 'invalid_request' ? 'invalid_request' : 'cli_readiness_failed';
    return NextResponse.json({ error: code }, { status: code === 'invalid_request' ? 400 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
