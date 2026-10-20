import { useAppStore } from '../app/store.js';
import { HeartIcon } from '../design/HeartIcon.js';
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
      className="heart-button favourite-toggle no-print"
      aria-label={t.score.header.favourite}
      aria-pressed={pressed}
      onClick={() => toggleFavourite(slug)}
    >
      <HeartIcon />
    </button>
  );
}
