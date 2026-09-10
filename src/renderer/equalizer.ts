/**
 * How five band levels become bars on screen.
 *
 * `rising` is the classic: bass on the left, treble on the right, five bars.
 * `mirrored` folds them around the middle — treble at both edges, bass in the
 * centre, nine bars — so the shape reads as one breathing blob rather than a
 * slope. Both are pure index maps over the same five levels; the helper does
 * not change.
 */
export type EqualizerLayout = 'rising' | 'mirrored';

/** Which band each bar shows, left to right. */
export function barBands(layout: EqualizerLayout): number[] {
  return layout === 'mirrored' ? [4, 3, 2, 1, 0, 1, 2, 3, 4] : [0, 1, 2, 3, 4];
}

/** The shape the bars hold while a track plays but nothing can be heard. */
export const QUIET_BANDS = [0.38, 0.55, 0.46, 0.6, 0.42];

/** A band level (0…1) as the bar's vertical scale; bars never vanish entirely. */
export const barScale = (level: number) => (0.18 + 0.82 * Math.min(1, Math.max(0, level))).toFixed(3);

/** One frame of scales for the layout, or the quiet shape when `levels` is null. */
export function barFrame(layout: EqualizerLayout, levels: number[] | null): string[] {
  const source = levels ?? QUIET_BANDS;
  return barBands(layout).map(band => barScale(source[band] ?? 0));
}

/** Bass energy for anything that wants to move with it: the lowest band, softened. */
export const bassOf = (levels: number[]) => Math.min(1, Math.max(0, levels[0] ?? 0)) ** 1.5;
