'use client';

import { spriteFrame, type Pose } from './atlas';
import type { Session } from '../studio/model/types';

export function AgentSprite({ session, pose, direction, animated }: { session: Session; pose: Pose; direction: 'left' | 'right'; animated: boolean }) {
  const frame = spriteFrame(session.avatar, pose, 0);
  const [x, y, width, height] = frame.source;
  return <span className={`agent-sprite ${direction === 'left' ? 'facing-left' : 'facing-right'} ${animated ? 'animated' : ''}`} aria-hidden="true">
    <svg viewBox={`0 0 ${frame.canvas[0]} ${frame.canvas[1]}`} preserveAspectRatio="none">
      <svg x={(frame.canvas[0] - width) / 2 + frame.offsetX} y={frame.canvas[1] - height + frame.offsetY} width={width} height={height} viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio="none">
        <image href="/art/agents.png" width="1402" height="1122" imageRendering="pixelated" />
      </svg>
    </svg>
  </span>;
}
