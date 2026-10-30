import { expect, type Page } from '@playwright/test';

/**
 * A fake Web MIDI for the play-along flows (issue 182), injected before the page loads. No real
 * piano and no real browser prompt: the page gets a `requestMIDIAccess` of its own whose answer,
 * inputs and notes the test decides, and a `permissions.query({ name: 'midi' })` that follows it.
 */
export interface FakeMidiOptions {
  /** What `permissions.query({ name: 'midi' })` answers at the start; default 'prompt'. */
  permission?: 'prompt' | 'granted' | 'denied';
  /**
   * The browser's prompt, answered when `requestMIDIAccess` is called with the permission on
   * 'prompt'; default 'allow'. 'manual' holds the request until `resolve` answers it.
   */
  answer?: 'allow' | 'block' | 'dismiss' | 'manual';
  /** The inputs connected when access is granted; default ['GO:PIANO MIDI 1']. */
  inputs?: string[];
  /** Overrides `userAgentData.platform` and the user agent's platform part. */
  platform?: 'Windows' | 'Linux';
  /** Deletes `navigator.requestMIDIAccess`, as in Safari. */
  unsupported?: boolean;
  /** Merged into the stored settings on the first load of a test (a reload keeps what the app made of it). */
  playAlong?: boolean;
  /**
   * Further stored settings, merged on the first load of a test like `playAlong`, e.g. `hands`
   * or a piece's tempo. A spec that needs the Hands control set before the page loads seeds it
   * here and never clicks the Practice panel: a click is a user activation, and a flow about the
   * browser's autoplay policy must not have one.
   */
  settings?: Record<string, unknown>;
  /**
   * The Practice tempo of pieces, by library slug: merged into the stored settings as
   * `tempoByPiece`, like `playAlong`. It sets the halo's length and the other hand's pace
   * (issue 204). It is the reader's own setting.
   */
  tempo?: Record<string, number>;
  /**
   * `requestMIDIAccess` stays pending whatever the permission says, until `resolve` answers it:
   * Chrome's WinRT backend while a Bluetooth piano is off (issue 182).
   */
  hang?: boolean;
  /**
   * The piano is listed, `connected` and `open`, and nothing it plays reaches the page, through
   * every new `requestMIDIAccess` and every reload of the page, until `wake` (issue 252). This is
   * Chrome's WinRT backend on Windows after a Bluetooth piano was turned off and on while the
   * browser held its port: the browser keeps the port for the life of its process, Windows keeps
   * it listed, and only a new browser process hears the piano again (`wake`).
   */
  deaf?: boolean;
}

type Answer = 'allow' | 'block' | 'dismiss';

/** The fake's state in the page; the helpers below only read and drive it. */
interface FakeHost {
  requests: number;
  options: unknown[];
  pending: Array<(answer: Answer) => void>;
  access: unknown;
  inputs: Map<string, FakeInput>;
  permission(): string;
  plug(name: string): void;
  unplug(name?: string): void;
  remove(name?: string): void;
  /** `atMs`: the event's `timeStamp` (performance.now() ms), as a piano's message carries it. */
  send(bytes: number[], input?: string, atMs?: number): void;
  /** Deaf (`FakeMidiOptions.deaf`): the piano plays and nothing reaches the page. */
  deaf(): boolean;
  /** The piano heard again, as a new browser process hears it. */
  wake(): void;
}

interface FakeInput extends EventTarget {
  id: string;
  name: string;
  state: string;
  connection: string;
  onmidimessage: ((e: unknown) => void) | null;
}

interface AlongHook {
  target(): number[];
  index(): number;
  /**
   * The whole length in real ms of the halo of the step `target()` names while it runs, 0 when
   * there is none (issue 204).
   */
  halo(): number;
}

/**
 * The walk's timing hook (`?audio=silent` or `?hooks=1`, issue 192): the shape of
 * `WalkTimingHook` in src/score/useWalkTiming.ts, declared here so the helpers stand alone.
 */
