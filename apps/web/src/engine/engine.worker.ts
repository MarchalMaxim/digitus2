// The engine worker: parses, solves and writes fingered MusicXML off the main thread. A thin
// shell around handle(), which holds all the logic and is tested under Node.
import { handle } from './handlers.js';
import type { EngineRequest, EngineResponse } from './protocol.js';

interface WorkerScope {
  onmessage: ((e: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: EngineResponse): void;
}
const scope = self as unknown as WorkerScope;
scope.onmessage = (e) => scope.postMessage(handle(e.data));
