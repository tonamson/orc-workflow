'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useStudio } from './StudioProvider';
import { workspaceConnectionLabel, type ServerHealth } from '../sessions/runtime-lifecycle';

type WorkspaceOption = { id: string; name: string; path: string; status: 'ready' | 'unavailable' };

export function AppShell({ children, panel, panelTone = 'terminal', workspaces, onWorkspaceChange, onOpenSettings, sessionCount = 0, runtimeStatus = 'Chưa kết nối CLI', serverHealth = 'available' }: { children: ReactNode; panel: ReactNode; panelTone?: 'terminal' | 'paper'; workspaces: WorkspaceOption[]; onWorkspaceChange: (id: string) => void; onOpenSettings: () => void; sessionCount?: number; runtimeStatus?: string; serverHealth?: ServerHealth }) {
  const { state, dispatch } = useStudio();
  const connectionLabel = workspaceConnectionLabel(sessionCount, runtimeStatus, serverHealth);
  const [fullscreen, setFullscreen] = useState(false);
  const panelOpen = state.ui.panelOpen;

  useEffect(() => { if (!panelOpen) setFullscreen(false); }, [panelOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.querySelector('dialog[open]')) return;
        if (event.target instanceof Element && event.target.closest('.xterm, input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
        if (fullscreen) setFullscreen(false);
        else if (panelOpen) dispatch({ type: 'ui.panel', open: false });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, fullscreen, panelOpen]);

  return <div className={`shell ${panelOpen ? '' : 'panel-collapsed'} ${fullscreen ? 'terminal-fullscreen' : ''}`}>
    <nav className="rail" aria-label="Điều hướng chính"><div className="orc-mark" aria-label="ORC"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><button className="current" aria-label="Mở terminal CLI" title="Terminal CLI" onClick={() => dispatch({ type: 'ui.panel', open: true })}>⌘</button><button className="settings-nav" aria-label="Cài đặt định tuyến agent" title="Cài đặt" onClick={onOpenSettings}>⚙</button></nav>
    <header className="top"><div className="brand">orc<span> / studio</span></div><label className="workspace-select"><span>WORKSPACE LOCAL</span><select aria-label="Workspace local" value={state.ui.workspaceId ?? ''} onChange={event => onWorkspaceChange(event.target.value)}><option value="">Chưa chọn</option>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="top-right"><span className="local"><i className={`dot ${serverHealth === 'available' && sessionCount ? 'online' : ''}`}/>{connectionLabel}</span><button className="open-terminal" onClick={() => dispatch({ type: 'ui.panel', open: true })}>Terminal CLI</button><button className="open-settings" onClick={onOpenSettings}>Cài đặt</button></div></header>
    <main className="workspace">{children}<nav className="mobile-nav" aria-label="Điều hướng di động"><button onClick={() => dispatch({ type: 'ui.panel', open: true })}>Mở terminal CLI</button><button onClick={onOpenSettings}>Cài đặt định tuyến</button></nav></main>
    <div className={`mobile-overlay ${panelOpen ? 'visible' : ''}`} onClick={() => dispatch({ type: 'ui.panel', open: false })} aria-hidden="true"/>
    <aside className={`rightpanel ${panelOpen ? 'open' : ''} ${fullscreen ? 'fullscreen' : ''}`} aria-label="Terminal CLI"><div className="sheet-handle"/><div className="panel-head"><span className="caps">TERMINAL CLI</span><div><button type="button" title={fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} aria-label={fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} onClick={() => setFullscreen(value => !value)}>⛶</button><button type="button" title="Đóng terminal" aria-label="Đóng terminal" onClick={() => { setFullscreen(false); dispatch({ type: 'ui.panel', open: false }); }}>×</button></div></div><div className={`panel-content ${panelTone === 'terminal' ? 'terminal-panel-content' : ''}`}>{panel}</div></aside>
    <footer className="activity"><span className="activity-icon">↳</span><div className="activity-body"><b>{workspaces.find(item => item.id === state.ui.workspaceId)?.name ?? 'Chưa có workspace'}</b><small>{connectionLabel}</small></div><time>LOCAL</time></footer>
  </div>;
}
