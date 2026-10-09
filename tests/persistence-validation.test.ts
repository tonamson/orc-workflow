import { describe, expect, it } from 'vitest';
import { validateMutationRequest } from '../server/persistence/validation';

const context = { role: 'ceo', workspaceId: 'demo-website', clientViewerId: null };

describe('persistence request validation', () => {
  it('accepts a typed domain event with an idempotency key and revision', () => {
    const result = validateMutationRequest({
      eventId: 'c7e62b40-0f78-47a7-8ef3-71c81e2a657c', expectedRevision: 2, context,
      event: { type: 'session.config', sessionId: 'session-atlas', provider: 'claude', model: 'claude-sonnet', reasoning: { kind: 'thinking-level', value: 'high' } },
    });
    expect(result.ok).toBe(true);
    expect(validateMutationRequest({ eventId: 'resize-1', expectedRevision: 0, context, event: { type: 'ui.departments-resize', count: 1 } }).ok).toBe(false);
  });

  it('rejects view-state events and unknown event types from the API', () => {
    const result = validateMutationRequest({
      eventId: 'c7e62b40-0f78-47a7-8ef3-71c81e2a657c', expectedRevision: 0, context,
      event: { type: 'ui.search', search: 'private' },
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_event' });
  });

  it('rejects legacy demo reset events so fixture data cannot be restored operationally', () => {
    for (const type of ['demo.seed-reset', 'demo.overflow-reset']) {
      expect(validateMutationRequest({ eventId: `legacy-${type}`, expectedRevision: 0, context, event: { type } }).ok).toBe(false);
    }
  });

  it('rejects malformed task, report, and context payloads before storage', () => {
    for (const event of [
      { type: 'task.status', taskId: 'task-01', status: 'launched' },
      { type: 'report.submitted', report: { id: 'r', workspaceId: 'demo-website', taskId: 'task-01', sessionId: 'session-atlas', status: 'accepted', content: 'not submitted' } },
      { type: 'record.updated', recordId: 'r', content: 'x'.repeat(1_000_001), updatedAt: 1 },
    ]) {
      expect(validateMutationRequest({ eventId: 'a1', expectedRevision: 0, context, event }).ok).toBe(false);
    }
    expect(validateMutationRequest({ eventId: '', expectedRevision: -1, context: { role: 'root', workspaceId: 'demo-website' }, event: { type: 'session.disconnected', sessionId: 'session-atlas' } }).ok).toBe(false);
  });
});
