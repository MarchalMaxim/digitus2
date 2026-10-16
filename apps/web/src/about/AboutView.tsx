import { ENGINE_VERSION } from '@digitus2/engine';
import { useRef } from 'react';
import { useFocusOnArrival } from '../app/focus.js';
import { useAppStore } from '../app/store.js';
import { Button } from '../design/Button.js';
import { ThemeToggle } from '../design/ThemeToggle.js';
import {
  isShareAlike,
  licenseLabel,
  pieces,
  requiresCredit,
  type LibraryPiece,
} from '../library/manifest.js';

const REPOSITORY_URL = 'https://github.com/MarchalMaxim/digitus2';
const VEROVIO_URL = 'https://github.com/rism-digital/verovio';
const MIDI_FILE_URL = 'https://github.com/carter-thaxton/midi-file';
const SMPLR_URL = 'https://github.com/danigb/smplr';
const SAMPLES_URL = 'https://github.com/sfzinstruments/SplendidGrandPiano';

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** 5 -> 'Five'; numbers past nine stay digits. */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

const shareAlikeCount = pieces.filter(isShareAlike).length;
/** CC BY engravings: credited like the share-alike ones, without a share-alike term. */
const attributionOnlyCount = pieces.filter((p) => requiresCredit(p) && !isShareAlike(p)).length;

/** The sentence above the table; it names CC BY only once the library has such an engraving. */
const CREDITED = 'credited here and on their score pages.';
const creditSentence =
  attributionOnlyCount === 0
    ? `${countWord(shareAlikeCount)} engravings are shared under CC BY-SA and are ${CREDITED}`
    : `${countWord(shareAlikeCount)} engravings are shared under CC BY-SA and ` +
      `${countWord(attributionOnlyCount).toLowerCase()} under CC BY; all are ${CREDITED}`;

/** Who engraved a piece: the Mutopia typesetter, or our own arrangement. */
function engraving(p: LibraryPiece): { text: string; url: string | null } {
  if (p.source.name.startsWith('digitus2')) return { text: 'digitus2 arrangement', url: null };
  const by = p.source.typesetter ?? 'Unnamed typesetter';
  if (p.source.name === 'The Mutopia Project' || p.source.mutopiaId !== undefined) {
    return { text: `${by} (Mutopia Project)`, url: p.source.url };
  }
  // No library piece takes this branch today; it keeps a future source credited rather than blank.
  return { text: `${by} (${p.source.name})`, url: p.source.url };
}

/** External links open in a new tab, so the reader keeps their place in the app. */
function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** What digitus2 is, how it chooses fingerings, and every licence and attribution it owes. */
export function AboutView() {
  const openLibrary = useAppStore((s) => s.openLibrary);
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  return (
    <main className="page stack about">
      <header className="about-header">
        <Button primary className="no-print" onClick={openLibrary}>
          Back to the library
        </Button>
        <ThemeToggle />
        <h1 ref={heading} tabIndex={-1}>
          About digitus2
        </h1>
      </header>

      <section className="stack" aria-labelledby="about-what">
        <h2 id="about-what">What this is</h2>
        <p>
          digitus2 writes finger numbers on piano music for beginning and intermediate players.
          Everything runs in your browser; nothing you open leaves your computer.
        </p>
      </section>

      <section className="stack" aria-labelledby="about-how">
        <h2 id="about-how">How the fingerings are chosen</h2>
        <p>
          The engine scores every possible fingering with ergonomic rules from the piano-fingering
          literature (finger spans, thumb crossings, weak fingers, black keys, hand position
          changes) and picks the cheapest one for the whole piece with an exact search. Your hand
          size changes the spans it allows. The engine version is {ENGINE_VERSION}.
        </p>
      </section>

      <section className="stack" aria-labelledby="about-who">
        <h2 id="about-who">Who made it</h2>
        <p>
          Created by Claude, Anthropic&apos;s AI model, in an autonomous multi-day build directed by
          Maxim Marchal. To our knowledge, nothing like this exists yet: a fingering engine that
          runs entirely in the browser and is verified against expert annotations. The code, the
          research notes and the verification results are in the{' '}
          <ExternalLink href={REPOSITORY_URL}>repository</ExternalLink>.
        </p>
      </section>

      <section className="stack" aria-labelledby="about-licences">
        <h2 id="about-licences">Licences</h2>
        <ul className="about-list">
          <li>
            <ExternalLink href={REPOSITORY_URL}>digitus2</ExternalLink> is free software under the
            MIT licence.
          </li>
          <li>
            Music engraving by <ExternalLink href={VEROVIO_URL}>Verovio</ExternalLink>,
            LGPL-3.0-or-later, used as an unmodified library.
          </li>
          <li>
            MIDI files are read with <ExternalLink href={MIDI_FILE_URL}>midi-file</ExternalLink>{' '}
            (MIT).
          </li>
          <li>
            Piano sound: <ExternalLink href={SMPLR_URL}>smplr</ExternalLink> (MIT) playing the{' '}
            <ExternalLink href={SAMPLES_URL}>Splendid Grand Piano</ExternalLink> samples (public
            domain).
          </li>
        </ul>
      </section>

      <section className="stack" aria-labelledby="about-pieces">
        <h2 id="about-pieces">The built-in pieces</h2>
        <p>The pieces use public-domain or Creative Commons editions. {creditSentence}</p>
        <table className="about-pieces">
          <thead>
            <tr>
              <th scope="col">Piece</th>
              <th scope="col">Composer</th>
              <th scope="col">Engraving</th>
              <th scope="col">Licence</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((p) => {
              const by = engraving(p);
              return (
                <tr key={p.slug}>
                  <td>
                    {p.title}
                    {p.catalogue && <span className="muted">, {p.catalogue}</span>}
                    {/* Narrow screens hide the Composer column and show the composer here. */}
                    <span className="composer-inline muted">{p.composer}</span>
                  </td>
                  <td>{p.composer}</td>
                  <td>{by.url ? <ExternalLink href={by.url}>{by.text}</ExternalLink> : by.text}</td>
                  <td>
                    <ExternalLink href={p.source.licenseUrl}>
                      {licenseLabel(p.source.license)}
                    </ExternalLink>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
