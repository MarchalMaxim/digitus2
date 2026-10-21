// The camera's tracker worker (issue 143): a thin shell around trackerHandler(), which holds all
// the logic and also runs on the main thread where there is no worker. Every frame goes back.
import { trackerHandler, type TrackerAnswer, type TrackerRequest } from './trackerHandler.js';

interface WorkerScope {
  onmessage: ((event: MessageEvent<TrackerRequest>) => void) | null;
  postMessage(message: TrackerAnswer, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;
const handle = trackerHandler();
scope.onmessage = (event) => {
  const answer = handle(event.data);
  if (answer) scope.postMessage(answer, [answer.frame.data.buffer]);
};
