// The piano samples' release asset (issue #51): its constants, the file naming, hashing, a
// minimal deterministic ustar writer and reader, and the checks shared by build-piano-samples.mjs
// (builds the asset), fetch-piano-samples.mjs (unpacks it for the app) and the unit tests
// (apps/web/src/audio/pianoSamplesAsset.test.ts and pianoSamples.test.ts).
import { createHash } from 'node:crypto';

export const TAG = 'piano-samples-v1';
export const ASSET_NAME = 'splendid-grand-piano-v1.tar';
export const RELEASE_REPOSITORY = 'MarchalMaxim/digitus2';
export const SOURCE_REPOSITORY = 'smpldsnds/sfzinstruments-splendid-grand-piano';
export const SOURCE_COMMIT = '009793ebf849aee57f9a213aeaf8f2d1e2178f4f';
export const FORMATS = ['ogg', 'm4a'];
export const LOCK_FILE = 'scripts/piano-samples.lock.json';

/** An audio file of the asset: a name that needs no escaping in a URL, and one of the formats. */
const SAMPLE_FILE = /^[A-Za-z0-9_-]+\.(?:ogg|m4a)$/;
const BLOCK = 512;

export const README = `# Splendid Grand Piano samples for digitus2

The piano samples digitus2 plays, as the release asset \`${TAG}\` that the app serves from its own
site (\`<base>piano/\`).

- Source: https://github.com/${SOURCE_REPOSITORY}, commit ${SOURCE_COMMIT}, folder \`samples\`:
  226 samples, each as Ogg Opus (\`.ogg\`) and as AAC in MP4 (\`.m4a\`). The files are unchanged.
- Origin: the Splendid Grand Piano, Steinway samples that Akai released into the public domain
  around 2000, mapped to SFZ by kinwie (https://github.com/sfzinstruments/SplendidGrandPiano) and
  converted for the smplr library by smpldsnds.
- Licence: public domain, as the source repository states.
- Names: the sample \`PP C#1\` is stored as \`PP_Cs1\` (a space becomes \`_\`, \`#\` becomes \`s\`), so
  its URL needs no escaping on any server. The app maps smplr's names the same way.
- \`manifest.json\` lists every file with its size, SHA-256 and git blob SHA-1 at the source commit.
`;

