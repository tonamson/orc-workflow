import { describe, expect, it } from 'vitest';
import { createDefaultRoutingPolicy, parseRoutingDecision, parseRoutingPolicy } from '../features/settings/routing-policy';
import { applyRoutingDecisionToPeer, buildCodexSessionArgs } from '../server/runtime/service';

describe('global routing policy contract', () => {
  it('rejects unknown task categories and provider model IDs outside the safe character set', () => {
    const policy = createDefaultRoutingPolicy();
    expect(() => parseRoutingPolicy({ ...policy, profiles: { ...policy.profiles, audit: policy.profiles.review } })).toThrow('invalid_routing_policy');
    expect(() => parseRoutingPolicy({ ...policy, profiles: { ...policy.profiles, coding: { ...policy.profiles.coding, model: 'x; touch /tmp/pwned' } } })).toThrow('invalid_routing_policy');
  });

  it('requires nonempty unique efforts supported by each configured provider', () => {
    const policy = createDefaultRoutingPolicy();
    expect(() => parseRoutingPolicy({ ...policy, profiles: { ...policy.profiles, coding: { ...policy.profiles.coding, allowedEfforts: [] } } })).toThrow('invalid_routing_policy');
    expect(() => parseRoutingPolicy({ ...policy, profiles: { ...policy.profiles, coding: { ...policy.profiles.coding, allowedEfforts: ['xhigh'] } } })).toThrow('invalid_routing_policy');
    expect(() => parseRoutingPolicy({ ...policy, profiles: { ...policy.profiles, coding: { ...policy.profiles.coding, allowedEfforts: ['medium', 'medium'] } } })).toThrow('invalid_routing_policy');
  });

  it('derives provider and model from configuration and rejects native effort outside its allowed list', () => {
    const policy = createDefaultRoutingPolicy();
    const decision = parseRoutingDecision(JSON.stringify({ taskKind: 'review', effort: 'high', reason: 'Risk review', instruction: 'Inspect auth boundaries.' }), policy);
    expect(decision).toEqual({ taskKind: 'review', provider: 'codex', model: null, effort: 'high', reason: 'Risk review', instruction: 'Inspect auth boundaries.' });
    expect(() => parseRoutingDecision('{', policy)).toThrow('invalid_routing_decision');
    expect(() => parseRoutingDecision(JSON.stringify({ taskKind: 'review', effort: 'xhigh', reason: 'Reason', instruction: 'Review.' }), policy)).toThrow('invalid_routing_decision');
    expect(() => parseRoutingDecision(JSON.stringify({ taskKind: 'review', effort: 'high', provider: 'codex', reason: 'Reason', instruction: 'Review.' }), policy)).toThrow('invalid_routing_decision');
  });

  it('allows unsupported providers to be configured without claiming a runner', () => {
    const policy = createDefaultRoutingPolicy();
    const configured = parseRoutingPolicy({ ...policy, profiles: { ...policy.profiles, coding: { provider: 'agy', model: 'gemini-3.5-flash-medium', allowedEfforts: ['low', 'high'] }, review: { provider: 'opencode', model: 'anthropic/claude-sonnet-4', allowedEfforts: ['default'] } } });
    expect(parseRoutingDecision(JSON.stringify({ taskKind: 'coding', effort: 'high', reason: 'Cost profile', instruction: 'Inspect the implementation.' }), configured).provider).toBe('agy');
  });

  it('passes the selected model and effort as native Codex arguments and keeps resume identity exact', () => {
    const args = buildCodexSessionArgs({ cwd: '/workspace', model: 'openai/gpt-6.1-codex', reasoningEffort: 'high', nativeConversationId: '01a11ae7-fb40-78c0-8af0-baa2078ab38c', resumePrompt: 'Continue the saved task.' });
    expect(args).toEqual([
      '--no-alt-screen', '--no-daemon', '-C', '/workspace', '-s', 'read-only', '-a', 'on-request', '--model', 'openai/gpt-6.1-codex', '-c', 'model_reasoning_effort="high"', 'resume', '01a11ae7-fb40-78c0-8af0-baa2078ab38c',
      'Continue the saved task.',
    ]);
    expect(args.filter(argument => argument === 'resume')).toHaveLength(1);
    expect(() => buildCodexSessionArgs({ cwd: '/workspace', model: 'gpt;bad', reasoningEffort: 'high', nativeConversationId: null })).toThrow('invalid_routing_settings');
  });

  it('reapplies a cached validated decision when a queued peer has not saved its launch settings yet', () => {
    const peer = { model: null as string | null, reasoningEffort: null as string | null };
    const decision = { taskKind: 'review' as const, provider: 'codex' as const, model: 'gpt-6.1-codex', effort: 'high', reason: 'Review task', instruction: 'Inspect changes.' };
    applyRoutingDecisionToPeer(peer, decision);
    expect(peer).toEqual({ model: 'gpt-6.1-codex', reasoningEffort: 'high' });
  });
});
