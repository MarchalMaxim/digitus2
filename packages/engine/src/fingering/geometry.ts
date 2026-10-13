export { isBlackKey as isBlack } from '../score/pitch.js';

export const MIRROR_SUM = 124;
const WHITE_COL = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const X14 = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function mirrorPitch(midi: number): number {
  return MIRROR_SUM - midi;
}

export function whiteColumn(midi: number): number {
  return 7 * Math.floor(midi / 12) + WHITE_COL[pc(midi)]!;
}

export function x14(midi: number): number {
  return 14 * Math.floor(midi / 12) + X14[pc(midi)]!;
}
