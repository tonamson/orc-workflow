import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkCliReadiness, resolveCliExecutable, runBoundedCliCommand, type CliCommandResult } from '../server/runtime/cli-readiness';

const ok: CliCommandResult = { code: 0, stdout: 'codex 1.2.3', stderr: '' };

describe('CLI readiness diagnostics', () => {
  it('resolves a configured bare Codex command through PATH', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orc-cli-path-'));
    try {
      const executable = path.join(directory, 'codex');
      await writeFile(executable, '#!/bin/sh\nexit 0\n');
      await chmod(executable, 0o755);
      expect(resolveCliExecutable('codex', 'codex', directory)).toBe(executable);
      expect(resolveCliExecutable('codex', path.relative(process.cwd(), executable), '')).toBe(executable);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('reports a versioned but unsupported provider as installed and not ORC-ready', async () => {
    const result = await checkCliReadiness('claude', {
      findExecutable: () => '/bin/claude',
      run: vi.fn().mockResolvedValueOnce({ ...ok, stdout: 'Claude Code 2.0.0' }).mockResolvedValueOnce({ code: 0, stdout: '{"loggedIn":true}', stderr: '' }),
    });

    expect(result).toMatchObject({ installed: true, version: '2.0.0', authentication: 'authenticated', runnerSupported: false, orcReady: false });
  });

  it('reports only the supported Codex runner ready after its local auth check passes', async () => {
    const result = await checkCliReadiness('codex', {
      findExecutable: () => '/bin/codex',
      run: vi.fn().mockResolvedValueOnce({ ...ok, stdout: 'codex 1.2.3' }).mockResolvedValueOnce({ code: 0, stdout: 'Logged in using ChatGPT', stderr: '' }),
    });
    expect(result).toMatchObject({ installed: true, authentication: 'authenticated', runnerSupported: true, orcReady: true });
  });

  it('reads Codex login status across stdout and stderr without returning it', async () => {
    const result = await checkCliReadiness('codex', {
      findExecutable: () => '/bin/codex',
      run: vi.fn().mockResolvedValueOnce({ ...ok, stdout: 'codex 1.2.3' }).mockResolvedValueOnce({ code: 0, stdout: 'Checking local credentials…', stderr: 'Logged in using ChatGPT' }),
    });
    expect(result.authentication).toBe('authenticated');
    expect(JSON.stringify(result)).not.toContain('ChatGPT');
  });

  it('reports a CLI executable as installed even when its version probe fails', async () => {
    const result = await checkCliReadiness('opencode', {
      findExecutable: () => '/bin/opencode',
      run: vi.fn().mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'private error detail' }),
    });
    expect(result).toMatchObject({ installed: true, version: null, authentication: 'unknown', runnerSupported: false, orcReady: false });
    expect(JSON.stringify(result)).not.toContain('private error detail');
  });

  it('does not infer OpenCode authentication from nonempty auth-list output', async () => {
    const run = vi.fn().mockResolvedValueOnce({ ...ok, stdout: 'opencode 1.2.3' }).mockResolvedValueOnce({ code: 0, stdout: 'anthropic\nopenai', stderr: '' });
    expect(await checkCliReadiness('opencode', { findExecutable: () => '/bin/opencode', run })).toMatchObject({ installed: true, authentication: 'unknown', runnerSupported: false, orcReady: false });
    expect(run).toHaveBeenLastCalledWith('/bin/opencode', ['auth', 'list']);
  });

  it('does not treat an OpenCode banner or zero-credential count as authenticated', async () => {
    const result = await checkCliReadiness('opencode', {
      findExecutable: () => '/bin/opencode',
      run: vi.fn().mockResolvedValueOnce({ ...ok, stdout: 'opencode 1.2.3' }).mockResolvedValueOnce({ code: 0, stdout: 'OpenCode CLI\n0 credentials', stderr: '' }),
    });
    expect(result.authentication).toBe('unknown');
  });

  it('keeps empty OpenCode auth-list output unknown because environment credentials may exist', async () => {
    const result = await checkCliReadiness('opencode', {
      findExecutable: () => '/bin/opencode',
      run: vi.fn().mockResolvedValueOnce({ ...ok, stdout: 'opencode 1.2.3' }).mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }),
    });
    expect(result).toMatchObject({ authentication: 'unknown', runnerSupported: false, orcReady: false });
  });

  it('does not expose output or infer authentication from a version-only probe', async () => {
    const result = await checkCliReadiness('agy', { findExecutable: () => '/bin/agy', run: vi.fn() });
    expect(result).toMatchObject({ installed: true, version: null, authentication: 'unknown', runnerSupported: false, orcReady: false });
    expect(JSON.stringify(result)).not.toMatch(/account|email|token|stderr/i);
    expect(result.version).toBeNull();
  });

  it('reports a missing agy command without invoking a wrapper or GUI', async () => {
    const run = vi.fn();
    expect(await checkCliReadiness('agy', { findExecutable: () => null, run })).toMatchObject({ installed: false, authentication: 'unknown', orcReady: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('reports a missing executable without attempting to run it', async () => {
    const run = vi.fn();
    expect(await checkCliReadiness('codex', { findExecutable: () => null, run })).toMatchObject({ installed: false, authentication: 'unknown', orcReady: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('does not infer successful Claude authentication from a failed status command', async () => {
    const result = await checkCliReadiness('claude', {
      findExecutable: () => '/bin/claude',
      run: vi.fn().mockResolvedValueOnce({ ...ok, stdout: 'Claude Code 2.0.0' }).mockResolvedValueOnce({ code: 1, stdout: '{"loggedIn":true}', stderr: '' }),
    });
    expect(result).toMatchObject({ authentication: 'unknown', runnerSupported: false, orcReady: false });
  });

  it('keeps authentication unknown on probe failure and never returns raw command output', async () => {
    const result = await checkCliReadiness('codex', {
      findExecutable: () => '/bin/codex',
      run: vi.fn().mockResolvedValueOnce(ok).mockRejectedValueOnce(new Error('private diagnostic email@example.test')),
    });
    expect(result).toMatchObject({ installed: true, authentication: 'unknown', orcReady: false });
    expect(JSON.stringify(result)).not.toContain('email@example.test');
  });

  it('returns a safe timeout state when a version probe hangs', async () => {
    const result = await checkCliReadiness('codex', {
      findExecutable: () => '/bin/codex',
      run: vi.fn().mockRejectedValue(new Error('cli_probe_timeout')),
    });
    expect(result).toMatchObject({ installed: true, version: null, authentication: 'unknown', diagnostic: 'timeout', orcReady: false });
    expect(JSON.stringify(result)).not.toContain('cli_probe_timeout');
  });

  it('terminates a command that exceeds its timeout', async () => {
    await expect(runBoundedCliCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 25 }))
      .rejects.toThrow('cli_probe_timeout');
  });
});