export interface WalkTimingHook {
  /** The steps of the hands played, aligned with `__digitus2Along`'s indices. */
  steps(): {
    perfSec: number;
    pitches: number[];
    bar: number;
    writtenBar: number;
    ids: string[];
    holdMs: number;
  }[];
  /** The onsets since the last clear, resolved. `ms` is the decisive key's event time. */
  onsets(): { index: number; ms: number; chain: number }[];
  /** Every judgement since the last clear, in order, with the performance bar judged. */
  judged(): {
    bar: number;
    index: number;
    verdict: 'onTime' | 'early' | 'late';
    offsetMs: number;
    tolMs: number;
  }[];
  /** Ringed steps kept now (the sheet draws one ring per staff of each). */
  markCount(): number;
}

type Windowed = {
  __fakeMidi?: FakeHost;
  __digitus2Along?: AlongHook;
  __digitus2Timing?: WalkTimingHook;
  __digitus2Keys?: {
    strikes(): number[];
    accompanied(): AccompaniedNote[];
    accompCancelled(): CancelledNote[];
    audioState(): AudioContextState | 'none';
  };
};

/** A note the accompaniment handed to the instrument (issue 184); `time` is on the audio clock. */
export interface AccompaniedNote {
  midi: number;
  hand: 'L' | 'R';
  time: number;
  duration: number;
  velocity: number;
}

/** A note the accompaniment dropped from its queue, cancelled before it sounded, or released. */
export interface CancelledNote {
  midi: number;
  time: number;
}

