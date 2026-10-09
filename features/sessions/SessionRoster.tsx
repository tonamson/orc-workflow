'use client';

import { visibleActors } from '../studio/model/selectors';
import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';
import { sessionMetadata } from './metadata';
import { sessionDisplay } from './display';
import type { ServerHealth } from './runtime-lifecycle';

function RosterRows({ sessions, state, dispatch, serverHealth }: { sessions: ReturnType<typeof visibleActors>; state: AppState; dispatch: Dispatch<StudioEvent>; serverHealth: ServerHealth }) {
  return <>{sessions.map(session => {
    const metadata = sessionMetadata(session);
    const current = sessionDisplay(state, session);
    const display = session.nativeRuntime && session.processConfirmed && serverHealth === 'unknown'
      ? { ...current, state: 'Chưa xác minh · mất kết nối máy chủ', tone: 'disconnected' }
      : current;
    return <button key={session.id} className="room-session" onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })}>
      <strong>{session.agentName}</strong><span className={`session-state ${display.tone}`}>{display.role} · {display.state}</span>
      <small>{display.task ? `Nhiệm vụ: ${display.task.title} · ` : ''}{session.provider} · {metadata.model} · {metadata.reasoningLabel}: {metadata.reasoningValue}</small>
    </button>;
  })}</>;
}

export function SessionRoster({ roomId, state, dispatch, serverHealth = 'available' }: { roomId: string; state: AppState; dispatch: Dispatch<StudioEvent>; serverHealth?: ServerHealth }) {
  const archives = Object.values(state.archives).filter(session => session.roomId === roomId);
  return <><div className="room-roster"><RosterRows sessions={visibleActors(state, roomId).filter(session => session.processConfirmed)} state={state} dispatch={dispatch} serverHealth={serverHealth}/></div>{archives.length > 0 && <section className="session-archives"><h3>Phiên đã lưu trữ</h3>{archives.map(session => <details key={session.id}><summary>{session.agentName} · {session.provider} · {session.model ?? 'Chưa đồng bộ'}</summary><div className="panel-terminal">{session.messages.slice(-500).map(message => <div className="terminal-message" key={message.id}>{message.kind === 'input' ? '$ ' : ''}{message.text}</div>)}</div></details>)}</section>}</>;
}

export function WorkspaceSessionRoster({ roomIds, state, dispatch, serverHealth = 'available' }: { roomIds: string[]; state: AppState; dispatch: Dispatch<StudioEvent>; serverHealth?: ServerHealth }) {
  if (state.ui.role === 'client') return null;
  const sessions = roomIds.flatMap(roomId => visibleActors(state, roomId)).filter(session => session.processConfirmed);
  if (!sessions.length) return null;
  return <details className="merged-session-roster"><summary><strong>Phiên agent · {sessions.length}</strong><span>Model · suy luận · trạng thái</span></summary><div className="room-roster"><RosterRows sessions={sessions} state={state} dispatch={dispatch} serverHealth={serverHealth}/></div></details>;
}
