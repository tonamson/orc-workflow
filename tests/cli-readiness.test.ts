import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, chmod, writeFile, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkCliReadiness, resolveCliExecutable, runBoundedCliCommand, type CliCommandResult } from '../server/runtime/cli-readiness';

const ok: CliCommandResult = { code: 0, stdout: 'codex 1.2.3', stderr: '' };

describe('CLI readiness diagnostics', () => {
  it('verifies AGY connectivity only when its bounded no-tools prompt returns the exact JSON marker', async () => {
    let probeCwd = '';
    const run = vi.fn(async (_executable: string, args: string[], options?: { timeoutMs?: number; cwd?: string }) => {
      if (args[0] === '--version') return { code: 0, stdout: 'AGY 1.3.2', stderr: '' };
      probeCwd = options?.cwd ?? '';
      expect(args).toEqual(['-p', 'Reply exactly ORC_AGY_OK. Do not use tools, read files, execute commands, or modify anything.', '--mode', 'plan', '--output-format', 'json', '--print-timeout', '20s']);
      expect(options?.timeoutMs).toBeLessThanOrEqual(25_000);
      expect(options?.timeoutMs).toBeGreaterThan(0);
      return { code: 0, stdout: JSON.stringify({ status: 'SUCCESS', response: 'ORC_AGY_OK', num_turns: 1, is_error: false }), stderr: '' };
    });

    const result = await checkCliReadiness('agy', { findExecutable: () => '/bin/agy', run });
    expect(result).toMatchObject({ installed: true, version: '1.3.2', authentication: 'unknown', connectionVerified: true, runnerSupported: false, orcReady: false });
    await expect(access(probeCwd)).rejects.toThrow();
  });

  it('accepts whitespace around the exact AGY response marker', async () => {
    const run = vi.fn().mockResolvedValueOnce({ code: 0, stdout: 'AGY 1.3.2', stderr: '' }).mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ status: 'SUCCESS', response: '\n ORC_AGY_OK \n', num_turns: 1 }), stderr: '' });
    const result = await checkCliReadiness('agy', { findExecutable: () => '/bin/agy', run });
    expect(result.connectionVerified).toBe(true);
  });

  it('does not verify AGY connection from auth errors, malformed JSON, other replies, or zero exit alone', async () => {
    const cases = [
      { code: 1, stdout: JSON.stringify({ status: 'ERROR', response: 'Login required ORC_AGY_OK', num_turns: 1 }), stderr: '' },
      { code: 0, stdout: 'ORC_AGY_OK', stderr: '' },
      { code: 0, stdout: JSON.stringify({ status: 'SUCCESS', response: 'different text', num_turns: 1 }), stderr: '' },
      { code: 0, stdout: JSON.stringify({ status: 'SUCCESS', response: { text: 'ORC_AGY_OK' }, num_turns: 1 }), stderr: '' },
      { code: 0, stdout: JSON.stringify({ status: 'SUCCESS', response: 'ORC_AGY_OK', num_turns: 0 }), stderr: '' },
      { code: 0, stdout: JSON.stringify({ status: 'SUCCESS', response: 'ORC_AGY_OK', num_turns: 1, is_error: true }), stderr: '' },
    ];
    for (const probeResult of cases) {
      const run = vi.fn().mockResolvedValueOnce({ code: 0, stdout: 'AGY 1.3.2', stderr: '' }).mockResolvedValueOnce(probeResult);
      const result = await checkCliReadiness('agy', { findExecutable: () => '/bin/agy', run });
      expect(result.connectionVerified).toBe(false);
      expect(result.authentication).toBe('unknown');
      expect(result.orcReady).toBe(false);
    }
  });

  it('passes the isolated cwd and 25-second timeout through the default process runner', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orc-cli-default-runner-'));
    try {
      const executable = path.join(directory, 'agy');
      await writeFile(executable, `#!/usr/bin/env node\nconst fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);if(args[0]==='--version'){process.stdout.write('AGY 1.3.2');process.exit(0)}setTimeout(()=>{const cwd=process.cwd();const entries=fs.readdirSync(cwd);const isolated=path.basename(cwd).startsWith('orc-cli-readiness-')&&entries.length===0;fs.writeFileSync(path.join(__dirname,'cwd.json'),JSON.stringify({cwd,isolated,entries}));process.stdout.write(JSON.stringify({status:isolated?'SUCCESS':'ERROR',response:isolated?'ORC_AGY_OK':'wrong cwd',num_turns:1}));},2600);\n`);
      await chmod(executable, 0o755);
      const result = await checkCliReadiness('agy', { findExecutable: () => executable });
      const cwdCheck = JSON.parse(await readFile(path.join(directory, 'cwd.json'), 'utf8')) as { cwd: string; isolated: boolean; entries: string[] };
      expect(cwdCheck.cwd).toContain('orc-cli-readiness-');
      expect(cwdCheck.entries).toEqual([]);
      expect(cwdCheck).toMatchObject({ isolated: true });
      expect(result).toMatchObject({ version: '1.3.2', connectionVerified: true, diagnostic: 'complete' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('reports AGY probe timeouts without exposing output and cleans up its temporary directory', async () => {
    let probeCwd = '';
    const run = vi.fn(async (_executable: string, args: string[], options?: { timeoutMs?: number; cwd?: string }) => {
      if (args[0] === '--version') return { code: 0, stdout: 'AGY 1.3.2', stderr: '' };
      probeCwd = options?.cwd ?? '';
      expect(options?.timeoutMs).toBeLessThanOrEqual(25_000);
      throw new Error('cli_probe_timeout');
    });
    const result = await checkCliReadiness('agy', { findExecutable: () => '/bin/agy', run });
    expect(result).toMatchObject({ version: '1.3.2', diagnostic: 'timeout', connectionVerified: false });
    expect(JSON.stringify(result)).not.toContain('cli_probe_timeout');
    await expect(access(probeCwd)).rejects.toThrow();
  });

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
