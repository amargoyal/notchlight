/**
 * Two fingers up over the open notch: fold it away.
 *
 * A trackpad swipe and a scroll wheel arrive as the same event, so the only
 * thing telling them apart is shape. A swipe is a run of upward deltas close
 * together that adds up to real distance; a wheel notch is one large delta on
 * its own, and reading a long panel is a run of *downward* ones. So the run is
 * accumulated, reset whenever the direction reverses or the fingers pause, and
 * only a run that clears the threshold counts.
 *
 * Kept away from the component so the rule can be tried directly rather than by
 * flicking at a notch and seeing what happens.
 */

/** Points of upward travel in one run before it is a swipe. */
export const SWIPE_DISTANCE = 42;
/** A gap this long ends the run. Fingers leaving the glass look exactly like this. */
export const SWIPE_GAP_MS = 180;

export interface SwipeState {
  /** Upward points in the current run. */
  travel: number;
  at: number;
  /** This run has already closed the notch; the rest of it is the same gesture. */
  spent: boolean;
}
export const NO_SWIPE: SwipeState = { travel: 0, at: 0, spent: false };

/**
 * Fold one wheel event into the run. `up` is true when the run has just cleared
 * the threshold, which happens on exactly one event per gesture — a long swipe
 * is one close, not a close every forty points.
 *
 * `deltaY` follows the DOM: negative is content moving up, which is two fingers
 * pushing up the trackpad.
 */
export function swipeStep(state: SwipeState, deltaY: number, now: number): { state: SwipeState; up: boolean } {
  // Only upward travel accumulates; a downward flick abandons the run outright
  // rather than eating into it, so a scroll back and forth never adds up to a
  // swipe.
  if (deltaY >= 0) return { state: NO_SWIPE, up: false };
  const continued = now - state.at <= SWIPE_GAP_MS && (state.travel > 0 || state.spent);
  const travel = (continued ? state.travel : 0) + -deltaY;
  const spent = continued && state.spent;
  if (spent || travel < SWIPE_DISTANCE) return { state: { travel, at: now, spent }, up: false };
  return { state: { travel, at: now, spent: true }, up: true };
}
