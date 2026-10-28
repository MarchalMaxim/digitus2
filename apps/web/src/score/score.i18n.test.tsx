import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { en } from '../i18n/en/index.js';
import { chooseLocale, messages, resetLocaleForTests } from '../i18n/i18n.js';
import { LOCALES, type Locale } from '../i18n/locales.js';
import { loadPiece } from '../library/manifest.js';
import { handLetter } from './handLetters.js';
import { Keyboard } from './Keyboard.js';
import { MidiImportPanel } from './MidiImportPanel.js';
import { importLine, noteName } from './midiCopy.js';
import { keyName } from './keyName.js';
import { ScoreHeader } from './ScoreHeader.js';
import { ScoreSheet } from './ScoreSheet.js';
import { SidePanel } from './SidePanel.js';
import { scoreStatusLine } from './ScoreView.js';
import type { ScoreDocument } from './useScoreDocument.js';

beforeEach(() => useAppStore.setState({ settings: { ...DEFAULT_SETTINGS }, notice: null }));
afterEach(() => {
  cleanup();
  resetLocaleForTests();
});

async function speak(locale: Locale): Promise<void> {
  await act(async () => {
    await chooseLocale(locale);
  });
}

const melody = (await loadPiece('schumann-op68-no1-melody'))!;
const doc: ScoreDocument = {
  status: 'ready',
  error: null,
  score: null,
  xml: null,
  assignment: null,
  printed: null,
  editorial: null,
  pages: [],
  solveMs: 6,
  renderMs: 63,
  title: 'Melody',
  composer: 'Robert Schumann',
  warnings: [],
  digitChanges: null,
  midiInfo: null,
  splitMidi: null,
  embellish: 'none',
  embellished: false,
  shownVersion: 'plain',
  plain: null,
  setEmbellished: () => {},
};

describe('the score view in another language', () => {
  it('writes the side panel in French, with the level from the library tiers', async () => {
    await speak('fr');
    render(
      <SidePanel
        doc={doc}
        source={{ kind: 'library', slug: melody.slug }}
        piece={{ ...melody, level: 3, key: 'Bb major' }}
        setSplitMidi={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Morceau et doigté')).toBeInTheDocument();
    expect(screen.getByText(/^Numéros de doigts\s: 1 est le pouce/)).toBeInTheDocument();
    expect(screen.getByText('Niveau').nextElementSibling).toHaveTextContent('Moyen');
    expect(screen.getByText('Tonalité').nextElementSibling).toHaveTextContent('Si bémol majeur');
    expect(screen.getByLabelText('Taille de la main')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Petite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exporter en MusicXML' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimer' })).toBeVisible();
    expect(screen.getByText('Doigté calculé en 6 ms · mise en page en 63 ms')).toBeInTheDocument();
    expect(screen.queryByText('Export MusicXML')).toBeNull();
  });

  it('writes the header, the sheet and the keyboard in Spanish, with the hand letters', async () => {
    await speak('es');
    render(
      <>
        <ScoreHeader title="T" composer="C" piece={null} onBack={() => {}} />
        <ScoreSheet pages={[]} label="Melody" />
        <Keyboard
          lowMidi={48}
          highMidi={71}
          pressed={[
            { midi: 64, finger: 3, hand: 'R' },
            { midi: 61, finger: 2, hand: 'L' },
          ]}
          handLetters
        />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Volver a la biblioteca' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Partitura de Melody' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Teclado' })).toBeInTheDocument();
    const marks = [...document.querySelectorAll('.key-hand')].map((m) => m.textContent);
    expect(marks).toEqual(['D', 'I']);
  });

  it('writes the MIDI import panel in Portuguese with solfège note names', async () => {
    await speak('pt');
    render(
      <MidiImportPanel
        info={{
          quantizedMovedShare: 0.03,
          grids: { '16th': 10, '16th-triplet': 2, '32nd': 0 },
          splitMidi: null,
          warnings: [],
        }}
        right={1}
        left={22}
        splitMidi={null}
        onSplitChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        'Importado de MIDI: notas quantizadas em uma grade de semicolcheias com tercinas; 3 % deslocadas em mais de uma semifusa',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Mão direita: 1 nota · mão esquerda: 22 notas')).toBeInTheDocument();
    expect(screen.getByLabelText('Divisão das mãos')).toHaveValue('auto');
    expect(screen.getByRole('option', { name: 'Dó4' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Fá#2' })).toBeInTheDocument();
  });

  it('writes the status line in Dutch', async () => {
    await speak('nl');
    const ready = {
      docStatus: 'ready',
      playable: true,
      hands: 'both',
      loading: false,
      countIn: null,
      alongHint: null,
    } as const;
    expect(scoreStatusLine({ ...ready, loading: true }, messages())).toEqual({
      text: 'De piano laden…',
      kind: 'info',
    });
    expect(scoreStatusLine({ ...ready, playable: false, hands: 'L' })?.text).toBe(
      'Dit stuk heeft geen noten voor de linkerhand.',
    );
  });
});

describe('score texts in every language', () => {
  it('names the hand letters L/R, L/R, G/D, I/D, E/D', async () => {
    const letters: Record<Locale, string> = { en: 'LR', nl: 'LR', fr: 'GD', es: 'ID', pt: 'ED' };
    for (const locale of LOCALES) {
      await speak(locale);
      expect(handLetter('L', messages()) + handLetter('R', messages())).toBe(letters[locale]);
    }
  });

  it('names notes and keys the way each language does', async () => {
    expect(noteName(60)).toBe('C4');
    expect(keyName('Bb major', en)).toBe('Bb major');
    await speak('nl');
    expect(noteName(61, messages())).toBe('C#4');
    expect(keyName('A minor', messages())).toBe('a-klein');
    expect(keyName('Bb major', messages())).toBe('Bes-groot');
    expect(keyName('F# minor', messages())).toBe('fis-klein');
    expect(keyName('Eb major', messages())).toBe('Es-groot');
    await speak('fr');
    expect(noteName(62, messages())).toBe('Ré4');
    expect(keyName('F# major', messages())).toBe('Fa dièse majeur');
    await speak('es');
    expect(keyName('Eb major', messages())).toBe('Mi bemol mayor');
    await speak('pt');
    expect(keyName('G minor', messages())).toBe('Sol menor');
    expect(keyName('odd', messages())).toBe('odd');
  });

  it('writes the import line with the number in the language', async () => {
    await speak('fr');
    expect(
      importLine(
        {
          quantizedMovedShare: 0.034,
          grids: { '16th': 8, '16th-triplet': 0, '32nd': 1 },
          splitMidi: null,
          warnings: [],
        },
        messages(),
      ),
    ).toBe(
      'Importé depuis MIDI : notes quantifiées sur une grille de triples croches ; 3 % déplacées de plus d’une quadruple croche',
    );
  });
});
