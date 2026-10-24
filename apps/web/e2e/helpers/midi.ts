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
   * The Practice tempo of pieces, by library slug (issue 185): merged into the stored settings as
   * `tempoByPiece`, like `playAlong`. A walk held for its time is long at the written tempo; 1.5,
   * the top of the slider, makes every hold two thirds as long. It is the reader's own setting.
   */
  tempo?: Record<string, number>;
  /**
   * `requestMIDIAccess` stays pending whatever the permission says, until `resolve` answers it:
   * Chrome's WinRT backend while a Bluetooth piano is off (issue 182).
   */
  hang?: boolean;
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
  /** The hold in real milliseconds of the step `target()` names, 0 when none (issue 185). */
  hold(): number;
}

/** Where the transport is as the listener hears it (audio/timeline.ts, issue 192). */
export interface HeardAt {
  pass: number;
  perfSec: number;
  factor: number;
}

/** One pass of a run of Play (audio/timeline.ts). */
export interface PassSpan {
  pass: number;
  fromSec: number;
  toSec: number | null;
  wrapped: boolean;
  countedIn: boolean;
}

/** A note-on the timing run heard while armed (score/useTimingRun.ts). */
export interface TimingLogEntry {
  midi: number;
  arrivalMs: number;
  atMs: number;
  pass: number | null;
  perfSec: number | null;
  factor: number | null;
}

/** A step of the hands played as the timing judge has it. */
export interface TimingStepView {
  perfSec: number;
  pitches: number[];
  parts: { hand: 'L' | 'R'; pitches: number[]; key: string }[];
}

/** One judged unit (score/timing.ts). */
export interface UnitVerdictView {
  key: string;
  hand: 'L' | 'R';
  ids: string[];
  verdict: 'onTime' | 'early' | 'late' | 'missed';
  offsetMs: number | null;
  offsetSec: number | null;
  tolMs: number;
  hearings: number;
}

/** How the last run went (score/timing.ts's RunJudgement). */
export interface JudgementView {
  verdicts: UnitVerdictView[];
  onTime: number;
  total: number;
  biasMs: number;
  playedShare: number;
}

/** The timing run's hook (`?audio=silent` or `?hooks=1`, issue 192). */
interface TimingHook {
  presses(): TimingLogEntry[];
  passes(): PassSpan[];
  steps(): TimingStepView[];
  heardNow(): HeardAt | null;
  judgement(): JudgementView | null;
}

type Windowed = {
  __fakeMidi?: FakeHost;
  __digitus2Along?: AlongHook;
  __digitus2Timing?: TimingHook;
  __digitus2Keys?: {
    strikes(): number[];
    accompanied(): AccompaniedNote[];
    accompCancelled(): CancelledNote[];
    audioState(): AudioContextState | 'none';
    outputLatency(): number | null;
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
    /** The hold in real milliseconds of the step the red waits on, 0 when it names none (issue 185). */
    async hold(): Promise<number> {
      return page.evaluate(() => (window as unknown as Windowed).__digitus2Along?.hold() ?? 0);
    },
    /**
     * Presses every pitch of the step the red waits on and holds them: no release, so the step
     * runs from the press (the other hand starts there, issue 184) and passes only once it has been
     * held for its time (issue 185). With `wait` false it does not wait for the step to settle
     * first, which is what a press right after `waitForStep` needs. Returns the step's index.
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
     * Presses every pitch of the step the red waits on, holds them until the walk moves on from
     * that step (a step passes once its keys have been held for its time, issue 185), and then
     * lets go. Returns the index of the step it played and the milliseconds from the press to the
     * walk's move, both taken in the page; the wait there polls on animation frames and throws
     * after 10 s. Waits for a step first, so it also serves the moment after a finish or a seek.
     */
    async playRedTimed(): Promise<{ index: number; ms: number }> {
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
        return { index, ms: performance.now() - started };
      });
    },
    /**
     * Plays the step the red waits on: holds all of its pitches until the walk has left that
     * step, then lets go (`playRedTimed`). Returns the index of the step it played.
     */
    async playRed(): Promise<number> {
      return (await api.playRedTimed()).index;
    },
    /**
     * Presses the pitches, holds them `ms` milliseconds and lets go, all in the page, so a slow
     * round trip cannot make a short hold long. Returns the milliseconds the keys were down, as
     * the page measured them: a test of a short hold checks that a busy PC did not make it long.
     */
    async tap(pitches: number[], ms: number): Promise<number> {
      await listening();
      return page.evaluate(
        async ([ps, held]) => {
          const host = (window as unknown as Windowed).__fakeMidi!;
          const started = performance.now();
          for (const midi of ps as number[]) host.send([0x90, midi, 100]);
          await new Promise((r) => setTimeout(r, held as number));
          for (const midi of ps as number[]) host.send([0x80, midi, 0]);
          return performance.now() - started;
        },
        [pitches, ms] as const,
      );
    },
  };
  return api;
}

