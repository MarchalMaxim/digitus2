import type { Messages } from '../messages.js';

export const app: Messages['app'] = {
  listFailed:
    'digitus2 kon de stukkenlijst niet laden. Controleer de verbinding en laad de pagina opnieuw.',
  openingScan: 'Scan openen...',
  fileNotRestorable: 'Open het via Mijn partituren, of kies het bestand opnieuw.',
  darkTheme: 'Donker thema',
  engineFailed: (detail: string) =>
    detail ? `de engine-worker is mislukt: ${detail}` : 'de engine-worker is mislukt',
};
