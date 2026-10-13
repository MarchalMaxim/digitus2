// Run the JavaScript FHMM1 of Nakamura's web demo (statpianofingering.github.io,
// FingeringEstimator.html / myfunctions.js) on PIG files, outside the browser.
// usage: node statpf_fhmm1.cjs <repoDir> <in1> <out1> [<in2> <out2> ...]
// The demo's scripts are loaded unmodified with vm.runInThisContext (no DOM is touched
// by BasicPitchCalculation.js / myfunctions.js).
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repo = process.argv[2];
for (const f of ["BasicPitchCalculation.js", "myfunctions.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(repo, f), "utf8"), { filename: f });
}
const FHMM1 = vm.runInThisContext("FHMM1");
const FingeringEvt = vm.runInThisContext("FingeringEvt");

for (let a = 3; a + 1 < process.argv.length + 1; a += 2) {
  const inFile = process.argv[a], outFile = process.argv[a + 1];
  if (!inFile || !outFile) break;
  const lines = fs.readFileSync(inFile, "utf8").split(/\r?\n/);
  const header = [], fin = [], raw = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("//")) { header.push(line); continue; }
    const cols = line.trim().split(/\s+/);
    const evt = new FingeringEvt();
    evt.FromFileEvt(cols.slice(0, 7));  // finger column dropped: the demo never sees it
    fin.push(evt); raw.push(cols);
  }
  const model = new FHMM1();
  model.fin = fin;
  model.ViterbiTwoHands();
  const out = [header.length ? header[0] : "//Version: PianoFingering_v170101"];
  fin.forEach((e, i) => {
    const c = raw[i].slice(0, 7);
    out.push(c.concat([e.fingerNum]).join("\t"));
  });
  fs.writeFileSync(outFile, out.join("\n") + "\n");
}
