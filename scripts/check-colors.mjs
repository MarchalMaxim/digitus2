#!/usr/bin/env node
// Design-brief guard: apps/web may use black, white, grays and exactly one red, and the red
// may only be referenced by the .is-red rule in tokens.css.
//   node scripts/check-colors.mjs            scans apps/web/src and apps/web/index.html
// Exported for tests: findForbiddenColors(files) -> [{ path, line, reason }]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TOKENS = 'apps/web/src/design/tokens.css';
const ACCENT = '#e3000f';
const NAMED =
  /(?<=[:\s(,])(red|blue|green|yellow|orange|purple|pink|cyan|magenta|teal|navy|brown|lime|olive|maroon|crimson|gold|silver|aqua|fuchsia|violet|indigo|coral|salmon|tomato|orchid|khaki|beige|ivory|tan)(?=[\s;,)!]|$)/i;
// A hex color is #rgb, #rgba, #rrggbb or #rrggbbaa not followed by more word characters (so ids
// like #n10, #d1e23 or #add-button are not colors). A longer run of hex digits (#e3e3e3e3e3)
// still reports its first eight as a possible #rrggbbaa: an accidental color is worth a look.
const HEX = /#([0-9a-f]{8}(?![0-9a-f]*[g-z_-])|(?:[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-]))/gi;

function isGray(hex) {
  const h =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(0, 6);
  return h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6);
}

export function findForbiddenColors(files) {
  const problems = [];
  for (const { path, text } of files) {
    const norm = path.replace(/\\/g, '/');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const at = (reason) => problems.push({ path: norm, line: i + 1, reason });
      if (norm.endsWith(TOKENS)) {
        for (const m of line.matchAll(HEX)) {
          const hex = m[1].toLowerCase();
          if (!isGray(hex) && `#${hex}` !== ACCENT) at(`second chromatic color #${hex}`);
        }
        return;
      }
      for (const m of line.matchAll(HEX)) at(`color literal #${m[1]}`);
      for (const fn of ['rgb(', 'rgba(', 'hsl(', 'hsla(', 'color('])
        if (line.includes(fn)) at(`color literal ${fn}`);
      if (/\.css$/.test(norm)) {
        const nm = NAMED.exec(line);
        if (nm) at(`named color ${nm[1]}`);
      }
      if (line.includes('var(--accent)')) at('var(--accent) outside tokens.css');
    });
  }
  return problems;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|ts|tsx|html)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

if (process.argv[1] && /check-colors\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const files = [...walk('apps/web/src'), 'apps/web/index.html'].map((p) => ({
    path: p,
    text: readFileSync(p, 'utf8'),
  }));
  const problems = findForbiddenColors(files);
  for (const p of problems) process.stdout.write(`${p.path}:${p.line}: ${p.reason}\n`);
  process.stdout.write(problems.length ? `\n${problems.length} color problem(s)\n` : 'colors ok\n');
  process.exitCode = problems.length ? 1 : 0;
}
