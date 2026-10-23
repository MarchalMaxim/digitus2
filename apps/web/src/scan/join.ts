import type { Phrase } from '../i18n/messages.js';
import { PhraseError } from '../i18n/PhraseError.js';

export const GRAPHIC_SPAN_TAGS =
  'slur, wedge, octave-shift, pedal, bracket, dashes, glissando, slide, wavy-line, tuplet, hammer-on, pull-off';
export const GRAPHIC_SPAN_WARNING =
  'Slurs and other notation spans are kept within each scanned page. Compare continuations at page edges; missing endpoints have not been repaired.';

const children = (node: Element, tag: string) =>
  Array.from(node.children).filter((child) => child.tagName === tag);
const text = (node: Element, tag: string) => children(node, tag)[0]?.textContent?.trim();
const refuse = (reason: Phrase): never => {
  throw new PhraseError((t) => t.scan.join.refused(reason(t)));
};

/** The staves a part declares in its first measure's opening attributes. */
function staffCount(part: Element): number {
  const first = children(part, 'measure')[0];
  const staves = first?.querySelector('attributes > staves')?.textContent?.trim();
  return Number(staves ?? 1);
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** The sign of the clef a part opens with: the last one declared before its first note. */
function openingClef(part: Element): string | undefined {
  let sign: string | undefined;
  for (const element of Array.from(children(part, 'measure')[0]?.children ?? [])) {
    if (['note', 'backup', 'forward'].includes(element.tagName)) break;
    if (element.tagName === 'attributes')
      for (const clef of children(element, 'clef')) sign = text(clef, 'sign') ?? sign;
  }
  return sign;
}

/**
 * Issue 152: the two one-staff parts of a page that homr read as a treble part and a bass part, or
 * nothing when the page is anything else. `grand` tells that they open with a G clef and an F clef:
 * where no page of the scan holds a two-staff piano part, one such page confirms the piano (issue
 * 159), and a page that starts with another clef (a bass line that has moved to the treble clef)
 * is paired with it.
 */
function splitPair(doc: Document) {
  const root = doc.documentElement;
  const parts = children(root, 'part');
  const list = children(root, 'part-list')[0];
  const entries = list ? children(list, 'score-part') : [];
  if (parts.length !== 2 || entries.length !== 2 || parts.some((part) => staffCount(part) !== 1))
    return;
  const [upper, lower] = parts as [Element, Element];
  const upperMeasures = children(upper, 'measure');
  const lowerMeasures = children(lower, 'measure');
  if (!upperMeasures.length || upperMeasures.length !== lowerMeasures.length) return;
  const divisions = parts.map((part) => part.querySelectorAll('divisions'));
  if (divisions.some((found) => found.length !== 1)) return;
  const [a, b] = divisions.map((found) => Number(found[0]!.textContent));
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a! < 1 || b! < 1) return;
  // The upper part's opening attributes: the first declares the second staff, the last its clef.
  const start: Element[] = [];
  for (const element of Array.from(upperMeasures[0]!.children)) {
    if (['note', 'backup', 'forward'].includes(element.tagName)) break;
    if (element.tagName === 'attributes') start.push(element);
  }
  if (!start.length) return;
  return {
    grand: openingClef(upper) === 'G' && openingClef(lower) === 'F',
    upper,
    lower,
    upperMeasures,
    lowerMeasures,
    divisions: divisions as [NodeListOf<Element>, NodeListOf<Element>],
    a: a!,
    b: b!,
    first: start[0]!,
    opening: start.at(-1)!,
    list: list!,
    entries,
  };
}

/**
 * Merged here into that layout: the second part's notes become staff 2, after a backup to the
 * start of each measure, in voices of their own; both parts' durations move to a common time unit;
 * the part takes the model's name and instrument (the other pages' piano part, or a plain Piano).
 * No pitch, duration or onset changes. The second staff is declared in the first of the opening
 * attributes, where Verovio reads the staff count and ignores any later one (issue 156); homr
 * writes a split page's clefs in the second.
 */
