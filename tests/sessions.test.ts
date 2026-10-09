import { describe, expect, it } from 'vitest';
import { sessionMetadata } from '../features/sessions/metadata';
import { formatSessionUpdate, sessionDisplay, taskForSession } from '../features/sessions/display';
import { runtimeStatusLabel, shouldPollRuntimeRun } from '../features/sessions/runtime-lifecycle';
import { createDemoState } from '../features/studio/model/seed';
import { studioReducer } from '../features/studio/model/reducer';

describe('session metadata', () => {
  it('polls startup and shutdown transitions until process confirmation is authoritative', () => {
    expect(shouldPollRuntimeRun('starting')).toBe(true);
    expect(shouldPollRuntimeRun('active')).toBe(true);
    expect(shouldPollRuntimeRun('closing')).toBe(true);
    expect(shouldPollRuntimeRun('interrupted')).toBe(false);
    expect(shouldPollRuntimeRun('done')).toBe(false);
  });

  it('translates persisted runtime states for display without changing server values', () => {
    expect(runtimeStatusLabel('reporting')).toBe('Đang rà soát');
    expect(runtimeStatusLabel('done')).toBe('Đã hoàn tất');
    expect(runtimeStatusLabel('interrupted')).toBe('Đã gián đoạn');
    expect(runtimeStatusLabel('custom-state')).toBe('custom-state');
  });

  it('does not guess unknown provider metadata or collapse a thinking budget', () => {
    const state = createDemoState();
    expect(sessionMetadata({ ...state.sessions['session-nova'], model: null, reasoning: { kind: 'unknown' } }).model).toBe('Chưa đồng bộ');
    expect(sessionMetadata({ ...state.sessions['session-mika'], reasoning: { kind: 'unsupported' } }).reasoningValue).toBe('Không hỗ trợ');
    expect(sessionMetadata(state.sessions['session-mika']).reasoningValue).toContain('8192');
  });
  it('bounds persisted transcript lines to the newest 500 entries', () => {
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
    expect(formatSessionUpdate(0)).toBe('Chưa đồng bộ');
    expect(sessionDisplay(state, state.sessions['session-atlas']).state).toBe('Chờ duyệt');
    expect(sessionDisplay(state, { ...state.sessions['session-atlas'], lifecycle: 'disconnected' }).state).toContain('Mất kết nối');
  });
});
