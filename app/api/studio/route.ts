import { NextResponse } from 'next/server';
import { getPersistenceDataSource } from '../../../server/persistence/data-source';
import { StudioPersistenceStore } from '../../../server/persistence/store';
import { validateMutationRequest } from '../../../server/persistence/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function store() { return new StudioPersistenceStore(await getPersistenceDataSource()); }

export async function GET() {
  try { return NextResponse.json(await (await store()).load(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'persistence_unavailable' }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }); }
    const checked = validateMutationRequest(body);
    if (!checked.ok) return NextResponse.json({ error: checked.code }, { status: 400 });
    const result = await (await store()).apply(checked.value);
    if (result.status === 'conflict') return NextResponse.json(result, { status: 409 });
    if (result.status === 'rejected') return NextResponse.json(result, { status: result.code === 'forbidden' ? 403 : 422 });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'persistence_unavailable' }, { status: 503 }); }
}
