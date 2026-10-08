'use client';

import { useStudio } from './StudioProvider';

export function Studio() {
  const { state } = useStudio();
  const workspace = state.ui.workspaceId ? state.workspaces[state.ui.workspaceId] : null;
  return <main className="welcome"><div className="brand">orc<span> / studio</span></div><p className="caps">ORC STUDIO · WORKSPACE DEMO</p><h1>{workspace?.name ?? 'Chưa chọn workspace'}</h1><p className="repo">{workspace?.repoPath ?? 'Chưa có workspace được cấp quyền'}</p><span className="demo-label">UI demo · chưa kết nối CLI</span></main>;
}
