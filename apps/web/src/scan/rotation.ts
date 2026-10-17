import { PhraseError } from '../i18n/PhraseError.js';
import { SCAN_LIMIT, type ScanPage } from './model.js';

const PIXEL_LIMIT = 16_000_000;
const SIDE_LIMIT = 12_000;

/** Inspect headers before allocating a decoded bitmap or canvas. */
async function checkDimensions(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let width = 0;
  let height = 0;
  if (bytes[0] === 137 && bytes.length >= 24) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && length >= 7) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw new PhraseError((t) => t.scan.rotation.unreadable);
  if (width * height > PIXEL_LIMIT || width > SIDE_LIMIT || height > SIDE_LIMIT)
    throw new PhraseError((t) => t.scan.rotation.tooLargeChoose);
}

/** Always decode the unchanged original; intermediate turns never become the next source. */
export async function rotateScanPage(page: ScanPage, signal: AbortSignal): Promise<ScanPage> {
  const original = page.originalFile ?? page.file;
  const quarterTurns = (((page.quarterTurns ?? 0) + 1) % 4) as 0 | 1 | 2 | 3;
  const clean = {
    ...page,
    xml: undefined,
    error: undefined,
    recognizer: undefined,
    warnings: undefined,
  };
  signal.throwIfAborted();
  if (!quarterTurns)
    return { ...clean, file: original, originalFile: undefined, quarterTurns: undefined };
  if (original.size > SCAN_LIMIT) throw new PhraseError((t) => t.scan.rotation.originalTooBig);
  await checkDimensions(original);
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(original, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  try {
    signal.throwIfAborted();
    if (
      bitmap.width * bitmap.height > PIXEL_LIMIT ||
      bitmap.width > SIDE_LIMIT ||
      bitmap.height > SIDE_LIMIT
    )
      throw new PhraseError((t) => t.scan.rotation.tooLarge);
    canvas.width = quarterTurns % 2 ? bitmap.height : bitmap.width;
    canvas.height = quarterTurns % 2 ? bitmap.width : bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new PhraseError((t) => t.scan.rotation.browserCannot);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((quarterTurns * Math.PI) / 2);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new PhraseError((t) => t.scan.rotation.failed)),
        'image/png',
      );
    });
    signal.throwIfAborted();
    if (blob.size > SCAN_LIMIT) throw new PhraseError((t) => t.scan.rotation.resultTooBig);
    return {
      ...clean,
      file: new File([blob], original.name.replace(/\.[^.]+$/, '') + '-rotated.png', {
        type: 'image/png',
        lastModified: original.lastModified,
      }),
      originalFile: original,
      quarterTurns,
    };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
