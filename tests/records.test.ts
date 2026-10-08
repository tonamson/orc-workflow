import { describe, expect, it } from 'vitest';
import { projectProgress, visibleRecords } from '../features/studio/model/selectors';
import { createDemoState } from '../features/studio/model/seed';
import { studioReducer } from '../features/studio/model/reducer';

describe('project records and verified progress', () => {
  it('counts accepted work only and deduplicates acceptance', () => {
    let state = createDemoState();
    expect(projectProgress(state, 'demo-website')).toEqual({ done: 8, total: 12, percent: 67 });
    expect(projectProgress(state, 'demo-empty')).toEqual({ done: 0, total: 0, percent: 0 });
    state = studioReducer(state, { type: 'task.status', taskId: 'task-09', status: 'reporting' });
    const report = { id: 'report-task-09', workspaceId: 'demo-website', taskId: 'task-09', sessionId: 'session-mika', content: 'Done', status: 'submitted' as const };
    state = studioReducer(state, { type: 'report.submitted', report });
    expect(projectProgress(state, 'demo-website').percent).toBe(67);
    state = studioReducer(state, { type: 'report.reviewed', reportId: report.id });
    state = studioReducer(state, { type: 'report.accepted', reportId: report.id });
    expect(projectProgress(state, 'demo-website')).toEqual({ done: 9, total: 12, percent: 75 });
    expect(studioReducer(state, { type: 'report.accepted', reportId: report.id })).toBe(state);
  });
  it('filters records by audience and ignores client edits', () => {
    let state = createDemoState();
    state = studioReducer(state, { type: 'ui.role', role: 'client' });
    expect(visibleRecords(state, 'demo-website-lobby').map(item => item.id)).not.toContain('record-commercial');
    const before = state.records['record-project'];
    expect(studioReducer(state, { type: 'record.updated', recordId: before.id, content: 'leak', updatedAt: 1 })).toBe(state);
    state = studioReducer(state, { type: 'ui.role', role: 'employee' });
    expect(visibleRecords(state, 'demo-website-meeting').map(item => item.id)).toContain('record-internal-minutes');
    expect(visibleRecords(state, 'demo-website-lobby')).toEqual([]);
  });
});
