import type { whistle as en } from './en.js';

export const whistle: typeof en = {
  start: 'Silba una melodía',
  hint: 'Silba o tararea y pulsa Parar.',
  stop: 'Parar',
  recording: 'Grabación',
  writing: 'Escribiendo las notas…',
  again: 'Silbar de nuevo',
  denied:
    'El navegador ha bloqueado el micrófono. Permítelo en los ajustes del sitio y vuelve a pulsar.',
  noMicrophone: 'No se encontró ningún micrófono.',
  failed: 'No se pudo activar el micrófono.',
  noNotes: 'No se oyó ninguna nota. Silba un poco más fuerte o más cerca del micrófono.',
};
