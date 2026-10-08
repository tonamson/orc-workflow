'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createDemoState } from './model/seed';
import { studioReducer } from './model/reducer';
import type { AppState, Dispatch, StudioEvent } from './model/types';
import { rebasePendingEvents } from './persistence-rebase';

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'error';
type StudioContextValue = { state: AppState; dispatch: Dispatch<StudioEvent>; saveStatus: SaveStatus; retryLoad: () => void; retrySave: () => void; loaded: boolean; pendingCount: number };
const StudioContext = createContext<StudioContextValue | null>(null);
const localOnly = new Set<StudioEvent['type']>(['ui.navigate','ui.role','ui.client','ui.workspace','ui.mode','ui.panel','ui.select-session','ui.select-record','ui.search','ui.record-filter']);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(studioReducer, undefined, createDemoState);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const stateRef = useRef(state); stateRef.current = state;
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
    if (!loaded && !localOnly.has(event.type)) return;
    rawDispatch(event);
    if (!localOnly.has(event.type)) {
      const current = stateRef.current;
      if (!current.ui.workspaceId) return;
      queue.current.push({ event, eventId: crypto.randomUUID(), context: { role: current.ui.role, workspaceId: current.ui.workspaceId, clientViewerId: current.ui.clientViewerId } });
      setPendingCount(queue.current.length);
      void processQueue();
    }
  }, [processQueue, loaded]);
  const retryLoad = useCallback(() => { setLoaded(false); setReloadToken(token => token + 1); }, []);
  const retrySave = useCallback(() => { void processQueue(true); }, [processQueue]);
  const value = useMemo(() => ({ state, dispatch, saveStatus, retryLoad, retrySave, loaded, pendingCount }), [state, dispatch, saveStatus, retryLoad, retrySave, loaded, pendingCount]);
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside StudioProvider');
  return value;
}

export type StudioViewProps = StudioContextValue;
