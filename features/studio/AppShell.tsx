'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { canAccessWorkspace, visibleWorkspaces } from './model/selectors';
import type { Role } from './model/types';
import { useStudio } from './StudioProvider';

export function AppShell({ children, panel }: { children: ReactNode; panel: ReactNode }) {
  const { state, dispatch } = useStudio();
  const workspace = state.ui.workspaceId ? state.workspaces[state.ui.workspaceId] : null;
  const options = visibleWorkspaces(state);
  const priorOpen = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelOpen = state.ui.panelOpen;

  useEffect(() => {
    if (panelOpen && !priorOpen.current && document.activeElement instanceof HTMLElement) returnFocus.current = document.activeElement;
    if (!panelOpen && priorOpen.current) returnFocus.current?.focus();
    priorOpen.current = panelOpen;
  }, [panelOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panelOpen) dispatch({ type: 'ui.panel', open: false });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, panelOpen]);

  const setRole = (role: Role) => dispatch({ type: 'ui.role', role });
  return <div className={`shell ${panelOpen ? '' : 'panel-collapsed'}`}>
    <nav className="rail" aria-label="Điều hướng chính">
      <div className="orc-mark" aria-label="ORC"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
      <button className="current" aria-label="Văn phòng" title="Văn phòng" onClick={() => dispatch({ type: 'ui.navigate', roomId: null })}>▦</button>
      <button aria-label="Phòng hồ sơ" title="Hồ sơ" onClick={() => dispatch({ type: 'ui.navigate', roomId: state.ui.role === 'client' ? state.ui.roomId : `${state.ui.workspaceId}-lobby` })}>▤</button>
      <button aria-label="Phiên agent" title="Phiên agent" onClick={() => { const session = Object.values(state.sessions).find(item => canAccessWorkspace(state, item.workspaceId)); if (session) dispatch({ type: 'ui.select-session', sessionId: session.id }); }}>♙</button>
      <span className="spacer"/>
      <span className="user" aria-label="Tài khoản mô phỏng">OR</span>
    </nav>
    <header className="top">
      <div className="brand">orc<span> / studio</span></div>
      <label className="workspace-select"><span>WORKSPACE · DEMO</span><select aria-label="Workspace demo" value={state.ui.workspaceId ?? ''} onChange={event => dispatch({ type: 'ui.workspace', workspaceId: event.target.value || null })}>
        {options.length ? options.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">Chưa được cấp quyền</option>}
      </select></label>
      <span className="repo-label">{workspace?.repoPath ?? 'Không có workspace được cấp quyền'}</span>
      <div className="top-right">
        <label className="role-preview"><span>VAI TRÒ · UI</span><select aria-label="Vai trò xem trước" value={state.ui.role} onChange={event => setRole(event.target.value as Role)}><option value="ceo">CEO</option><option value="employee">Nhân viên</option><option value="client">Khách hàng</option></select></label>
        {state.ui.role === 'client' && <label className="role-preview client-preview"><span>TÀI KHOẢN DEMO</span><select aria-label="Tài khoản khách hàng demo" value={state.ui.clientViewerId ?? ''} onChange={event => dispatch({ type: 'ui.client', clientViewerId: event.target.value || null })}>{Object.values(state.clientViewers).map(viewer => <option key={viewer.id} value={viewer.id}>{viewer.id}</option>)}</select></label>}
        <span className="local"><i className="dot"/>UI DEMO · CHƯA KẾT NỐI CLI</span>
      </div>
    </header>
    <main className="workspace">
      {children}
      <nav className="mobile-nav" aria-label="Điều hướng di động">
        <button onClick={() => dispatch({ type: 'ui.navigate', roomId: null })}>Văn phòng</button>
        <button onClick={() => dispatch({ type: 'ui.navigate', roomId: state.ui.role === 'client' ? state.ui.roomId : `${state.ui.workspaceId}-lobby` })}>Hồ sơ</button>
        <button onClick={() => dispatch({ type: 'ui.panel', open: !panelOpen })}>Chi tiết</button>
      </nav>
    </main>
    <div className={`mobile-overlay ${panelOpen ? 'visible' : ''}`} onClick={() => dispatch({ type: 'ui.panel', open: false })} aria-hidden="true"/>
    <aside className={`rightpanel ${panelOpen ? 'open' : ''}`} aria-label="Chi tiết đang chọn">
      <div className="sheet-handle"/>
      <div className="panel-head"><span className="caps">CHI TIẾT · DEMO</span><button type="button" title="Đóng panel" aria-label="Đóng panel" onClick={() => dispatch({ type: 'ui.panel', open: false })}>×</button></div>
      <div className="panel-content">{panel}</div>
    </aside>
    <footer className="activity"><span className="activity-icon">↳</span><div className="activity-body"><b>{workspace?.name ?? 'Workspace chưa được cấp'}</b><small>Dữ liệu mô phỏng · không chạy CLI · không lưu hồ sơ thành tệp</small></div><time>DEMO</time></footer>
  </div>;
}