function mergeSplitStaves(
  doc: Document,
  pair: NonNullable<ReturnType<typeof splitPair>>,
  model: Element,
) {
  const root = doc.documentElement;
  const {
    upper,
    lower,
    upperMeasures,
    lowerMeasures,
    divisions,
    a,
    b,
    first,
    opening,
    list,
    entries,
  } = pair;
  const unit = (a * b) / gcd(a, b);
  const scale = (part: Element, factor: number) => {
    for (const duration of Array.from(part.querySelectorAll('duration')))
      duration.textContent = String(Number(duration.textContent) * factor);
  };
  scale(upper, unit / a);
  scale(lower, unit / b);
  divisions[0][0]!.textContent = String(unit);
  divisions[1][0]!.remove();
  // The lower part's voices continue after the upper part's, as homr numbers a second staff's.
  const voices = Array.from(upper.querySelectorAll('voice')).map((v) => Number(v.textContent));
  const offset = Math.max(4, ...voices.filter(Number.isSafeInteger));
  /** An element in the document's own namespace, as the parsed ones are. */
  const make = (tag: string) => doc.createElementNS(root.namespaceURI, tag);
  /** A note's staff, where MusicXML puts it: before its beams, notations and lyrics. */
  const setStaff = (note: Element, value: string) => {
    let staff = children(note, 'staff')[0];
    if (!staff) {
      staff = make('staff');
      const after = Array.from(note.children).find((child) =>
        ['beam', 'notations', 'lyric', 'play', 'listen'].includes(child.tagName),
      );
      note.insertBefore(staff, after ?? null);
    }
    staff.textContent = value;
  };
  upperMeasures.forEach((measure, index) => {
    // Where the upper staff's content ends: back from there to the measure's start.
    let at = 0;
    for (const element of Array.from(measure.children)) {
      const duration = Number(text(element, 'duration') ?? 0);
      if (element.tagName === 'note' && !children(element, 'chord').length) at += duration;
      if (element.tagName === 'forward') at += duration;
      if (element.tagName === 'backup') at -= duration;
    }
    if (at > 0) {
      const backup = make('backup');
      const duration = make('duration');
      duration.textContent = String(at);
      backup.appendChild(duration);
      measure.appendChild(backup);
    }
    for (const element of Array.from(lowerMeasures[index]!.children)) {
      if (element.tagName === 'print') continue;
      for (const staff of Array.from(element.querySelectorAll('staff'))) staff.textContent = '2';
      if (element.tagName === 'note') {
        setStaff(element, '2');
        const voice = children(element, 'voice')[0];
        if (voice) voice.textContent = String(Number(voice.textContent) + offset);
        children(element, 'instrument').forEach((instrument) => instrument.remove());
      }
      if (element.tagName === 'attributes') {
        for (const clef of children(element, 'clef')) clef.setAttribute('number', '2');
        // Key and time are the upper part's; the lower part's clef at the start is staff 2's.
        children(element, 'key').forEach((key) => key.remove());
        children(element, 'time').forEach((time) => time.remove());
        if (index === 0) for (const clef of children(element, 'clef')) opening.appendChild(clef);
        if (!element.children.length) continue;
      }
      measure.appendChild(element);
    }
  });
  for (const instrument of Array.from(upper.querySelectorAll('note > instrument')))
    instrument.remove();
  const staves = make('staves');
  staves.textContent = '2';
  // Where the schema puts it: after divisions, key and time, before everything that follows them.
  const following = Array.from(first.children).find((child) =>
    [
      'part-symbol',
      'instruments',
      'clef',
      'staff-details',
      'transpose',
      'for-part',
      'directive',
      'measure-style',
    ].includes(child.tagName),
  );
  first.insertBefore(staves, following ?? null);
  for (const clef of children(opening, 'clef').filter((c) => !c.hasAttribute('number')))
    clef.setAttribute('number', '1');
  for (const note of Array.from(upper.querySelectorAll('note')))
    if (!children(note, 'staff').length) setStaff(note, '1');
  // The model's part name and instrument: homr's "Voice" for a piano staff is a guess.
  const entry = doc.importNode(model, true) as Element;
  entry.setAttribute('id', upper.id);
  list.replaceChild(entry, entries[0]!);
  entries[1]!.remove();
  lower.remove();
}

/** A plain piano part, for pages paired where no page of the scan holds one. */
const PIANO_ENTRY =
  '<score-part id="P1"><part-name>Piano</part-name><score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>';
/**
 * Issue 159: the join leaves this comment in a file whose treble and bass parts it paired into one
 * piano part, and the review says so. The warning is the review's key for the line.
 */
const PAIRED_MARK = 'digitus2: treble and bass staves paired into one piano part';
export const PAIRED_STAVES_WARNING =
  'The treble and bass staves were paired into a grand staff by the app.';
export const stavesWerePaired = (xml: string) => xml.includes(`<!--${PAIRED_MARK}-->`);
const markPaired = (doc: Document) => {
  const root = doc.documentElement;
  root.insertBefore(doc.createComment(PAIRED_MARK), children(root, 'part')[0] ?? null);
};

/** A single page: unchanged, unless it is a treble part and a bass part, which are paired. */
function pairedSinglePage(xml: string): string {
  if ((xml.match(/<part[ >]/g)?.length ?? 0) !== 2 || /<!ENTITY/i.test(xml)) return xml;
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'score-partwise')
    return xml;
  const pair = splitPair(doc);
  if (!pair?.grand) return xml;
  mergeSplitStaves(
    doc,
    pair,
    new DOMParser().parseFromString(PIANO_ENTRY, 'text/xml').documentElement,
  );
  markPaired(doc);
  return new XMLSerializer().serializeToString(doc);
}

