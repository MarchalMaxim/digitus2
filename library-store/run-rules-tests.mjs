// Runs rules.test.mjs against the Firestore emulator with this folder's rules, inside Docker
// (emulator.Dockerfile), so the host needs neither Java nor the Firebase CLI. Exit 3 when Docker is
// not running, so `pnpm verify` reports SKIP, not a pass.
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const image = 'digitus2-library-emulator';

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  process.stdout.write('docker is not running\n');
  process.exit(3);
}

const build = spawnSync(
  'docker',
  ['build', '--quiet', '-t', image, '-f', 'emulator.Dockerfile', '.'],
  { cwd: here, stdio: ['ignore', 'ignore', 'inherit'] },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    `${here}:/src:ro`,
    image,
    'sh',
    '-c',
    // A copy, so the emulator's logs stay inside the container.
    'cp -r /src/. /work && firebase emulators:exec --only firestore --project digitus2-library "node --test rules.test.mjs"',
  ],
  { stdio: 'inherit' },
);
process.exit(run.status ?? 1);
