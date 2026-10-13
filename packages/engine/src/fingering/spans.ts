import type { Finger } from '../score/types.js';
import profilesJson from './params/profiles.json' with { type: 'json' };

export type SpanMatrix = number[][];
export interface SpanTables {
  maxPrac: SpanMatrix;
  maxComf: SpanMatrix;
  maxRel: SpanMatrix;
}
export type SpanKind = 'minPrac' | 'minComf' | 'minRel' | 'maxRel' | 'maxComf' | 'maxPrac';

export const PARNCUTT_TABLES: SpanTables = {
  maxPrac: [
    [0, 10, 12, 14, 15],
    [5, 0, 5, 7, 10],
    [4, -1, 0, 4, 7],
    [3, -1, -1, 0, 5],
    [1, -2, -1, -1, 0],
  ],
  maxComf: [
    [0, 8, 10, 12, 13],
    [3, 0, 3, 5, 8],
    [2, -1, 0, 2, 5],
    [1, -1, -1, 0, 3],
    [-1, -2, -1, -1, 0],
  ],
  maxRel: [
    [0, 5, 7, 9, 10],
    [-1, 0, 2, 4, 6],
    [-3, -1, 0, 2, 4],
    [-5, -3, -1, 0, 2],
    [-7, -5, -3, -1, 0],
  ],
};

export function span(t: SpanTables, kind: SpanKind, f: Finger, g: Finger): number {
  switch (kind) {
    case 'maxPrac':
      return t.maxPrac[f - 1]![g - 1]!;
    case 'maxComf':
      return t.maxComf[f - 1]![g - 1]!;
    case 'maxRel':
      return t.maxRel[f - 1]![g - 1]!;
    case 'minPrac':
      return -t.maxPrac[g - 1]![f - 1]!;
    case 'minComf':
      return -t.maxComf[g - 1]![f - 1]!;
    case 'minRel':
      return -t.maxRel[g - 1]![f - 1]!;
  }
}

export function scaleTables(t: SpanTables, factor: number): SpanTables {
  const scale = (m: SpanMatrix): SpanMatrix =>
    m.map((row) => row.map((v) => Math.round(v * factor)));
  return { maxPrac: scale(t.maxPrac), maxComf: scale(t.maxComf), maxRel: scale(t.maxRel) };
}

export type HandProfileId = 'child' | 'small' | 'medium' | 'large';
export interface HandProfile {
  id: HandProfileId;
  label: string;
  scale: number;
  tables: SpanTables;
}

const raw = profilesJson as { profiles: Record<HandProfileId, { label: string; scale: number }> };
export const HAND_PROFILES: Record<HandProfileId, HandProfile> = Object.fromEntries(
  (Object.keys(raw.profiles) as HandProfileId[]).map((id) => {
    const p = raw.profiles[id];
    return [
      id,
      {
        id,
        label: p.label,
        scale: p.scale,
        tables: p.scale === 1 ? PARNCUTT_TABLES : scaleTables(PARNCUTT_TABLES, p.scale),
      },
    ];
  }),
) as Record<HandProfileId, HandProfile>;

export function resolveProfile(p: HandProfileId | HandProfile | undefined): HandProfile {
  if (p === undefined) return HAND_PROFILES.large;
  return typeof p === 'string' ? HAND_PROFILES[p] : p;
}
