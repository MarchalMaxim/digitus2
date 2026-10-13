// THROWAWAY dev helper: compact printer for pw-eval output (stdin) -> one line per result key.
let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  const i = s.indexOf('RESULTS ');
  const pre = i < 0 ? s : s.slice(0, i);
  const errs = pre.split('\n').filter((l) => /ERROR|pageerror|\[console.error\]/.test(l));
  if (errs.length) console.log(errs.slice(0, 20).join('\n'));
  if (i < 0) { console.log(pre.slice(-3000)); return; }
  const r = JSON.parse(s.slice(i + 8).trim().split('\n').join('\n'));
  for (const [k, v] of Object.entries(r ?? {})) console.log(k, JSON.stringify(v));
});