/** The timing run's hook (issue 192), read through the page; null when it is not installed. */
export function timingHook(page: Page) {
  return {
    steps: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.steps() ?? []),
    judgement: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.judgement() ?? null),
    presses: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.presses() ?? []),
    passes: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.passes() ?? []),
  };
}

/** One hearing of a step to play in `playAlongTimed`. */
export interface TimedHearing {
  /** The pass's ordinal in the run (0 first). */
  pass: number;
  /** The step's index in `__digitus2Timing.steps()`. */
  index: number;
  /** How far from the beat the keys go down, in real milliseconds (negative early). */
  offsetMs?: number;
  /** Not played at all. */
  skip?: boolean;
}

export interface TimedPlan {
  hearings: TimedHearing[];
  /**
   * The passes the run goes through, in performance seconds: a loop's stretch per pass, or the
   * piece's span (`toSec` null for an open end). They join end to start, as a loop's do.
   */
  passes: { fromSec: number; toSec: number | null }[];
  /** How long each step's keys are held, in real milliseconds; default 150. */
  holdMs?: number;
  /** Clicks Pause from inside the page on the first frame at or after this point. */
  pauseAt?: { pass: number; perfSec: number };
  /** Clicks Play from inside the page first, so the run cannot start before the loop listens. */
  play?: boolean;
  /** Gives up after this many real milliseconds; default 45 000. */
  timeoutMs?: number;
}

/** What `playAlongTimed` did, as the page measured it. */
export interface TimedReport {
  sent: {
    pass: number;
    index: number;
    pitches: number[];
    /** The target on the run axis (performance seconds) and the axis at the frame it was sent. */
    target: number;
    axis: number;
    /** The event time stamped on the note-ons, and the page's clock when they were sent. */
    atMs: number;
    sentMs: number;
  }[];
  /**
   * The page on the frame the run's first note-on goes out, read before it is sent (and on every
   * playing frame until then): the timing rings drawn and the status line, so a check can see what
   * Play cleared before any note. Null only when the run never played; with no hearing to send it
   * is the last playing frame.
   */
  beforeFirstNote: { marks: number; status: string; perfSec: number } | null;
  /** The axis at the frame Pause was clicked, null when it was not. */
  pausedAxis: number | null;
}

/**
 * Plays along with a run of Play on the fake piano, with set offsets (issue 192), timed in the
 * page by a `requestAnimationFrame` loop that reads `__digitus2Timing.heardNow()`, never by
 * Playwright round trips. Each hearing's target is on the run axis built from `plan.passes`
 * (`axis(pass, step.perfSec) + offsetMs / 1000 * factor`), so an early press across a loop's wrap
 * fires while the pass before is heard. On the first frame at or after a target the step's
 * note-ons are sent stamped with the target's own instant (`now - (axisNow - target) / factor`),
 * and the note-offs `holdMs` later. With `pauseAt` it clicks Pause; it returns once the transport
 * has stopped (Pause or the end) and every key is up.
 */
