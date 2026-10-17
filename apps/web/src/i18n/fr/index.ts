import type { Messages } from '../messages.js';
import { about } from './about.js';
import { app } from './app.js';
import { common } from './common.js';
import { library } from './library.js';
import { scan } from './scan.js';
import { score } from './score.js';
import { transport } from './transport.js';

/** Loaded on demand (i18n.ts), so a reader in English downloads none of it. */
export const messages: Messages = { common, app, about, library, scan, score, transport };
