'use client';

import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { createDemoState } from './model/seed';
import { studioReducer } from './model/reducer';
import type { AppState, Dispatch, StudioEvent } from './model/types';

type StudioContextValue = { state: AppState; dispatch: Dispatch<StudioEvent> };
const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(studioReducer, undefined, createDemoState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside StudioProvider');
  return value;
}

export type StudioViewProps = StudioContextValue;
