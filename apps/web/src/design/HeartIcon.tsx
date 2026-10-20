/**
 * The heart of the favourites (issue #78): the score page's toggle and the Favourites shelf's
 * rows. Its outline and fill come from the button around it (base.css, `.heart-button`).
 */
export function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      {/* Two lobes of radius 4 that meet at the top, and their tangents down to the point. */}
      <path d="M12 20L5.35 11.46A4 4 0 1 1 12 7.06A4 4 0 1 1 18.65 11.46Z" />
    </svg>
  );
}
