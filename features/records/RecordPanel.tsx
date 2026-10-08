'use client';

import { useState } from 'react';
import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';

export function RecordPanel({ recordId, state, dispatch }: { recordId: string; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const record = state.records[recordId];
  const [content, setContent] = useState(record?.content ?? '');
  if (!record || record.workspaceId !== state.ui.workspaceId) return <div className="empty-state">Hồ sơ không còn khả dụng.</div>;
  const editable = state.ui.role === 'ceo' || state.ui.role === 'employee' && record.audience === 'internal';
  return <article className="record-panel"><h2>{record.name}</h2><div className="panel-tag">{record.type.toLocaleUpperCase()} · {record.audience.toLocaleUpperCase()}</div><p>{record.summary}</p><h3>Nội dung</h3>{editable ? <><textarea aria-label="Nội dung hồ sơ" value={content} onChange={event => setContent(event.target.value)}/><button onClick={() => dispatch({ type: 'record.updated', recordId, content, updatedAt: Date.now() })}>Lưu ghi chú demo</button></> : <p className="record-content">{record.content}</p>}<p className="panel-tag">Bản demo · chưa lưu tệp thật</p></article>;
}
