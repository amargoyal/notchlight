/**
 * The colour of a record sleeve, for a glow behind the bars.
 *
 * The artwork is fetched once per URL, shrunk to a handful of pixels, and its
 * most saturated-and-bright pixels averaged. Nothing here is on any hot path:
 * a track changes every few minutes, and the answer is cached. Offline or odd,
 * there is no tint and the bars sit on plain black as before.
 */
/** Average of the liveliest pixels in an RGBA buffer, as #rrggbb; null for an empty or grey image. */
export function tintOf(rgba: Uint8Array | Buffer, width: number, height: number): string | null {
  const count = width * height;
  if (count <= 0 || rgba.length < count * 4) return null;
  const scored: { r: number; g: number; b: number; score: number }[] = [];
  for (let i = 0; i < count; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max ? (max - min) / max : 0;
    const brightness = max / 255;
    // Lively and visible, but not blown-out white or near-black.
    scored.push({ r, g, b, score: saturation * 0.7 + brightness * 0.3 - (brightness > 0.95 && saturation < 0.15 ? 1 : 0) - (brightness < 0.12 ? 1 : 0) });
  }
  if (!scored.length) return null;
  scored.sort((x, y) => y.score - x.score);
  const top = scored.slice(0, Math.max(1, Math.round(scored.length * 0.2)));
  if (top[0].score < 0.3) return null; // nothing lively enough: grey, or near it
  const r = Math.round(top.reduce((n, p) => n + p.r, 0) / top.length);
  const g = Math.round(top.reduce((n, p) => n + p.g, 0) / top.length);
  const b = Math.round(top.reduce((n, p) => n + p.b, 0) / top.length);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Bitmap bytes from a PNG or JPEG, shrunk. Electron's nativeImage gives BGRA;
 * this returns RGBA. Electron is loaded here rather than at the top so the
 * pure tintOf() can be tested outside it.
 */
export async function shrinkToRgba(bytes: Buffer, size = 12): Promise<{ rgba: Buffer; width: number; height: number } | null> {
  const { nativeImage } = await import('electron');
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const small = image.resize({ width: size, height: size, quality: 'good' });
  const { width, height } = small.getSize();
  const bgra = small.toBitmap();
  const rgba = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3]; }
  return { rgba, width, height };
}

export type TintLookup = (artworkUrl: string) => Promise<string | null>;

/** Fetch the artwork and find its tint. Best effort with a short deadline; null on any trouble. */
export async function fetchTint(artworkUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(artworkUrl, { signal: controller.signal });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 4_000_000) return null;
    const small = await shrinkToRgba(bytes);
    return small ? tintOf(small.rgba, small.width, small.height) : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
