'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppState, Dispatch, Provider, StudioEvent } from '../studio/model/types';
import { makePromptEvent, skillSuggestions } from './skills';
import { sessionMetadata } from './metadata';
import type { DemoAdapter } from '../demo/adapter';
import { AgentSprite } from '../office/AgentSprite';
import { formatSessionUpdate, sessionDisplay } from './display';

export function SessionPanel({ sessionId, state, dispatch, adapter }: { sessionId: string; state: AppState; dispatch: Dispatch<StudioEvent>; adapter: DemoAdapter }) {
  const session = state.sessions[sessionId];
  const [text, setText] = useState('');
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [session?.messages]);
  if (!session) return <div className="empty-state">Phiên này đã đóng hoặc không còn khả dụng.</div>;
  const metadata = sessionMetadata(session);
  const canSend = session.processConfirmed && session.lifecycle === 'active';
  const suggestions = skillSuggestions(session.provider, text.startsWith('$') || text.startsWith('/') ? text.split(/\s/, 1)[0] : '');
  const display = sessionDisplay(state, session);
  const task = display.task;
  const report = task ? Object.values(state.reports).filter(item => item.sessionId === sessionId && item.taskId === task.id).at(-1) : null;
  const send = (event: FormEvent) => {
    event.preventDefault();
    const prompt = makePromptEvent(state, sessionId, text);
    if (prompt) { dispatch(prompt); setText(''); }
  };
  const config = (provider: Provider) => dispatch({ type: 'session.config', sessionId, provider, model: provider === session.provider ? session.model : null, reasoning: provider === session.provider ? session.reasoning : { kind: 'unknown' } });
  const changeEffort = (value: string) => dispatch({ type: 'session.config', sessionId, provider: session.provider, model: session.model, reasoning: value ? { kind: 'effort', value } : { kind: 'unknown' } });
  const modelOptions: Record<Provider, string[]> = { codex: ['gpt-5-codex'], claude: ['claude-sonnet'], gemini: ['gemini-2.5-pro'], opencode: ['openai/gpt-5'] };
  return <div className="session-panel">
    <div className="session-panel-identity"><AgentSprite session={session} pose={session.role === 'supervisor' ? 'standing' : 'seated'} direction="right" animated={false}/><div><h2>{session.agentName}</h2><div className={`panel-tag ${display.tone}`}>{display.role} · {display.state}</div></div><img src={`/cli/${session.provider}.svg`} alt={`${session.provider} CLI`}/></div>
    <dl><div><dt>Nhiệm vụ</dt><dd>{task?.title ?? 'Chưa gán nhiệm vụ'}</dd></div><div><dt>Trạng thái nhiệm vụ</dt><dd>{display.taskState}</dd></div><div><dt>Cập nhật mô phỏng</dt><dd>{formatSessionUpdate(session.lastUpdate)}</dd></div></dl>
    {task?.status === 'assigned' && <button className="session-action" onClick={() => dispatch({ type: 'task.status', taskId: task.id, status: 'working' })}>Bắt đầu làm việc</button>}
    {task?.status === 'working' && <button className="session-action" onClick={() => dispatch({ type: 'task.status', taskId: task.id, status: 'approval' })}>Yêu cầu duyệt</button>}
    {task?.status === 'approval' && state.ui.role === 'ceo' && <div className="session-actions"><button onClick={() => adapter.respond(task.id, true)}>Duyệt yêu cầu</button><button onClick={() => adapter.respond(task.id, false)}>Từ chối</button></div>}
    {task && ['working', 'approval', 'blocked'].includes(task.status) && <button className="session-action" onClick={() => adapter.submitReport(sessionId)}>Gửi báo cáo mô phỏng</button>}
    {report && <section className="session-report"><h3>Báo cáo · {report.status === 'submitted' ? 'Đã gửi' : report.status === 'reviewed' ? 'Đã rà soát' : 'Đã chấp thuận'}</h3><p>{report.content}</p>{state.ui.role === 'ceo' && report.status === 'submitted' && <button onClick={() => dispatch({ type: 'report.reviewed', reportId: report.id })}>Rà soát báo cáo</button>}{state.ui.role === 'ceo' && report.status === 'reviewed' && <button onClick={() => dispatch({ type: 'report.accepted', reportId: report.id })}>Chấp thuận báo cáo</button>}</section>}
    {session.lifecycle === 'disconnected' ? <button className="session-action" onClick={() => dispatch({ type: 'session.reconnected', sessionId })}>Kết nối lại demo</button> : session.lifecycle === 'closing' ? <div className="session-actions"><button onClick={() => dispatch({ type: 'session.closed', sessionId })}>Xác nhận đóng</button><button onClick={() => dispatch({ type: 'session.close-failed', sessionId, message: 'CLI demo không xác nhận yêu cầu.' })}>Đóng thất bại</button></div> : <button className="session-action" onClick={() => adapter.close(sessionId)}>{session.lifecycle === 'error' ? 'Thử đóng lại' : 'Yêu cầu đóng phiên'}</button>}
    <dl><div><dt>Model</dt><dd>{metadata.model}</dd></div><div><dt>{metadata.reasoningLabel}</dt><dd>{metadata.reasoningValue}</dd></div><div><dt>Nguồn</dt><dd>Mô phỏng · chưa kết nối CLI</dd></div></dl>
    <details className="session-secondary"><summary>Cấu hình mô phỏng</summary>
      <label className="config-provider">CLI<select value={session.provider} onChange={event => config(event.target.value as Provider)} disabled={!session.processConfirmed}><option value="codex">Codex</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="opencode">OpenCode</option></select></label>
      <label className="config-provider">Model<select value={session.model ?? ''} onChange={event => dispatch({ type: 'session.config', sessionId, provider: session.provider, model: event.target.value || null, reasoning: session.reasoning })} disabled={!session.processConfirmed}><option value="">Chưa đồng bộ</option>{modelOptions[session.provider].map(model => <option key={model} value={model}>{model}</option>)}</select></label>
      {session.provider === 'codex' && <label className="config-provider">Effort<select value={session.reasoning.kind === 'effort' ? String(session.reasoning.value) : ''} onChange={event => changeEffort(event.target.value)} disabled={!session.processConfirmed}><option value="">Chưa đồng bộ</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>}
    </details>
    <section className="session-transcript"><h3>Terminal mô phỏng · {session.messages.length} dòng</h3>
      <div ref={transcriptRef} className="panel-terminal" aria-live="polite">{session.messages.map(message => <div key={message.id} className={`terminal-message ${message.kind}`}>{message.kind === 'input' ? '$ ' : 'MÔ PHỎNG · '}{message.text}</div>)}</div>
    </section>
    <form className="prompt-composer" onSubmit={send}><label htmlFor="session-prompt">Gửi prompt tới {session.agentName}</label><textarea id="session-prompt" value={text} onChange={event => setText(event.target.value)} disabled={!canSend} placeholder={canSend ? 'Nhập prompt…' : 'Phiên chưa sẵn sàng'} rows={4}/>
      {suggestions.length > 0 && <div className="skill-suggestions" aria-label="Gợi ý skill mô phỏng">{suggestions.map(item => <button type="button" key={item.id} title={item.description} onClick={() => setText(item.command + ' ')}>{item.command}<small>{item.label}</small></button>)}</div>}
      <button type="submit" disabled={!canSend || !text.trim()}>Gửi prompt</button>
    </form>
  </div>;
}
