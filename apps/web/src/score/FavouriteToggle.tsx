import { useAppStore } from '../app/store.js';
import { useT } from '../i18n/i18n.js';

/**
 * The heart beside a library piece's title (issue #78): an outline that fills with ink while the
 * piece is a favourite, and the piece is on the library's Favourites shelf. Ink only, never red,
 * not printed. Named "Favourite" and pressed while it is one, as the theme switch is named for
 * what it turns on.
 */
export function FavouriteToggle({ slug }: { slug: string }) {
  const t = useT();
  const pressed = useAppStore((s) => s.settings.favourites.includes(slug));
  const toggleFavourite = useAppStore((s) => s.toggleFavourite);
  return (
    <button
      type="button"
      className="favourite-toggle no-print"
      aria-label={t.score.header.favourite}
      aria-pressed={pressed}
      onClick={() => toggleFavourite(slug)}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        {/* Two lobes of radius 4 that meet at the top, and their tangents down to the point. */}
        <path d="M12 20L5.35 11.46A4 4 0 1 1 12 7.06A4 4 0 1 1 18.65 11.46Z" />
      </svg>
    </button>
  );
}
