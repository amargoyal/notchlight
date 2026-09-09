/**
 * The buddy.
 *
 * Eleven rectangles: a head, two arms, three legs, and a face. It is drawn at
 * 44×40 and scaled, rather than being an SVG or a font glyph, because the whole
 * charm is that the pixels stay square at every size — at 20px in a row it is
 * still recognisably the same object as the one filling the hero view.
 */
import { C } from './theme';
import type { Face, Status } from '../shared/types';

const W = 44;
const H = 40;

/** Faces are eye glyphs; `null` means the plain square eyes. */
const EYES: Record<Face, string | null> = {
  working: null,
  thinking: '. .',
  asking: 'o o',
  done: '> <',
  failed: 'x x',
  idle: '- -',
  approved: '^ ^'
};

export function faceFor(status: Status, busy = false): Face {
  if (status === 'asking') return 'asking';
  if (status === 'failed') return 'failed';
  if (status === 'done') return 'done';
  if (status === 'idle') return 'idle';
  return busy ? 'working' : 'thinking';
}

export function Buddy({ face = 'working', size = 44, opacity = 1 }: { face?: Face; size?: number; opacity?: number }) {
  const scale = size / W;
  const glyph = EYES[face];
  const block = (style: React.CSSProperties) => ({ position: 'absolute' as const, background: C.buddy, ...style });
  return (
    <div
      data-cl-buddy
      style={{
        position: 'relative',
        width: size,
        height: Math.round(H * scale),
        flex: 'none',
        opacity
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div style={block({ left: 0, top: 11, width: 6, height: 12 })} />
        <div style={block({ right: 0, top: 11, width: 6, height: 12 })} />
        <div style={block({ left: 6, top: 0, width: 32, height: 30 })} />
        <div style={block({ left: 6, top: 30, width: 7, height: 10 })} />
        <div style={block({ left: 18, top: 30, width: 8, height: 10 })} />
        <div style={block({ left: 31, top: 30, width: 7, height: 10 })} />
        {glyph === null ? (
          <>
            <div style={{ position: 'absolute', left: 13, top: 9, width: 6, height: 6, background: C.buddyInk }} />
            <div style={{ position: 'absolute', left: 25, top: 9, width: 6, height: 6, background: C.buddyInk }} />
          </>
        ) : (
          <div
            style={{
              position: 'absolute',
              left: 6,
              top: 4,
              width: 32,
              height: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: "700 12px/1 ui-monospace,'SF Mono',Menlo,monospace",
              letterSpacing: 3,
              color: C.buddyInk
            }}
          >
            {glyph}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Several buddies overlapping, most active in front.
 *
 * This is the multi-session collapsed state: you cannot fit three rows in a
 * 34px bar, but you can fit three faces peeking out from behind each other,
 * and the count is already on the other wing.
 */
export function BuddyStack({ faces, size = 22 }: { faces: Face[]; size?: number }) {
  const shown = faces.slice(0, 3);
  // Wide enough that three silhouettes still read as three. At 0.42 they
  // overlapped into one smudge on a real menu bar.
  const step = Math.round(size * 0.58);
  const width = size + step * (shown.length - 1);
  return (
    <div style={{ position: 'relative', width, height: Math.round((H / W) * size), flex: 'none' }}>
      {shown
        .map((face, i) => ({ face, i }))
        .reverse()
        .map(({ face, i }) => (
          <div key={i} style={{ position: 'absolute', left: step * (shown.length - 1 - i), top: 0 }}>
            <Buddy face={face} size={size} opacity={i === 0 ? 1 : i === 1 ? 0.8 : 0.55} />
          </div>
        ))}
    </div>
  );
}
