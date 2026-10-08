import { describe, expect, it } from 'vitest';
import { sessionMetadata } from '../features/sessions/metadata';
import { formatSessionUpdate, sessionDisplay, taskForSession } from '../features/sessions/display';
import { makePromptEvent, skillSuggestions } from '../features/sessions/skills';
import { createDemoState } from '../features/studio/model/seed';
import { studioReducer } from '../features/studio/model/reducer';

describe('session metadata and prompts', () => {
  it('does not guess unknown provider metadata or collapse a thinking budget', () => {
    const state = createDemoState();
    expect(sessionMetadata({ ...state.sessions['session-nova'], model: null, reasoning: { kind: 'unknown' } }).model).toBe('Chưa đồng bộ');
    expect(sessionMetadata({ ...state.sessions['session-mika'], reasoning: { kind: 'unsupported' } }).reasoningValue).toBe('Không hỗ trợ');
    expect(sessionMetadata(state.sessions['session-mika']).reasoningValue).toContain('8192');
  });
  it('suggests only provider-scoped documented demo skills', () => {
    expect(skillSuggestions('codex', '$code').map(item => item.command)).toEqual(['$codebase-memory']);
    expect(skillSuggestions('claude', '/code')).toHaveLength(1);
    expect(skillSuggestions('gemini', '/')).toEqual([]);
  });
  it('preserves exact prompt text for only the selected live session', () => {
    const state = createDemoState();
    state.ui.selectedSessionId = 'session-atlas';
    const text = '$superpowers:brainstorming\nKeep $x and /y exactly';
    const event = makePromptEvent(state, 'session-atlas', text);
    expect(event?.type).toBe('session.message');
    if (event?.type === 'session.message') expect(event.message.text).toBe(text);
    expect(makePromptEvent(state, 'session-mika', text)).toBeNull();
    expect(makePromptEvent(state, 'missing', text)).toBeNull();
    expect(makePromptEvent({ ...state, sessions: { ...state.sessions, 'session-atlas': { ...state.sessions['session-atlas'], lifecycle: 'closing' } } }, 'session-atlas', text)).toBeNull();
  });
  it('bounds the demo transcript to the newest 500 messages', () => {
    let state = createDemoState();
    const session = state.sessions['session-atlas'];
    for (let index = 0; index < 505; index += 1) state = studioReducer(state, { type: 'session.message', sessionId: session.id, message: { id: `m-${index}`, kind: 'output', text: String(index), timestamp: index + 1 } });
    expect(state.sessions[session.id].messages).toHaveLength(500);
    expect(state.sessions[session.id].messages[0].text).toBe('5');
  });
  it('prefers the latest unfinished task over older completed tasks for a session', () => {
    const state = createDemoState();
    state.tasks['task-live-atlas'] = { id: 'task-live-atlas', workspaceId: 'demo-website', departmentId: 'dept-ui', requiredSkills: [], status: 'approval', sessionId: 'session-atlas', title: 'Current approval' };
    expect(taskForSession(state, 'session-atlas')?.id).toBe('task-live-atlas');
    expect(formatSessionUpdate(state.sessions['session-atlas'].lastUpdate)).not.toMatch(/Sự kiện #/);
    expect(sessionDisplay(state, state.sessions['session-atlas']).state).toBe('Chờ duyệt');
    expect(sessionDisplay(state, { ...state.sessions['session-atlas'], lifecycle: 'disconnected' }).state).toContain('Mất kết nối');
  });
});
