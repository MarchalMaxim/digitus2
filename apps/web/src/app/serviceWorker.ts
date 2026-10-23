import { useAppStore } from './store.js';

/**
 * Registers the service worker (src/sw/sw.ts, built to `sw.js` next to index.html) once the page
 * has loaded, on production builds only: `vite dev` serves no sw.js. `updateViaCache: 'none'`
 * makes the browser check sw.js itself for a new build. A failed registration (blocked site data,
 * an insecure origin) leaves the app as it was, online only: the reader sees nothing, and the
 * console gets one warning for whoever debugs it. A register stubbed to resolve to nothing
 * (Playwright's `serviceWorkers: 'block'`) is left alone silently.
 *
 * A newer build's worker waits until every window of the app has closed (sw.ts), which on a phone
 * that keeps the app open can be a long time. When one is waiting, the page offers it on the
 * notice line (Notice.tsx); the reader's Reload tells that worker to take over and reloads the
 * page once it has. Nothing reloads by itself: the first worker also takes control of the page
 * that registered it, and another window's Reload changes the controller of this one too.
 */
export interface ServiceWorkerHost {
  prod: boolean;
  /** Vite's base path, ending in '/'. */
  base: string;
  serviceWorker:
    Pick<ServiceWorkerContainer, 'register' | 'controller' | 'addEventListener'> | undefined;
  whenLoaded(run: () => void): void;
  /** Shows the offer of the newer build; `reload` runs when the reader accepts it. */
  offerUpdate(reload: () => void): void;
  /** Reloads the page. */
  reload(): void;
}

/** The message sw.ts takes to skip its wait. */
const SKIP_WAITING = { type: 'skip-waiting' };

export function registerServiceWorker(host: ServiceWorkerHost = browserHost()): void {
  const container = host.serviceWorker;
  if (!host.prod || !container) return;
  host.whenLoaded(() => {
    Promise.resolve()
      .then(() =>
        container.register(`${host.base}sw.js`, { scope: host.base, updateViaCache: 'none' }),
      )
      .then((registration) => offerWaitingUpdate(registration, container, host))
      .catch((e: unknown) => console.warn('service worker registration failed', e));
  });
}

/**
 * Offers a newer build as soon as its worker waits: one that waits already, one still installing,
 * and one found later. An install while nothing controls the page is the first worker, not an
 * update. The offer reloads once: the listener is added at the reader's first Reload and fires
 * once, whichever way the controller changes.
 */
function offerWaitingUpdate(
  registration: ServiceWorkerRegistration | undefined,
  container: NonNullable<ServiceWorkerHost['serviceWorker']>,
  host: ServiceWorkerHost,
): void {
  if (!registration) return; // a register stubbed to resolve to nothing (Playwright's serviceWorkers: block)
  let accepted = false;
  const reload = () => {
    // The waiting worker may be gone already (another window's Reload took it live): the page
    // then only has to reload to meet the newer build.
    const waiting = registration.waiting;
    if (!waiting) {
      host.reload();
      return;
    }
    if (!accepted) {
      accepted = true;
      container.addEventListener('controllerchange', () => host.reload(), { once: true });
    }
    waiting.postMessage(SKIP_WAITING);
  };
  const offerWhenInstalled = (worker: ServiceWorker) => {
    const check = () => {
      if (worker.state === 'installed' && container.controller) host.offerUpdate(reload);
    };
    worker.addEventListener('statechange', check);
    check();
  };
  if (registration.waiting) host.offerUpdate(reload);
  else if (registration.installing) offerWhenInstalled(registration.installing);
  registration.addEventListener('updatefound', () => {
    if (registration.installing) offerWhenInstalled(registration.installing);
  });
}

function browserHost(): ServiceWorkerHost {
  return {
    prod: import.meta.env.PROD,
    base: import.meta.env.BASE_URL,
    serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    whenLoaded: (run) => {
      if (document.readyState === 'complete') run();
      else window.addEventListener('load', run, { once: true });
    },
    offerUpdate: (reload) => useAppStore.getState().setUpdateReady(reload),
    reload: () => window.location.reload(),
  };
}
