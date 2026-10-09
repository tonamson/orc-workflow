'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { createTerminalInputBatcher, type TerminalInputBatcher } from './terminal-input-batcher';
import { applyTerminalResizeInOrder, createTerminalResizeGate, isRuntimeEventAfterBaseline, replayTerminalEvents, runtimeStatusLabel, sessionConnectionLabel, shouldPollRuntimeRun, type ServerHealth } from './runtime-lifecycle';
import type { RoutingDecision, RoutingPolicySnapshot } from '../settings/routing-policy';

type Workspace = { id: string; name: string; path: string; status: 'ready' | 'unavailable' };
type RuntimeSession = { id: string; runId: string; role: 'supervisor' | 'peer'; status: string; processConfirmed: boolean; nativeConversationId: string | null; model: string | null; reasoningEffort: string | null; startedAt: string | null; lastSequence?: number };
export type RuntimeRun = { id: string; workspaceId: string; taskId: string; prompt: string; report: string | null; finalReport?: string | null; routingSnapshot?: RoutingPolicySnapshot | null; routingDecision?: RoutingDecision | null; phase: 'supervisor_delegation' | 'delegating' | 'peer_running' | 'supervisor_reporting' | 'done'; createdAt?: string; sessions: RuntimeSession[]; status: string };
type RuntimeEvent = { sequence: number; sessionId: string; kind: 'status' | 'output' | 'resize' | 'error' | 'exit'; text?: string; dataBase64?: string; status?: string; cols?: number; rows?: number };

const decodeOutput = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

function phaseLabel(phase: RuntimeRun['phase']): string {
  const labels: Record<RuntimeRun['phase'], string> = {
    supervisor_delegation: 'Supervisor nhận yêu cầu',
    delegating: 'Đang giao việc',
    peer_running: 'Agent đang làm',
    supervisor_reporting: 'Supervisor rà soát',
    done: 'Đã hoàn tất',
  };
  return labels[phase];
}

function runtimeErrorLabel(code?: string): string {
  if (code === 'runtime_busy') return 'Đang có tiến trình Codex khác chạy. Hãy tiếp tục hoặc đóng nhiệm vụ đó trước khi bắt đầu nhiệm vụ mới.';
  if (code === 'routing_settings_not_configured') return 'Chưa có cấu hình định tuyến toàn cục. Mở Cài đặt định tuyến và lưu cấu hình trước khi bắt đầu.';
  if (code === 'routing_provider_runner_unsupported') return 'Runner của provider này chưa được kết nối; chưa mở tiến trình CLI. Nếu đã có phiên Supervisor, phiên đó vẫn được giữ để sửa quyết định.';
  if (code === 'routing_session_configuration_mismatch') return 'CLI native chưa xác nhận model hoặc effort đã cấu hình bằng /status. Tác vụ chưa được gửi; hãy kiểm tra model và effort trong cấu hình CLI rồi thử lại.';
  if (code === 'invalid_routing_decision') return 'Supervisor trả về quyết định định tuyến không hợp lệ hoặc effort chưa được cho phép. Phiên Supervisor vẫn mở; yêu cầu Supervisor trả lại JSON đúng cấu hình rồi thử giao việc lại.';
  return code ?? 'Không thể kết nối runtime.';
}

function hasConfirmedNativeProcess(session?: RuntimeSession): boolean {
  return session?.status === 'active' && session.processConfirmed;
}

