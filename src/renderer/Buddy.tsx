/**
 * The buddy.
 *
 * Eleven rectangles: a head, two arms, three legs, and a face. It is drawn at
 * 44×40 and scaled, rather than being an SVG or a font glyph, because the whole
 * charm is that the pixels stay square at every size — at 20px in a row it is
 * still recognisably the same object as the one filling the hero view.
 */
import { C } from './theme';
import type { AgentProvider, Face, Status } from '../shared/types';

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
  if (status === 'idle' || status === 'unknown' || status === 'interrupted') return 'idle';
  return busy ? 'working' : 'thinking';
}

export function Buddy({ face = 'working', size = 44, opacity = 1, provider = 'claude' }: { face?: Face; size?: number; opacity?: number; provider?: AgentProvider }) {
  if (provider === 'codex') return <CodexBuddy face={face} size={size} opacity={opacity}/>;
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
export function BuddyStack({ faces, size = 22, providers = [] }: { faces: Face[]; size?: number; providers?: (AgentProvider | undefined)[] }) {
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
            <Buddy provider={providers[i]} face={face} size={size} opacity={i === 0 ? 1 : i === 1 ? 0.8 : 0.55} />
          </div>
        ))}
    </div>
  );
}

/** Original Codex companion: antenna, square visor, two feet, cool ivory shell. */
export function CodexBuddy({face = 'working',size = 44,opacity = 1}: {face?: Face;size?:number;opacity?:number}) {
  const block = (x:number,y:number,w:number,h:number,color:string) => <div key={`${x}-${y}`} style={{position:'absolute',left:x,top:y,width:w,height:h,background:color}}/>;
  const shell = '#DCE7EA', trim = '#89AAB5', visor = '#15252D';
  const square = ['1111','1111','1111','1111'];
  const eyes: Record<Face,string[]> = {
    working: square, thinking: ['0000','1100','1100','0000'],
    asking: ['11111','10001','10001','10001','11111'],
    done: ['0110','1001','0000','0000'], failed: ['1001','0110','0110','1001'],
    idle: ['0000','0000','1111','0000'], approved: ['0110','1001','1001','0000']
  };
  // Two-point cells: at 18pt an eye is still ~3px, the same weight as Claude's 6×6 eyes.
  const eye = (center:number,pattern:string[]) => {
    const x = center - pattern[0].length;
    return pattern.flatMap((row,y) => [...row].flatMap((pixel,column) => pixel === '1' ? [block(x+column*2,15+y*2,2,2,shell)] : []));
  };
  return <div data-codex-buddy aria-hidden="true" style={{position:'relative',width:size,height:Math.round(size*40/44),flex:'none',opacity}}>
    <div style={{position:'absolute',width:44,height:40,transform:`scale(${size/44})`,transformOrigin:'top left'}}>
      {block(20,0,4,7,trim)}{block(17,0,10,3,shell)}
      {block(6,7,32,25,shell)}{block(2,15,4,11,trim)}{block(38,15,4,11,trim)}
      {block(9,12,26,13,visor)}{block(10,32,8,8,trim)}{block(26,32,8,8,trim)}{block(19,28,6,2,trim)}
      {eye(18,eyes[face])}{eye(30,face === 'thinking' ? square : eyes[face])}
    </div>
  </div>;
}
