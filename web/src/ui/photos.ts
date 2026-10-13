// Photos are resized on the shelter's phone before they're sent (PAT-9): a ~1600 px image for cards and
// profiles, and a ~480 px thumbnail for small frames. Re-drawing through a canvas also drops the camera's
// metadata (EXIF, including GPS), which the server refuses anyway. WebP where the browser can encode it,
// JPEG otherwise (older Safari).

const FULL_EDGE = 1600;
const THUMB_EDGE = 480;
const FULL_TARGET = 450_000; // bytes; the server's limit is 600 KB
const THUMB_TARGET = 60_000; // the server's limit is 80 KB
const MIN_EDGE = 400;

export type PreparedPhoto = { full: Blob; thumb: Blob; width: number; height: number };
export class PhotoError extends Error {}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function draw(source: ImageBitmap, edge: number, target: number) {
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  // Try WebP first; a browser that can't encode it hands back PNG, so switch to JPEG.
  const probe = await encode(canvas, 'image/webp', 0.82);
  const type = probe?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  for (const q of [0.82, 0.72, 0.62, 0.5]) {
    const blob = q === 0.82 && type === 'image/webp' ? probe : await encode(canvas, type, q);
    if (blob && blob.size <= target) return { blob, width: canvas.width, height: canvas.height };
  }
  return null;
}

/** Resizes a picked file into the two images the server takes. Throws PhotoError with a reason key. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('unreadable');
  }
  try {
    if (Math.max(bitmap.width, bitmap.height) < MIN_EDGE) throw new PhotoError('too_small');
    const full = (await draw(bitmap, FULL_EDGE, FULL_TARGET)) ?? (await draw(bitmap, 1200, FULL_TARGET));
    const thumb = await draw(bitmap, THUMB_EDGE, THUMB_TARGET);
    if (!full || !thumb) throw new PhotoError('unreadable');
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
  } finally {
    bitmap.close();
  }
}

/** A blob as base64 (no data: prefix), for the JSON upload. */
export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
