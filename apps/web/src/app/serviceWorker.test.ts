import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, type ServiceWorkerHost } from './serviceWorker.js';

function fakeHost(overrides: Partial<ServiceWorkerHost> = {}) {
  const onLoad: (() => void)[] = [];
  const register = vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration));
  const whenLoaded = vi.fn((run: () => void) => {
    onLoad.push(run);
  });
  const host: ServiceWorkerHost = {
    prod: true,
    base: '/digitus2/',
    serviceWorker: { register },
    whenLoaded,
    ...overrides,
  };
  return { host, register, whenLoaded, load: () => onLoad.forEach((run) => run()) };
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
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
