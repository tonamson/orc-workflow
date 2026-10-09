'use client';

import { useEffect, type RefObject } from 'react';
import { startMotion, type MotionTarget } from './motion';
import type { Point } from './geometry';

export function useAgentMotion(target: RefObject<HTMLElement | null>, route: Point[] | null, phase: 'assign' | 'report' | 'exit' | null, reducedMotion: boolean, onFinish: () => void): void {
  useEffect(() => {
    const element = target.current;
    if (!element || !route || !phase) return;
    if (reducedMotion || typeof element.animate !== 'function') { onFinish(); return; }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches) { onFinish(); return; }
    let animation: ReturnType<typeof startMotion> | null = null;
    let completed = false;
    let observer: IntersectionObserver | null = null;
    const finish = () => { if (!completed) { completed = true; observer?.disconnect(); onFinish(); } };
    const start = () => {
      if (completed) return;
      if (!animation) animation = startMotion(element as MotionTarget, route, { duration: phase === 'exit' ? 4200 : 3600, onFinish: finish });
      else animation.play();
    };
    if ('IntersectionObserver' in window) {
      const observerInstance = new IntersectionObserver(entries => {
        if (entries[0]?.isIntersecting) start();
        else animation?.pause();
      });
      observer = observerInstance;
      observerInstance.observe(element);
      return () => { if (phase === 'report' || phase === 'exit') finish(); observerInstance.disconnect(); animation?.cancel(); };
    }
    start();
    return () => { if (phase === 'report' || phase === 'exit') finish(); animation?.cancel(); };
  }, [target, route, phase, reducedMotion, onFinish]);
}
