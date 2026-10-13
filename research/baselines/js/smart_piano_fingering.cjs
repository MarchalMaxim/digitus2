// Run the fingering core of the MuseScore plugin "Smart Piano Fingering"
// (emanuelemerlo/smart-piano-fingering, GPL-3.0) outside MuseScore, the same way the
// repository's own tests/run-tests.js does: the core is sliced out of the QML file and
// evaluated with new Function (no source changes).
// usage: node smart_piano_fingering.cjs <qmlFile> <in.json> <out.json> [handSize]
//   in.json  = {"beat_seconds": 0.5, "notes": [{"id", "pitch", "onset", "offset", "channel"}]}
//   out.json = {"fingers": {id: signedFinger}}  (unison duplicates get their primary's finger)
"use strict";
const fs = require("fs");
const [qmlPath, inPath, outPath, size] = process.argv.slice(2);
const src = fs.readFileSync(qmlPath, "utf8");
const start = src.indexOf("    function createSmartPianoFingeringCore()");
const end = src.lastIndexOf("}");
if (start < 0) { throw new Error("createSmartPianoFingeringCore not found"); }
const mod = {};
new Function("m", src.slice(start, end) + ";m.Core=createSmartPianoFingeringCore;")(mod);
const core = mod.Core();
const input = JSON.parse(fs.readFileSync(inPath, "utf8"));
const beat = input.beat_seconds || 0.5;
const fingers = {};
for (const [channel, side] of [[0, "right"], [1, "left"]]) {
  const items = input.notes.filter(n => n.channel === channel).map(n => ({
    id: n.id, pitch: n.pitch, start: n.onset / beat, end: n.offset / beat, anchor: 0, voice: 0 }));
  if (!items.length) continue;
  const seq = core.buildSequence(items, 0.05);
  core.generate(seq, side, size || "M");
  const sign = channel === 0 ? 1 : -1;
  for (const s of seq) {
    fingers[s.id] = sign * s.finger;
    for (const d of s.dups) fingers[d] = sign * s.finger;
  }
}
fs.writeFileSync(outPath, JSON.stringify({ fingers: fingers }));
