export const ROUTING_PROVIDERS = [
  { id: 'codex', label: 'Codex', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], runnerSupported: true },
  { id: 'claude', label: 'Claude', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], runnerSupported: false },
  { id: 'agy', label: 'Antigravity', efforts: ['low', 'medium', 'high'], runnerSupported: false },
  { id: 'opencode', label: 'OpenCode', efforts: ['default'], runnerSupported: false },
] as const;

export const TASK_KINDS = ['coding', 'planning', 'review'] as const;
export type RoutingProvider = typeof ROUTING_PROVIDERS[number]['id'];
export type TaskKind = typeof TASK_KINDS[number];
export type RoutingProfile = { provider: RoutingProvider; model: string | null; allowedEfforts: string[] };
export type RoutingPolicy = { supervisor: { provider: RoutingProvider; model: string | null; effort: string }; profiles: Record<TaskKind, RoutingProfile> };
export type RoutingDecision = { taskKind: TaskKind; provider: RoutingProvider; model: string | null; effort: string; reason: string; instruction: string };
export type RoutingPolicySnapshot = { revision: number; policy: RoutingPolicy };
export type RoutingSettingsEnvelope = { configured: boolean; revision: number; policy: RoutingPolicy; providers: Array<{ id: RoutingProvider; label: string; efforts: string[]; runnerSupported: boolean }> };

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}$/;
const EFFORT_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export function createDefaultRoutingPolicy(): RoutingPolicy {
  return {
    supervisor: { provider: 'codex', model: null, effort: 'high' },
    profiles: {
      coding: { provider: 'agy', model: null, allowedEfforts: ['medium', 'high'] },
      planning: { provider: 'claude', model: null, allowedEfforts: ['medium', 'high'] },
      review: { provider: 'codex', model: null, allowedEfforts: ['medium', 'high'] },
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function assertKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('invalid_routing_policy');
}
function provider(value: unknown): RoutingProvider {
  if (typeof value !== 'string' || !ROUTING_PROVIDERS.some(item => item.id === value)) throw new Error('invalid_routing_policy');
  return value as RoutingProvider;
}
function model(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !MODEL_ID.test(value)) throw new Error('invalid_routing_policy');
  return value;
}

export function parseRoutingPolicy(value: unknown): RoutingPolicy {
  if (!record(value)) throw new Error('invalid_routing_policy');
  assertKeys(value, ['supervisor', 'profiles']);
  const supervisor = value.supervisor;
  const profiles = value.profiles;
  if (!record(supervisor) || !record(profiles)) throw new Error('invalid_routing_policy');
  assertKeys(supervisor, ['provider', 'model', 'effort']);
  assertKeys(profiles, [...TASK_KINDS]);
  const supervisorProvider = provider(supervisor.provider);
  if (typeof supervisor.effort !== 'string' || !EFFORT_ID.test(supervisor.effort)) throw new Error('invalid_routing_policy');
  if (!ROUTING_PROVIDERS.find(item => item.id === supervisorProvider)!.efforts.includes(supervisor.effort as never)) throw new Error('invalid_routing_policy');
  const parsedProfiles = {} as Record<TaskKind, RoutingProfile>;
  for (const taskKind of TASK_KINDS) {
    const item = profiles[taskKind];
    if (!record(item)) throw new Error('invalid_routing_policy');
    assertKeys(item, ['provider', 'model', 'allowedEfforts']);
    const selectedProvider = provider(item.provider);
    if (!Array.isArray(item.allowedEfforts) || item.allowedEfforts.length === 0 || item.allowedEfforts.length > 8) throw new Error('invalid_routing_policy');
    const efforts = item.allowedEfforts.map(effort => {
      if (typeof effort !== 'string' || !EFFORT_ID.test(effort) || !ROUTING_PROVIDERS.find(p => p.id === selectedProvider)!.efforts.includes(effort as never)) throw new Error('invalid_routing_policy');
      return effort;
    });
    if (new Set(efforts).size !== efforts.length) throw new Error('invalid_routing_policy');
    parsedProfiles[taskKind] = { provider: selectedProvider, model: model(item.model), allowedEfforts: efforts };
  }
  return { supervisor: { provider: supervisorProvider, model: model(supervisor.model), effort: supervisor.effort }, profiles: parsedProfiles };
}

export function parseRoutingDecision(nativeText: string, policy: RoutingPolicy): RoutingDecision {
  let parsed: unknown;
  try { parsed = JSON.parse(nativeText); } catch { throw new Error('invalid_routing_decision'); }
  if (!record(parsed)) throw new Error('invalid_routing_decision');
  if (Object.keys(parsed).some(key => !['taskKind', 'effort', 'reason', 'instruction'].includes(key))) throw new Error('invalid_routing_decision');
  if (!TASK_KINDS.includes(parsed.taskKind as TaskKind) || typeof parsed.effort !== 'string' || typeof parsed.reason !== 'string' || typeof parsed.instruction !== 'string') throw new Error('invalid_routing_decision');
  const taskKind = parsed.taskKind as TaskKind;
  const profile = policy.profiles[taskKind];
  if (!profile.allowedEfforts.includes(parsed.effort) || !parsed.reason.trim() || !parsed.instruction.trim() || parsed.reason.length > 2000 || parsed.instruction.length > 12_000) throw new Error('invalid_routing_decision');
  return { taskKind, provider: profile.provider, model: profile.model, effort: parsed.effort, reason: parsed.reason.trim(), instruction: parsed.instruction.trim() };
}
