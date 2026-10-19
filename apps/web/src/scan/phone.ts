/**
 * A phone or tablet scans like any other device; it only adds pages through its camera, and its
 * page tools say how to move a page by touch.
 */

/**
 * True on a device whose only pointer is a finger. A touch laptop also has a fine pointer, and a
 * browser that cannot tell (tests, old browsers) counts as a pointer device.
 */
export function isTouchOnly(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(any-pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

let lastCapture = '';
let sameSecond = 0;
/**
 * A camera capture renamed after the time it was taken ("photo 14.05.31.jpg"): phones hand
 * every capture over as "image.jpg", which says nothing in a list of pages.
 */
export function namedCapture(file: File, at = new Date()): File {
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join('.');
  sameSecond = time === lastCapture ? sameSecond + 1 : 1;
  lastCapture = time;
  const extension = file.type === 'image/png' ? 'png' : 'jpg';
  return new File([file], `photo ${time}${sameSecond > 1 ? ` (${sameSecond})` : ''}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
