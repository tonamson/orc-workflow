'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from './StudioProvider';
import { AppShell } from './AppShell';
import { OfficeView } from '../office/RoomView';
import { TerminalWorkspace, type RuntimeRun } from '../sessions/TerminalWorkspace';
import { advanceWorkspaceScope, isWorkspaceScopeCurrent, runtimeStatusLabel, type ServerHealth, type WorkspaceScope } from '../sessions/runtime-lifecycle';
import { visibleRooms, visibleRecords } from './model/selectors';
import { RecordPanel } from '../records/RecordPanel';
import { ServerDirectoryPicker } from './ServerDirectoryPicker';
import { RoutingSettings } from '../settings/RoutingSettings';
import '../records/records.css';
import '../sessions/sessions.css';
import './studio.css';
import '../office/office.css';

type RuntimeWorkspace = { id: string; name: string; path: string; status: 'ready' | 'unavailable' };

export function Studio() {
  const { state, dispatch, saveStatus, loaded, retryLoad, retrySave, pendingCount } = useStudio();
  const [workspaces, setWorkspaces] = useState<RuntimeWorkspace[]>([]);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [registering, setRegistering] = useState(false);
  const [run, setRun] = useState<RuntimeRun | null>(null);
  const [runtimeRuns, setRuntimeRuns] = useState<RuntimeRun[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverHealth, setServerHealth] = useState<ServerHealth>('checking');

  const refreshWorkspaces = async () => {
    const response = await fetch('/api/runtime/workspaces', { cache: 'no-store' });
    if (!response.ok) throw new Error('workspace_list_failed');
    const result = await response.json() as RuntimeWorkspace[] | { workspaces: RuntimeWorkspace[] };
    const list = Array.isArray(result) ? result : result.workspaces;
    setWorkspaces(list);
    setServerHealth('available');
    dispatch({ type: 'runtime.workspaces', workspaces: list });
    if (!state.ui.workspaceId && list[0]) dispatch({ type: 'ui.workspace', workspaceId: list[0].id });
  };

  useEffect(() => { void refreshWorkspaces().catch(() => { setServerHealth('unknown'); setWorkspaceError('Không tải được danh sách workspace từ máy chủ.'); }); }, []);

  const registerWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    setRegistering(true); setWorkspaceError('');
    let serverReached = false;
    try {
      const response = await fetch('/api/runtime/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: workspaceName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, ''), name: workspaceName.trim(), path: workspacePath.trim() }) });
      serverReached = true; setServerHealth('available');
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Không thể đăng ký thư mục này.');
      const workspace = result.workspace ?? result;
      const next = [...workspaces.filter(item => item.id !== workspace.id), workspace as RuntimeWorkspace];
      setWorkspaces(next); setServerHealth('available'); dispatch({ type: 'runtime.workspaces', workspaces: next }); dispatch({ type: 'ui.workspace', workspaceId: workspace.id });
      setWorkspaceName(''); setWorkspacePath('');
    } catch (error) { if (!serverReached) setServerHealth('unknown'); setWorkspaceError(error instanceof Error ? error.message : 'Không thể kết nối máy chủ runtime.'); }
    finally { setRegistering(false); }
  };

  const workspace = state.ui.workspaceId ? workspaces.find(item => item.id === state.ui.workspaceId) : null;
  const workspaceScopeRef = useRef<WorkspaceScope>({ workspaceId: null, generation: 0 });
  workspaceScopeRef.current = advanceWorkspaceScope(workspaceScopeRef.current, workspace?.id ?? null);
  const workspaceScope = workspaceScopeRef.current;
  const scopeIsCurrent = useMemo(() => (mounted = true) => isWorkspaceScopeCurrent(workspaceScope, workspaceScopeRef.current, mounted), [workspaceScope.generation]);
  const onRunChange = useMemo(() => (next: RuntimeRun | null) => {
    if (!isWorkspaceScopeCurrent(workspaceScope, workspaceScopeRef.current)) return;
    if (next && next.workspaceId !== workspaceScope.workspaceId) return;
    setRun(next);
    if (next) dispatch({ type: 'runtime.run', run: next });
  }, [dispatch, workspaceScope.generation]);
  const workspaceRuntimeRuns = useMemo(() => runtimeRuns.filter(item => item.workspaceId === workspace?.id), [runtimeRuns, workspace?.id]);
  useEffect(() => {
    const workspaceId = workspace?.id;
    if (!workspaceId) {
      setRuntimeRuns([]);
      dispatch({ type: 'runtime.runs', workspaceId: null, runs: [] });
      return;
    }
    setServerHealth('checking');
    let alive = true;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(`/api/runtime/runs?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('run_history_unavailable');
        const body = await response.json() as { runs?: RuntimeRun[] } | RuntimeRun[];
        const runs = Array.isArray(body) ? body : body.runs ?? [];
        if (!alive) return;
        setServerHealth('available');
        setRuntimeRuns(runs);
        dispatch({ type: 'runtime.runs', workspaceId, runs });
      } catch {
        // Keep the last server-confirmed office projection during brief API disconnects.
        if (alive && !controller.signal.aborted) setServerHealth('unknown');
      } finally {
        if (alive) timer = window.setTimeout(() => { void refresh(); }, 2000);
      }
    };
    void refresh();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); controller?.abort(); };
  }, [workspace?.id, dispatch]);
  const rooms = visibleRooms(state);
  const currentRoom = rooms.find(room => room.id === state.ui.roomId) ?? null;
  const selectedRecord = state.ui.selectedRecordId && currentRoom ? visibleRecords(state, currentRoom.id).find(record => record.id === state.ui.selectedRecordId) : null;
  const selectedPanel = selectedRecord ? <RecordPanel recordId={selectedRecord.id} state={state} dispatch={dispatch}/> : <TerminalWorkspace key={`${workspaceScope.workspaceId ?? 'none'}:${workspaceScope.generation}`} workspace={workspace ?? null} historyRuns={workspaceRuntimeRuns} selectedSessionId={state.ui.selectedSessionId} scopeIsCurrent={scopeIsCurrent} serverHealth={serverHealth} onRunChange={onRunChange} onOpenSettings={() => setSettingsOpen(true)} onClearSelectedSession={() => { dispatch({ type: 'ui.select-session', sessionId: null }); dispatch({ type: 'ui.panel', open: true }); }}/>;
  const workspaceRuntimeSessions = workspace ? Object.values(state.sessions).filter(session => session.nativeRuntime && session.workspaceId === workspace.id && session.processConfirmed) : [];
  const sessionCount = workspaceRuntimeSessions.length;
  const workspaceRuntimeStatus = workspaceRuntimeSessions.some(session => session.lifecycle === 'active') ? 'active' : workspaceRuntimeSessions.some(session => session.lifecycle === 'closing') ? 'closing' : workspaceRuntimeSessions.some(session => session.lifecycle === 'starting') ? 'starting' : undefined;
  const runtimeStatus = workspaceRuntimeStatus ?? (run && run.workspaceId === workspace?.id ? run.status : undefined);

  return <><AppShell panel={selectedPanel} panelTone={selectedRecord ? 'paper' : 'terminal'} workspaces={workspaces} sessionCount={sessionCount} runtimeStatus={runtimeStatusLabel(runtimeStatus)} serverHealth={serverHealth} onOpenSettings={() => setSettingsOpen(true)} onWorkspaceChange={id => dispatch({ type: 'ui.workspace', workspaceId: id || null })}>
    {!loaded ? <div className="persistence-gate"><strong>{saveStatus === 'error' ? 'Không thể kết nối cơ sở dữ liệu.' : 'Đang tải dữ liệu đã lưu…'}</strong>{saveStatus === 'error' && <button onClick={retryLoad}>Thử tải lại</button>}</div> : <div className={`persistence-status ${saveStatus}`} role="status">{saveStatus === 'saving' ? `Đang lưu · ${pendingCount} đang chờ…` : saveStatus === 'error' ? <>Chưa lưu được · {pendingCount} đang chờ. <button onClick={retrySave}>Thử lưu lại</button></> : 'Đã lưu'}</div>}
    <header className="workspace-head"><div><h1>{workspace?.name ?? 'Văn phòng ORC'}</h1><p className="subtitle">{workspace ? workspace.path : 'Đăng ký thư mục mã nguồn để bắt đầu'}</p><span className="tiny"><i className="dot"/>{workspace ? `${workspace.status === 'ready' ? 'Workspace sẵn sàng' : 'Thư mục không khả dụng'} · ${Object.values(state.sessions).filter(session => session.workspaceId === workspace.id && session.processConfirmed).length} phiên CLI${serverHealth === 'unknown' ? ' · máy chủ mất kết nối, trạng thái chưa xác minh' : ''}` : 'Chưa có workspace hoặc tiến trình CLI'}</span></div></header>
    <section className="workspace-onboarding" aria-labelledby="workspace-onboarding-title">
      {workspaces.length ? <details><summary>Thêm workspace</summary><p>Chọn thư mục mã nguồn local để kết nối Codex.</p><WorkspaceRegistrationForm onSubmit={registerWorkspace} workspaceName={workspaceName} setWorkspaceName={setWorkspaceName} workspacePath={workspacePath} setWorkspacePath={setWorkspacePath} registering={registering} error={workspaceError}/><button type="button" className="workspace-action workspace-refresh" onClick={() => void refreshWorkspaces().catch(() => { setServerHealth('unknown'); setWorkspaceError('Không tải được danh sách workspace.'); })}>Làm mới danh sách</button></details> : <><div className="workspace-onboarding-head"><div><h2 id="workspace-onboarding-title">Bắt đầu với workspace</h2><p>Đăng ký một thư mục mã nguồn local để tạo phiên Codex.</p></div></div><WorkspaceRegistrationForm onSubmit={registerWorkspace} workspaceName={workspaceName} setWorkspaceName={setWorkspaceName} workspacePath={workspacePath} setWorkspacePath={setWorkspacePath} registering={registering} error={workspaceError}/></>}
    </section>
    <nav className="room-nav" aria-label="Phòng trong workspace"><button className={!currentRoom ? 'active' : ''} onClick={() => dispatch({ type: 'ui.navigate', roomId: null })}>Toàn cảnh</button>{rooms.map(room => <button key={room.id} className={currentRoom?.id === room.id ? 'active' : ''} onClick={() => dispatch({ type: 'ui.navigate', roomId: room.id })}>{room.name}</button>)}</nav>
    <div className="mobile-room-select">
      <label htmlFor="mobile-room-picker"><span>Chuyển phòng</span><select id="mobile-room-picker" value={currentRoom?.id ?? ''} onChange={event => dispatch({ type: 'ui.navigate', roomId: event.target.value || null })}>
        <option value="">Chọn phòng</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
      </select></label>
      <button type="button" className={!currentRoom ? 'active' : ''} aria-current={!currentRoom ? 'page' : undefined} onClick={() => dispatch({ type: 'ui.navigate', roomId: null })}>Toàn cảnh</button>
    </div>
    <div className="workspace-tools"><input value={state.ui.search} onChange={event => dispatch({ type: 'ui.search', search: event.target.value })} placeholder="Tìm phòng hoặc hồ sơ…" aria-label="Tìm kiếm"/><div className="view-switch" role="group" aria-label="Kiểu hiển thị văn phòng"><button className={state.ui.officeMode === 'merged' ? 'active' : ''} onClick={() => dispatch({ type: 'ui.mode', mode: 'merged' })}>Bản đồ</button><button className={state.ui.officeMode === 'cards' ? 'active' : ''} onClick={() => dispatch({ type: 'ui.mode', mode: 'cards' })}>Từng phòng</button></div></div>
    <section className="office-content" aria-label="Văn phòng pixel"><OfficeView state={state} dispatch={dispatch} serverHealth={serverHealth}/></section>
  </AppShell><RoutingSettings open={settingsOpen} onClose={() => setSettingsOpen(false)}/></>;
}

function WorkspaceRegistrationForm({ onSubmit, workspaceName, setWorkspaceName, workspacePath, setWorkspacePath, registering, error }: { onSubmit: (event: React.FormEvent) => void; workspaceName: string; setWorkspaceName: (value: string) => void; workspacePath: string; setWorkspacePath: (value: string) => void; registering: boolean; error: string }) {
  return <><form className="workspace-register" onSubmit={onSubmit}><label>Tên hiển thị<input required value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} placeholder="Ví dụ: ORC workflow"/></label><div className="workspace-path-field"><label htmlFor="workspace-server-path">Đường dẫn thư mục trên máy chủ</label><div className="workspace-path-control"><input id="workspace-server-path" aria-label="Đường dẫn thư mục trên máy chủ" required value={workspacePath} onChange={event => setWorkspacePath(event.target.value)} placeholder="/workspace/project" autoCapitalize="none"/><ServerDirectoryPicker onSelect={setWorkspacePath}/></div></div><button type="submit" disabled={registering || !workspaceName.trim() || !workspacePath.trim()}>{registering ? 'Đang kiểm tra…' : 'Đăng ký workspace'}</button></form>{error && <p className="workspace-error" role="alert">{error}</p>}</>;
}