export async function playAlongTimed(page: Page, plan: TimedPlan): Promise<TimedReport> {
  return page.evaluate(async (p) => {
    const w = window as unknown as Windowed;
    const timing = w.__digitus2Timing;
    const host = w.__fakeMidi;
    if (!timing || !host) throw new Error('the timing hook and the fake piano are needed');
    const steps = timing.steps();
    const offsets: number[] = [];
    let at = 0;
    for (const pass of p.passes) {
      offsets.push(at);
      at += (pass.toSec ?? Infinity) - pass.fromSec;
    }
    const axis = (pass: number, perfSec: number) =>
      offsets[pass]! + perfSec - p.passes[pass]!.fromSec;
    const pending = p.hearings
      .filter((h) => !h.skip)
      .map((h) => {
        const step = steps[h.index];
        if (!step) throw new Error(`no step ${h.index} among ${steps.length}`);
        return { ...h, pitches: step.pitches, base: axis(h.pass, step.perfSec) };
      });
    const report: TimedReport = { sent: [], beforeFirstNote: null, pausedAxis: null };
    const releases: Promise<void>[] = [];
    const holdMs = p.holdMs ?? 150;
    const started = performance.now();
    const playButton = () => document.querySelector<HTMLElement>('.dock .play-button');
    if (p.play) {
      const button = playButton();
      if (!button) throw new Error('no Play button');
      button.click();
    }
    await new Promise<void>((resolve, reject) => {
      let heard = false;
      const frame = () => {
        try {
          const now = performance.now();
          if (now - started > (p.timeoutMs ?? 45_000)) {
            reject(new Error(`the run did not stop; sent ${report.sent.length} steps`));
            return;
          }
          const h = timing.heardNow();
          if (!h) {
            if (heard) resolve();
            else requestAnimationFrame(frame);
            return;
          }
          heard = true;
          // Read on every playing frame until a note goes out, before this frame sends one: the
          // last reading is the page as the first note-on is sent, wherever the start delay, a
          // flight or a slow frame left the clock (a window inside the start delay alone can be
          // missed by every frame when the page is loaded).
          if (report.sent.length === 0) {
            report.beforeFirstNote = {
              marks: document.querySelectorAll('.timing-mark').length,
              status: document.querySelector('.dock [role="status"]')?.textContent ?? '',
              perfSec: h.perfSec,
            };
          }
          const run = timing.passes();
          const ordinal = run.findIndex((pass) => pass.pass === h.pass);
          if (ordinal < 0 || ordinal >= p.passes.length) {
            requestAnimationFrame(frame);
            return;
          }
          const axisNow = axis(ordinal, h.perfSec);
          for (let i = 0; i < pending.length;) {
            const q = pending[i]!;
            const target = q.base + ((q.offsetMs ?? 0) / 1000) * h.factor;
            if (target > axisNow) {
              i++;
              continue;
            }
            pending.splice(i, 1);
            const atMs = now - ((axisNow - target) / h.factor) * 1000;
            for (const midi of q.pitches) host.send([0x90, midi, 100], undefined, atMs);
            report.sent.push({
              pass: q.pass,
              index: q.index,
              pitches: q.pitches,
              target,
              axis: axisNow,
              atMs,
              sentMs: performance.now(),
            });
            releases.push(
              new Promise<void>((done) =>
                setTimeout(() => {
                  for (const midi of q.pitches) host.send([0x80, midi, 0]);
                  done();
                }, holdMs),
              ),
            );
          }
          if (
            p.pauseAt &&
            report.pausedAxis === null &&
            axisNow >= axis(p.pauseAt.pass, p.pauseAt.perfSec)
          ) {
            report.pausedAxis = axisNow;
            playButton()?.click();
          }
          requestAnimationFrame(frame);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      requestAnimationFrame(frame);
    });
    await Promise.all(releases);
    return report;
  }, plan);
}

/** Hearings of the steps `indices` in pass `pass`, on time unless `offsets` or `skip` say. */
export function timedHearings(
  indices: readonly number[],
  o: { pass?: number; offsets?: Record<number, number>; skip?: readonly number[] } = {},
): TimedHearing[] {
  return indices.map((index) => ({
    pass: o.pass ?? 0,
    index,
    offsetMs: o.offsets?.[index] ?? 0,
    skip: o.skip?.includes(index) ?? false,
  }));
}
