/**
 * Which build of the app this is. vite.config.ts defines `__DIGITUS2_BUILD__` as the short commit
 * and the time of the build; a phone that keeps the app installed can run an older build than the
 * site serves (a newer worker waits until every window closes), so About and a scan's
 * Recognition details name it.
 */
export interface Build {
  /** The short commit the build was made from; 'dev' where there is none. */
  commit: string;
  /** The time of the build as an ISO timestamp; empty where unknown. */
  date: string;
}

export const DEV_BUILD: Build = { commit: 'dev', date: '' };

/** The build a defined global describes; anything that is not a commit and a date is a dev build. */
export function readBuild(raw: unknown): Build {
  if (typeof raw !== 'object' || raw === null) return DEV_BUILD;
  const { commit, date } = raw as Record<string, unknown>;
  return {
    commit: typeof commit === 'string' && commit !== '' ? commit : DEV_BUILD.commit,
    date: typeof date === 'string' && !Number.isNaN(Date.parse(date)) ? date : DEV_BUILD.date,
  };
}

/** The build of this page. The global is absent where nothing defines it (a bare test runner). */
export const build: Build = readBuild(
  typeof __DIGITUS2_BUILD__ === 'undefined' ? undefined : __DIGITUS2_BUILD__,
);

/** The build's day as `2026-10-22`, in UTC; empty when the date is unknown. */
export function buildDay(b: Build = build): string {
  return b.date ? new Date(b.date).toISOString().slice(0, 10) : '';
}

/**
 * The build's day written in the reader's language ('22 October 2026'), in UTC so that it names
 * the same day as buildDay whatever time zone the device is in; empty when the date is unknown.
 */
export function formatBuildDay(locale: string, b: Build = build): string {
  return b.date
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
        new Date(b.date),
      )
    : '';
}
