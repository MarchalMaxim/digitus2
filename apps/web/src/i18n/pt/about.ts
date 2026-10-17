import type { Messages } from '../messages.js';
import { formatNumber, plural } from '../format.js';

const NUMBER_WORDS = [
  'Zero',
  'Uma',
  'Duas',
  'Três',
  'Quatro',
  'Cinco',
  'Seis',
  'Sete',
  'Oito',
  'Nove',
];

const count = (n: number) => NUMBER_WORDS[n] ?? formatNumber('pt', n);

export const about: Messages['about'] = {
  back: 'Voltar para a biblioteca',
  title: 'Sobre o digitus2',
  what: {
    heading: 'O que é isto',
    body: 'O digitus2 escreve os números dos dedos em partituras de piano para iniciantes e pianistas de nível intermediário.',
  },
  how: {
    heading: 'Como os dedilhados são escolhidos',
    body: (version: string) =>
      'O motor avalia cada dedilhado possível com regras ergonômicas da literatura sobre ' +
      'dedilhado de piano (aberturas entre os dedos, passagens do polegar, dedos fracos, teclas ' +
      'pretas, mudanças de posição da mão) e escolhe o de menor custo para a peça inteira, com ' +
      'uma busca exata. O tamanho da sua mão muda as aberturas que ele permite. ' +
      `A versão do motor é ${version}.`,
  },
  who: {
    heading: 'Quem fez',
    body:
      'Criado por Claude, o modelo de IA da Anthropic, em um desenvolvimento autônomo de vários dias ' +
      'dirigido por Maxim Marchal. Até onde sabemos, nada parecido existe ainda: um motor de ' +
      'dedilhado verificado com anotações de especialistas. O código, as notas de pesquisa e os ' +
      'resultados da verificação estão no [repositório].',
  },
  licences: {
    heading: 'Licenças',
    digitus2: '[digitus2] é software livre sob a licença MIT.',
    verovio:
      'Notação musical com [Verovio], LGPL-3.0-or-later, usada como biblioteca sem modificações.',
    pdfjs: 'As pré-visualizações de PDF usam [PDF.js] ([Apache-2.0]).',
    midiFile: 'Arquivos MIDI são lidos com [midi-file] (MIT).',
    piano:
      'Som de piano: [smplr] (MIT) tocando as amostras do [Splendid Grand Piano] (domínio público).',
  },
  pieces: {
    heading: 'As peças incluídas',
    intro: 'As peças usam edições de domínio público ou com licença Creative Commons.',
    count,
    credit: (shareAlike: number, attribution: number) => {
      const credited = 'creditadas aqui e nas páginas de suas partituras.';
      if (shareAlike === 1 && attribution === 0)
        return 'Uma edição é compartilhada sob CC BY-SA e é creditada aqui e na página da partitura.';
      const start = `${count(shareAlike)} edições são compartilhadas sob CC BY-SA e`;
      return attribution === 0
        ? `${start} são ${credited}`
        : `${start} ${count(attribution).toLowerCase()} sob CC BY; todas são ${credited}`;
    },
    columns: { piece: 'Peça', composer: 'Compositor', engraving: 'Edição', licence: 'Licença' },
    arrangement: 'arranjo do digitus2',
    unnamedTypesetter: 'Editor desconhecido',
    archive: (n: number) =>
      plural('pt', n, { one: 'Mais # partitura vem', other: 'Mais # partituras vêm' }) +
      ' do arquivo do MuseScore (o conjunto de dados PDMX). Cada uma é de domínio público ou ' +
      'CC0, conforme declarado por quem a enviou, e indica sua fonte e sua licença na página da ' +
      'partitura.',
  },
};