/** Installs the fake before the page loads (call it before `goto`; it also serves every reload). */
export async function installFakeMidi(page: Page, o: FakeMidiOptions = {}): Promise<void> {
  await page.addInitScript(
    (cfg) => {
      const w = window as unknown as Windowed & Record<string, unknown>;
      const KEY = 'digitus2.fakeMidi';
      const keep = (name: string, value?: string): string | null => {
        try {
          if (value === undefined) return sessionStorage.getItem(`${KEY}.${name}`);
          sessionStorage.setItem(`${KEY}.${name}`, value);
        } catch {
          // No storage in this frame: the fake then starts from the options on each load.
        }
        return value ?? null;
      };

      // The stored settings, once per test: a reload keeps what the app did with them.
      if (
        (cfg.playAlong !== null || cfg.settings !== null || cfg.tempo !== null) &&
        keep('seeded') === null
      ) {
        keep('seeded', '1');
        try {
          const stored = JSON.parse(localStorage.getItem('digitus2.settings.v1') ?? 'null') as {
            state?: { settings?: Record<string, unknown> };
            version?: number;
          } | null;
          const settings: Record<string, unknown> = {
            ...(stored?.state?.settings ?? {}),
            ...(cfg.settings ?? {}),
          };
          if (cfg.playAlong !== null) settings.playAlong = cfg.playAlong;
          if (cfg.tempo !== null) {
            settings.tempoByPiece = {
              ...((settings.tempoByPiece as Record<string, number> | undefined) ?? {}),
              ...Object.fromEntries(
                Object.entries(cfg.tempo).map(([slug, factor]) => [`piece:${slug}`, factor]),
              ),
            };
          }
          localStorage.setItem(
            'digitus2.settings.v1',
            JSON.stringify({ ...stored, state: { ...stored?.state, settings }, version: 2 }),
          );
        } catch {
          // Settings that cannot be written leave the app on its defaults.
        }
      }

      if (cfg.unsupported) {
        delete (Navigator.prototype as unknown as Record<string, unknown>).requestMIDIAccess;
        Object.defineProperty(navigator, 'requestMIDIAccess', {
          value: undefined,
          configurable: true,
        });
        return;
      }

      if (cfg.platform) {
        const part =
          cfg.platform === 'Windows' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
        const agent = navigator.userAgent.replace(/\([^)]*\)/, `(${part})`);
        Object.defineProperty(navigator, 'userAgent', { get: () => agent, configurable: true });
        const hints = (navigator as unknown as { userAgentData?: { brands?: unknown[] } })
          .userAgentData;
        const brands = hints?.brands ?? [{ brand: 'Chromium', version: '120' }];
        Object.defineProperty(navigator, 'userAgentData', {
          get: () => ({ platform: cfg.platform, brands, mobile: false }),
          configurable: true,
        });
      }

      let permission = keep('permission') ?? cfg.permission;
      const setPermission = (next: string) => {
        permission = next;
        keep('permission', next);
      };
      const query = (descriptor: { name: string }) => {
        if (descriptor.name !== 'midi') return Promise.reject(new TypeError('unknown permission'));
        const status = new EventTarget() as EventTarget & { name: string; state: string };
        status.name = 'midi';
        status.state = permission;
        return Promise.resolve(status);
      };
      const originalQuery = navigator.permissions?.query.bind(navigator.permissions);
      Object.defineProperty(navigator.permissions, 'query', {
        value: (d: { name: string }) =>
          d.name === 'midi' || !originalQuery ? query(d) : originalQuery(d as PermissionDescriptor),
        configurable: true,
      });

      // Kept for the tab, as the browser keeps the dead port across reloads of the page.
      let deaf = (keep('deaf') ?? String(cfg.deaf)) === 'true';
      let seq = 0;
      const inputs = new Map<string, FakeInput>();
      // A port as Chrome keeps it: assigning `onmidimessage` opens it (`connection` 'open', and a
      // `statechange` on the port and on the access, a task later), `close()` closes it, and
      // unplugging only marks it disconnected (below).
      const makeInput = (name: string): FakeInput => {
        const input = new EventTarget() as FakeInput;
        let handler: ((e: unknown) => void) | null = null;
        Object.assign(input, {
          id: `fake-input-${++seq}`,
          name,
          manufacturer: 'Fake',
          type: 'input',
          version: '1',
          state: 'connected',
          connection: 'closed',
          onstatechange: null,
          open: () => Promise.resolve(input),
          close: () => {
            if (input.connection === 'open') {
              input.connection = 'closed';
              setTimeout(() => fire(input), 0);
            }
            return Promise.resolve(input);
          },
        });
        Object.defineProperty(input, 'onmidimessage', {
          get: () => handler,
          set: (next: ((e: unknown) => void) | null) => {
            handler = typeof next === 'function' ? next : null;
            if (handler && input.state === 'connected' && input.connection !== 'open') {
              input.connection = 'open';
              setTimeout(() => fire(input), 0);
            }
          },
          enumerable: true,
          configurable: true,
        });
        return input;
      };
      const access = new EventTarget() as EventTarget & {
        inputs: Map<string, FakeInput>;
        outputs: Map<string, unknown>;
        sysexEnabled: boolean;
        onstatechange: ((e: Event) => void) | null;
      };
      access.inputs = inputs;
      access.outputs = new Map();
      access.sysexEnabled = false;
      access.onstatechange = null;
      const fire = (port: FakeInput) => {
        const event = new Event('statechange');
        Object.assign(event, { port });
        if (typeof access.onstatechange === 'function') access.onstatechange(event);
        access.dispatchEvent(event);
      };

      const host: FakeHost = {
        requests: 0,
        options: [],
        pending: [],
        access: null,
        inputs,
        permission: () => permission,
        // A piano plugged in: the port Chrome kept for it comes back as the same object, with the
        // same id; a piano not seen before is a new port.
        plug(name) {
          const kept = [...inputs.values()].find(
            (i) => i.name === name && i.state === 'disconnected',
          );
          const input = kept ?? makeInput(name);
          input.state = 'connected';
          if (!kept) inputs.set(input.id, input);
          fire(input);
        },
        // Unplugged, as Chrome has it: the port stays in the map, marked disconnected.
        unplug(name) {
          for (const input of [...inputs.values()]) {
            if (input.state !== 'connected' || (name !== undefined && input.name !== name))
              continue;
            input.state = 'disconnected';
            input.connection = input.connection === 'open' ? 'pending' : 'closed';
            fire(input);
          }
        },
        // Unplugged, as some browsers have it: the port leaves the map altogether.
        remove(name) {
          for (const input of [...inputs.values()]) {
            if (name !== undefined && input.name !== name) continue;
            input.state = 'disconnected';
            inputs.delete(input.id);
            fire(input);
          }
        },
        send(bytes, name, atMs) {
          const input = [...inputs.values()].find(
            (i) => i.state === 'connected' && (name === undefined || i.name === name),
          );
          if (!input) throw new Error(`no input ${name ?? ''} to send to`);
          if (deaf) return;
          const data = Uint8Array.from(bytes);
          const event =
            typeof MIDIMessageEvent === 'function'
              ? new MIDIMessageEvent('midimessage', { data })
              : Object.assign(new Event('midimessage'), { data });
          // The time the key went down, as a piano's message carries it (issue 192).
          if (atMs !== undefined) Object.defineProperty(event, 'timeStamp', { value: atMs });
          input.onmidimessage?.(event);
          input.dispatchEvent(event);
        },
        deaf: () => deaf,
        wake() {
          deaf = false;
          keep('deaf', 'false');
        },
      };
      w.__fakeMidi = host;

      const grant = (resolve: (access: unknown) => void) => {
        if (host.access === null) {
          for (const name of cfg.inputs) {
            const input = makeInput(name);
            inputs.set(input.id, input);
          }
          host.access = access;
        }
        resolve(access);
      };
      const refuse = (reject: (error: unknown) => void, name: string) =>
        reject(new DOMException('Permission denied.', name));

      Object.defineProperty(navigator, 'requestMIDIAccess', {
        value: (options?: unknown) => {
          host.requests++;
          host.options.push(options ?? null);
          return new Promise((resolve, reject) => {
            const settle = (answer: Answer) => {
              if (answer === 'allow') {
                setPermission('granted');
                grant(resolve);
              } else if (answer === 'block') {
                setPermission('denied');
                refuse(reject, 'SecurityError');
              } else refuse(reject, 'SecurityError');
            };
            if (cfg.hang) host.pending.push(settle);
            else if (permission === 'granted') grant(resolve);
            else if (permission === 'denied') refuse(reject, 'SecurityError');
            else if (cfg.answer === 'manual') host.pending.push(settle);
            else settle(cfg.answer);
          });
        },
        configurable: true,
        writable: true,
      });
    },
    {
      permission: o.permission ?? 'prompt',
      answer: o.answer ?? 'allow',
      inputs: o.inputs ?? ['GO:PIANO MIDI 1'],
      platform: o.platform ?? null,
      unsupported: o.unsupported ?? false,
      playAlong: o.playAlong ?? null,
      settings: o.settings ?? null,
      tempo: o.tempo ?? null,
      hang: o.hang ?? false,
      deaf: o.deaf ?? false,
    },
  );
}

