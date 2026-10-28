import { expect, test } from '@playwright/test';

// A browser can hand the page a MIDI access whose piano port stays silent although the piano plays
// (Chrome on Windows over Bluetooth MIDI, seen on the owner's GO:PIANO after a page load): the line
// says connected and no key is ever heard. The page heals it by opening the access again while a
// score is open and nothing has been heard (`usePianoHealer`). The fake here gives the first access
// a deaf port and every later one a live port, and the page opens on a score straight from its
// address, so the access is the silent one made at page load, with no press.
//
// The healer counts from the moment the access opened, and a slow runner can take longer than its
// first wait to show the score. So the page starts hidden, where the healer waits, and the test
// shows it when the deaf press is done; showing the page starts the healer's wait afresh.

const MINUET = 'bach-minuet-g-major-bwv-anh-114';

test.use({ viewport: { width: 1280, height: 900 } });

test('a piano port that stays silent after the page loads is opened again, and the walk follows', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'digitus2.settings.v1',
      JSON.stringify({
        state: { settings: { playAlong: true, practiceMode: true, hands: 'both' } },
        version: 2,
      }),
    );
    const w = window as unknown as {
      __deaf: { requests: number; on(midi: number): void; off(midi: number): void };
    };
    const live: {
      deaf: boolean;
      port: { onmidimessage: ((e: MIDIMessageEvent) => void) | null };
    }[] = [];
    const fake = {
      requests: 0,
      on: (midi: number) => send(0x90, midi, 80),
      off: (midi: number) => send(0x80, midi, 0),
    };
    function send(status: number, midi: number, velocity: number): void {
      for (const a of live) {
        if (a.deaf) continue;
        a.port.onmidimessage?.(
          new MIDIMessageEvent('midimessage', { data: new Uint8Array([status, midi, velocity]) }),
        );
      }
    }
    w.__deaf = fake;
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    (window as unknown as { __show(): void }).__show = () => {
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => {
        fake.requests++;
        const port = {
          id: 'go-piano',
          name: 'GO:PIANO MIDI 1',
          manufacturer: 'Roland',
          type: 'input',
          state: 'connected',
          connection: 'open',
          onmidimessage: null,
          onstatechange: null,
          addEventListener() {},
          removeEventListener() {},
          open() {
            return Promise.resolve(this);
          },
          close() {
            return Promise.resolve(this);
          },
        };
        live.push({ deaf: fake.requests === 1, port });
        return Promise.resolve({
          inputs: new Map([[port.id, port]]),
          outputs: new Map(),
          sysexEnabled: false,
          onstatechange: null,
          addEventListener() {},
          removeEventListener() {},
        });
      },
    });
    const query = navigator.permissions.query.bind(navigator.permissions);
    Object.defineProperty(navigator.permissions, 'query', {
      configurable: true,
      value: (d: { name: string }) =>
        d.name === 'midi'
          ? Promise.resolve(Object.assign(new EventTarget(), { name: 'midi', state: 'granted' }))
          : query(d as PermissionDescriptor),
    });
  });

  await page.goto(`/?audio=silent#/piece/${MINUET}`);
  const target = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { __digitus2Along?: { target(): number[] } }
        ).__digitus2Along?.target() ?? [],
    );
  const index = () =>
    page.evaluate(
      () =>
        (window as unknown as { __digitus2Along?: { index(): number } }).__digitus2Along?.index() ??
        -1,
    );
  const press = async () => {
    const pitches = await target();
    await page.evaluate((ps) => {
      const fake = (window as unknown as { __deaf: { on(m: number): void } }).__deaf;
      for (const m of ps) fake.on(m);
    }, pitches);
    await page.waitForTimeout(100);
    await page.evaluate((ps) => {
      const fake = (window as unknown as { __deaf: { off(m: number): void } }).__deaf;
      for (const m of ps) fake.off(m);
    }, pitches);
  };
  const requests = () =>
    page.evaluate(() => (window as unknown as { __deaf: { requests: number } }).__deaf.requests);

  await expect.poll(async () => (await target()).length).toBeGreaterThan(0);
  await expect(page.locator('.piano-line')).toHaveCount(0); // the score view, not the library
  expect(await requests()).toBe(1);

  // Deaf: the reader plays and the red stays on the first step.
  await press();
  await page.waitForTimeout(500);
  expect(await index()).toBe(0);

  // Shown, the page opens the access again by itself, within the healer's first wait.
  await page.evaluate(() => (window as unknown as { __show(): void }).__show());
  await expect.poll(requests, { timeout: 10_000 }).toBe(2);

  // Heard: every press moves the red on.
  for (let step = 1; step <= 4; step++) {
    await press();
    await expect.poll(index).toBe(step);
  }

  // Heard now, so the page leaves the connection alone.
  await page.waitForTimeout(6_000);
  expect(await requests()).toBe(2);

  // The black box tells what happened, and holds no notes.
  const log = await page.evaluate(() =>
    (
      JSON.parse(localStorage.getItem('digitus2.midi.log') ?? '[]') as {
        event: string;
        reason?: string;
      }[]
    ).map((e) => [e.event, e.reason ?? '']),
  );
  expect(log).toEqual([
    ['connect', 'page load'],
    ['ports', ''],
    ['opened', 'page load'],
    ['shown again', ''],
    ['reconnect', 'silent'],
    ['connect', 'silent'],
    ['ports', ''],
    ['opened', 'silent'],
    ['first note', ''],
  ]);
});
