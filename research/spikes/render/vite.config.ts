// THROWAWAY spike config: multi-page app, one page per experiment.
import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

const pages = ['index', 'osmd', 'verovio', 'vexml', 'vexflow', 'players', 'playback', 'parsers', 'midi'];

// @tonejs/piano@0.2.1 only works with tone@14 (peer dep); the rest of the spike uses tone@15.
// Redirect its bare `tone` imports to the `tone14` alias package.
const tonejsPianoUsesTone14 = (): Plugin => ({
  name: 'tonejs-piano-uses-tone14',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (importer && /[\/]@tonejs[\/]piano[\/]/.test(importer) && (source === 'tone' || source.startsWith('tone/'))) {
      return this.resolve(source.replace(/^tone/, 'tone14'), resolve(import.meta.dirname, 'index.html'), { skipSelf: true });
    }
  },
});

export default defineConfig({
  plugins: [tonejsPianoUsesTone14()],
  // @tonejs/piano imports Node's 'events' (MidiInput) -> browser polyfill
  resolve: { alias: { events: resolve(import.meta.dirname, 'node_modules/events/events.js') } },
  assetsInclude: ['**/*.musicxml', '**/*.mxl', '**/*.mid'],
  optimizeDeps: { exclude: ['@tonejs/piano'], include: ['@tonejs/piano > webmidi', '@tonejs/piano > tslib', 'tone14', 'events'] },
  server: { port: 4316, strictPort: true },
  preview: { port: 4317, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 20000,
    rollupOptions: { input: Object.fromEntries(pages.map((p) => [p, resolve(import.meta.dirname, p + '.html')])) },
  },
});
