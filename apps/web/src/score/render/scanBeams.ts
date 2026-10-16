interface Meter {
  beats: number;
  unit: number;
}

interface Event {
  note: Element;
  start: number;
  duration: number;
  levels: number;
  lane: string;
}

const children = (el: Element, name: string) =>
  [...el.children].filter((child) => child.localName === name);
const first = (el: Element, name: string) => children(el, name)[0];
const text = (el: Element, name: string) => first(el, name)?.textContent?.trim() ?? '';
const positive = (value: string) =>
  /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : NaN;

function readMeter(time: Element): Meter | undefined {
  if (children(time, 'beats').length !== 1 || children(time, 'beat-type').length !== 1) return;
  const beats = positive(text(time, 'beats'));
  const unit = positive(text(time, 'beat-type'));
  if ((unit === 4 && [2, 3, 4].includes(beats)) || (unit === 8 && [6, 9, 12].includes(beats)))
    return { beats, unit };
}

function addBeam(event: Event, level: number, value: string) {
  const beam = event.note.ownerDocument.createElement('beam');
  beam.setAttribute('number', String(level));
  beam.textContent = value;
  // MusicXML puts beams after staff and before notations/lyrics/play/listen.
  const after = [...event.note.children].find((el) =>
    ['notations', 'lyric', 'play', 'listen'].includes(el.localName),
  );
  event.note.insertBefore(beam, after ?? null);
}

function beamGroup(group: Event[]): number {
  if (group.length < 2) return 0;
  for (let i = 0; i < group.length; i++) {
    const event = group[i]!;
    addBeam(event, 1, i === 0 ? 'begin' : i === group.length - 1 ? 'end' : 'continue');
    if (event.levels < 2) continue;
    const previous = group[i - 1]?.levels === 2;
    const next = group[i + 1]?.levels === 2;
    addBeam(
      event,
      2,
      previous
        ? next
          ? 'continue'
          : 'end'
        : next
          ? 'begin'
          : i === group.length - 1
            ? 'backward hook'
            : 'forward hook',
    );
  }
  return group.length;
}

function beamMeasure(measure: Element, divisions: number, meter: Meter): number {
  if (
    measure.getAttribute('implicit') === 'yes' ||
    measure.querySelector('beam, grace, time-modification, tuplet, tremolo')
  )
    return 0;
  const beat = divisions * (meter.unit === 8 ? 1.5 : 1);
  const length = (divisions * meter.beats * 4) / meter.unit;
  const events: Event[] = [];
  let cursor = 0;
  let anchor: Event | undefined;
  let sawNote = false;
  for (const el of measure.children) {
    if (el.localName === 'attributes') {
      // Mid-bar changes require more context than this engraving fallback has.
      if (sawNote && (first(el, 'divisions') || first(el, 'time'))) return 0;
      continue;
    }
    if (el.localName === 'backup' || el.localName === 'forward') {
      const duration = positive(text(el, 'duration'));
      if (!Number.isFinite(duration)) return 0;
      cursor += el.localName === 'backup' ? -duration : duration;
      if (cursor < 0 || cursor > length) return 0;
      anchor = undefined;
      continue;
    }
    if (el.localName !== 'note') continue;
    sawNote = true;
    const duration = positive(text(el, 'duration'));
    if (!Number.isFinite(duration)) return 0;
    const lane = `${text(el, 'voice') || '1'}:${text(el, 'staff') || '1'}`;
    const type = text(el, 'type');
    const dots = children(el, 'dot').length;
    const base = ({ eighth: divisions / 2, '16th': divisions / 4 } as Record<string, number>)[type];
    const levels = base === undefined || first(el, 'rest') ? 0 : type === '16th' ? 2 : 1;
    if (base !== undefined && duration !== base * (2 - 2 ** -dots)) return 0;
    if (first(el, 'chord')) {
      if (
        !anchor ||
        anchor.lane !== lane ||
        anchor.duration !== duration ||
        anchor.levels !== levels
      )
        return 0;
      continue;
    }
    const event = { note: el, start: cursor, duration, levels, lane };
    events.push(event);
    cursor += duration;
    if (cursor > length) return 0;
    anchor = event;
  }
  // A voice moving between staves may be a cross-staff beam: leave it to its exporter.
  const voices = new Map<string, string>();
  const lanes = new Map<string, Event[]>();
  for (const event of events) {
    const voice = text(event.note, 'voice') || '1';
    if (voices.has(voice) && voices.get(voice) !== event.lane) return 0;
    voices.set(voice, event.lane);
    const lane = lanes.get(event.lane) ?? [];
    lane.push(event);
    lanes.set(event.lane, lane);
  }
  // Validate every lane before adding anything to this measure.
  for (const lane of lanes.values()) {
    lane.sort((a, b) => a.start - b.start);
    if (lane.some((event, i) => i > 0 && lane[i - 1]!.start + lane[i - 1]!.duration > event.start))
      return 0;
  }
  let added = 0;
  for (const lane of lanes.values()) {
    let group: Event[] = [];
    for (const event of lane) {
      const previous = group.at(-1);
      const bucket = Math.floor(event.start / beat);
      if (
        !event.levels ||
        event.start + event.duration > (bucket + 1) * beat ||
        (previous &&
          (previous.start + previous.duration !== event.start ||
            Math.floor(previous.start / beat) !== bucket))
      ) {
        added += beamGroup(group);
        group = [];
      }
      if (event.levels && event.start + event.duration <= (bucket + 1) * beat) group.push(event);
    }
    added += beamGroup(group);
  }
  return added;
}

/**
 * HOMR currently omits beam data. Infer conventional beat groups solely for display;
 * these are not recovered source beams. Never pass this copy to parsing or downloads.
 * Ordinary imports, explicit beams and unsupported/ambiguous notation remain untouched.
 * Run on the main thread because workers do not provide DOMParser.
 */
export function prepareScanBeams(xml: string): string {
  if (!xml.includes('homr')) return xml;
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (
    doc.documentElement.localName !== 'score-partwise' ||
    doc.querySelector('parsererror') ||
    ![...doc.querySelectorAll('identification > encoding > software')].some(
      (el) => el.textContent?.trim() === 'homr',
    )
  )
    return xml;
  let added = 0;
  for (const part of children(doc.documentElement, 'part')) {
    let divisions = NaN;
    let meter: Meter | undefined;
    for (const measure of children(part, 'measure')) {
      for (const attributes of children(measure, 'attributes')) {
        if (first(attributes, 'divisions')) divisions = positive(text(attributes, 'divisions'));
        const times = children(attributes, 'time');
        if (times.length)
          meter =
            times.length === 1 && !times[0]!.hasAttribute('number')
              ? readMeter(times[0]!)
              : undefined;
      }
      if (meter && Number.isFinite(divisions)) added += beamMeasure(measure, divisions, meter);
    }
  }
  return added ? new XMLSerializer().serializeToString(doc) : xml;
}
