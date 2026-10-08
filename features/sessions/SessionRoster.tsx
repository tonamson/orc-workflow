'use client';

import { visibleActors } from '../studio/model/selectors';
import type { AppState, Dispatch, StudioEvent } from '../studio/model/types';
import { sessionMetadata } from './metadata';

export function SessionRoster({ roomId, state, dispatch }: { roomId: string; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const archives = Object.values(state.archives).filter(session => session.roomId === roomId);
  return <><div className="room-roster">{visibleActors(state, roomId).map(session => {
    const metadata = sessionMetadata(session);
    return <button key={session.id} className="room-session" onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })}>
      <strong>{session.agentName}</strong><span>{session.role} · {session.lifecycle}</span>
      <small>{session.provider} · {metadata.model} · {metadata.reasoningLabel}: {metadata.reasoningValue}</small>
    </button>;
  })}</div>{archives.length > 0 && <section className="session-archives"><h3>Phiên đã lưu trữ</h3>{archives.map(session => <details key={session.id}><summary>{session.agentName} · {session.provider} · {session.model ?? 'Chưa đồng bộ'}</summary><div className="panel-terminal">{session.messages.slice(-500).map(message => <div className="terminal-message" key={message.id}>{message.kind === 'input' ? '$ ' : ''}{message.text}</div>)}</div></details>)}</section>}</>;
}