/**
 * Makes `page.evaluate` run without a user gesture, until the returned function is called.
 *
 * Playwright evaluates in the page with `userGesture: true`, and that gives the document sticky
 * user activation: after the first `evaluate`, `locator.textContent()` or `expect(locator)`
 * (they all evaluate), the browser's autoplay policy lets an AudioContext run, so a flow about a
 * page that has had no click or key cannot look at the page at all. Under `quietly` the
 * helpers here, and every helper that goes through `page.evaluate` (red.ts, seek.ts), read the
 * page through the protocol with no gesture; only locators, `waitForFunction` and screenshots
 * stay loud, and the flow keeps away from them until the click it means to make.
 */
export async function quietly(page: Page): Promise<() => void> {
  const cdp = await page.context().newCDPSession(page);
  const target = page as unknown as { evaluate: Page['evaluate'] };
  const loud = target.evaluate;
  // An `undefined` inside the argument (a list with a missing name) must stay `undefined`, which
  // JSON would turn into `null`: it travels as a marker the page turns back.
  const revive =
    "(function revive(v){if(v&&typeof v==='object'){if(v.$undefined===true)return undefined;" +
    'for(const k of Object.keys(v))v[k]=revive(v[k]);}return v;})';
  target.evaluate = (async (fn: unknown, arg?: unknown) => {
    const json = JSON.stringify(arg, (_key, value: unknown) =>
      value === undefined ? { $undefined: true } : value,
    );
    const expression =
      typeof fn === 'function' ? `(${fn.toString()})(${revive}(${json}))` : String(fn);
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression,
      userGesture: false,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result.value;
  }) as Page['evaluate'];
  return () => {
    target.evaluate = loud;
    cdp.detach().catch(() => undefined);
  };
}

