'use client';

import { useEffect, useRef, useState } from 'react';
import { spriteFrame, type Pose } from './atlas';
import type { Session } from '../studio/model/types';

export function AgentSprite({ session, pose, direction, animated }: { session: Session; pose: Pose; direction: 'left' | 'right'; animated: boolean }) {
  const [step, setStep] = useState<0 | 1>(0);
  const spriteRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!animated || pose !== 'walking') { setStep(0); return; }
    let frame: 0 | 1 = 0; let previous = 0; let request = 0; let visible = true;
    const tick = (time: number) => { if (visible) { if (time - previous >= 110) { frame = frame ? 0 : 1; setStep(frame); previous = time; } request = requestAnimationFrame(tick); } };
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      visible = Boolean(entries[0]?.isIntersecting);
      if (visible && !request) request = requestAnimationFrame(tick);
      if (!visible && request) { cancelAnimationFrame(request); request = 0; }
    }) : null;
    if (spriteRef.current) observer?.observe(spriteRef.current);
    request = requestAnimationFrame(tick);
    return () => { observer?.disconnect(); cancelAnimationFrame(request); };
  }, [animated, pose]);
  const frame = spriteFrame(session.avatar, pose, animated && pose === 'walking' ? step : 0);
  const [x, y, width, height] = frame.source;
  return <span ref={spriteRef} className={`agent-sprite ${direction === 'left' ? 'facing-left' : 'facing-right'} ${animated ? 'animated' : ''}`} aria-hidden="true">
    <svg viewBox={`0 0 ${frame.canvas[0]} ${frame.canvas[1]}`} preserveAspectRatio="none">
      <svg x={(frame.canvas[0] - width) / 2 + frame.offsetX} y={frame.canvas[1] - height + frame.offsetY} width={width} height={height} viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio="none">
        <image href="/art/agents.png" width="1402" height="1122" imageRendering="pixelated" />
      </svg>
    </svg>
  </span>;
}
