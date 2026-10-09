import { describe, expect, it } from 'vitest';
import { isLocalRuntimeRequest } from '../server/runtime/service';

describe('native runtime local request boundary', () => {
  it('allows loopback requests with a matching origin', () => {
    expect(isLocalRuntimeRequest(new Request('http://localhost/api/runtime/runs', {
      method: 'POST', headers: { host: 'localhost', origin: 'http://localhost' },
    }))).toBe(true);
  });

  it('allows bracketed IPv6 loopback host and origin', () => {
    expect(isLocalRuntimeRequest(new Request('http://[::1]:3000/api/runtime/runs', {
      method: 'POST', headers: { host: '[::1]:3000', origin: 'http://[::1]:3000' },
    }))).toBe(true);
  });

  it('rejects remote hosts and mismatched origins for mutations', () => {
    expect(isLocalRuntimeRequest(new Request('http://example.com/api/runtime/runs', {
      method: 'POST', headers: { host: 'example.com', origin: 'http://example.com' },
    }))).toBe(false);
    expect(isLocalRuntimeRequest(new Request('http://127.0.0.1/api/runtime/runs', {
      method: 'POST', headers: { host: '127.0.0.1', origin: 'http://attacker.example' },
    }))).toBe(false);
  });

  it('allows read-only local requests without an origin header', () => {
    expect(isLocalRuntimeRequest(new Request('http://127.0.0.1/api/runtime/runs', {
      method: 'GET', headers: { host: '127.0.0.1' },
    }))).toBe(true);
  });
});