/** 'PP C#1' -> 'PP_Cs1'. The app maps smplr's names the same way (apps/web/src/audio/pianoSamples.ts). */
export function sampleFileName(name) {
  return name.replace(/ /g, '_').replace(/#/g, 's');
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Git's object id of a file (`git hash-object`), as the source commit's tree lists it. */
export function gitBlobSha1(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function checksum(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i];
  return sum;
}

function field(header, start, length) {
  return header
    .subarray(start, start + length)
    .toString('latin1')
    .replace(/\0.*$/s, '')
    .trim();
}

/**
 * A ustar archive of plain files, deterministic: the entries in the order given, mode 0644,
 * owner and group 0, modification time 0, no user or group names. Names up to 100 bytes.
 */
export function writeTar(entries) {
  const parts = [];
  for (const { name, data } of entries) {
    if (Buffer.byteLength(name) > 100) throw new Error(`tar entry name over 100 bytes: ${name}`);
    const header = Buffer.alloc(BLOCK);
    header.write(name, 0, 100, 'utf8');
    header.write(octal(0o644, 8), 100, 'ascii');
    header.write(octal(0, 8), 108, 'ascii');
    header.write(octal(0, 8), 116, 'ascii');
    header.write(octal(data.length, 12), 124, 'ascii');
    header.write(octal(0, 12), 136, 'ascii');
    header.write('0', 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    header.write(`${octal(checksum(header), 7)} `, 148, 'ascii');
    parts.push(header, Buffer.from(data), Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(2 * BLOCK));
  return Buffer.concat(parts);
}

/** The plain files of a ustar archive; anything else (a link, a directory, a bad header) throws. */
export function readTar(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let offset = 0;
  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) return entries;
    if (Number.parseInt(field(header, 148, 8), 8) !== checksum(header))
      throw new Error(`tar header checksum mismatch at byte ${offset}`);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    if (header[156] !== 0x30 && header[156] !== 0)
      throw new Error(`tar entry ${name} is not a plain file`);
    const size = Number.parseInt(field(header, 124, 12), 8);
    if (!Number.isFinite(size) || offset + BLOCK + size > buffer.length)
      throw new Error(`tar entry ${name} is truncated`);
    offset += BLOCK;
    entries.push({ name, data: new Uint8Array(buffer.subarray(offset, offset + size)) });
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error('tar archive has no end marker');
}

const byFile = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

/**
 * The asset's entries: README.md, manifest.json (each file's source path, size, SHA-256 and git
 * blob SHA-1), then the audio files under their safe names, sorted. `samples` are
 * `{ name, format, data, gitBlobSha1 }` as downloaded from the source commit.
 */
export function assetEntries(samples) {
  const files = samples
    .map((s) => ({
      file: `${sampleFileName(s.name)}.${s.format}`,
      source: `samples/${s.name}.${s.format}`,
      bytes: s.data.length,
      sha256: sha256(s.data),
      gitBlobSha1: s.gitBlobSha1,
      data: s.data,
    }))
    .sort(byFile);
  const seen = new Set();
  for (const f of files) {
    if (!SAMPLE_FILE.test(f.file)) throw new Error(`unsafe sample file name ${f.file}`);
    if (seen.has(f.file.toLowerCase())) throw new Error(`two samples map to ${f.file}`);
    seen.add(f.file.toLowerCase());
  }
  const manifest = {
    tag: TAG,
    source: {
      repository: `https://github.com/${SOURCE_REPOSITORY}`,
      commit: SOURCE_COMMIT,
      path: 'samples',
    },
    licence: 'Public domain (see README.md)',
    files: files.map(({ data: _data, ...entry }) => entry),
  };
  return [
    { name: 'README.md', data: Buffer.from(README, 'utf8') },
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    ...files.map((f) => ({ name: f.file, data: f.data })),
  ];
}

/** The lock that pins a built asset: what the Pages workflow and the fetch script check. */
export function lockFor(tar, entries) {
  return {
    tag: TAG,
    repository: RELEASE_REPOSITORY,
    asset: ASSET_NAME,
    bytes: tar.length,
    sha256: sha256(tar),
    files: entries
      .map((e) => e.name)
      .filter((n) => SAMPLE_FILE.test(n))
      .sort(),
  };
}

/**
 * Throws unless `entries` are exactly the asset the lock names: only README.md, manifest.json
 * and safely named audio files, no duplicates, the manifest listing exactly those files with
 * their sizes and SHA-256, and the same file names as the lock.
 */
export function checkAssetEntries(entries, lock) {
  const byName = new Map();
  for (const e of entries) {
    if (byName.has(e.name)) throw new Error(`duplicate entry ${e.name}`);
    if (e.name !== 'README.md' && e.name !== 'manifest.json' && !SAMPLE_FILE.test(e.name))
      throw new Error(`unexpected entry ${JSON.stringify(e.name)}`);
    byName.set(e.name, e.data);
  }
  if (!byName.has('README.md')) throw new Error('the asset has no README.md');
  const manifestBytes = byName.get('manifest.json');
  if (!manifestBytes) throw new Error('the asset has no manifest.json');
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  const audio = [...byName.keys()].filter((n) => SAMPLE_FILE.test(n)).sort();
  const listed = manifest.files.map((f) => f.file).sort();
  if (JSON.stringify(listed) !== JSON.stringify(audio))
    throw new Error("the manifest does not list exactly the asset's audio files");
  if (JSON.stringify(audio) !== JSON.stringify([...lock.files].sort()))
    throw new Error(`the asset's audio files differ from ${LOCK_FILE}`);
  for (const f of manifest.files) {
    const data = byName.get(f.file);
    if (data.length !== f.bytes || sha256(data) !== f.sha256)
      throw new Error(`${f.file} does not match the manifest`);
  }
}
