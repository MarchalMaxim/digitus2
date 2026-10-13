#!/usr/bin/env node
// Entry point only; the commands live in run.ts so tests can call them without side effects.
import { main } from './run.js';

process.exitCode = main(process.argv.slice(2));
