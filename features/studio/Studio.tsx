'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { canSelectSession, visibleRecords, visibleRooms } from './model/selectors';
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

export function Studio() {
  const { state, dispatch, saveStatus, loaded, retryLoad, retrySave, pendingCount } = useStudio();
  const [departmentName, setDepartmentName] = useState('');
  const [creatingDepartment, setCreatingDepartment] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const adapter = useMemo(() => createDemoAdapter(() => stateRef.current, dispatch), [dispatch, state.ui.workspaceId]);
  useEffect(() => () => adapter.dispose(), [adapter]);
  const workspace = state.ui.workspaceId ? state.workspaces[state.ui.workspaceId] : null;
  const rooms = visibleRooms(state);
  const currentRoom = rooms.find(room => room.id === state.ui.roomId) ?? null;
  const selectedSession = state.ui.selectedSessionId && canSelectSession(state, state.ui.selectedSessionId) ? state.sessions[state.ui.selectedSessionId] : null;
  const selectedRecord = state.ui.selectedRecordId && currentRoom ? visibleRecords(state, currentRoom.id).find(record => record.id === state.ui.selectedRecordId) : null;
  const workspaceSessionCount = Object.values(state.sessions).filter(session => session.workspaceId === workspace?.id).length;
  const serverSessionCount = Object.keys(state.sessions).length;
  const departmentCount = Object.values(state.departments).filter(department => department.workspaceId === workspace?.id).length;
  const departmentSizes = [...new Set([0, 2, 8, 24, 64, departmentCount])].sort((left, right) => left - right);

  const selectedPanel = !loaded ? <div className="empty-state">{saveStatus === 'error' ? 'Dữ liệu DB chưa tải; không hiển thị phiên mẫu.' : 'Đang tải chi tiết đã lưu…'}</div> : selectedSession ? <SessionPanel key={selectedSession.id} sessionId={selectedSession.id} state={state} dispatch={dispatch} adapter={adapter}/> : selectedRecord ? <RecordPanel key={selectedRecord.id} recordId={selectedRecord.id} state={state} dispatch={dispatch}/> : <div className="empty-state">Chọn một phiên hoặc hồ sơ để xem chi tiết.</div>;

  return <AppShell panel={selectedPanel}>
    {!loaded ? <div className="persistence-gate"><strong>{saveStatus === 'error' ? 'Không thể kết nối cơ sở dữ liệu.' : 'Đang tải workspace đã lưu…'}</strong>{saveStatus === 'error' && <button onClick={retryLoad}>Thử tải lại</button>}</div> : <>
      <div className={`persistence-status ${saveStatus}`} role="status">{saveStatus === 'saving' ? `Đang lưu thay đổi · ${pendingCount} đang chờ…` : saveStatus === 'error' ? <>Chưa lưu được thay đổi · {pendingCount} đang chờ. <button onClick={retrySave}>Thử lưu lại</button></> : 'Đã lưu'}</div>
    {!workspace && state.ui.role === 'client' ? <section className="no-grant"><div className="workspace-head"><div><p className="caps">WORKSPACE ACCESS</p><h1>Chưa được cấp quyền truy cập workspace</h1><p className="subtitle">Tài khoản demo này chưa được cấp workspace nào.</p></div></div><div className="empty-state">Không có dự án hoặc hồ sơ nào được hiển thị.</div></section> : <>
      <header className="workspace-head">
        <div><h1>{currentRoom?.name ?? (state.ui.role === 'client' ? 'Phòng khách.' : 'Văn phòng.')}</h1><p className="subtitle">{workspace?.name} / {state.ui.role === 'client' ? 'Hồ sơ được chia sẻ' : 'Không gian làm việc'}</p><span className="tiny"><i className="dot"/>{state.ui.role === 'client' ? `${visibleRecords(state, currentRoom?.id ?? '').length} hồ sơ được chia sẻ` : `${workspaceSessionCount} phiên · ${serverSessionCount}/${state.capacity} slot máy`}</span></div>
      </header>
      <nav className="room-nav" aria-label="Phòng trong workspace">
        <button className={!currentRoom ? 'active' : ''} onClick={() => dispatch({ type: 'ui.navigate', roomId: null })}>Tổng quan</button>
        {rooms.map(room => <button key={room.id} className={currentRoom?.id === room.id ? 'active' : ''} onClick={() => dispatch({ type: 'ui.navigate', roomId: room.id })}>{room.name}</button>)}
      </nav>
      <div className="workspace-tools">
        <input value={state.ui.search} onChange={event => dispatch({ type: 'ui.search', search: event.target.value })} placeholder={state.ui.role === 'client' ? 'Tìm hồ sơ được chia sẻ…' : 'Tìm phòng hoặc hồ sơ…'} aria-label="Tìm kiếm" />
        {state.ui.role !== 'client' && <div className="view-switch" role="group" aria-label="Kiểu hiển thị văn phòng"><button className={state.ui.officeMode === 'merged' ? 'active' : ''} onClick={() => dispatch({ type: 'ui.mode', mode: 'merged' })}>Bản đồ</button><button className={state.ui.officeMode === 'cards' ? 'active' : ''} onClick={() => dispatch({ type: 'ui.mode', mode: 'cards' })}>Từng phòng</button></div>}
        {state.ui.role === 'client' && <select aria-label="Lọc loại hồ sơ" value={state.ui.recordFilter} onChange={event => dispatch({ type: 'ui.record-filter', filter: event.target.value })}><option value="all">Tất cả hồ sơ</option><option value="contract">Hợp đồng</option><option value="minutes">Biên bản</option><option value="progress">Tiến độ</option><option value="delivery">Bàn giao</option></select>}
      </div>
      {state.ui.role !== 'client' && <details className="simulation-tools"><summary>Công cụ mô phỏng</summary><div className="simulation-tools-content">
        <div className="department-create"><label htmlFor="department-count">Số phòng ban</label><select id="department-count" aria-label="Số phòng ban demo" value={String(departmentCount)} onChange={event => dispatch({ type: 'ui.departments-resize', count: Number(event.target.value) })}>{departmentSizes.map(count => <option key={count} value={count}>{count}</option>)}</select><button className="workspace-action" onClick={() => setCreatingDepartment(value => !value)}>+ Thêm phòng ban</button></div>
        {creatingDepartment && <div className="department-create-form"><input value={departmentName} onChange={event => setDepartmentName(event.target.value)} placeholder="Tên phòng mới" aria-label="Tên phòng ban mới"/><button className="workspace-action" onClick={() => { dispatch({ type: 'ui.department-create', name: departmentName }); setDepartmentName(''); setCreatingDepartment(false); }}>Tạo phòng</button></div>}
        <DemoControls state={state} dispatch={dispatch} adapter={adapter}/>
      </div></details>}
      <section className="office-content">
        <OfficeView state={state} dispatch={dispatch}/>
      </section>
    </>}</>}
  </AppShell>;
}