export function TerminalWorkspace({ workspace, historyRuns, selectedSessionId, scopeIsCurrent, serverHealth, onRunChange, onClearSelectedSession, onOpenSettings }: { workspace: Workspace | null; historyRuns: RuntimeRun[]; selectedSessionId: string | null; scopeIsCurrent: (mounted?: boolean) => boolean; serverHealth: ServerHealth; onRunChange: (run: RuntimeRun | null) => void; onClearSelectedSession: () => void; onOpenSettings: () => void }) {
  const [taskTitle, setTaskTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [run, setRun] = useState<RuntimeRun | null>(null);
  const [history, setHistory] = useState<RuntimeRun[]>(historyRuns);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [terminalReady, setTerminalReady] = useState(false);
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [inputBlockedSessionId, setInputBlockedSessionId] = useState<string | null>(null);
  const inputBlockedSessionRef = useRef(inputBlockedSessionId);
  inputBlockedSessionRef.current = inputBlockedSessionId;
  const activeSession = run?.sessions.find(session => session.id === activeSessionId);
  const activeConnectionLabel = sessionConnectionLabel(activeSession?.status, activeSession?.processConfirmed ?? false, terminalConnected, serverHealth);
  const canResumeSession = !!run && run.phase !== 'done' && !!activeSession?.nativeConversationId && !activeSession.processConfirmed && ['interrupted', 'closed', 'error'].includes(activeSession.status);
  const runRef = useRef<RuntimeRun | null>(run);
  const onRunChangeRef = useRef(onRunChange);
  const scopeIsCurrentRef = useRef(scopeIsCurrent);
  const mountedRef = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  runRef.current = run;
  onRunChangeRef.current = onRunChange;
  scopeIsCurrentRef.current = scopeIsCurrent;
  activeSessionIdRef.current = activeSessionId;
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const activeIdRef = useRef('');
  const sequenceRef = useRef<Record<string, number>>({});
  const historyBaselineRef = useRef<Record<string, number>>({});
  const historyReplaySessionsRef = useRef(new Set<string>());
  const eventStreamOpenRef = useRef(new Set<string>());
  const recoveryQueues = useRef<Record<string, Promise<void>>>({});
  const resizeGateRef = useRef(createTerminalResizeGate());
  const blockedInput = useRef(new Set<string>());
  const connectedInput = useRef(new Set<string>());
  const sendInputRef = useRef<(sessionId: string, data: string) => void>(() => undefined);
  const inputBatcherRef = useRef<TerminalInputBatcher | null>(null);

  const requestTerminalResize = (terminal: Terminal, sessionId: string) => {
    const session = runRef.current?.sessions.find(item => item.id === sessionId);
    if (!hasConfirmedNativeProcess(session)) return;
    const processStartedAt = session?.startedAt ?? null;
    void resizeGateRef.current(sessionId, processStartedAt, terminal.cols, terminal.rows, async () => {
      const current = runRef.current?.sessions.find(item => item.id === sessionId);
      if (activeIdRef.current !== sessionId || !hasConfirmedNativeProcess(current) || current?.startedAt !== processStartedAt) return false;
      const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(sessionId)}/resize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows }) });
      return response.ok;
    }).catch(() => undefined);
  };

  const isCurrentWorkspace = () => mountedRef.current && scopeIsCurrentRef.current(mountedRef.current);
  const isCurrentRun = (runId: string) => isCurrentWorkspace() && runRef.current?.id === runId;
  const selectSession = (sessionId: string) => { activeSessionIdRef.current = sessionId; setActiveSessionId(sessionId); };

  useEffect(() => {
    mountedRef.current = true;
    inputBatcherRef.current = createTerminalInputBatcher(async (sessionId, data) => {
      const session = runRef.current?.sessions.find(item => item.id === sessionId);
      if (!isCurrentWorkspace() || !hasConfirmedNativeProcess(session) || !connectedInput.current.has(sessionId) || blockedInput.current.has(sessionId)) throw new Error('terminal_input_unavailable');
      const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(sessionId)}/input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      if (!response.ok) throw new Error('terminal_input_failed');
    }, {
      onFailure: sessionId => {
        blockedInput.current.add(sessionId);
        if (!isCurrentWorkspace()) return;
        inputBlockedSessionRef.current = sessionId;
        setInputBlockedSessionId(sessionId);
        setError('Lệnh terminal chưa được xác nhận. Đã tạm khóa nhập để tránh gửi lặp.');
      },
      onOverflow: sessionId => {
        blockedInput.current.add(sessionId);
        if (!isCurrentWorkspace()) return;
        inputBlockedSessionRef.current = sessionId;
        setInputBlockedSessionId(sessionId);
        setError('Bộ đệm nhập terminal đã đầy. Đã xóa phần chưa gửi và tạm khóa nhập để tránh gửi sai thứ tự.');
      },
    });
    return () => { mountedRef.current = false; inputBatcherRef.current?.dispose(); inputBatcherRef.current = null; };
  }, []);

  const syncNativeConnection = useCallback((sessionId: string) => {
    const session = runRef.current?.sessions.find(item => item.id === sessionId);
    const connected = eventStreamOpenRef.current.has(sessionId) && hasConfirmedNativeProcess(session);
    if (connected) connectedInput.current.add(sessionId);
    else connectedInput.current.delete(sessionId);
    if (activeIdRef.current === sessionId) setTerminalConnected(connected);
    return connected;
  }, []);

  sendInputRef.current = (sessionId, data) => {
    const session = runRef.current?.sessions.find(item => item.id === sessionId);
    if (!sessionId || !isCurrentWorkspace() || !hasConfirmedNativeProcess(session) || !connectedInput.current.has(sessionId) || blockedInput.current.has(sessionId)) return;
    inputBatcherRef.current?.enqueue(sessionId, data);
  };

  const writeEvent = useCallback((terminal: Terminal, event: RuntimeEvent) => {
    const previousSequence = sequenceRef.current[event.sessionId] ?? 0;
    if (event.sequence <= previousSequence) return;
    sequenceRef.current[event.sessionId] = Math.max(sequenceRef.current[event.sessionId] ?? 0, event.sequence);
    if (event.kind === 'output' && event.dataBase64) {
      terminal.write(decodeOutput(event.dataBase64));
    }
    else if (event.kind === 'resize' && Number.isInteger(event.cols) && Number.isInteger(event.rows)) {
      applyTerminalResizeInOrder(terminal, event.cols!, event.rows!);
    }
    else if (event.kind === 'error' && event.text && isRuntimeEventAfterBaseline(event.sequence, historyBaselineRef.current[event.sessionId] ?? 0)) setError(event.text);
    if (event.status && isRuntimeEventAfterBaseline(event.sequence, historyBaselineRef.current[event.sessionId] ?? 0)) {
      const current = runRef.current;
      if (current) {
        const sessions = current.sessions.map(session => session.id === event.sessionId ? { ...session, status: event.status! } : session);
        const next = { ...current, sessions };
        runRef.current = next; setRun(next); onRunChangeRef.current(next);
        syncNativeConnection(event.sessionId);
      }
    }
  }, [syncNativeConnection]);

  useEffect(() => {
    let alive = true;
    let resizeObserver: ResizeObserver | null = null;
    let inputSubscription: { dispose(): void } | null = null;
    let resizeTimer: number | null = null;
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      if (!alive || !hostRef.current) return;
      const terminal = new Terminal({ allowProposedApi: false, convertEol: false, cursorBlink: true, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 16, lineHeight: 1.45, theme: { background: '#182a20', foreground: '#dbe5d3', cursor: '#dbe5d3', selectionBackground: '#526f4c' }, scrollback: 5000 });
      const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(hostRef.current); fit.fit();
      terminalRef.current = terminal; fitRef.current = fit;
      setTerminalReady(true);
      inputSubscription = terminal.onData(data => sendInputRef.current(activeIdRef.current, data));
      resizeObserver = new ResizeObserver(() => {
        const sessionId = activeIdRef.current;
        if (sessionId && historyReplaySessionsRef.current.has(sessionId)) return;
        fit.fit();
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        if (sessionId && hasConfirmedNativeProcess(runRef.current?.sessions.find(session => session.id === sessionId))) resizeTimer = window.setTimeout(() => requestTerminalResize(terminal, sessionId), 120);
      });
      resizeObserver.observe(hostRef.current);
    })().catch(() => setError('Không thể khởi tạo giao diện terminal.'));
    return () => { alive = false; resizeObserver?.disconnect(); if (resizeTimer !== null) window.clearTimeout(resizeTimer); inputSubscription?.dispose(); terminalRef.current?.dispose(); terminalRef.current = null; fitRef.current = null; };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) { activeIdRef.current = ''; setTerminalConnected(false); return; }
    if (!activeSessionId) { activeIdRef.current = ''; setTerminalConnected(false); terminal.reset(); return; }
    activeIdRef.current = activeSessionId;
    setTerminalConnected(false);
    terminal.reset();
    historyReplaySessionsRef.current.add(activeSessionId);
    const selectedSession = runRef.current?.sessions.find(session => session.id === activeSessionId);
    const lastSequence = selectedSession?.lastSequence ?? 0;
    historyBaselineRef.current[activeSessionId] = lastSequence;
    sequenceRef.current[activeSessionId] = 0;
    let alive = true;
    const recoverThrough = (targetSequence: number) => {
      const previous = recoveryQueues.current[activeSessionId] ?? Promise.resolve();
      const recovery = previous.then(async () => {
        while (alive && (sequenceRef.current[activeSessionId] ?? 0) < targetSequence) {
          const before = sequenceRef.current[activeSessionId] ?? 0;
          const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(activeSessionId)}/events?after=${before}`, { cache: 'no-store' });
          if (!alive) return;
          if (!response.ok) throw new Error('event_replay_failed');
          const body = await response.json() as { events?: RuntimeEvent[] };
          if (!alive) return;
          const events = [...(body.events ?? [])].sort((left, right) => left.sequence - right.sequence);
          if (!events.length) break;
          await replayTerminalEvents(events.filter(event => event.sessionId === activeSessionId), event => writeEvent(terminal, event), () => new Promise(resolve => terminal.write(new Uint8Array(), resolve)), () => !alive || terminalRef.current !== terminal);
          if ((sequenceRef.current[activeSessionId] ?? 0) <= before) break;
        }
        if ((sequenceRef.current[activeSessionId] ?? 0) < targetSequence) throw new Error('event_gap_unresolved');
      }).catch(() => { if (alive) setError('Không thể khôi phục lịch sử terminal đã lưu.'); });
      recoveryQueues.current[activeSessionId] = recovery;
    };
    void fetch(`/api/runtime/sessions/${encodeURIComponent(activeSessionId)}/events?after=0`, { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('terminal_history_failed');
      const result = await response.json() as RuntimeEvent[] | { events: RuntimeEvent[] };
      const events = Array.isArray(result) ? result : result.events;
      if (alive && terminalRef.current === terminal) {
        await replayTerminalEvents(events, event => writeEvent(terminal, event), () => new Promise(resolve => terminal.write(new Uint8Array(), resolve)), () => !alive || terminalRef.current !== terminal);
      }
    }).then(() => {
      if (!alive) return;
      historyReplaySessionsRef.current.delete(activeSessionId);
      fitRef.current?.fit();
      const after = sequenceRef.current[activeSessionId] ?? 0;
      const stream = new EventSource(`/api/runtime/sessions/${encodeURIComponent(activeSessionId)}/events?after=${after}`);
      streamRef.current = stream;
      const receive = (message: Event) => { if (!alive || terminalRef.current !== terminal) return; try { const event = JSON.parse((message as MessageEvent<string>).data) as RuntimeEvent; if (event.sessionId !== activeSessionId) return; const last = sequenceRef.current[activeSessionId] ?? 0; if (event.sequence <= last) return; if (event.sequence > last + 1) recoverThrough(event.sequence); else writeEvent(terminal, event); } catch { setError('Sự kiện terminal không đúng định dạng.'); } };
      for (const kind of ['output', 'status', 'resize', 'error', 'exit']) stream.addEventListener(kind, receive);
      stream.onopen = () => {
        if (!alive) return;
        eventStreamOpenRef.current.add(activeSessionId);
        const nativeConnected = syncNativeConnection(activeSessionId);
        if (nativeConnected && !blockedInput.current.has(activeSessionId)) setError('');
        fitRef.current?.fit();
        const attachedTerminal = terminalRef.current;
        const session = runRef.current?.sessions.find(item => item.id === activeSessionId);
        if (attachedTerminal === terminal && nativeConnected && hasConfirmedNativeProcess(session)) requestTerminalResize(terminal, activeSessionId);
      };
      stream.onerror = () => {
        if (!alive) return;
        inputBatcherRef.current?.clear(activeSessionId);
        eventStreamOpenRef.current.delete(activeSessionId);
        syncNativeConnection(activeSessionId);
        const currentStatus = runRef.current?.sessions.find(session => session.id === activeSessionId)?.status;
        if (currentStatus && ['closed', 'error', 'interrupted'].includes(currentStatus)) {
          setError(runtimeStatusLabel(currentStatus));
          return;
        }
        setError('Đang khôi phục kết nối terminal…');
      };
    }).catch(() => { historyReplaySessionsRef.current.delete(activeSessionId); if (alive) setError('Không tải được lịch sử terminal đã lưu.'); });
    return () => { alive = false; inputBatcherRef.current?.clear(activeSessionId); historyReplaySessionsRef.current.delete(activeSessionId); activeIdRef.current = ''; eventStreamOpenRef.current.delete(activeSessionId); connectedInput.current.delete(activeSessionId); setTerminalConnected(false); streamRef.current?.close(); streamRef.current = null; };
  }, [activeSessionId, terminalReady, writeEvent, syncNativeConnection]);

  useEffect(() => { if (terminalRef.current) terminalRef.current.options.disableStdin = activeSession?.status !== 'active' || !terminalConnected || inputBlockedSessionId === activeSessionId; }, [activeSession?.status, activeSessionId, inputBlockedSessionId, terminalConnected]);

  useEffect(() => {
    if (!run || !shouldPollRuntimeRun(run.status)) return;
    let alive = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/runtime/runs/${encodeURIComponent(run.id)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json() as { run?: RuntimeRun };
        if (!alive || !body.run) return;
        runRef.current = body.run; setRun(body.run); onRunChangeRef.current(body.run);
        if (activeIdRef.current) syncNativeConnection(activeIdRef.current);
        setHistory(items => items.map(item => item.id === body.run!.id ? body.run! : item));
      } catch { /* SSE reports connection state; polling is only a lifecycle refresh. */ }
    };
    const timer = window.setInterval(() => { void poll(); }, 1500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [run?.id, run?.status, syncNativeConnection]);

  useEffect(() => {
    if (!selectedSessionId) return;
    if (run?.sessions.some(session => session.id === selectedSessionId)) { selectSession(selectedSessionId); return; }
    if (!workspace?.id) return;
    let alive = true;
    void fetch(`/api/runtime/sessions/${encodeURIComponent(selectedSessionId)}`, { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Không tải được phiên Codex đã chọn.');
      const body = await response.json() as { session?: RuntimeSession };
      if (!body.session?.runId) throw new Error('Phiên không có liên kết nhiệm vụ đã lưu.');
      const runResponse = await fetch(`/api/runtime/runs/${encodeURIComponent(body.session.runId)}`, { cache: 'no-store' });
      if (!runResponse.ok) throw new Error('Không tải được nhiệm vụ của phiên đã chọn.');
      const runBody = await runResponse.json() as { run?: RuntimeRun };
      if (!runBody.run || runBody.run.workspaceId !== workspace.id || !runBody.run.sessions.some(session => session.id === selectedSessionId)) throw new Error('Phiên không thuộc workspace đang mở.');
      if (!alive) return;
      runRef.current = runBody.run; setRun(runBody.run); onRunChange(runBody.run); setHistory(items => [runBody.run!, ...items.filter(item => item.id !== runBody.run!.id)]); selectSession(selectedSessionId);
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Không thể mở phiên Codex.'); });
    return () => { alive = false; };
  }, [selectedSessionId, run, workspace?.id, onRunChange]);

  const startRun = async (event: React.FormEvent) => {
    event.preventDefault(); if (!workspace || working) return;
    const workspaceId = workspace.id;
    const selectedRunId = runRef.current?.id ?? null;
    const isCurrentSelection = () => isCurrentWorkspace() && workspace?.id === workspaceId && (runRef.current?.id ?? null) === selectedRunId;
    setWorking(true); setError('');
    try {
      const response = await fetch('/api/runtime/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, taskId: taskTitle.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID(), prompt }) });
      const body = await response.json() as { run?: RuntimeRun; error?: string };
      if (!isCurrentSelection()) return;
      if (!response.ok) throw new Error(runtimeErrorLabel(body.error));
      const result = body.run;
      if (!result) throw new Error('Runtime không trả về phiên làm việc.');
      runRef.current = result; setRun(result); onRunChange(result); setHistory(items => [result, ...items.filter(item => item.id !== result.id)]); const supervisor = result.sessions.find(session => session.role === 'supervisor') ?? result.sessions[0];
      selectSession(supervisor?.id ?? ''); setTaskTitle(''); setPrompt('');
    } catch (cause) { if (isCurrentSelection()) setError(cause instanceof Error ? cause.message : 'Không thể khởi chạy runtime.'); }
    finally { if (isCurrentWorkspace()) setWorking(false); }
  };

  const closeRun = async () => {
    if (!run) return;
    const runId = run.id;
    const isRunSelected = () => isCurrentRun(runId);
    setWorking(true); setError('');
    try {
      const response = await fetch(`/api/runtime/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
      if (!isRunSelected()) return;
      if (!response.ok) throw new Error('Không thể đóng phiên.');
      const refreshed = await fetch(`/api/runtime/runs/${encodeURIComponent(runId)}`, { cache: 'no-store' });
      if (!isRunSelected()) return;
      if (!refreshed.ok) throw new Error('Không tải được trạng thái phiên.');
      const body = await refreshed.json() as { run: RuntimeRun };
      if (!isRunSelected()) return;
      runRef.current = body.run; setRun(body.run); onRunChange(body.run); setHistory(items => items.map(item => item.id === body.run.id ? body.run : item));
    } catch (cause) { if (isRunSelected()) setError(cause instanceof Error ? cause.message : 'Không thể đóng phiên.'); }
    finally { if (isCurrentWorkspace()) setWorking(false); }
  };

  const advanceRun = async (action: 'delegate' | 'report' | 'finalize') => {
    if (!run) return;
    const runId = run.id;
    const selectedSessionId = activeSessionId;
    const isRunSelected = () => isCurrentRun(runId);
    setWorking(true); setError('');
    try {
      const response = await fetch(`/api/runtime/runs/${encodeURIComponent(runId)}/${action}`, { method: 'POST' });
      const body = await response.json() as { run?: RuntimeRun; error?: string };
      if (!isRunSelected()) return;
      if (!response.ok || !body.run) throw new Error(runtimeErrorLabel(body.error ?? 'Không thể chuyển bước công việc.'));
      runRef.current = body.run; setRun(body.run); onRunChange(body.run); setHistory(items => items.map(item => item.id === body.run!.id ? body.run! : item));
      const latest = body.run.sessions.find(session => session.role === 'peer' && session.status !== 'closed');
      if (latest && action === 'delegate' && activeSessionIdRef.current === selectedSessionId) selectSession(latest.id);
    } catch (cause) {
      if (!isRunSelected()) return;
      setError(cause instanceof Error ? cause.message : 'Không thể chuyển bước công việc.');
      if (action === 'delegate') {
        try {
          const refreshed = await fetch(`/api/runtime/runs/${encodeURIComponent(runId)}`, { cache: 'no-store' });
          if (!isRunSelected()) return;
          const latest = await refreshed.json() as { run?: RuntimeRun };
          if (isRunSelected() && refreshed.ok && latest.run) { runRef.current = latest.run; setRun(latest.run); onRunChange(latest.run); setHistory(items => items.map(item => item.id === latest.run!.id ? latest.run! : item)); }
        } catch { /* Keep the last persisted run projection if refresh is unavailable. */ }
      }
    }
    finally { if (isCurrentWorkspace()) setWorking(false); }
  };

  useEffect(() => {
    setHistory(historyRuns);
  }, [historyRuns]);

  useEffect(() => {
    runRef.current = null; activeSessionIdRef.current = '';
    setRun(null); selectSession(''); setTerminalConnected(false); setError(''); onRunChange(null);
  }, [workspace?.id, onRunChange]);

  const loadRun = (runId: string) => {
    if (!runId) {
      runRef.current = null; setRun(null); onRunChange(null); selectSession(''); onClearSelectedSession();
      return;
    }
    const selected = history.find(item => item.id === runId);
    if (!selected || selected.workspaceId !== workspace?.id) return;
    runRef.current = selected; setRun(selected); onRunChange(selected);
    const nextSession = selected.sessions.find(session => session.role === 'supervisor') ?? selected.sessions[0];
    selectSession(nextSession?.id ?? '');
  };

  const resumeSession = async () => {
    if (!canResumeSession || !activeSession) return;
    const runId = run!.id;
    const sessionId = activeSession.id;
    const isRunSelected = () => isCurrentRun(runId);
    const isSessionSelected = () => isRunSelected() && activeSessionIdRef.current === sessionId;
    setWorking(true); setError('');
    try {
      const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(sessionId)}/resume`, { method: 'POST' });
      const body = await response.json() as { session?: RuntimeSession; error?: string };
      if (!isRunSelected()) return;
      if (!response.ok || !body.session) throw new Error(body.error ?? 'Không thể tiếp tục cuộc trò chuyện đã lưu.');
      const current = runRef.current;
      if (!current || current.id !== runId) return;
      const updatedSessionRun = { ...current, sessions: current.sessions.map(session => session.id === body.session!.id ? { ...session, ...body.session } : session) };
      runRef.current = updatedSessionRun;
      setRun(updatedSessionRun); onRunChange(updatedSessionRun);
      const refreshed = await fetch(`/api/runtime/runs/${encodeURIComponent(runId)}`, { cache: 'no-store' });
      if (!isRunSelected()) return;
      if (!refreshed.ok) throw new Error('Không tải được trạng thái runtime sau khi tiếp tục.');
      const result = await refreshed.json() as { run?: RuntimeRun };
      if (!isRunSelected()) return;
      if (!result.run) throw new Error('Máy chủ không trả trạng thái runtime sau khi tiếp tục.');
      blockedInput.current.delete(sessionId);
      inputBatcherRef.current?.reset(sessionId);
      if (inputBlockedSessionRef.current === sessionId) { inputBlockedSessionRef.current = null; setInputBlockedSessionId(null); }
      runRef.current = result.run;
      setRun(result.run); onRunChange(result.run); setHistory(items => items.map(item => item.id === result.run!.id ? result.run! : item));
    } catch (cause) { if (isSessionSelected()) setError(cause instanceof Error ? cause.message : 'Không thể tiếp tục cuộc trò chuyện.'); }
    finally { if (isCurrentWorkspace()) setWorking(false); }
  };

  const verifyInputSession = async () => {
    const sessionId = inputBlockedSessionId;
    if (!sessionId) return;
    const runId = runRef.current?.id;
    const isSessionSelected = () => !!runId && isCurrentRun(runId) && activeSessionIdRef.current === sessionId;
    setWorking(true);
    try {
      const sessionResponse = await fetch(`/api/runtime/sessions/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
      if (!isCurrentWorkspace()) return;
      if (!sessionResponse.ok) throw new Error('Không thể xác minh phiên Codex.');
      const sessionBody = await sessionResponse.json() as { session?: RuntimeSession };
      if (!isSessionSelected()) return;
      if (!sessionBody.session || sessionBody.session.status !== 'active' || !sessionBody.session.processConfirmed) throw new Error('Máy chủ chưa xác nhận tiến trình đang chạy; không gửi lại phím chưa xác nhận.');
      const runResponse = await fetch(`/api/runtime/runs/${encodeURIComponent(sessionBody.session.runId)}`, { cache: 'no-store' });
      if (!isSessionSelected()) return;
      if (!runResponse.ok) throw new Error('Không tải được trạng thái nhiệm vụ.');
      const runBody = await runResponse.json() as { run?: RuntimeRun };
      if (!isSessionSelected()) return;
      if (!runBody.run || runBody.run.workspaceId !== workspace?.id || !runBody.run.sessions.some(session => session.id === sessionId)) throw new Error('Phiên không còn thuộc workspace đang mở.');
      blockedInput.current.delete(sessionId); inputBatcherRef.current?.reset(sessionId); inputBlockedSessionRef.current = null; setInputBlockedSessionId(null);
      runRef.current = runBody.run; setRun(runBody.run); onRunChange(runBody.run); setHistory(items => items.map(item => item.id === runBody.run!.id ? runBody.run! : item));
      setError(terminalConnected ? '' : 'Phiên đang chạy; đang chờ kết nối terminal trước khi nhập tiếp.');
    } catch (cause) { if (isSessionSelected()) setError(cause instanceof Error ? cause.message : 'Không thể xác minh kết nối terminal.'); }
    finally { if (isCurrentWorkspace()) setWorking(false); }
  };
  return <section className="terminal-workspace" aria-label="Terminal CLI">
    <header className="terminal-workspace-head"><div><span className={`terminal-led ${terminalConnected ? 'connected' : ''}`}/><h2>Phiên CLI</h2><span className="terminal-connection">{activeConnectionLabel}</span></div><small>{workspace?.path ?? 'Chọn hoặc đăng ký workspace'}</small>{activeSession?.nativeConversationId && <small>Cuộc trò chuyện · {activeSession.nativeConversationId} · {activeSession.model ?? 'model chưa đồng bộ'} · {activeSession.reasoningEffort ?? 'effort chưa đồng bộ'}</small>}</header>
    {history.length > 0 && <label className="runtime-history">Nhiệm vụ đã lưu<select aria-label="Nhiệm vụ đã lưu" value={run?.id ?? ''} onChange={event => loadRun(event.target.value)}><option value="">Chọn một nhiệm vụ</option>{history.map(item => <option key={item.id} value={item.id}>{item.taskId} · {runtimeStatusLabel(item.status)} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : 'thời điểm không rõ'}</option>)}</select></label>}
    {run && <div className="runtime-session-tabs" role="tablist" aria-label="Phiên CLI"><span>{run.taskId} · {phaseLabel(run.phase)}</span>{run.sessions.filter(session => session.id).map(session => <button role="tab" aria-selected={activeSessionId === session.id} key={session.id} onClick={() => selectSession(session.id)}>{session.role === 'supervisor' ? 'Supervisor' : 'Agent'} · {sessionConnectionLabel(session.status, session.processConfirmed, session.id === activeSessionId && terminalConnected, serverHealth, session.id === activeSessionId)}</button>)}{canResumeSession && <button className="runtime-resume" onClick={() => void resumeSession()} disabled={working}>Tiếp tục cùng cuộc trò chuyện đã lưu</button>}{['supervisor_delegation','delegating'].includes(run.phase) && <button onClick={() => void advanceRun('delegate')} disabled={working || activeSession?.role !== 'supervisor'}>{run.phase === 'delegating' ? 'Tiếp tục giao việc cho Agent' : 'Giao việc cho Agent'}</button>}{run.phase === 'peer_running' && <button onClick={() => void advanceRun('report')} disabled={working}>Gửi báo cáo Agent cho Supervisor</button>}{run.phase === 'supervisor_reporting' && <button onClick={() => void advanceRun('finalize')} disabled={working}>Chốt nhiệm vụ</button>}{run.sessions.some(session => session.processConfirmed && ['active', 'starting', 'closing'].includes(session.status)) && <button className="runtime-close" onClick={() => void closeRun()} disabled={working}>Đóng tiến trình</button>}</div>}
    {run?.routingDecision && <details className="runtime-routing-decision"><summary><strong>Quyết định định tuyến</strong><span>{run.routingDecision.taskKind} · {run.routingDecision.provider} · {run.routingDecision.model ?? 'Mặc định CLI'} · {run.routingDecision.effort} · v{run.routingSnapshot?.revision ?? '?'}</span><small>Hiện lý do và chỉ dẫn</small></summary><div className="runtime-routing-details"><dl><div><dt>Nhóm</dt><dd>{run.routingDecision.taskKind}</dd></div><div><dt>Provider</dt><dd>{run.routingDecision.provider}</dd></div><div><dt>Model</dt><dd>{run.routingDecision.model ?? 'Mặc định CLI'}</dd></div><div><dt>Effort</dt><dd>{run.routingDecision.effort}</dd></div><div><dt>Phiên bản cấu hình</dt><dd>{run.routingSnapshot?.revision ?? 'Không rõ'}</dd></div></dl><div className="runtime-routing-copy"><strong>Lý do</strong><p>{run.routingDecision.reason}</p></div><div className="runtime-routing-copy"><strong>Chỉ dẫn Agent</strong><p>{run.routingDecision.instruction}</p></div>{run.routingDecision.provider !== 'codex' && <small>Runner chưa kết nối · chưa mở tiến trình cho provider này.</small>}</div></details>}
    {run?.report && <section className="runtime-report"><h3>Báo cáo Agent</h3><p>{run.report}</p></section>}
    {run?.finalReport && <section className="runtime-report"><h3>Báo cáo Supervisor</h3><p>{run.finalReport}</p></section>}
    {!run && <form className="runtime-run-form" onSubmit={startRun}><label>Nhiệm vụ<input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder="Tên ngắn cho nhiệm vụ" disabled={!workspace || workspace.status !== 'ready'}/></label><label>Chỉ dẫn ban đầu<textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Mô tả công việc cho Supervisor" rows={4} disabled={!workspace || workspace.status !== 'ready'}/></label><button type="submit" disabled={!workspace || workspace.status !== 'ready' || working || !prompt.trim()}>{working ? 'Đang kết nối…' : 'Kết nối CLI và bắt đầu'}</button><small>Chạy Supervisor CLI và một agent được giao việc.</small></form>}
    <div className="terminal-pane"><div className="terminal-screen xterm-host" ref={hostRef} aria-label="Nội dung terminal native"/>{!activeSession && <div className="terminal-placeholder"><strong>Chưa kết nối CLI</strong><span>Terminal sẽ hiển thị nguyên trạng giao diện Codex native.</span></div>}</div>
    {activeSession && <div className="terminal-mobile-keys" aria-label="Phím terminal di động">{[['Enter','\r'],['Esc','\x1b'],['Tab','\t'],['↑','\x1b[A'],['↓','\x1b[B'],['←','\x1b[D'],['→','\x1b[C'],['Ctrl+C','\x03']].map(([label, data]) => <button type="button" key={label} onClick={() => sendInputRef.current(activeSession.id, data)} disabled={!terminalConnected || activeSession.status !== 'active' || inputBlockedSessionId === activeSession.id}>{label}</button>)}</div>}
    {error && <p className="runtime-error" role="alert">{error}{error.includes('Cài đặt định tuyến') && <button type="button" onClick={onOpenSettings}>Mở cài đặt</button>}</p>}
    {inputBlockedSessionId === activeSession?.id && <button type="button" className="runtime-reconnect" onClick={() => void verifyInputSession()} disabled={working}>Kiểm tra phiên rồi tiếp tục nhập</button>}
  </section>;
}
