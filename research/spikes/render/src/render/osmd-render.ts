// THROWAWAY spike: shared OSMD helpers (no side effects).
import type { OpenSheetMusicDisplay, GraphicalNote } from 'opensheetmusicdisplay';
import type { ScoreModel } from '../model/musicxml';

/** every rendered (non-rest) graphical note with its musical identity */
export function osmdNotes(osmd: OpenSheetMusicDisplay) {
  const out: { gn: GraphicalNote; svgId: string; el: SVGGElement | null; mi: number; staff: number; q: number; midi: number; grace: boolean }[] = [];
  for (const row of osmd.GraphicSheet.MeasureList) for (const gm of row) {
    if (!gm) continue;
    const mi = gm.parentSourceMeasure.measureListIndex;
    const staff = gm.ParentStaff.idInMusicSheet + 1;
    for (const se of gm.staffEntries) for (const gve of se.graphicalVoiceEntries) for (const gn of gve.notes) {
      const n = gn.sourceNote;
      if (n.isRest()) continue;
      const vgn = gn as unknown as { getSVGId(): string; getSVGGElement(): SVGGElement };
      // OSMD's internal halfTone is offset from MIDI by 12 (verified against the fixture, see results)
      out.push({ gn, svgId: vgn.getSVGId(), el: vgn.getSVGGElement(), mi, staff, q: gve.parentVoiceEntry.Timestamp.RealValue * 4, midi: n.halfTone + 12, grace: gve.parentVoiceEntry.IsGrace });
    }
  }
  return out;
}

export function mapToModel(osmd: OpenSheetMusicDisplay, model: ScoreModel) {
  const rendered = osmdNotes(osmd);
  const key = (mi: number, staff: number, q: number, midi: number, grace: boolean) => `${mi}|${staff}|${q.toFixed(3)}|${midi}|${grace ? 'g' : ''}`;
  const index = new Map<string, string[]>();
  for (const n of model.allNotes) {
    const k = key(n.measureIndex, n.staff, n.measureOnsetQ, n.midi, n.grace);
    index.set(k, [...(index.get(k) ?? []), n.id]);
  }
  let unique = 0, ambiguous = 0, missing = 0;
  const unmatched: string[] = [];
  const idToEl = new Map<string, SVGGElement | null>();
  for (const r of rendered) {
    const ids = index.get(key(r.mi, r.staff, r.q, r.midi, r.grace));
    if (!ids) { missing++; if (unmatched.length < 5) unmatched.push(key(r.mi, r.staff, r.q, r.midi, r.grace)); }
    else if (ids.length > 1) ambiguous++;
    else { unique++; idToEl.set(ids[0], r.el); }
  }
  return { renderedNotes: rendered.length, modelNotes: model.allNotes.length, unique, ambiguous, missing, unmatched, idToEl, withSvgElement: rendered.filter((r) => r.el).length };
}