/** The walk's hook (`?audio=silent` or `?hooks=1`): the current step's pitches and index, once read. */
function along(page: Page): Promise<{ target: number[]; index: number } | null> {
  return page.evaluate(() => {
    const hook = (window as unknown as Windowed).__digitus2Along;
    return hook ? { target: hook.target(), index: hook.index() } : null;
  });
}

/**
 * The strikes the silent instrument recorded (`?audio=silent`): nothing the reader plays on the
 * piano may be in them, as the app makes no sound for the reader's notes.
 */
export function strikes(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as Windowed).__digitus2Keys?.strikes() ?? []);
}

/**
 * What the accompaniment handed to the instrument (`?audio=silent` or `?hooks=1`), in order:
 * the notes of the hand digitus plays, never Play's notes (issue 184). `time` is on the audio
 * clock: `press + offset / tempo`, so differences within one stretch are exact.
 */
export function accompanied(page: Page): Promise<AccompaniedNote[]> {
  return page.evaluate(() => (window as unknown as Windowed).__digitus2Keys?.accompanied() ?? []);
}

/**
 * What the accompaniment cancelled, in order: a note dropped from its queue before it was handed
 * over, a handed note cancelled before it started, and a sounding note released by a stop.
 */
export function accompCancelled(page: Page): Promise<CancelledNote[]> {
  return page.evaluate(
    () => (window as unknown as Windowed).__digitus2Keys?.accompCancelled() ?? [],
  );
}

/** The page's AudioContext state; 'none' before the app made one. */
export function audioState(page: Page): Promise<AudioContextState | 'none'> {
  return page.evaluate(
    () => (window as unknown as Windowed).__digitus2Keys?.audioState() ?? 'none',
  );
}

