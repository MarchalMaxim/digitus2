// @vitest-environment node
import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { createSilentInstrument } from './instrument.js';
import { Transport } from './transport.js';

const xml = `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>1</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notations><ornaments><inverted-mordent long="yes"/></ornaments></notations></note></measure></part></score-partwise>`;

function setup(source = xml, lookAheadSec = 0.01) {
  const { score } = parseMusicXml(source);
  const ctx = { currentTime: 100 };
  const instrument = createSilentInstrument();
  const t = new Transport(
    { score, ctx, instrument, setInterval: (() => 0) as never, clearInterval: () => {} },
    { startDelaySec: 0, lookAheadSec },
  );
  const run = (sec: number) => {
    for (let i = 0; i <= sec * 200; i++) {
      ctx.currentTime = 100 + i / 200;
      t.step();
    }
  };
  return { t, ctx, instrument, run };
}

describe('ornaments through the real transport', () => {
  it.each([0.5, 2])(
    'changes tempo to %s between trill attacks without a gap or overlap',
    (factor) => {
      const source = xml
        .replace('<inverted-mordent long="yes"/>', '<trill-mark beats="9"/>')
        .replace('<duration>4</duration>', '<duration>8</duration>')
        .replace('<beats>1</beats>', '<beats>2</beats>');
      const { t, instrument, ctx, run } = setup(source, 0.15);
      t.play();
      t.setTempoFactor(factor);
      run(0.4);
      expect(instrument.events.length).toBeGreaterThan(3);
      instrument.events.forEach((event, i) => {
        if (i)
          expect(event.time).toBeCloseTo(
            instrument.events[i - 1]!.time + instrument.events[i - 1]!.duration,
            8,
          );
        ctx.currentTime = event.time + 1e-5;
        const position = t.positionSec();
        if (position < 1) expect(event.midi).toBe(Math.floor(position * 9) % 2 ? 62 : 60);
      });
      // Includes the existing lookahead: a safe transition must take effect within 250 ms.
      ctx.currentTime = 100.25;
      expect(t.positionSec()).toBeCloseTo(2 / 9 + (0.25 - 2 / 9) * factor, 8);
    },
  );

  it('caps deferred tempo changes at the loop edge and keeps repeated requests chronological', () => {
    const source = xml.replace('<inverted-mordent long="yes"/>', '<trill-mark beats="5"/>');
    const { t, instrument, run } = setup(source, 0.15);
    t.setLoop({ from: 0, to: 0 });
    t.play();
    t.setTempoFactor(0.5);
    t.setTempoFactor(2);
    run(1);
    expect(instrument.stopAllCalls).toBe(0);
    instrument.events.forEach((event, i) => {
      if (i)
        expect(event.time).toBeCloseTo(
          instrument.events[i - 1]!.time + instrument.events[i - 1]!.duration,
          8,
        );
    });
    expect(t.state.tempoFactor).toBe(2);
  });

  it('resynchronizes interleaved long trills within 250 ms instead of waiting for their phrases to finish', () => {
    const first = xml
      .replace('<inverted-mordent long="yes"/>', '<trill-mark beats="31"/>')
      .replace('<duration>4</duration>', '<duration>40</duration>')
      .replace('<beats>1</beats>', '<beats>10</beats>');
    const source = first.replace(
      '</measure>',
      '<backup><duration>40</duration></backup><note><pitch><step>G</step><octave>3</octave></pitch><duration>40</duration><voice>2</voice><type>whole</type><notations><ornaments><trill-mark beats="32"/></ornaments></notations></note></measure>',
    );
    const { t, instrument, run } = setup(source, 0.15);
    t.play();
    run(0.05);
    t.setTempoFactor(2);
    expect(instrument.stopAllCalls).toBe(1);
    // The fallback restarts both sounding pitches, so a held bass is not lost until its next onset.
    expect(
      instrument.events.filter((e) => Math.abs(e.time - 100.05) < 1e-8).map((e) => e.midi),
    ).toEqual([55, 60]);
    run(0.25);
    expect(t.positionSec()).toBeCloseTo(0.45, 8);
    expect(t.leadingIn()).toBe(false);
  });
  it('clips a tied principal tail at the loop boundary so it cannot overlap the next pass auxiliary', () => {
    const source = xml
      .replace('<inverted-mordent long="yes"/>', '<trill-mark/>')
      .replace('<notations>', '<tie type="start"/><notations>')
      .replace(
        '</measure>',
        '</measure><measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><tie type="stop"/></note></measure>',
      );
    const { t, instrument, run } = setup(source);
    t.setLoop({ from: 0, to: 0 });
    t.play();
    run(0.7);
    const lastFirstPass = instrument.events.find((e) => Math.abs(e.time - 100.4) < 1e-8)!;
    expect(lastFirstPass.duration).toBeCloseTo(0.1, 9);
    const nextAuxiliary = instrument.events.find((e) => Math.abs(e.time - 100.6) < 1e-8)!;
    expect(lastFirstPass.time + lastFirstPass.duration).toBeLessThan(nextAuxiliary.time);
  });
  it('schedules five attacks once, within the source duration, at the chosen practice tempo', () => {
    const { t, instrument, run } = setup();
    t.setTempoFactor(0.5);
    t.play();
    run(1);
    expect(instrument.events.map((e) => e.midi)).toEqual([60, 62, 60, 62, 60]);
    instrument.events.forEach((e, i) => {
      expect(e.time + e.duration).toBeLessThanOrEqual(101.000000001);
      if (i)
        expect(e.time).toBeCloseTo(
          instrument.events[i - 1]!.time + instrument.events[i - 1]!.duration,
          9,
        );
    });
  });

  it('keeps muted ornaments silent and repeats the same attacks at a bar loop', () => {
    const muted = setup();
    muted.t.setMuted(['R']);
    muted.t.play();
    muted.run(1);
    expect(muted.instrument.events).toEqual([]);
    const { t, instrument, run } = setup();
    t.setLoop({ from: 0, to: 0 });
    t.play();
    run(1);
    expect(instrument.events.filter((e) => e.time < 101).map((e) => e.midi)).toEqual([
      60, 62, 60, 62, 60, 60, 62, 60, 62, 60,
    ]);
  });

  it('resumes with the remaining ornament attacks after seeking and never backdates the lead-in', () => {
    const { t, instrument, run } = setup();
    t.seek(0.1);
    t.play();
    expect(t.leadingIn()).toBe(true);
    run(0.05);
    expect(instrument.events[0]?.time).toBeGreaterThanOrEqual(100);
    expect(instrument.events.map((e) => e.midi)).toEqual([60]);
    expect(t.leadingIn()).toBe(false);
  });
});
