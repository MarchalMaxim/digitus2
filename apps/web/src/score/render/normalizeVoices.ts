interface Event {
  note: Element;
  start: number;
  duration: number;
  chord: boolean;
  lane: string;
  voice: string;
  staff: string;
}

const children = (el: Element, name: string) =>
  [...el.children].filter((child) => child.localName === name);
const first = (el: Element, name: string) => children(el, name)[0];
const text = (el: Element, name: string) => first(el, name)?.textContent?.trim() ?? '';
const positive = (value: string) =>
  /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : NaN;

function normalizeMeasure(measure: Element): boolean {
  const lanes = new Map<string, Event[]>();
  const closed = new Set<string>();
  const voices = new Map<string, string>();
  let previousLane = '';
  let interleaved = false;
  let cursor = 0;
  let length = 0;
  let anchor: Event | undefined;
  let started = false;
  let ended = false;
  for (const el of measure.children) {
    const tag = el.localName;
    if (tag === 'attributes' || tag === 'print') {
      if (started) return false;
      continue;
    }
    if (tag === 'barline') {
      if (started) ended = true;
      continue;
    }
    if (!['note', 'backup', 'forward'].includes(tag) || ended) return false;
    started = true;
    const duration = positive(text(el, 'duration'));
    if (!Number.isFinite(duration)) return false;
    if (tag !== 'note') {
      cursor += tag === 'backup' ? -duration : duration;
      if (!Number.isSafeInteger(cursor) || cursor < 0) return false;
      length = Math.max(length, cursor);
      anchor = undefined;
      continue;
    }
    // Grace timing and a voice crossing staves need an exporter-specific policy.
    if (first(el, 'grace')) return false;
    const voice = text(el, 'voice') || '1';
    const staff = text(el, 'staff') || '1';
    if (voices.has(voice) && voices.get(voice) !== staff) return false;
    voices.set(voice, staff);
    const lane = `${staff}:${voice}`;
    const chord = first(el, 'chord') !== undefined;
    if (chord && (!anchor || anchor.lane !== lane || duration > anchor.duration)) return false;
    const start = chord ? anchor!.start : cursor;
    const event = { note: el, start, duration, chord, lane, voice, staff };
    const events = lanes.get(lane) ?? [];
    if (!chord) {
      const previous = [...events].reverse().find((candidate) => !candidate.chord);
      if (previous && previous.start + previous.duration > start) return false;
      cursor += duration;
      anchor = event;
    }
    if (!Number.isSafeInteger(cursor)) return false;
    length = Math.max(length, cursor);
    events.push(event);
    lanes.set(lane, events);
    if (previousLane !== lane) {
      if (closed.has(lane)) interleaved = true;
      if (previousLane) closed.add(previousLane);
      previousLane = lane;
    }
  }
  if (!interleaved) return false;

  // Valid MusicXML has one document cursor, independent of voice/staff. Verovio can instead
  // append a note to its previous layer when the voice switches without a backup. Serialize
  // each lane in one block, with explicit movement, retaining every original note element.
  const suffix = [...measure.children].find(
    (el) => el.localName === 'barline' && el.getAttribute('location') !== 'left',
  );
  for (const el of [...measure.children]) {
    if (['note', 'backup', 'forward'].includes(el.localName)) el.remove();
  }
  const append = (el: Element) => measure.insertBefore(el, suffix ?? null);
  const movement = (tag: string, duration: number, event?: Event) => {
    const el = measure.ownerDocument.createElement(tag);
    for (const [name, value] of [
      ['duration', String(duration)],
      ...(event
        ? [
            ['voice', event.voice],
            ['staff', event.staff],
          ]
        : []),
    ]) {
      const child = measure.ownerDocument.createElement(name!);
      child.textContent = value!;
      el.appendChild(child);
    }
    append(el);
  };
  let previous = 0;
  let laneIndex = 0;
  for (const events of lanes.values()) {
    if (previous) movement('backup', previous);
    let position = 0;
    for (const event of events) {
      if (!event.chord && event.start > position) {
        movement('forward', event.start - position, event);
        position = event.start;
      }
      append(event.note);
      if (!event.chord) position += event.duration;
    }
    // Preserve a final explicit forward, including an otherwise silent tail of the bar.
    if (++laneIndex === lanes.size && position < length) {
      movement('forward', length - position, events[0]);
      position = length;
    }
    previous = position;
  }
  return true;
}

/**
 * Render-only workaround for HOMR's interleaved MusicXML voices. The original XML still feeds
 * the engine and downloads; IDs have already been injected before this copy is regrouped.
 * Skip unknown notation rather than moving position-sensitive directions or changing music.
 */
export function normalizeVoices(xml: string): string {
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
  let changed = false;
  for (const part of children(doc.documentElement, 'part')) {
    for (const measure of children(part, 'measure')) changed = normalizeMeasure(measure) || changed;
  }
  return changed ? new XMLSerializer().serializeToString(doc) : xml;
}