/** Append raw measures, keeping each page's own time units and notation. Never re-engrave notes. */
export function joinScanPages(pages: readonly string[]): string {
  if (!pages.length) return refuse((t) => t.scan.join.reasons.noPages);
  if (pages.length === 1) return pairedSinglePage(pages[0]!);
  const documents = pages.map((xml) => {
    if (/<!ENTITY/i.test(xml)) return refuse((t) => t.scan.join.reasons.entities);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'score-partwise')
      return refuse((t) => t.scan.join.reasons.notPartwise);
    if (
      doc.querySelector('repeat, ending, segno, coda') ||
      Array.from(doc.querySelectorAll('sound')).some((el) =>
        ['dacapo', 'dalsegno', 'tocoda', 'fine'].some((a) => el.hasAttribute(a)),
      )
    )
      return refuse((t) => t.scan.join.reasons.repeats);
    if (doc.querySelector('transpose, staff-details, measure-style'))
      return refuse((t) => t.scan.join.reasons.transposition);
    return doc;
  });
  // A page read as a treble part and a bass part is the other pages' piano (issue 152). Without a
  // piano page to say so, every page must be such a pair and one must open with a G clef over an
  // F clef (issue 159).
  const piano = documents.find((doc) => {
    const parts = children(doc.documentElement, 'part');
    return parts.length === 1 && staffCount(parts[0]!) === 2;
  });
  const pairs = documents.map((doc) => splitPair(doc));
  if (piano || (pairs.every(Boolean) && pairs.some((pair) => pair?.grand))) {
    const model = piano
      ? children(children(piano.documentElement, 'part-list')[0]!, 'score-part')[0]!
      : new DOMParser().parseFromString(PIANO_ENTRY, 'text/xml').documentElement;
    documents.forEach((doc, index) => {
      if (pairs[index]) mergeSplitStaves(doc, pairs[index]!, model);
    });
    if (pairs.some(Boolean)) markPaired(documents[0]!);
  }
  const layouts = documents.map((doc, pageIndex) => {
    const root = doc.documentElement;
    const parts = children(root, 'part');
    const list = children(root, 'part-list')[0];
    const entries = list ? children(list, 'score-part') : [];
    if (!parts.length || parts.length !== entries.length)
      return refuse((t) => t.scan.join.reasons.partLayout);
    let count: number | undefined;
    const layout = parts.map((part, partIndex) => {
      const entry = entries[partIndex]!;
      if (part.id !== entry.id) return refuse((t) => t.scan.join.reasons.partOrder);
      const measures = children(part, 'measure');
      if (!measures.length || (count !== undefined && count !== measures.length))
        return refuse((t) => t.scan.join.reasons.measureCounts);
      count = measures.length;
      const opening: Element[] = [];
      for (const element of Array.from(measures[0]!.children)) {
        if (['note', 'backup', 'forward'].includes(element.tagName)) break;
        if (element.tagName === 'attributes') opening.push(...Array.from(element.children));
      }
      const starting = (tag: string) => opening.filter((el) => el.tagName === tag);
      const value = (tag: string) => starting(tag).at(-1)?.textContent?.trim();
      if (
        !value('divisions') ||
        !starting('key').length ||
        !starting('time').length ||
        !starting('clef').length
      )
        return refuse((t) => t.scan.join.reasons.startingSetup(pageIndex + 1));
      const staves = Number(value('staves') ?? 1);
      const clefs = new Set(
        starting('clef').map((clef) => Number(clef.getAttribute('number') ?? 1)),
      );
      if (
        !Number.isSafeInteger(staves) ||
        staves < 1 ||
        clefs.size !== staves ||
        [...clefs].some((staff) => !Number.isSafeInteger(staff) || staff < 1 || staff > staves)
      )
        return refuse((t) => t.scan.join.reasons.staffLayout);
      if (Array.from(part.querySelectorAll('staves')).some((s) => Number(s.textContent) !== staves))
        return refuse((t) => t.scan.join.reasons.staffChange);
      const instruments = children(entry, 'score-instrument');
      const instrumentIds = new Set(instruments.map((el) => el.id));
      if (
        [...part.querySelectorAll('instrument'), ...children(entry, 'midi-instrument')].some(
          (el) => !instrumentIds.has(el.id),
        )
      )
        return refuse((t) => t.scan.join.reasons.instrumentUndeclared);
      const midi = children(entry, 'midi-instrument')
        .map((el) =>
          [
            instruments.findIndex((i) => i.id === el.id),
            ...Array.from(el.children).map(
              (setting) => `${setting.tagName}:${setting.textContent?.trim()}`,
            ),
          ].join('|'),
        )
        .sort()
        .join(';');
      return { part, entry, measures, staves, instruments, midi };
    });
    return layout;
  });
  const first = layouts[0]!;
  layouts.forEach((layout) => {
    if (layout.length !== first.length) return refuse((t) => t.scan.join.reasons.partCounts);
    layout.forEach((item, index) => {
      const target = first[index]!;
      if (
        text(item.entry, 'part-name') !== text(target.entry, 'part-name') ||
        item.staves !== target.staves
      )
        return refuse((t) => t.scan.join.reasons.layoutsDiffer);
      if (
        item.instruments.length !== target.instruments.length ||
        item.midi !== target.midi ||
        item.instruments.some(
          (el, i) =>
            text(el, 'instrument-name') !== text(target.instruments[i]!, 'instrument-name'),
        )
      )
        return refuse((t) => t.scan.join.reasons.instrumentsDiffer);
    });
  });

  const canonical = first.map((item) => ({
    part: item.part.id,
    instruments: item.instruments.map((i) => i.id),
  }));
  documents.forEach((doc, pageIndex) => {
    const ids = new Map<string, string>();
    const definitions = new Set<string>();
    // IDs can be repeated by score-instrument, midi-instrument and note instrument references.
    for (const element of Array.from(doc.querySelectorAll('[id]'))) {
      const old = element.id;
      if (!['part', 'midi-instrument', 'instrument'].includes(element.tagName)) {
        if (definitions.has(old)) return refuse((t) => t.scan.join.reasons.duplicateIds);
        definitions.add(old);
      }
      if (!ids.has(old)) ids.set(old, `page${pageIndex + 1}-${old}`);
    }
    layouts[pageIndex]!.forEach((item, index) => {
      ids.set(item.part.id, `page1-${canonical[index]!.part}`);
      item.instruments.forEach((instrument, i) => {
        ids.set(instrument.id, `page1-${canonical[index]!.instruments[i]}`);
      });
    });
    for (const element of Array.from(doc.querySelectorAll('*'))) {
      if (element.hasAttribute('id')) element.setAttribute('id', ids.get(element.id)!);
      for (const attr of ['idref', 'startid', 'endid', 'instrument', 'href']) {
        const value = element.getAttribute(attr);
        if (value === null) continue;
        const raw = value.startsWith('#') ? value.slice(1) : value;
        const mapped = ids.get(raw);
        if (!mapped) return refuse((t) => t.scan.join.reasons.unresolvedId);
        element.setAttribute(attr, (value.startsWith('#') ? '#' : '') + mapped);
      }
    }
  });

  first.forEach((target, partIndex) => {
    let number = 0;
    const allocated = new Map<string, number>();
    layouts.forEach((layout, pageIndex) => {
      // Separate recognitions reuse span numbers. Keep their existing local endpoint relations,
      // without inventing cross-page links from coincidentally equal numbers. MusicXML permits
      // endpoints in arbitrary document order and requires number-level values in 1..16.
      const local = new Map<string, number>();
      for (const span of Array.from(layout[partIndex]!.part.querySelectorAll(GRAPHIC_SPAN_TAGS))) {
        const old = Number(span.getAttribute('number') ?? 1);
        if (!Number.isInteger(old) || old < 1 || old > 16)
          return refuse((t) => t.scan.join.reasons.spanNumber);
        const key = `${span.tagName}:${old}`;
        let mapped = local.get(key);
        if (mapped === undefined) {
          mapped = (allocated.get(span.tagName) ?? 0) + 1;
          if (mapped > 16) return refuse((t) => t.scan.join.reasons.spanOverflow);
          allocated.set(span.tagName, mapped);
          local.set(key, mapped);
        }
        span.setAttribute('number', String(mapped));
      }
      layout[partIndex]!.measures.forEach((measure, measureIndex) => {
        measure.setAttribute('number', String(++number));
        if (pageIndex > 0 && measureIndex === 0) {
          const print =
            children(measure, 'print')[0] ?? measure.ownerDocument.createElement('print');
          print.setAttribute('new-page', 'yes');
          if (!print.parentNode) measure.insertBefore(print, measure.firstChild);
        }
        if (pageIndex > 0) target.part.appendChild(documents[0]!.importNode(measure, true));
      });
    });
  });
  // Notes are not judged here: a page whose notes do not fit together still joins, so the review can
  // point at the place and the reader can correct it. The review's strict import of the joined file
  // decides whether it can be used for fingerings.
  return new XMLSerializer().serializeToString(documents[0]!);
}
