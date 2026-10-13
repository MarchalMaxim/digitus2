import { parseArgs } from 'node:util';
import { evaluateDirs, formatReport } from './evaluate.js';
import { describeScore, loadScore } from './inspect.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processIo: CliIo = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
};

const USAGE = `digitus2 <command>

  inspect <file>                        summarize a MusicXML (.musicxml/.xml/.mxl) or PIG (.txt) file
  eval --pred <path> --gold <path>      score PIG predictions against PIG ground truth [--json]
`;

/**
 * Runs one CLI command and returns its exit code: 0 on success, 1 when the command fails (the
 * error message is printed as one `digitus2: ...` line, no stack trace), 2 on a usage error.
 */
export function main(argv: string[], io: CliIo = processIo): number {
  try {
    return dispatch(argv, io);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`digitus2: ${message}\n`);
    return 1;
  }
}

function dispatch(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;
  if (command === 'inspect') {
    const file = rest[0];
    if (!file) {
      io.stderr(USAGE);
      return 2;
    }
    io.stdout(describeScore(loadScore(file)) + '\n');
    return 0;
  }
  if (command === 'eval') {
    const { values } = parseArgs({
      args: rest,
      options: { pred: { type: 'string' }, gold: { type: 'string' }, json: { type: 'boolean' } },
    });
    if (!values.pred || !values.gold) {
      io.stderr(USAGE);
      return 2;
    }
    const report = evaluateDirs(values.pred, values.gold);
    io.stdout((values.json ? JSON.stringify(report, null, 2) : formatReport(report)) + '\n');
    return 0;
  }
  io.stderr(USAGE);
  return 2;
}
