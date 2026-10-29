import type { whistle as en } from './en.js';

export const whistle: typeof en = {
  start: 'Assobiar uma melodia',
  hint: 'Assobie ou cantarole, depois pressione Parar.',
  stop: 'Parar',
  recording: 'Gravação',
  writing: 'Escrevendo as notas…',
  again: 'Assobiar de novo',
  denied:
    'O navegador bloqueou o microfone. Permita-o nas configurações do site e pressione de novo.',
  noMicrophone: 'Nenhum microfone encontrado.',
  failed: 'Não foi possível iniciar o microfone.',
  noNotes: 'Nenhuma nota foi ouvida. Assobie um pouco mais alto ou mais perto do microfone.',
};
