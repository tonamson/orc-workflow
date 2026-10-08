'use client';

import { useState, type FormEvent } from 'react';
import type { AppState, Dispatch, Provider, StudioEvent } from '../studio/model/types';
import { makePromptEvent, skillSuggestions } from './skills';
import { sessionMetadata } from './metadata';

export function SessionPanel({ sessionId, state, dispatch }: { sessionId: string; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const session = state.sessions[sessionId];
  const [text, setText] = useState('');
  if (!session) return <div className="empty-state">Phiên này đã đóng hoặc không còn khả dụng.</div>;
  const metadata = sessionMetadata(session);
  const canSend = session.processConfirmed && session.lifecycle === 'active';
  const suggestions = skillSuggestions(session.provider, text.startsWith('$') || text.startsWith('/') ? text.split(/\s/, 1)[0] : '');
  const send = (event: FormEvent) => {
    event.preventDefault();
    const prompt = makePromptEvent(state, sessionId, text);
    if (prompt) { dispatch(prompt); setText(''); }
  };
  const config = (provider: Provider) => dispatch({ type: 'session.config', sessionId, provider, model: provider === session.provider ? session.model : null, reasoning: provider === session.provider ? session.reasoning : { kind: 'unknown' } });
  const modelOptions: Record<Provider, string[]> = { codex: ['gpt-5-codex'], claude: ['claude-sonnet'], gemini: ['gemini-2.5-pro'], opencode: ['openai/gpt-5'] };
  return <div className="session-panel">
    <h2>{session.agentName}</h2><div className="panel-tag">{session.role.toLocaleUpperCase()} · {session.lifecycle.toLocaleUpperCase()} · {session.provider.toLocaleUpperCase()}</div>
    <dl><div><dt>Model</dt><dd>{metadata.model}</dd></div><div><dt>{metadata.reasoningLabel}</dt><dd>{metadata.reasoningValue}</dd></div><div><dt>Nguồn</dt><dd>Mô phỏng · chưa kết nối CLI</dd></div></dl>
    <label className="config-provider">CLI demo<select value={session.provider} onChange={event => config(event.target.value as Provider)} disabled={!session.processConfirmed}><option value="codex">Codex</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="opencode">OpenCode</option></select></label>
    <label className="config-provider">Model demo<select value={session.model ?? ''} onChange={event => dispatch({ type: 'session.config', sessionId, provider: session.provider, model: event.target.value || null, reasoning: session.reasoning })} disabled={!session.processConfirmed}><option value="">Chưa đồng bộ</option>{modelOptions[session.provider].map(model => <option key={model} value={model}>{model}</option>)}</select></label>
    <h3>Terminal mô phỏng</h3>
    <div className="panel-terminal" aria-live="polite">{session.messages.slice(-500).map(message => <div key={message.id} className={`terminal-message ${message.kind}`}>{message.kind === 'input' ? '$ ' : ''}{message.text}</div>)}</div>
    <form className="prompt-composer" onSubmit={send}><label htmlFor="session-prompt">Gửi prompt tới {session.agentName}</label><textarea id="session-prompt" value={text} onChange={event => setText(event.target.value)} disabled={!canSend} placeholder={canSend ? 'Nhập prompt…' : 'Phiên chưa sẵn sàng'} rows={4}/>
      {suggestions.length > 0 && <div className="skill-suggestions" aria-label="Gợi ý skill mô phỏng">{suggestions.map(item => <button type="button" key={item.id} title={item.description} onClick={() => setText(item.command + ' ')}>{item.command}<small>{item.label}</small></button>)}</div>}
      <button type="submit" disabled={!canSend || !text.trim()}>Gửi prompt</button>
    </form>
  </div>;
}
