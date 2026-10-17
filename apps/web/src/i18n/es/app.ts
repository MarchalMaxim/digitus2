import type { Messages } from '../messages.js';

export const app: Messages['app'] = {
  listFailed:
    'digitus2 no pudo cargar la lista de piezas. Comprueba la conexión y vuelve a cargar la página.',
  openingScan: 'Abriendo el escaneo...',
  fileNotRestorable: 'Ábrela desde Mis partituras, o elige el archivo otra vez.',
  darkTheme: 'Tema oscuro',
  engineFailed: (detail: string) =>
    detail ? `el motor ha fallado: ${detail}` : 'el motor ha fallado',
};
