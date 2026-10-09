'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createEmptyState } from './model/empty';
import { studioReducer } from './model/reducer';
import type { AppState, Dispatch, StudioEvent } from './model/types';
import { rebasePendingEvents } from './persistence-rebase';
import { isLocalOnlyEvent } from './persistence-events';

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'error';
type StudioContextValue = { state: AppState; dispatch: Dispatch<StudioEvent>; saveStatus: SaveStatus; retryLoad: () => void; retrySave: () => void; loaded: boolean; pendingCount: number };
const StudioContext = createContext<StudioContextValue | null>(null);
export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(studioReducer, undefined, createEmptyState);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const stateRef = useRef(state); stateRef.current = state;
  const departureDeadlines = useRef(new Map<string, { sessionId: string; sequence: number; deadline: number }>());
  const revision = useRef(0);
  const queue = useRef<Array<{ event: StudioEvent; eventId: string; context: { role: AppState['ui']['role']; workspaceId: string; clientViewerId: string | null } }>>([]);
  const running = useRef(false);
  const failed = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let alive = true;
    setSaveStatus('loading');
    fetch('/api/studio', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('load_failed');
      return response.json() as Promise<{ state: AppState; revision: number }>;
    }).then(result => {
      if (!alive) return;
      revision.current = result.revision;
      rawDispatch({ type: 'persistence.hydrate', state: result.state });
      setLoaded(true); setSaveStatus('saved');
    }).catch(() => { if (alive) setSaveStatus('error'); });
    return () => { alive = false; };
  }, [reloadToken]);

  const processQueue = useCallback(async (force = false) => {
    if (running.current || !loaded || failed.current && !force) return;
    failed.current = false;
    running.current = true;
    try {
      while (queue.current.length) {
        const item = queue.current[0];
        setSaveStatus('saving');
        const response = await fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: item.eventId, expectedRevision: revision.current, context: item.context, event: item.event }) });
        const result = await response.json();
        if (response.status === 409 && result.state) {
          revision.current = result.revision;
          failed.current = true;
          rawDispatch({ type: 'persistence.hydrate', state: rebasePendingEvents(result.state, queue.current, stateRef.current.ui) });
          setSaveStatus('error'); return;
        }
        if (!response.ok) throw new Error('save_failed');
        revision.current = result.revision;
        queue.current.shift();
        setPendingCount(queue.current.length);
        rawDispatch({ type: 'persistence.hydrate', state: rebasePendingEvents(result.state, queue.current, stateRef.current.ui) });
      }
      setSaveStatus('saved');
    } catch { failed.current = true; setSaveStatus('error'); }
    finally { running.current = false; }
  }, [loaded]);

  const dispatch = useCallback<Dispatch<StudioEvent>>(event => {
    if (event.type === 'persistence.hydrate') return;
    if (!loaded && !isLocalOnlyEvent(event)) return;
    rawDispatch(event);
    if (!isLocalOnlyEvent(event)) {
      const current = stateRef.current;
      if (!current.ui.workspaceId) return;
      queue.current.push({ event, eventId: crypto.randomUUID(), context: { role: current.ui.role, workspaceId: current.ui.workspaceId, clientViewerId: current.ui.clientViewerId } });
      setPendingCount(queue.current.length);
      void processQueue();
    }
  }, [processQueue, loaded]);
  const retryLoad = useCallback(() => { setLoaded(false); setReloadToken(token => token + 1); }, []);
  const retrySave = useCallback(() => { void processQueue(true); }, [processQueue]);
  const departures = Object.values(state.sessions).filter(session => session.runtimeMotion?.phase === 'exit' && session.nativeRuntime && !session.processConfirmed);
  const departureKey = departures.map(session => `${session.id}:${session.runtimeMotion!.sequence}`).sort().join('|');
  useEffect(() => {
    const now = Date.now();
    const active = new Map<string, { sessionId: string; sequence: number; deadline: number }>();
    for (const session of departures) {
      const sequence = session.runtimeMotion!.sequence;
      const key = `${session.id}:${sequence}`;
      active.set(key, departureDeadlines.current.get(key) ?? { sessionId: session.id, sequence, deadline: now + 5000 });
    }
    departureDeadlines.current = active;
    const earliest = Math.min(...Array.from(active.values(), item => item.deadline));
    if (!Number.isFinite(earliest)) return;
    const timer = window.setTimeout(() => {
      const current = stateRef.current.sessions;
      const expired = Array.from(departureDeadlines.current.values()).filter(item => item.deadline <= Date.now()
        && current[item.sessionId]?.runtimeMotion?.phase === 'exit'
        && current[item.sessionId]?.runtimeMotion?.sequence === item.sequence);
      expired.forEach(item => rawDispatch({ type: 'runtime.motion-finished', sessionId: item.sessionId, sequence: item.sequence }));
    }, Math.max(0, earliest - now));
    return () => window.clearTimeout(timer);
  }, [departureKey, dispatch]);
  const value = useMemo(() => ({ state, dispatch, saveStatus, retryLoad, retrySave, loaded, pendingCount }), [state, dispatch, saveStatus, retryLoad, retrySave, loaded, pendingCount]);
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside StudioProvider');
  return value;
}

export type StudioViewProps = StudioContextValue;
