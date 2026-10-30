/**
 * The services the score document's tests open pieces with: an engine client that runs the real
 * worker handlers inline, and a renderer that lays nothing out. Tests only.
 */
import { vi } from 'vitest';
import type { EngineClient } from '../../engine/client.js';
import { handle } from '../../engine/handlers.js';
import { sourceKind } from '../../engine/protocol.js';
import type { ScoreRenderer } from '../render/renderer.js';

/** The options each `load` was given, in order. */
type LoadOpts = Parameters<EngineClient['load']>[2];

/**
 * An engine client that runs the real handlers synchronously inside promises. `calls` lists the
 * request types in the order they were made; `loads` the options of every load.
 */
export function inlineEngine(): EngineClient & { calls: string[]; loads: LoadOpts[] } {
  let id = 0;
  const calls: string[] = [];
  const loads: LoadOpts[] = [];
  const run = (req: Parameters<typeof handle>[0]) => {
    calls.push(req.type);
    const r = handle(req);
    return r.ok ? Promise.resolve(r) : Promise.reject(new Error(r.error));
  };
  return {
    calls,
    loads,
    load: (input, source, opts) => {
      loads.push(opts);
      return run({
        id: ++id,
        type: 'load',
        kind: sourceKind(source),
        input,
        source,
        ...(opts?.splitMidi !== undefined ? { splitMidi: opts.splitMidi } : {}),
        ...(opts?.preserveNotation !== undefined
          ? { preserveNotation: opts.preserveNotation }
          : {}),
        ...(opts?.tolerateScanTies !== undefined
          ? { tolerateScanTies: opts.tolerateScanTies }
          : {}),
      }).then((r) => r as never);
    },
    solve: (score, profile, pins) =>
      run({ id: ++id, type: 'solve', score, profile, ...(pins ? { pins } : {}) }).then(
        (r) => r as never,
      ),
    fingeredXml: (xml, score, assignment, bareRepeatedChords) =>
      run({
        id: ++id,
        type: 'fingeredXml',
        xml,
        score,
        assignment,
        ...(bareRepeatedChords ? { bareRepeatedChords: true as const } : {}),
      }).then((r) => (r as { xml: string }).xml),
    embellish: (xml) => run({ id: ++id, type: 'embellish', xml }).then((r) => r as never),
    dispose: () => {},
  };
}

/**
 * A renderer whose one page names the width, the number of digits and the number of notes with
 * our ids in the text it was given; `renders` counts the calls and `xmls` keeps their texts.
 */
export function fakeRenderer(): ScoreRenderer & { renders: number; xmls: string[] } {
  const r = {
    renders: 0,
    xmls: [] as string[],
    render: vi.fn(async ({ xml, widthPx }: { xml: string; widthPx: number }) => {
      r.renders++;
      r.xmls.push(xml);
      const count = (re: RegExp) => (xml.match(re) ?? []).length;
      return {
        pages: [
          `<svg data-w="${widthPx}" data-fings="${count(/<fingering/g)}" data-notes="${count(/<note id=/g)}"/>`,
        ],
        ms: 1,
      };
    }),
    warmUp: () => {},
    dispose: () => {},
  };
  return r;
}

/** How many notes carry our ids in a text given to the renderer. */
export function notesIn(xml: string): number {
  return (xml.match(/<note id=/g) ?? []).length;
}
