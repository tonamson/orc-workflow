'use client';

import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';
import { projectProgress, visibleRecords, visibleRooms } from '../studio/model/selectors';
import { layoutOffice } from '../office/geometry';
import { ArtworkCrop } from '../office/ArtworkCrop';
import { recordAudienceLabel, recordTypeLabel } from './labels';

export function RecordsRoom({ roomId, state, dispatch }: { roomId: string; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const room = state.rooms[roomId];
  const layoutRoom = layoutOffice(visibleRooms(state)).rooms.find(item => item.room.id === roomId);
  const records = visibleRecords(state, roomId).filter(record => {
    const query = state.ui.search.trim().toLocaleLowerCase();
    return (!query || `${record.name} ${record.summary} ${record.content}`.toLocaleLowerCase().includes(query)) && (state.ui.recordFilter === 'all' || record.type === state.ui.recordFilter);
  });
  const types = [...new Set(visibleRecords(state, roomId).map(record => record.type))];
  const progress = projectProgress(state, room?.workspaceId ?? '');
  const reports = state.ui.role === 'client' ? [] : Object.values(state.reports).filter(report => report.workspaceId === room?.workspaceId && report.status === 'accepted');
  return <section className="records-room">
    {layoutRoom && <div className="records-room-art" style={{ aspectRatio: `${layoutRoom.source[2]}/${layoutRoom.source[3]}` }}><ArtworkCrop room={layoutRoom} label={room?.name ?? 'phòng hồ sơ'}/></div>}
    <header><span>{room?.kind === 'meeting' ? 'HỌP & HỒ SƠ NỘI BỘ' : 'HỒ SƠ DỰ ÁN'}</span><h2>{room?.name}</h2><p>Tiến độ được tính từ nhiệm vụ đã được chấp thuận.</p></header>
    <div className="progress-card"><div><strong>{progress.percent}%</strong><span>{progress.done}/{progress.total} nhiệm vụ được chấp thuận</span></div><progress value={progress.done} max={progress.total || 1}/></div>
    <nav aria-label="Lọc hồ sơ"><button className={state.ui.recordFilter === 'all' ? 'active' : ''} onClick={() => dispatch({ type: 'ui.record-filter', filter: 'all' })}>Tất cả</button>{types.map(type => <button key={type} className={state.ui.recordFilter === type ? 'active' : ''} onClick={() => dispatch({ type: 'ui.record-filter', filter: type })}>{recordTypeLabel(type)}</button>)}</nav>
    <div className="records-list">{records.map(record => <button key={record.id} className="record-row" onClick={() => dispatch({ type: 'ui.select-record', recordId: record.id })}><strong>{record.name}</strong><small>{recordTypeLabel(record.type)} · {recordAudienceLabel(record.audience)}</small><span>{record.type === 'progress' ? `${progress.done}/${progress.total} nhiệm vụ được chấp thuận · ${progress.percent}% hoàn thành.` : record.summary}</span></button>)}{!records.length && <div className="empty-state">Không có hồ sơ phù hợp.</div>}</div>
    {reports.length > 0 && <section className="accepted-reports"><h3>Báo cáo đã chấp thuận · nội bộ</h3>{reports.map(report => <details key={report.id}><summary>{state.tasks[report.taskId]?.title ?? report.taskId} · {state.archives[report.sessionId]?.agentName ?? state.sessions[report.sessionId]?.agentName ?? 'Phiên lưu trữ'}</summary><p>{report.content}</p></details>)}</section>}
    <p className="records-boundary">Dữ liệu workspace được lưu trong PostgreSQL · phiên terminal kết nối CLI Codex native.</p>
  </section>;
}