/** The helpers that drive the fake once it is installed. */
export function fakeMidi(page: Page) {
  // These poll `page.evaluate` rather than use `waitForFunction`, so that they also work on a
  // page under `quietly` (whose `evaluate` makes no user gesture).
  /** Waits until the app has opened the access and attached its handler to an input. */
  const listening = () =>
    expect
      .poll(() =>
        page.evaluate(() => {
          const host = (window as unknown as Windowed).__fakeMidi;
          return (
            !!host && [...host.inputs.values()].some((i) => typeof i.onmidimessage === 'function')
          );
        }),
      )
      .toBe(true);
  /** Waits until the access exists (the app's request was answered). */
  const opened = () =>
    expect
      .poll(() => page.evaluate(() => (window as unknown as Windowed).__fakeMidi?.access != null))
      .toBe(true);

  const api = {
    /** How many times the page called `requestMIDIAccess` in this document. */
    requests: () => page.evaluate(() => (window as unknown as Windowed).__fakeMidi?.requests ?? 0),
    /** The options of those calls. */
    requestOptions: () =>
      page.evaluate(() => (window as unknown as Windowed).__fakeMidi?.options ?? []),
    /** What `permissions.query({ name: 'midi' })` answers now. */
    permission: () =>
      page.evaluate(() => (window as unknown as Windowed).__fakeMidi?.permission() ?? 'prompt'),
    /** Answers the browser's prompt held back by `answer: 'manual'`. */
    async resolve(answer: Answer): Promise<void> {
      await expect
        .poll(() =>
          page.evaluate(
            () => ((window as unknown as Windowed).__fakeMidi?.pending.length ?? 0) > 0,
          ),
        )
        .toBe(true);
      await page.evaluate((a) => {
        const host = (window as unknown as Windowed).__fakeMidi!;
        host.pending.shift()!(a);
      }, answer);
    },
    /** A piano is plugged in. */
    async plug(name: string): Promise<void> {
      await opened();
      await page.evaluate((n) => (window as unknown as Windowed).__fakeMidi!.plug(n), name);
    },
    /** A piano (by name; all of them without one) is unplugged: its port stays, disconnected. */
    async unplug(name?: string): Promise<void> {
      await opened();
      await page.evaluate((n) => (window as unknown as Windowed).__fakeMidi!.unplug(n), name);
    },
    /** A piano goes the way it does in browsers that drop the port from the list. */
    async remove(name?: string): Promise<void> {
      await opened();
      await page.evaluate((n) => (window as unknown as Windowed).__fakeMidi!.remove(n), name);
    },
    /** Raw bytes arrive from an input (the first one without a name). */
    async send(bytes: number[], input?: string): Promise<void> {
      await listening();
      await page.evaluate(
        ([b, n]) => (window as unknown as Windowed).__fakeMidi!.send(b as number[], n as string),
        [bytes, input] as const,
      );
    },
    async noteOn(
      midi: number,
      o: { channel?: number; velocity?: number; input?: string } = {},
    ): Promise<void> {
      await api.send([0x90 | (o.channel ?? 0), midi, o.velocity ?? 100], o.input);
    },
    async noteOff(midi: number, o: { channel?: number; input?: string } = {}): Promise<void> {
      await api.send([0x80 | (o.channel ?? 0), midi, 0], o.input);
    },
    /** The pitches of the step the red waits on; none while the walk is not active. */
    async target(): Promise<number[]> {
      return (await along(page))?.target ?? [];
    },
    /** The index of that step among the steps played, -1 when there is none. */
    async index(): Promise<number> {
      return (await along(page))?.index ?? -1;
    },
    /**
     * Waits until the red waits on a step, settled: the playback is cued at it (`target()`), no
     * hop or flight is on screen, and the keyboard shows its keys pressed. Right after a seek,
     * a hands change or the finish the walk still names the step of before until it has looked
     * again, and pitches pressed then would play nothing. Returns the step's pitches.
     */
    async waitForStep(): Promise<number[]> {
      let found: number[] = [];
      await expect
        .poll(
          async () => {
            found = await page.evaluate(() => {
              const hook = (window as unknown as Windowed).__digitus2Along;
              const target = hook ? hook.target() : [];
              if (target.length === 0 || document.querySelector('.red-ghost')) return [];
              const down = new Set(
                [...document.querySelectorAll('.keyboard .key.is-pressed')].map((k) =>
                  Number(k.getAttribute('data-midi')),
                ),
              );
              return target.every((midi) => down.has(midi)) ? target : [];
            });
            return found.length;
          },
          { message: 'the red waits on a step, settled' },
        )
        .toBeGreaterThan(0);
      return found;
    },
    /**
     * The whole length in real ms of the halo of the step the red waits on while it runs, 0 when
     * there is none (issue 204).
     */
    async halo(): Promise<number> {
      return page.evaluate(() => (window as unknown as Windowed).__digitus2Along?.halo() ?? 0);
    },
    /**
     * Presses every pitch of the step the red waits on and holds them: the step passes at the press
     * (issue 204) and the other hand starts there (issue 184). With `wait` false it does not wait
     * for the step to settle first, which is what a press right after `waitForStep` needs. Returns
     * the step's index.
     */
    async pressStep(o: { wait?: boolean } = {}): Promise<number> {
      if (o.wait !== false) await api.waitForStep();
      await listening();
      return page.evaluate(() => {
        const w = window as unknown as Windowed;
        const hook = w.__digitus2Along!;
        const pitches = hook.target();
        const index = hook.index();
        for (const midi of pitches) w.__fakeMidi!.send([0x90, midi, 100]);
        return index;
      });
    },
    /**
     * Presses every pitch of the step the red waits on, waits in the page (on animation frames, up
     * to 10 s) until the walk has moved on, which it does at the press, and lets go. Waits for a
     * step first, so it also serves the moment after a finish or a seek. Returns the index of the
     * step it played.
     */
    async playRed(): Promise<number> {
      await api.waitForStep();
      await listening();
      return page.evaluate(async () => {
        const w = window as unknown as Windowed;
        const hook = w.__digitus2Along!;
        const host = w.__fakeMidi!;
        const pitches = hook.target();
        const index = hook.index();
        const started = performance.now();
        for (const midi of pitches) host.send([0x90, midi, 100]);
        try {
          await new Promise<void>((resolve, reject) => {
            const look = () => {
              if (hook.index() !== index) resolve();
              else if (performance.now() - started > 10_000)
                reject(new Error(`the red stayed on step ${index} for 10 s`));
              else requestAnimationFrame(look);
            };
            look();
          });
        } finally {
          for (const midi of pitches) host.send([0x80, midi, 0]);
        }
        return index;
      });
    },
  };
  return api;
}

