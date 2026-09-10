/**
 * The breathing light, driven from one slow timer instead of a CSS animation.
 *
 * A compositor animation on the overlay makes Chromium redraw the whole
 * transparent, screen-wide window sixty times a second. Measured on an M5 with
 * one 9 px dot pulsing: the GPU process at 27 % and the renderer at 6 % of a
 * core, against under 2 % with the dot still. Twelve frames a second of a
 * 1.7 s breath look the same and cost a fraction of that.
 *
 * One interval serves every pulsing light through two custom properties on
 * the root. It runs only while something is pulsing, and not at all when the
 * system or the app asks for reduced motion.
 */
import { useEffect, useState, type CSSProperties } from 'react';

const PERIOD_MS = 1700;
const FRAME_MS = 80;
const QUERY = '(prefers-reduced-motion: reduce)';

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function write(breath: number) {
  const root = document.documentElement.style;
  root.setProperty('--cl-pulse-opacity', (1 - 0.6 * breath).toFixed(3));
  root.setProperty('--cl-pulse-scale', (1 - 0.2 * breath).toFixed(3));
}

function tick() {
  const phase = (Date.now() % PERIOD_MS) / PERIOD_MS;
  // 0 → 1 → 0 with an ease at both ends, like the keyframes it replaces.
  write((1 - Math.cos(phase * 2 * Math.PI)) / 2);
}

/** Follows the system's reduced-motion setting as it changes, not just as it was at mount. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia(QUERY);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Keep the shared timer running while this light wants to breathe. */
export function usePulse(active: boolean): boolean {
  const reduced = useReducedMotion();
  const pulsing = active && !reduced;
  useEffect(() => {
    if (!pulsing) return;
    if (users++ === 0) { tick(); timer = setInterval(tick, FRAME_MS); }
    return () => {
      if (--users > 0) return;
      if (timer) clearInterval(timer);
      timer = null;
      write(0);
    };
  }, [pulsing]);
  return pulsing;
}

/** The style a pulsing element wears; nothing when still. */
export function pulseStyle(pulsing: boolean): CSSProperties {
  return pulsing ? { opacity: 'var(--cl-pulse-opacity, 1)', transform: 'scale(var(--cl-pulse-scale, 1))' } : {};
}
