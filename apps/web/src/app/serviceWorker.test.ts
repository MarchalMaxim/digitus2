import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, type ServiceWorkerHost } from './serviceWorker.js';

/** A worker that reports its state changes, and records what the page posts to it. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  postMessage = vi.fn();
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  /** A newer build's worker starts installing, as the browser reports it. */
  found(worker: FakeWorker) {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
  }
  /** The installing worker finishes: it waits, and then says so. */
  install(worker: FakeWorker) {
    this.installing = null;
    this.waiting = worker;
    worker.become('installed');
  }
}

class FakeContainer extends EventTarget {
  controller: object | null = {};
  register = vi.fn(() =>
    Promise.resolve(new FakeRegistration() as unknown as ServiceWorkerRegistration),
  );
}

function fakeHost(overrides: Partial<ServiceWorkerHost> = {}) {
  const onLoad: (() => void)[] = [];
  const registration = new FakeRegistration();
  const container = new FakeContainer();
  container.register.mockImplementation(() =>
    Promise.resolve(registration as unknown as ServiceWorkerRegistration),
  );
  const whenLoaded = vi.fn((run: () => void) => {
    onLoad.push(run);
  });
  const offerUpdate = vi.fn<ServiceWorkerHost['offerUpdate']>();
  const reload = vi.fn();
  const host: ServiceWorkerHost = {
    prod: true,
    base: '/digitus2/',
    serviceWorker: container as unknown as ServiceWorkerHost['serviceWorker'],
    whenLoaded,
    offerUpdate,
    reload,
    ...overrides,
  };
  return {
    host,
    register: container.register,
    container,
    registration,
    whenLoaded,
    offerUpdate,
    reload,
    load: () => onLoad.forEach((run) => run()),
  };
}

/** Registers, loads the page, and waits until the registration has been looked at. */
async function started(setup: (f: ReturnType<typeof fakeHost>) => void = () => {}) {
  const fake = fakeHost();
  setup(fake);
  registerServiceWorker(fake.host);
  fake.load();
  await vi.waitFor(() => expect(fake.register).toHaveBeenCalledTimes(1));
  // The registration promise resolves, then the offer logic runs in the next microtasks.
  await new Promise((r) => setTimeout(r, 0));
  return fake;
}

describe('registerServiceWorker', () => {
  it('registers sw.js at the base path once the page has loaded, updates bypassing the HTTP cache', async () => {
    const { host, register, load } = fakeHost();
    registerServiceWorker(host);
    expect(register).not.toHaveBeenCalled();
    load();
    await vi.waitFor(() =>
      expect(register).toHaveBeenCalledWith('/digitus2/sw.js', {
        scope: '/digitus2/',
        updateViaCache: 'none',
      }),
    );
  });

  it('does nothing on a development server', () => {
    const dev = fakeHost({ prod: false });
    registerServiceWorker(dev.host);
    expect(dev.whenLoaded).not.toHaveBeenCalled();
    dev.load();
    expect(dev.register).not.toHaveBeenCalled();
  });

  it('does nothing where the browser has no service workers', () => {
    const none = fakeHost({ serviceWorker: undefined });
    expect(() => registerServiceWorker(none.host)).not.toThrow();
    expect(none.whenLoaded).not.toHaveBeenCalled();
    none.load();
    expect(none.register).not.toHaveBeenCalled();
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('blocked'))],
    [
      'throws',
      () => {
        throw new Error('insecure context');
      },
    ],
  ])('warns once on the console and shows nothing when the registration %s', async (_, fail) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failing = fakeHost();
      failing.register.mockImplementation(fail);
      registerServiceWorker(failing.host);
      expect(() => failing.load()).not.toThrow();
      await vi.waitFor(() => expect(failing.register).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 0));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toBe('service worker registration failed');
      expect(error).not.toHaveBeenCalled();
      expect(failing.offerUpdate).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe('a newer build', () => {
  it('is offered at once when its worker waits already, and takes over when the reader reloads', async () => {
    const worker = new FakeWorker();
    worker.state = 'installed';
    const fake = await started((f) => {
      f.registration.waiting = worker;
    });
    expect(fake.offerUpdate).toHaveBeenCalledTimes(1);
    // Nothing happens until the reader accepts: the old build keeps running.
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(fake.reload).not.toHaveBeenCalled();

    fake.offerUpdate.mock.calls[0]![0]();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
    // The page reloads when the worker has taken control, not before.
    expect(fake.reload).not.toHaveBeenCalled();
    fake.container.dispatchEvent(new Event('controllerchange'));
    expect(fake.reload).toHaveBeenCalledTimes(1);
    // Once: a controller that changes again cannot start a loop.
    fake.container.dispatchEvent(new Event('controllerchange'));
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });

  it('is offered when a worker finishes installing while the page is open', async () => {
    const fake = await started();
    expect(fake.offerUpdate).not.toHaveBeenCalled();
    const worker = new FakeWorker();
    fake.registration.found(worker);
    expect(fake.offerUpdate).not.toHaveBeenCalled();
    fake.registration.install(worker);
    expect(fake.offerUpdate).toHaveBeenCalledTimes(1);

    fake.offerUpdate.mock.calls[0]![0]();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
  });

  it('is offered when its worker is still installing as the page registers', async () => {
    const worker = new FakeWorker();
    const fake = await started((f) => {
      f.registration.installing = worker;
    });
    expect(fake.offerUpdate).not.toHaveBeenCalled();
    fake.registration.install(worker);
    expect(fake.offerUpdate).toHaveBeenCalledTimes(1);
  });

  it('is not offered for the first worker, which has nothing to replace', async () => {
    const fake = await started((f) => {
      f.container.controller = null;
    });
    const worker = new FakeWorker();
    fake.registration.found(worker);
    fake.registration.install(worker);
    worker.become('activating');
    worker.become('activated');
    expect(fake.offerUpdate).not.toHaveBeenCalled();
  });

  it('does not reload the page when the controller changes without the reader asking', async () => {
    // The first worker claims the page that registered it, and another window's Reload changes
    // this window's controller as well: neither may pull the page out from under its reader.
    const fake = await started();
    fake.container.dispatchEvent(new Event('controllerchange'));
    expect(fake.reload).not.toHaveBeenCalled();
  });

  it('reloads at once when the waiting worker took over meanwhile', async () => {
    const worker = new FakeWorker();
    worker.state = 'installed';
    const fake = await started((f) => {
      f.registration.waiting = worker;
    });
    // Another window pressed Reload first: this registration has no waiting worker any more.
    fake.registration.waiting = null;
    fake.offerUpdate.mock.calls[0]![0]();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });

  it('asks again when the reader presses Reload twice, and still reloads once', async () => {
    const worker = new FakeWorker();
    worker.state = 'installed';
    const fake = await started((f) => {
      f.registration.waiting = worker;
    });
    const reload = fake.offerUpdate.mock.calls[0]![0];
    reload();
    reload();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    fake.container.dispatchEvent(new Event('controllerchange'));
    fake.container.dispatchEvent(new Event('controllerchange'));
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });
});