/** The walk's timing hook (issue 192), read through the page; empty when it is not installed. */
export function walkTiming(page: Page) {
  return {
    steps: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.steps() ?? []),
    judged: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.judged() ?? []),
    onsets: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.onsets() ?? []),
    markCount: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.markCount() ?? 0),
  };
}

/** A rhythm for `walkRhythm` to play on the fake piano. */
export interface RhythmPlan {
  /** The first step (the red must be waiting on it) and the last, inclusive, in walk order. */
  from: number;
  to: number;
  /** The reader's tempo: real milliseconds per performance second. */
  msPerSec: number;
  /** Signed ms added to a step's press (negative: early). */
  offsets?: Record<number, number>;
  /** Extra ms before a step's press (a hesitation), carried to every later step. */
  pauses?: Record<number, number>;
  /** Gives up after this many real ms; default 60 000. */
  timeoutMs?: number;
}

/** What `walkRhythm` did, as the page measured it. */
export interface RhythmReport {
  /** One per step pressed: the stamped time, when it went out, and the page at that moment. */
  sent: {
    index: number;
    pitches: number[];
    /** The event time stamped on the note-ons: the instant the press was scheduled for. */
    atMs: number;
    /** The page's clock when they went out. */
    sentMs: number;
    /** The timing rings drawn on the sheet (SVG groups, one per staff) just before the press. */
    marks: number;
    /** The status line's text just before the press. */
    status: string;
  }[];
}

/**
 * Walks steps `from` to `to` on the fake piano in a set rhythm (issue 192), entirely in the page,
 * so a round trip never lands in the reader's gaps. Step i is pressed at
 * `t0 + (perfSec_i - perfSec_from) * msPerSec + offsets[i] + the pauses up to and including i`,
 * every pitch stamped with that instant as its event time. A step is let go 200 ms after its
 * note's length up to the next step (`holdMs`), or 100 ms before the next press when that is
 * later; the walk passes each step at its press, so the releases only shape the keys' levels.
 * Resolves once the red has left step `to`.
 *
 * Consecutive calls are one continuous chain unless a seek or Rewind comes between them: the gap
 * between two calls is the last step's release (its note length plus 200 ms) plus a round trip,
 * not the reader's rhythm, and it would be judged.
 */
