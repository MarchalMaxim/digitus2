#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { evaluateDirs, formatReport } from './evaluate.js';
import { describeScore, loadScore } from './inspect.js';

const USAGE = `digitus2 <command>

  inspect <file>                        summarize a MusicXML (.musicxml/.xml/.mxl) or PIG (.txt) file
  eval --pred <path> --gold <path>      score PIG predictions against PIG ground truth [--json]
`;

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === 'inspect') {
    const file = rest[0];
    if (!file) {
      process.stderr.write(USAGE);
      return 2;
    }
    process.stdout.write(describeScore(loadScore(file)) + '\n');
    return 0;
  }
  if (command === 'eval') {
    const { values } = parseArgs({
      args: rest,
      options: { pred: { type: 'string' }, gold: { type: 'string' }, json: { type: 'boolean' } },
    });
    if (!values.pred || !values.gold) {
      process.stderr.write(USAGE);
      return 2;
    }
    const report = evaluateDirs(values.pred, values.gold);
    process.stdout.write(
      (values.json ? JSON.stringify(report, null, 2) : formatReport(report)) + '\n',
    );
    return 0;
  }
  process.stderr.write(USAGE);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
