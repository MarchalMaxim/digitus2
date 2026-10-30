/**
 * How long reading a score may take before the reader gets the library back with a notice
 * (issues 240, 242): the bytes of a file chosen from a phone's provider or a cloud folder, or a
 * saved score out of My scores, can stall without ever failing.
 */
export const READ_TIMEOUT_MS = 8000;

/** `read`, or a rejection when it has not finished within `READ_TIMEOUT_MS`. */
export function withinReadTimeout<T>(read: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('read timed out')), READ_TIMEOUT_MS);
    read.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error('read failed'));
      },
    );
  });
}
