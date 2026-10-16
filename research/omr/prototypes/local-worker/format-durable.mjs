// Research files are ignored by the repository formatter; explicitly format/check our scope.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(path.resolve('package.json'));
const prettier = require('prettier');
const folders = [
  'research/omr/prototypes/oemer-performance',
  'research/omr/prototypes/local-worker',
];
const files = [
  'docs/research/omr-performance-wave-2026-10-15.md',
  'docs/research/omr-local-worker-2026-10-15.md',
];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(mjs|html|md)$/.test(entry.name))
      files.push(path.join(directory, entry.name));
  }
}
for (const folder of folders) await collect(folder);
const rows = [];
const hash = (data) => createHash('sha256').update(data).digest('hex');
for (const file of files) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  if (file.replaceAll('\\', '/').startsWith(folders[0] + '/')) {
    const archive = path.join(
      'research/omr/results/performance-wave/source-before-format',
      path.basename(file),
    );
    await fs.mkdir(path.dirname(archive), { recursive: true });
    try {
      await fs.writeFile(archive, text, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  const options = { ...(await prettier.resolveConfig(file)), filepath: file };
  let formatted = await prettier.format(text, options);
  for (let i = 0; i < 3 && !(await prettier.check(formatted, options)); i++)
    formatted = await prettier.format(formatted, options);
  await fs.writeFile(file, formatted);
  if (!(await prettier.check(formatted, options))) throw Error('Formatting failed: ' + file);
  rows.push({ file, beforeSha256: hash(text), afterSha256: hash(formatted), checked: true });
}
await fs.writeFile(
  'research/omr/results/connector-wave/durable-format.json',
  JSON.stringify(rows, null, 2),
);
console.log('Explicit Prettier API checked ' + rows.length + ' durable MJS/HTML/Markdown files.');
