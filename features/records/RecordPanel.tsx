'use client';

import { useState } from 'react';
import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';
import { projectProgress, visibleRecords } from '../studio/model/selectors';
import { recordAudienceLabel, recordTypeLabel } from './labels';

export function RecordPanel({ recordId, state, dispatch }: { recordId: string; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const record = state.records[recordId];
  const [content, setContent] = useState(record?.content ?? '');
  if (!record || record.workspaceId !== state.ui.workspaceId || !visibleRecords(state, record.roomId).some(item => item.id === recordId)) return <div className="empty-state">Hồ sơ không còn khả dụng.</div>;
  const derivedProgress = record.type === 'progress' ? projectProgress(state, record.workspaceId) : null;
  const editable = !derivedProgress && (state.ui.role === 'ceo' || state.ui.role === 'employee' && record.audience === 'internal');
  return <article className="record-panel"><h2>{record.name}</h2><div className="panel-tag">{recordTypeLabel(record.type)} · {recordAudienceLabel(record.audience)}</div>{derivedProgress ? <><p>Tiến độ hiện tại được tính từ phần việc đã chấp thuận.</p><section className="record-live-progress" aria-label="Tiến độ dự án"><strong>{derivedProgress.percent}%</strong><span>{derivedProgress.done}/{derivedProgress.total} nhiệm vụ được chấp thuận</span><progress value={derivedProgress.done} max={derivedProgress.total || 1}/></section></> : <p>{record.summary}</p>}<h3>{derivedProgress ? 'Chi tiết tiến độ' : 'Nội dung'}</h3>{derivedProgress ? <p className="record-content">Báo cáo và hoạt ảnh không cộng tiến độ trước khi được chấp thuận.</p> : editable ? <><textarea aria-label="Nội dung hồ sơ" value={content} onChange={event => setContent(event.target.value)}/><button onClick={() => dispatch({ type: 'record.updated', recordId, content, updatedAt: Date.now() })}>Lưu ghi chú</button></> : <p className="record-content">{record.content}</p>}<p className="panel-tag">Lưu trong PostgreSQL</p></article>;
}
