import { describe, expect, it } from 'vitest';
import { precacheList, type BuildManifest } from './precache.js';

const manifest: BuildManifest = {
  'index.html': { file: 'assets/index-abc.js' },
  '../../content/manifest.json': { file: 'assets/manifest-def.json' },
  '../../content/scores/twinkle.musicxml': { file: 'assets/twinkle-111.musicxml' },
  '../../content/scores/twinkle.musicxml?url': {
    file: 'assets/twinkle-222.js',
    assets: ['assets/twinkle-111.musicxml'],
  },
  '../../content/scores/song.musicxml.gz?url': {
    file: 'assets/song-333.js',
    assets: ['assets/song.musicxml-444.gz'],
  },
};

describe('the precache list', () => {
  it('keeps the shell, the workers and the library data, and leaves scores, maps and samples out', () => {
    const files = [
      'index.html',
      'sw.js',
      '.vite/manifest.json',
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'assets/verovio.worker-zz.js',
      'assets/manifest-def.json',
      'assets/twinkle-111.musicxml',
      'assets/twinkle-222.js',
      'assets/song-333.js',
      'assets/song.musicxml-444.gz',
      'piano/PP_Cs1.ogg',
      'piano/manifest.json',
      'licenses\\pdfjs.txt',
      'manifest.webmanifest',
      'icons/icon-192.png',
    ];
    expect(precacheList(files, manifest)).toEqual([
      'assets/index-abc.js',
      'assets/manifest-def.json',
      'assets/verovio.worker-zz.js',
      'icons/icon-192.png',
      'index.html',
      'licenses/pdfjs.txt',
      'manifest.webmanifest',
    ]);
  });
});
