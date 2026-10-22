import { ENGINE_VERSION } from '@digitus2/engine';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { build, formatBuildDay } from '../app/build.js';
import { useFocusOnArrival } from '../app/focus.js';
import { useAppStore } from '../app/store.js';
import type { Messages } from '../i18n/messages.js';
import { Button } from '../design/Button.js';
import { en } from '../i18n/en/index.js';
import { useLocale, useT } from '../i18n/i18n.js';
import { ThemeToggle } from '../design/ThemeToggle.js';
import {
  isShareAlike,
  licenseLabel,
  loadPieceDetails,
  requiresCredit,
  type LibraryPiece,
} from '../library/manifest.js';

const REPOSITORY_URL = 'https://github.com/MarchalMaxim/digitus2';
const VEROVIO_URL = 'https://github.com/rism-digital/verovio';
const MIDI_FILE_URL = 'https://github.com/carter-thaxton/midi-file';
const SMPLR_URL = 'https://github.com/danigb/smplr';
const SAMPLES_URL = 'https://github.com/sfzinstruments/SplendidGrandPiano';

/** 5 -> 'Five': a count written as a word up to nine, in English (the tests' language). */
export function countWord(n: number): string {
  return en.about.pieces.count(n);
}

/**
 * The MuseScore archive pieces (PDMX, content/tools/build.py build_pdmx) are counted in one sentence
 * rather than listed row by row: there are more than a thousand of them.
 */
export function isArchivePiece(p: LibraryPiece): boolean {
  return p.source.name.startsWith('MuseScore');
}

/** Who engraved a piece: the Mutopia typesetter, or our own arrangement. */
function engraving(p: LibraryPiece, t: Messages): { text: string; url: string | null } {
  if (p.source.name.startsWith('digitus2')) return { text: t.about.pieces.arrangement, url: null };
  const by = p.source.typesetter ?? t.about.pieces.unnamedTypesetter;
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

/**
 * A text with links: each [bracketed] part is a link, made by the next of `links` from its words,
 * so a translation puts the link wherever its own word order needs it.
 */
function Linked({
  text,
  links,
}: {
  text: string;
  links: readonly ((label: string) => ReactNode)[];
}) {
  return (
    <>
      {text.split(/\[([^\]]*)\]/).map((part, i) => (
        <Fragment key={i}>{i % 2 === 0 ? part : links[(i - 1) / 2]!(part)}</Fragment>
      ))}
    </>
  );
}

/** What digitus2 is, how it chooses fingerings, and every licence and attribution it owes. */
export function AboutView() {
  const t = useT();
  const [locale] = useLocale();
  const a = t.about;
  const [details, setDetails] = useState<LibraryPiece[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadPieceDetails().then((map) => {
      if (live) setDetails([...map.values()]);
    });
    return () => {
      live = false;
    };
  }, []);
  const curated = (details ?? []).filter((p) => !isArchivePiece(p));
  const shareAlikeCount = curated.filter(isShareAlike).length;
  /** CC BY engravings: credited like the share-alike ones, without a share-alike term. */
  const attributionCount = curated.filter((p) => requiresCredit(p) && !isShareAlike(p)).length;
  const archiveCount = (details ?? []).length - curated.length;
  const openLibrary = useAppStore((s) => s.openLibrary);
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  const link = (href: string) => (label: string) => (
    <ExternalLink href={href}>{label}</ExternalLink>
  );
  return (
    <main className="page stack about">
      <header className="about-header">
        <Button primary className="no-print" onClick={openLibrary}>
          {a.back}
        </Button>
        <ThemeToggle />
        <h1 ref={heading} tabIndex={-1}>
          {a.title}
        </h1>
      </header>

      <section className="stack" aria-labelledby="about-what">
        <h2 id="about-what">{a.what.heading}</h2>
        <p>{a.what.body}</p>
      </section>

      <section className="stack" aria-labelledby="about-how">
        <h2 id="about-how">{a.how.heading}</h2>
        <p>{a.how.body(ENGINE_VERSION)}</p>
      </section>

      <section className="stack" aria-labelledby="about-who">
        <h2 id="about-who">{a.who.heading}</h2>
        <p>
          <Linked text={a.who.body} links={[link(REPOSITORY_URL)]} />
        </p>
      </section>

      <section className="stack" aria-labelledby="about-licences">
        <h2 id="about-licences">{a.licences.heading}</h2>
        <ul className="about-list">
          <li>
            <Linked text={a.licences.digitus2} links={[link(REPOSITORY_URL)]} />
          </li>
          <li>
            <Linked text={a.licences.verovio} links={[link(VEROVIO_URL)]} />
          </li>
          <li>
            <Linked
              text={a.licences.pdfjs}
              links={[
                link('https://mozilla.github.io/pdf.js/'),
                (label) => (
                  <a
                    href={import.meta.env.BASE_URL + 'licenses/pdfjs.txt'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {label}
                  </a>
                ),
              ]}
            />
          </li>
          <li>
            <Linked text={a.licences.midiFile} links={[link(MIDI_FILE_URL)]} />
          </li>
          <li>
            <Linked text={a.licences.piano} links={[link(SMPLR_URL), link(SAMPLES_URL)]} />
          </li>
        </ul>
      </section>

      <section className="stack" aria-labelledby="about-pieces">
        <h2 id="about-pieces">{a.pieces.heading}</h2>
        <p>
          {a.pieces.intro} {details !== null && a.pieces.credit(shareAlikeCount, attributionCount)}
        </p>
        <table className="about-pieces">
          <thead>
            <tr>
              <th scope="col">{a.pieces.columns.piece}</th>
              <th scope="col">{a.pieces.columns.composer}</th>
              <th scope="col">{a.pieces.columns.engraving}</th>
              <th scope="col">{a.pieces.columns.licence}</th>
            </tr>
          </thead>
          <tbody>
            {curated.map((p) => {
              const by = engraving(p, t);
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
        {archiveCount > 0 && <p>{a.pieces.archive(archiveCount)}</p>}
      </section>

      {/* The installed app can run an older build than the site serves: this says which. */}
      <p className="small muted">{a.build(build.commit, formatBuildDay(locale, build))}</p>
    </main>
  );
}
