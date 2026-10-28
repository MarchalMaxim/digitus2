import { build } from '../../app/build.js';
import { SHARED_LINK_BASE, type SharedFields } from './store.js';

/** The limits the store's rules enforce, checked here first so a refusal never comes from the wire. */
export const TITLE_MAX = 120;
export const COMPOSER_MAX = 120;
export const SCORE_MAX = 100_000;

/** The score, deflated and in base64, is longer than the store accepts. */
export class ScoreTooLarge extends Error {
  constructor() {
    super('the score is too large to share');
    this.name = 'ScoreTooLarge';
  }
}

/** The MusicXML file extensions a reader can share; MIDI files have no notation to share. */
export const SHAREABLE_FILE = /\.(musicxml|xml|mxl)$/i;

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const copy = new Uint8Array(bytes);
  const out = new Response(new Blob([copy]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** MusicXML text as the store keeps it: deflate-raw, then base64. */
export async function pack(text: string): Promise<string> {
  const bytes = await through(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The MusicXML text a stored score holds; throws when it is not what `pack` makes. */
export async function unpack(packed: string): Promise<string> {
  const binary = atob(packed);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(await through(bytes, new DecompressionStream('deflate-raw')));
}

/**
 * The title and composer the MusicXML names, for the share sheet: `work-title`, else
 * `movement-title`; the `creator` typed composer. Never the file's name.
 */
export function prefill(xml: string): { title: string; composer: string } {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const first = (selector: string) =>
      doc.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return {
      title: first('work > work-title') || first('movement-title'),
      composer: first('identification > creator[type="composer"]'),
    };
  } catch {
    return { title: '', composer: '' };
  }
}

export interface ShareInput {
  title: string;
  composer: string;
  /** The MusicXML text of the score as the app plays it. */
  xml: string;
  kind: 'scan' | 'file';
}

/**
 * The fields of the upload: what the reader typed, the packed score, the kind and the app's
 * version. Never a file name or the id of the record in My scores.
 */
export async function buildShare(id: string, input: ShareInput): Promise<SharedFields> {
  const score = await pack(input.xml);
  if (score.length > SCORE_MAX) throw new ScoreTooLarge();
  return {
    title: input.title.trim().slice(0, TITLE_MAX),
    composer: input.composer.trim().slice(0, COMPOSER_MAX),
    score,
    kind: input.kind,
    app: build.commit.slice(0, 40),
    status: 'waiting',
    link: `${SHARED_LINK_BASE}${id}`,
  };
}
