/**
 * Registers the service worker (src/sw/sw.ts, built to `sw.js` next to index.html) once the page
 * has loaded, on production builds only: `vite dev` serves no sw.js. `updateViaCache: 'none'`
 * makes the browser check sw.js itself for a new build. A failed registration (blocked site data,
 * an insecure origin) leaves the app as it was, online only: the reader sees nothing, and the
 * console gets one warning for whoever debugs it.
 */
export interface ServiceWorkerHost {
  prod: boolean;
  /** Vite's base path, ending in '/'. */
  base: string;
  serviceWorker: Pick<ServiceWorkerContainer, 'register'> | undefined;
  whenLoaded(run: () => void): void;
}

export function registerServiceWorker(host: ServiceWorkerHost = browserHost()): void {
  const container = host.serviceWorker;
  if (!host.prod || !container) return;
  host.whenLoaded(() => {
    Promise.resolve()
      .then(() =>
        container.register(`${host.base}sw.js`, { scope: host.base, updateViaCache: 'none' }),
      )
      .catch((e: unknown) => console.warn('service worker registration failed', e));
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
  };
}
