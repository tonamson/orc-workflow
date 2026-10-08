import type { Avatar } from '../studio/model/types';
import type { Box } from './geometry';

export type Pose = 'standing' | 'seated' | 'walking';
export type SpriteFrame = { source: Box; offsetX: number; offsetY: number; canvas: [number, number] };

const measuredFrames: Record<Avatar, [Box, Box, Box, Box]> = {
  Nova: [[98,48,206,310],[102,349,216,611],[104,650,220,893],[106,925,226,1083]],
  Atlas: [[368,46,493,311],[377,343,509,603],[375,641,507,893],[381,919,517,1086]],
  Mika: [[648,57,755,313],[652,356,767,610],[655,655,780,893],[654,932,780,1085]],
  Sage: [[925,47,1047,311],[937,343,1061,611],[943,641,1070,893],[940,921,1069,1086]],
  Rune: [[1201,45,1320,309],[1206,344,1334,611],[1219,642,1339,896],[1208,921,1342,1085]],
};
const seatedOffsets: Record<Avatar, number> = { Nova: 13, Atlas: 15, Mika: 9, Sage: 14, Rune: 13 };

export function spriteFrame(avatar: Avatar, pose: Pose, step: 0 | 1 = 0): SpriteFrame {
  const index = pose === 'seated' ? 3 : pose === 'walking' ? 1 + step : 0;
  const [x1, y1, x2, y2] = measuredFrames[avatar][index];
  return {
    source: [x1 - 2, y1 - 2, x2 - x1 + 4, y2 - y1 + 4],
    offsetX: pose === 'seated' ? seatedOffsets[avatar] : 0,
    offsetY: 0,
    canvas: [180, 300],
  };
}
