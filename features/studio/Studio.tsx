'use client';

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { canSelectSession, visibleRecords, visibleRooms } from './model/selectors';
import type { ProjectRecord, Room, Session } from './model/types';
import { useStudio } from './StudioProvider';
import { AppShell } from './AppShell';
import { OfficeView } from '../office/RoomView';
import { createDemoAdapter } from '../demo/adapter';
import { DemoControls } from '../demo/DemoControls';
import { SessionPanel } from '../sessions/SessionPanel';
import { RecordPanel } from '../records/RecordPanel';
import '../records/records.css';
import '../sessions/sessions.css';
import './studio.css';
import '../office/office.css';

function sessionStatus(session: Session): string {
  const labels: Record<Session['lifecycle'], string> = { starting: 'Đang khởi động', active: 'Đang làm', closing: 'Đang đóng', disconnected: 'Mất kết nối', error: 'Lỗi phiên' };
  return labels[session.lifecycle];
}

export function Studio() {
  const { state, dispatch } = useStudio();
  const [departmentName, setDepartmentName] = useState('');
  const [creatingDepartment, setCreatingDepartment] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const adapter = useMemo(() => createDemoAdapter(() => stateRef.current, dispatch), [dispatch, state.ui.workspaceId]);
  useEffect(() => () => adapter.dispose(), [adapter]);
  const workspace = state.ui.workspaceId ? state.workspaces[state.ui.workspaceId] : null;
  const rooms = visibleRooms(state);
  const currentRoom = rooms.find(room => room.id === state.ui.roomId) ?? null;
  const search = state.ui.search.trim().toLocaleLowerCase();
  const matchingRooms = rooms.filter(room => !search || room.name.toLocaleLowerCase().includes(search));
  const currentRecords = currentRoom ? visibleRecords(state, currentRoom.id).filter(record => (!search || `${record.name} ${record.summary}`.toLocaleLowerCase().includes(search)) && (state.ui.recordFilter === 'all' || record.type === state.ui.recordFilter)) : [];
  const selectedSession = state.ui.selectedSessionId && canSelectSession(state, state.ui.selectedSessionId) ? state.sessions[state.ui.selectedSessionId] : null;
  const selectedRecord = state.ui.selectedRecordId && currentRoom ? visibleRecords(state, currentRoom.id).find(record => record.id === state.ui.selectedRecordId) : null;
  const workspaceSessionCount = Object.values(state.sessions).filter(session => session.workspaceId === workspace?.id).length;
  const serverSessionCount = Object.keys(state.sessions).length;
  const openRecord = (record: ProjectRecord) => dispatch({ type: 'ui.select-record', recordId: record.id });
  const roomCard = (room: Room) => {
    const members = state.ui.role === 'client' ? [] : Object.values(state.sessions).filter(session => session.roomId === room.id && session.processConfirmed);
    const records = visibleRecords(state, room.id);
    return <button className="office-card" key={room.id} onClick={() => dispatch({ type: 'ui.navigate', roomId: room.id })}>
      <span className="room-kind">{room.kind === 'work' ? 'DEPARTMENT' : room.kind === 'supervisor' ? 'SUPERVISOR' : 'PROJECT RECORDS'}</span>
      <h2>{room.name}</h2>
      <p>{room.kind === 'work' ? `${members.length} phiên · tối đa 3 mỗi phòng` : `${records.length} hồ sơ khả dụng`}</p>
      {room.kind === 'work' && <span className="session-chips">{members.map(session => <span className="session-chip" key={session.id}>{session.agentName} · {session.provider}</span>)}</span>}
    </button>;
  };
  const clientContent = !currentRoom ? <div className="office-overview">{matchingRooms.map(roomCard)}{!matchingRooms.length && <div className="empty-state">Không tìm thấy phòng phù hợp.</div>}</div>
    : currentRoom.kind === 'work' || currentRoom.kind === 'supervisor' ? <div className="room-detail">
      <span className="room-kind">{currentRoom.kind === 'work' ? 'PHÒNG BAN · TỐI ĐA 3 PHIÊN' : 'ĐIỀU PHỐI'}</span><h2>{currentRoom.name}</h2><p>{currentRoom.kind === 'work' ? 'Mỗi nhân vật tương ứng một phiên được xác nhận.' : 'Phòng chỉ hiển thị phiên Supervisor đang tồn tại.'}</p>
      <div className="room-sessions">{Object.values(state.sessions).filter(session => session.roomId === currentRoom.id && session.processConfirmed).map(session => <button className="room-session" key={session.id} onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })}><strong>{session.agentName}</strong><span>{sessionStatus(session)}</span><small>{session.provider} · {session.model ?? 'Chưa đồng bộ'}</small></button>)}{!Object.values(state.sessions).some(session => session.roomId === currentRoom.id && session.processConfirmed) && <div className="empty-state">0 phiên đang chạy · phòng cấu hình không tự mở CLI.</div>}</div>
    </div> : <div className="record-list">{currentRecords.map(record => <button className="record-row" key={record.id} onClick={() => openRecord(record)}><strong>{record.name}</strong><small>{record.type} · {record.audience === 'shared' ? 'Được chia sẻ' : record.audience === 'ceo' ? 'CEO' : 'Nội bộ'}</small></button>)}{!currentRecords.length && <div className="empty-state">Không có hồ sơ phù hợp.</div>}</div>;

  const selectedPanel = selectedSession ? <SessionPanel key={selectedSession.id} sessionId={selectedSession.id} state={state} dispatch={dispatch} adapter={adapter}/> : selectedRecord ? <RecordPanel key={selectedRecord.id} recordId={selectedRecord.id} state={state} dispatch={dispatch}/> : <div className="empty-state">Chọn một phiên hoặc hồ sơ để xem chi tiết.</div>;

  return <AppShell panel={selectedPanel}>
    {!workspace && state.ui.role === 'client' ? <section className="no-grant"><div className="workspace-head"><div><p className="caps">WORKSPACE ACCESS</p><h1>Chưa được cấp quyền truy cập workspace</h1><p className="subtitle">Tài khoản demo này chưa được cấp workspace nào.</p></div></div><div className="empty-state">Không có dự án hoặc hồ sơ nào được hiển thị.</div></section> : <>
      <header className="workspace-head">
        <div><h1>{currentRoom?.name ?? (state.ui.role === 'client' ? 'Phòng khách.' : 'Văn phòng.')}</h1><p className="subtitle">{workspace?.name} / {state.ui.role === 'client' ? 'Hồ sơ được chia sẻ' : 'Supervisor → Lead → Peer'}</p><span className="tiny"><i className="dot"/>{state.ui.role === 'client' ? `${currentRecords.length} hồ sơ được chia sẻ` : `${workspaceSessionCount} phiên workspace · ${serverSessionCount}/${state.capacity} slot máy đang dùng`}</span></div>
        {state.ui.role !== 'client' && <div className="head-controls"><button className={`mode-button ${state.ui.officeMode === 'merged' ? 'active' : ''}`} onClick={() => dispatch({ type: 'ui.mode', mode: 'merged' })}>Văn phòng lớn</button><button className={`mode-button ${state.ui.officeMode === 'cards' ? 'active' : ''}`} onClick={() => dispatch({ type: 'ui.mode', mode: 'cards' })}>Từng phòng</button></div>}
      </header>
      <nav className="room-nav" aria-label="Phòng trong workspace">
        <button className={!currentRoom ? 'active' : ''} onClick={() => dispatch({ type: 'ui.navigate', roomId: null })}>Tổng quan</button>
        {rooms.map(room => <button key={room.id} className={currentRoom?.id === room.id ? 'active' : ''} onClick={() => dispatch({ type: 'ui.navigate', roomId: room.id })}>{room.name}</button>)}
      </nav>
      <div className="workspace-tools">
        <input value={state.ui.search} onChange={event => dispatch({ type: 'ui.search', search: event.target.value })} placeholder={state.ui.role === 'client' ? 'Tìm hồ sơ được chia sẻ…' : 'Tìm phòng hoặc hồ sơ…'} aria-label="Tìm kiếm" />
        {state.ui.role === 'client' && <select aria-label="Lọc loại hồ sơ" value={state.ui.recordFilter} onChange={event => dispatch({ type: 'ui.record-filter', filter: event.target.value })}><option value="all">Tất cả hồ sơ</option><option value="contract">Hợp đồng</option><option value="minutes">Biên bản</option><option value="progress">Tiến độ</option><option value="delivery">Bàn giao</option></select>}
        {state.ui.role !== 'client' && <select aria-label="Số phòng ban demo" value={String(Object.values(state.departments).filter(department => department.workspaceId === workspace?.id).length)} onChange={event => dispatch({ type: 'ui.departments-resize', count: Number(event.target.value) })}><option value="0">0 phòng ban</option><option value="2">2 phòng ban</option><option value="8">8 phòng ban</option><option value="24">24 phòng ban</option><option value="64">64 phòng ban</option></select>}
        {state.ui.role !== 'client' && <button className="workspace-action" onClick={() => setCreatingDepartment(value => !value)}>+ Phòng ban</button>}
      </div>
      {creatingDepartment && state.ui.role !== 'client' && <div className="department-create"><input value={departmentName} onChange={event => setDepartmentName(event.target.value)} placeholder="Tên phòng mới" aria-label="Tên phòng ban mới"/><button className="workspace-action" onClick={() => { dispatch({ type: 'ui.department-create', name: departmentName }); setDepartmentName(''); setCreatingDepartment(false); }}>Tạo phòng</button></div>}
      {state.ui.role !== 'client' && <DemoControls state={state} dispatch={dispatch} adapter={adapter}/>}
      <section className="office-content">
        {state.ui.role !== 'client' ? <OfficeView state={state} dispatch={dispatch}/> : clientContent}
      </section>
    </>}
  </AppShell>;
}