export async function walkRhythm(page: Page, plan: RhythmPlan): Promise<RhythmReport> {
  // The handler must be attached before the first key goes out.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = (window as unknown as Windowed).__fakeMidi;
        return (
          !!host && [...host.inputs.values()].some((i) => typeof i.onmidimessage === 'function')
        );
      }),
    )
    .toBe(true);
  return page.evaluate(async (p) => {
    const w = window as unknown as Windowed;
    const timing = w.__digitus2Timing;
    const walk = w.__digitus2Along;
    const host = w.__fakeMidi;
    if (!timing || !walk || !host) {
      throw new Error('the timing hook, the walk hook and the fake piano are needed');
    }
    const steps = timing.steps();
    const first = steps[p.from];
    const last = steps[p.to];
    if (!first || !last || p.to < p.from) {
      throw new Error(`no steps ${p.from} to ${p.to} among ${steps.length}`);
    }
    if (walk.index() !== p.from) {
      throw new Error(`the red waits on step ${walk.index()}, not on step ${p.from}`);
    }

    // The presses (P) and the releases (R), in performance.now() ms.
    const t0 = performance.now() + 50;
    const press: number[] = [];
    let paused = 0;
    for (let i = p.from; i <= p.to; i++) {
      if (i > p.from) paused += p.pauses?.[i] ?? 0;
      press.push(
        t0 + (steps[i]!.perfSec - first.perfSec) * p.msPerSec + (p.offsets?.[i] ?? 0) + paused,
      );
    }
    for (let k = 1; k < press.length; k++) {
      if (!(press[k]! > press[k - 1]!)) {
        throw new Error(`the plan presses step ${p.from + k} before step ${p.from + k - 1}`);
      }
    }
    const release = press.map((t, k) => {
      const held = t + steps[p.from + k]!.holdMs + 200;
      return k < press.length - 1 ? Math.max(press[k + 1]! - 100, held) : held;
    });
    for (let k = 0; k < press.length; k++) {
      for (const midi of steps[p.from + k]!.pitches) {
        for (let j = k + 1; j < press.length; j++) {
          if (steps[p.from + j]!.pitches.includes(midi) && press[j]! < release[k]! + 30) {
            throw new Error(
              `the plan presses ${midi} again before it comes up (step ${p.from + j} after step ${p.from + k})`,
            );
          }
        }
      }
    }

    // The events in time order, a release before a press at the same instant.
    const events: { t: number; on: boolean; index: number; pitches: number[] }[] = [];
    press.forEach((t, k) => {
      const { pitches } = steps[p.from + k]!;
      events.push({ t, on: true, index: p.from + k, pitches });
      events.push({ t: release[k]!, on: false, index: p.from + k, pitches });
    });
    events.sort((a, b) => a.t - b.t || (a.on === b.on ? 0 : a.on ? 1 : -1));

    const report: RhythmReport = { sent: [] };
    const deadline = performance.now() + (p.timeoutMs ?? 60_000);
    await new Promise<void>((resolve, reject) => {
      let next = 0;
      const tick = () => {
        try {
          if (performance.now() > deadline) {
            reject(new Error(`the plan did not finish; sent ${report.sent.length} steps`));
            return;
          }
          while (next < events.length && performance.now() >= events[next]!.t) {
            const event = events[next++]!;
            if (event.on) {
              report.sent.push({
                index: event.index,
                pitches: [...event.pitches],
                atMs: event.t,
                sentMs: performance.now(),
                marks: document.querySelectorAll('.timing-mark').length,
                status: document.querySelector('.dock [role="status"]')?.textContent ?? '',
              });
            }
            // The stamp is the scheduled instant, never later than now.
            for (const midi of event.pitches) {
              host.send(event.on ? [0x90, midi, 100] : [0x80, midi, 0], undefined, event.t);
            }
          }
          if (next < events.length) setTimeout(tick, 2);
          else resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      setTimeout(tick, 2);
    });
    await new Promise<void>((resolve, reject) => {
      const look = () => {
        if (walk.index() !== p.to) resolve();
        else if (performance.now() > deadline) {
          reject(new Error(`the red stayed on step ${p.to} after its last release`));
        } else requestAnimationFrame(look);
      };
      look();
    });
    return report;
  }, plan);
}
