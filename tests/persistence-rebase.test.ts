import { describe, expect, it } from 'vitest';
import { createDemoState } from '../features/studio/model/seed';
import { rebasePendingEvents } from '../features/studio/persistence-rebase';

describe('pending persistence event rebase', () => {
  it('replays pending model and record edits after a server reply and preserves local view state', () => {
    const seed = createDemoState();
    const localUi = { ...seed.ui, role: 'employee' as const, workspaceId: 'demo-empty', search: 'local filter', officeMode: 'cards' as const };
    const rebased = rebasePendingEvents(seed, [
      { context: { role: 'ceo', workspaceId: 'demo-website', clientViewerId: null }, event: { type: 'session.config', sessionId: 'session-atlas', provider: 'claude', model: 'optimistic-model', reasoning: { kind: 'effort', value: 'high' } } },
      { context: { role: 'ceo', workspaceId: 'demo-empty', clientViewerId: null }, event: { type: 'record.updated', recordId: 'record-mobile-project', content: 'optimistic note in another workspace', updatedAt: 123 } },
    ], localUi);
    expect(rebased.sessions['session-atlas'].model).toBe('optimistic-model');
    expect(rebased.records['record-mobile-project'].content).toBe('optimistic note in another workspace');
    expect(rebased.ui).toEqual(localUi);
  });

  it('applies each queued event using its captured workspace and role context', () => {
    const seed = createDemoState();
    const localUi = { ...seed.ui, workspaceId: 'demo-website' };
    const rebased = rebasePendingEvents(seed, [{
      context: { role: 'client', workspaceId: 'demo-website', clientViewerId: 'client-a' },
      event: { type: 'record.updated', recordId: 'record-project', content: 'should not apply', updatedAt: 9 },
    }], localUi);
    expect(rebased.records['record-project'].content).not.toBe('should not apply');
  });
});
