/** Vite's build manifest (`dist/.vite/manifest.json`), as far as the precache reads it. */
export type BuildManifest = Record<string, { file: string; assets?: string[] }>;

/** The largest precache the build accepts (about 16 MiB today: Verovio 8.2 MB, the library 3.7 MB). */
export const PRECACHE_MAX_BYTES = 24 * 1024 * 1024;

/**
 * The files the service worker installs with: every file of the build except source maps,
 * Vite's manifest, the service worker itself, the piano samples (kept as they are played) and the
 * library's score files with their per-score URL chunks (kept as pieces open; there are thousands).
 * Paths relative to the build directory with `/`, sorted. The engine and Verovio worker chunks are
 * not keys of Vite's manifest, which is why the list starts from the files on disk.
 */
export function precacheList(files: readonly string[], manifest: BuildManifest): string[] {
  const scores = new Set<string>();
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!key.includes('content/scores/')) continue;
    scores.add(chunk.file);
    for (const asset of chunk.assets ?? []) scores.add(asset);
  }
  return files
    .map((f) => f.replace(/\\/g, '/'))
    .filter(
      (f) =>
        !f.startsWith('.vite/') &&
        !f.endsWith('.map') &&
        f !== 'sw.js' &&
        !f.startsWith('piano/') &&
        !scores.has(f),
    )
    .sort();
}
