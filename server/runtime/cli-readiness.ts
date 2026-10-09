import { execFile as execFileCallback, type ChildProcess } from 'node:child_process';
import { constants as fsConstants, accessSync, statSync } from 'node:fs';
import path from 'node:path';
import type { RoutingProvider } from '../../features/settings/routing-policy';

export type CliCommandResult = { code: number | null; stdout: string; stderr: string };
export type CliReadinessResult = {
  provider: RoutingProvider;
  installed: boolean | null;
  version: string | null;
  authentication: 'authenticated' | 'unauthenticated' | 'unknown';
  runnerSupported: boolean;
  orcReady: boolean;
  testedAt: string;
  diagnostic: 'complete' | 'timeout' | 'failed';
};
type Dependencies = {
  findExecutable(provider: RoutingProvider): string | null;
  run(executable: string, args: string[]): Promise<CliCommandResult>;
};

const TIMEOUT_MS = 2500;
const MAX_OUTPUT_BYTES = 8_000;

const dependencies: Dependencies = { findExecutable: provider => resolveCliExecutable(provider), run: (executable, args) => runBoundedCliCommand(executable, args) };
const inFlight = new Map<RoutingProvider, Promise<CliReadinessResult>>();
let runningProbes = 0;
const probeQueue: Array<() => void> = [];

export function resolveCliExecutable(provider: RoutingProvider, configuredCodex = process.env.ORC_CODEX_BIN, searchPath = process.env.PATH || ''): string | null {
  const configured = provider === 'codex' ? configuredCodex : undefined;
  const binary = configured || provider;
  const isExecutableFile = (candidate: string) => {
    try { accessSync(candidate, fsConstants.X_OK); return statSync(candidate).isFile(); } catch { return false; }
  };
  if (configured && (path.isAbsolute(configured) || configured.includes(path.sep))) {
    const candidate = path.resolve(configured);
    return isExecutableFile(candidate) ? candidate : null;
  }
  if (path.isAbsolute(binary)) return isExecutableFile(binary) ? binary : null;
  for (const folder of searchPath.split(path.delimiter)) {
    if (!folder) continue;
    const candidate = path.join(folder, binary);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

export function runBoundedCliCommand(executable: string, args: string[], options: { timeoutMs?: number } = {}): Promise<CliCommandResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    let timedOut = false;
    try {
      child = execFileCallback(executable, args, { timeout: options.timeoutMs ?? TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout, stderr) => {
        if (timedOut || (error as (Error & { killed?: boolean }) | null)?.killed) return reject(new Error('cli_probe_timeout'));
        const code = typeof (error as NodeJS.ErrnoException | null)?.code === 'number' ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0;
        resolve({ code, stdout: String(stdout).slice(0, MAX_OUTPUT_BYTES), stderr: String(stderr).slice(0, MAX_OUTPUT_BYTES) });
      });
    } catch { reject(new Error('cli_probe_failed')); return; }
    child.once('error', () => { if (!timedOut) reject(new Error('cli_probe_failed')); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 300);
      force.unref();
    }, options.timeoutMs ?? TIMEOUT_MS);
    child.once('close', () => clearTimeout(timer));
  });
}

function cleanVersion(output: string): string | null {
  const match = output.match(/\b(?:v)?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b/);
  return match?.[1] ?? null;
}

function authenticationFrom(provider: RoutingProvider, result: CliCommandResult): CliReadinessResult['authentication'] {
  const output = (provider === 'codex' ? `${result.stdout}\n${result.stderr}` : result.stdout || result.stderr).trim();
  if (provider === 'codex') {
    if (/not logged in|not authenticated/i.test(output)) return 'unauthenticated';
    if (result.code === 0 && /logged in|authenticated/i.test(output)) return 'authenticated';
  }
  if (provider === 'claude') {
    if (result.code !== 0) return 'unknown';
    try {
      const parsed = JSON.parse(output) as { loggedIn?: unknown };
      if (parsed.loggedIn === true) return 'authenticated';
      if (parsed.loggedIn === false) return 'unauthenticated';
    } catch {}
  }
  if (provider === 'opencode' && result.code === 0) {
    if (/no (?:authenticated )?providers|no credentials/i.test(output)) return 'unauthenticated';
    return 'unknown';
  }
  return 'unknown';
}

async function acquireProbeSlot() {
  if (runningProbes >= 2) await new Promise<void>(resolve => probeQueue.push(resolve));
  runningProbes += 1;
  return () => { runningProbes -= 1; probeQueue.shift()?.(); };
}

export function checkCliReadiness(provider: RoutingProvider, overrides: Partial<Dependencies> = {}): Promise<CliReadinessResult> {
  const existing = inFlight.get(provider);
  if (existing) return existing;
  const deps = { ...dependencies, ...overrides };
  const promise = (async (): Promise<CliReadinessResult> => {
    const release = await acquireProbeSlot();
    let executable: string | null;
    try {
      executable = deps.findExecutable(provider);
    } catch {
      release();
      return { provider, installed: null, version: null, authentication: 'unknown', runnerSupported: provider === 'codex', orcReady: false, testedAt: new Date().toISOString(), diagnostic: 'failed' };
    }
    try {
      const runnerSupported = provider === 'codex';
      if (!executable) return { provider, installed: false, version: null, authentication: 'unknown', runnerSupported, orcReady: false, testedAt: new Date().toISOString(), diagnostic: 'complete' };
      if (provider === 'agy') return { provider, installed: true, version: null, authentication: 'unknown', runnerSupported: false, orcReady: false, testedAt: new Date().toISOString(), diagnostic: 'complete' };
      const versionResult = await deps.run(executable, ['--version']);
      const version = versionResult.code === 0 ? cleanVersion(versionResult.stdout) : null;
      let authentication: CliReadinessResult['authentication'] = 'unknown';
      let diagnostic: CliReadinessResult['diagnostic'] = versionResult.code === 0 && version !== null ? 'complete' : 'failed';
      if (versionResult.code === 0 && (provider === 'codex' || provider === 'claude' || provider === 'opencode')) {
        try {
          const authArgs = provider === 'codex' ? ['login', 'status'] : provider === 'claude' ? ['auth', 'status'] : ['auth', 'list'];
          const authResult = await deps.run(executable, authArgs);
          authentication = authenticationFrom(provider, authResult);
          if (authentication === 'unknown') diagnostic = 'failed';
        } catch (error) { authentication = 'unknown'; diagnostic = error instanceof Error && error.message === 'cli_probe_timeout' ? 'timeout' : 'failed'; }
      }
      const installed = true;
      return { provider, installed, version, authentication, runnerSupported, orcReady: runnerSupported && installed && version !== null && authentication === 'authenticated', testedAt: new Date().toISOString(), diagnostic };
    } catch (error) {
      return { provider, installed: true, version: null, authentication: 'unknown', runnerSupported: provider === 'codex', orcReady: false, testedAt: new Date().toISOString(), diagnostic: error instanceof Error && error.message === 'cli_probe_timeout' ? 'timeout' : 'failed' };
    } finally { release(); }
  })();
  inFlight.set(provider, promise);
  void promise.finally(() => { if (inFlight.get(provider) === promise) inFlight.delete(provider); });
  return promise;
}
