import { describe, expect, it } from 'vitest';
import { parseCodexStatus } from '../server/runtime/status';

describe('Codex /status parsing', () => {
  it('extracts exact UUID, model, and effort when narrow terminals wrap status fields', () => {
    const parsed = parseCodexStatus([
      'Model:\r\n GPT-6.1-\r\n Sol (reasoning\r\n low, summaries auto)',
      'Model provider: openai',
      'Session:\r\n 01a11ae7-fb40-78c0\r\n -8af0-baa2078ab38c',
      'Weekly limit: 45% left',
    ].join('\r\n'));
    expect(parsed).toEqual({
      nativeConversationId: '01a11ae7-fb40-78c0-8af0-baa2078ab38c',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
    });
  });

  it('does not accept a UUID from outside the Session field', () => {
    expect(parseCodexStatus('Recent thread: 01a11ae7-fb40-78c0-8af0-baa2078ab38c\nSession: pending\nWeekly limit: 45%')).toBeNull();
  });

  it('normalizes a configured provider/model ID with supported delimiters', () => {
    const parsed = parseCodexStatus('Model: OpenAI/GPT-6.1-Codex (reasoning high, summaries auto)\nModel provider: openai\nSession: 01a11ae7-fb40-78c0-8af0-baa2078ab38c\nWeekly limit: 45%');
    expect(parsed?.model).toBe('openai/gpt-6.1-codex');
  });
});
