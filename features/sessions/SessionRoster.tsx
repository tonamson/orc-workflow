'use client';

import { visibleActors } from '../studio/model/selectors';
import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';
import { sessionMetadata } from './metadata';
import { sessionDisplay } from './display';

function RosterRows({ sessions, state, dispatch }: { sessions: ReturnType<typeof visibleActors>; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  return <>{sessions.map(session => {
    const metadata = sessionMetadata(session);
    const display = sessionDisplay(state, session);
    return <button key={session.id} className="room-session" onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })}>
      <strong>{session.agentName}</strong><span className={`session-state ${display.tone}`}>{display.role} · {display.state}</span>
      <small>{display.task ? `Nhiệm vụ: ${display.task.title} · ` : ''}{session.provider} · {metadata.model} · {metadata.reasoningLabel}: {metadata.reasoningValue}</small>
    </button>;
  })}</>;
}

export function SessionRoster({ roomId, state, dispatch }: { roomId: string; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const archives = Object.values(state.archives).filter(session => session.roomId === roomId);
  return <><div className="room-roster"><RosterRows sessions={visibleActors(state, roomId)} state={state} dispatch={dispatch}/></div>{archives.length > 0 && <section className="session-archives"><h3>Phiên đã lưu trữ</h3>{archives.map(session => <details key={session.id}><summary>{session.agentName} · {session.provider} · {session.model ?? 'Chưa đồng bộ'}</summary><div className="panel-terminal">{session.messages.slice(-500).map(message => <div className="terminal-message" key={message.id}>{message.kind === 'input' ? '$ ' : ''}{message.text}</div>)}</div></details>)}</section>}</>;
}

export function WorkspaceSessionRoster({ roomIds, state, dispatch }: { roomIds: string[]; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  if (state.ui.role === 'client') return null;
  const sessions = roomIds.flatMap(roomId => visibleActors(state, roomId));
  if (!sessions.length) return null;
  return <section className="merged-session-roster" aria-label="Phiên agent và model"><header><strong>Phiên agent</strong><span>Model · reasoning · trạng thái</span></header><div className="room-roster"><RosterRows sessions={sessions} state={state} dispatch={dispatch}/></div></section>;
}
