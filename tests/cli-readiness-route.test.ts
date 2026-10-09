import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkCliReadiness } = vi.hoisted(() => ({ checkCliReadiness: vi.fn() }));
vi.mock('../server/runtime/cli-readiness', () => ({ checkCliReadiness }));

import { POST } from '../app/api/runtime/cli-readiness/route';

const localHeaders = { 'Content-Type': 'application/json', Host: 'localhost', Origin: 'http://localhost' };

describe('POST /api/runtime/cli-readiness', () => {
  beforeEach(() => checkCliReadiness.mockReset());

  it('rejects remote origins before probing a CLI', async () => {
    const response = await POST(new Request('http://example.test/api/runtime/cli-readiness', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'example.test', Origin: 'http://example.test' }, body: JSON.stringify({ provider: 'codex' }),
    }));
    expect(response.status).toBe(403);
    expect(checkCliReadiness).not.toHaveBeenCalled();
  });

  it('accepts only one allowlisted provider field', async () => {
    const response = await POST(new Request('http://localhost/api/runtime/cli-readiness', { method: 'POST', headers: localHeaders, body: JSON.stringify({ provider: 'codex', command: 'whoami' }) }));
    expect(response.status).toBe(400);
    expect(checkCliReadiness).not.toHaveBeenCalled();
  });

  it('uses the provider from a local request and disables response caching', async () => {
    checkCliReadiness.mockResolvedValue({ provider: 'codex', installed: true, version: '1.2.3', authentication: 'unknown', runnerSupported: true, orcReady: false, testedAt: '2026-10-09T00:00:00.000Z' });
    const response = await POST(new Request('http://localhost/api/runtime/cli-readiness', { method: 'POST', headers: localHeaders, body: JSON.stringify({ provider: 'codex' }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(checkCliReadiness).toHaveBeenCalledWith('codex');
    expect(await response.json()).toMatchObject({ runnerSupported: true, orcReady: false });
  });
});
