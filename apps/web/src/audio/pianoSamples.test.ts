import { LAYERS } from 'smplr';
import { describe, expect, it, vi } from 'vitest';
import lock from '../../../../scripts/piano-samples.lock.json';
import { sampleFileName } from '../../../../scripts/piano-samples-lib.mjs';
import { pianoSampleBaseUrl, pianoSampleFile, pianoStorage } from './pianoSamples.js';

/** Every sample name smplr's Splendid Grand Piano can ask for, over all its velocity layers. */
const names = [...new Set(LAYERS.flatMap((layer) => layer.samples.map((s) => String(s[1]))))];

describe('the piano samples', () => {
  it('maps a smplr sample name to the file it is stored as', () => {
    expect(pianoSampleFile('PP C#1')).toBe('PP_Cs1');
    expect(pianoSampleFile('FF B-1')).toBe('FF_B-1');
  });

  it('names every sample as the asset script does: safe and without collisions, in any case', () => {
    expect(names).toHaveLength(226);
    for (const name of names) expect(pianoSampleFile(name)).toBe(sampleFileName(name));
    const files = names.map(pianoSampleFile);
    expect(files.every((f) => /^[A-Za-z0-9_-]+$/.test(f))).toBe(true);
    expect(new Set(files.map((f) => f.toLowerCase())).size).toBe(names.length);
  });

  it('finds every file smplr can ask for in the pinned asset, and nothing else', () => {
    const wanted = names.flatMap((n) => ['ogg', 'm4a'].map((f) => `${pianoSampleFile(n)}.${f}`));
    expect(wanted.sort()).toEqual([...lock.files].sort());
  });

  it("serves the samples from the app's own piano directory", () => {
    expect(pianoSampleBaseUrl('/')).toBe('/piano');
    expect(pianoSampleBaseUrl('/digitus2/')).toBe('/digitus2/piano');
  });

  it('fetches the stored file for the URL smplr builds', async () => {
    const fetchFile = vi.fn(
      async (_url: string) => new Response('ogg', { headers: { 'content-type': 'audio/ogg' } }),
    );
    const response = await pianoStorage(fetchFile).fetch('/digitus2/piano/PP%20C%231.ogg');
    expect(fetchFile).toHaveBeenCalledWith('/digitus2/piano/PP_Cs1.ogg');
    expect(response.status).toBe(200);
  });

  it('rejects a missing sample and a page served in its place', async () => {
    const page = pianoStorage(
      async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
    );
    await expect(page.fetch('/piano/PP%20C1.ogg')).rejects.toThrow(/PP_C1\.ogg/);
    const missing = pianoStorage(
      async () => new Response('', { status: 404, headers: { 'content-type': 'audio/ogg' } }),
    );
    await expect(missing.fetch('/piano/PP%20C1.ogg')).rejects.toThrow(/404/);
  });
});
