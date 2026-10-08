import { canSelectSession } from '../studio/model/selectors';
import type { AppState, Provider, StudioEvent } from '../studio/model/types';

export type SkillSuggestion = { id: string; label: string; command: string; description: string; source: 'demo' };
const catalog: Record<Provider, SkillSuggestion[]> = {
  codex: [
    { id: 'brainstorming', label: 'Khám phá yêu cầu và thiết kế', command: '$superpowers:brainstorming', description: 'Mô phỏng · kỹ năng của Codex', source: 'demo' },
    { id: 'codebase-memory', label: 'Khám phá cấu trúc codebase', command: '$codebase-memory', description: 'Mô phỏng · kỹ năng của Codex', source: 'demo' },
  ],
  claude: [
    { id: 'brainstorming', label: 'Khám phá yêu cầu và thiết kế', command: '/superpowers:brainstorming', description: 'Plugin nếu đã cài · mô phỏng', source: 'demo' },
    { id: 'code-review', label: 'Review code', command: '/code-review', description: 'Ví dụ skill có sẵn · mô phỏng', source: 'demo' },
  ],
  gemini: [], opencode: [],
};

export function skillSuggestions(provider: Provider, query: string): SkillSuggestion[] {
  const normalized = query.trim().toLocaleLowerCase();
  return (catalog[provider] ?? []).filter(item => !normalized || item.command.toLocaleLowerCase().startsWith(normalized));
}

export function makePromptEvent(state: AppState, sessionId: string, text: string): StudioEvent | null {
  if (!text.trim() || state.ui.selectedSessionId !== sessionId || !canSelectSession(state, sessionId)) return null;
  const session = state.sessions[sessionId];
  if (!session.processConfirmed || session.lifecycle !== 'active') return null;
  const timestamp = Date.now();
  return { type: 'session.message', sessionId, message: { id: `message-${sessionId}-${timestamp}`, kind: 'input', text, timestamp } };
}
