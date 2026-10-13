import manifestJson from '../../../../content/manifest.json';

export type Level = 1 | 2 | 3 | 4 | 5;
export interface PieceSourceInfo {
  name: string;
  url: string;
  license: string;
  licenseUrl: string;
  retrievedAt: string | null;
  files?: string;
  mutopiaId?: string;
  typesetter?: string;
  edition?: string;
  lilypondVersion?: string;
}
export interface LibraryPiece {
  slug: string;
  title: string;
  composer: string;
  composerDates: string | null;
  catalogue: string | null;
  year: string | null;
  level: Level;
  measures: number;
  approxDurationSec: number;
  timeSignature: string;
  key: string;
  tempoBpm: number;
  source: PieceSourceInfo;
  arranger: string | null;
  hasEditorialFingering: boolean;
  excerpt: string | null;
  notes: string;
  files: { score: string; fingered: string | null };
}

export const LEVEL_NAMES: Record<Level, string> = {
  1: 'First steps',
  2: 'Easy',
  3: 'Early intermediate',
  4: 'Intermediate',
  5: 'Stretch',
};

export const pieces: LibraryPiece[] = manifestJson as LibraryPiece[];

const bySlug = new Map(pieces.map((p) => [p.slug, p]));

const scoreFiles = import.meta.glob('../../../../content/scores/*.musicxml', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

export function pieceBySlug(slug: string): LibraryPiece | undefined {
  return bySlug.get(slug);
}

/** The piece the start-here card suggests: the first level-1 piece in manifest order. */
export function recommendedPiece(): LibraryPiece {
  return pieces.find((p) => p.level === 1)!;
}

/** Resolves a manifest path such as 'scores/x.musicxml' to its asset URL (lazy, per file). */
export function scoreUrl(relativePath: string): Promise<string> {
  const key = `../../../../content/${relativePath}`;
  const loader = scoreFiles[key];
  if (!loader) return Promise.reject(new Error(`no score file ${relativePath}`));
  return loader();
}

/** 29 -> '0:29', 132.3 -> '2:12' (whole seconds, truncated). */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function isShareAlike(p: LibraryPiece): boolean {
  return p.source.license.startsWith('CC-BY-SA');
}

/** 'CC-BY-SA-2.5' -> 'CC BY-SA 2.5', 'CC0-1.0' -> 'CC0 1.0'. */
export function licenseLabel(id: string): string {
  return id.replace(/^CC-/, 'CC ').replace(/-(\d)/, ' $1');
}

function isOwnArrangement(p: LibraryPiece): boolean {
  return p.source.name.startsWith('digitus2');
}

function isMutopia(p: LibraryPiece): boolean {
  return p.source.name === 'The Mutopia Project' || p.source.mutopiaId !== undefined;
}

export function attribution(p: LibraryPiece): { text: string; url: string | null } {
  if (isOwnArrangement(p)) {
    return { text: 'digitus2 arrangement, CC0 (public domain)', url: p.source.licenseUrl };
  }
  if (isMutopia(p)) {
    const by = p.source.typesetter ?? 'an unnamed typesetter';
    if (isShareAlike(p)) {
      return {
        text: `Engraving by ${by} for the Mutopia Project, ${licenseLabel(p.source.license)}`,
        url: p.source.licenseUrl,
      };
    }
    return { text: `Engraving by ${by} for the Mutopia Project, public domain`, url: p.source.url };
  }
  // No library piece takes this branch today; it keeps a future source credited rather than blank.
  return { text: `${p.source.name}, ${licenseLabel(p.source.license)}`, url: p.source.url };
}
