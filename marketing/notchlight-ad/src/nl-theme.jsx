// Ported from notchlight/src/renderer: theme.ts, Buddy.tsx, marks.tsx, IslandView.tsx atoms, Preview.tsx Icon, shared/fmt.ts
const NL = {};
NL.C = { ink:'#000000', well:'#0A0A0A', text:'#F2EDE7', body:'#E4DDD5', muted:'#A69C93', dim:'#9E958C', faint:'#8A817A', ghost:'#7C736C', dead:'#4A443F', green:'#5FBE86', yellow:'#E0B04A', red:'#D46A5A', buddy:'#C97C5C', buddyInk:'#141210', hair:'rgba(255,255,255,.08)' };
NL.MONO = "ui-monospace,'SF Mono',Menlo,monospace";
NL.SANS = "-apple-system,'SF Pro Text','Helvetica Neue',Helvetica,sans-serif";
NL.PANEL_W = 472; NL.NOTCH_W = 150; NL.NOTCH_H = 34;
NL.lightColor = (s) => s === 'working' ? NL.C.green : s === 'asking' ? NL.C.yellow : (s === 'done' || s === 'failed') ? NL.C.red : NL.C.dead;
NL.glow = (color, strength = 0.85) => { const rgb = color === NL.C.green ? '95,190,134' : color === NL.C.yellow ? '224,176,74' : color === NL.C.red ? '212,106,90' : '0,0,0'; return `0 0 10px rgba(${rgb},${strength})`; };
NL.fmtTokens = (n) => { if (!Number.isFinite(n) || n <= 0) return '0'; if (n < 1000) return String(Math.round(n)); const k = n / 1000; if (k < 100) return k.toFixed(1).replace(/\.0$/, '') + 'k'; if (k < 1000) return Math.round(k) + 'k'; return (k / 1000).toFixed(1).replace(/\.0$/, '') + 'M'; };
NL.duration = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`; };
NL.time = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// pulse.ts: 1.7s breath, opacity 1→0.4, scale 1→0.8 — here a pure function of T
NL.breath = (T) => { const phase = (T % 1.7) / 1.7; return (1 - Math.cos(phase * 2 * Math.PI)) / 2; };

function NLLight({ status, size = 9, pulse = false, T = 0 }) {
  const color = NL.lightColor(status); const dead = status === 'idle';
  const b = pulse && status === 'working' ? NL.breath(T) : 0;
  return <div style={{ width: size, height: size, borderRadius: '50%', flex: 'none', background: dead ? 'transparent' : color, boxShadow: dead ? `inset 0 0 0 1.5px ${NL.C.dead}` : NL.glow(color, 0.9), opacity: 1 - 0.6 * b, transform: `scale(${1 - 0.2 * b})` }} />;
}
function NLMono({ children, color = NL.C.text, size = 11, weight = 500, style }) {
  return <div style={{ font: `${weight} ${size}px/1 ${NL.MONO}`, color, whiteSpace: 'nowrap', ...style }}>{children}</div>;
}
NL.CLIP = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// Wings: the three-column spine. Collapsed tracks are auto (content-sized); the panel's are 1fr.
function NLWings({ notchW = NL.NOTCH_W, height = NL.NOTCH_H, left, right, width }) {
  const outward = width !== undefined; const side = outward ? 'minmax(0,1fr)' : 'auto';
  return <div style={{ display: 'grid', gridTemplateColumns: `${side} ${notchW}px ${side}`, alignItems: 'center', height, width: width ?? 'max-content' }}>
    <div data-nl-leftwing style={{ display: 'flex', alignItems: 'center', justifyContent: outward ? 'flex-start' : 'flex-end' }}>{left}</div>
    <div data-nl-notch />
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: outward ? 'flex-end' : 'flex-start' }}>{right}</div>
  </div>;
}

// Buddy.tsx — eleven rectangles at 44×40, scaled
const NL_EYES = { working: null, thinking: '. .', asking: 'o o', done: '> <', failed: 'x x', idle: '- -', approved: '^ ^' };
function NLBuddy({ face = 'working', size = 44, opacity = 1, provider = 'claude' }) {
  if (provider === 'codex') return <NLCodexBuddy face={face} size={size} opacity={opacity} />;
  const scale = size / 44; const glyph = NL_EYES[face];
  const block = (s) => ({ position: 'absolute', background: NL.C.buddy, ...s });
  return <div data-cl-buddy style={{ position: 'relative', width: size, height: Math.round(40 * scale), flex: 'none', opacity }}>
    <div style={{ position: 'absolute', left: 0, top: 0, width: 44, height: 40, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
      <div style={block({ left: 0, top: 11, width: 6, height: 12 })} /><div style={block({ right: 0, top: 11, width: 6, height: 12 })} />
      <div style={block({ left: 6, top: 0, width: 32, height: 30 })} />
      <div style={block({ left: 6, top: 30, width: 7, height: 10 })} /><div style={block({ left: 18, top: 30, width: 8, height: 10 })} /><div style={block({ left: 31, top: 30, width: 7, height: 10 })} />
      {glyph === null ? <><div style={{ position: 'absolute', left: 13, top: 9, width: 6, height: 6, background: NL.C.buddyInk }} /><div style={{ position: 'absolute', left: 25, top: 9, width: 6, height: 6, background: NL.C.buddyInk }} /></>
        : <div style={{ position: 'absolute', left: 6, top: 4, width: 32, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 12px/1 ${NL.MONO}`, letterSpacing: 3, color: NL.C.buddyInk }}>{glyph}</div>}
    </div>
  </div>;
}
function NLCodexBuddy({ face = 'working', size = 44, opacity = 1 }) {
  const shell = '#DCE7EA', trim = '#89AAB5', visor = '#15252D';
  const block = (x, y, w, h, color, k) => <div key={k} style={{ position: 'absolute', left: x, top: y, width: w, height: h, background: color }} />;
  const square = ['1111', '1111', '1111', '1111'];
  const eyes = { working: square, thinking: ['0000', '1100', '1100', '0000'], asking: ['11111', '10001', '10001', '10001', '11111'], done: ['0110', '1001', '0000', '0000'], failed: ['1001', '0110', '0110', '1001'], idle: ['0000', '0000', '1111', '0000'], approved: ['0110', '1001', '1001', '0000'] };
  const eye = (center, pattern, tag) => { const x = center - pattern[0].length; const out = []; pattern.forEach((row, y) => [...row].forEach((p, col) => { if (p === '1') out.push(block(x + col * 2, 15 + y * 2, 2, 2, shell, `${tag}-${x}-${y}-${col}`)); })); return out; };
  return <div data-codex-buddy style={{ position: 'relative', width: size, height: Math.round(size * 40 / 44), flex: 'none', opacity }}>
    <div style={{ position: 'absolute', width: 44, height: 40, transform: `scale(${size / 44})`, transformOrigin: 'top left' }}>
      {block(20, 0, 4, 7, trim, 'a')}{block(17, 0, 10, 3, shell, 'b')}
      {block(6, 7, 32, 25, shell, 'c')}{block(2, 15, 4, 11, trim, 'd')}{block(38, 15, 4, 11, trim, 'e')}
      {block(9, 12, 26, 13, visor, 'f')}{block(10, 32, 8, 8, trim, 'g')}{block(26, 32, 8, 8, trim, 'h')}{block(19, 28, 6, 2, trim, 'i')}
      {eye(18, eyes[face], 'l')}{eye(30, face === 'thinking' ? square : eyes[face], 'r')}
    </div>
  </div>;
}
NL.faceFor = (status, busy = false) => status === 'asking' ? 'asking' : status === 'failed' ? 'failed' : status === 'done' ? 'done' : (status === 'idle' || status === 'unknown' || status === 'interrupted') ? 'idle' : busy ? 'working' : 'thinking';

// marks.tsx
function NLMark({ activity, color = NL.C.faint }) {
  switch (activity) {
    case 'code': return <div style={{ position: 'relative', width: 15, height: 12, flex: 'none' }}><div style={{ position: 'absolute', left: 2, top: 0, width: 11, height: 8, boxShadow: `inset 0 0 0 1.5px ${color}` }} /><div style={{ position: 'absolute', left: 0, bottom: 0, width: 15, height: 2, background: color }} /></div>;
    case 'shell': return <div style={{ width: 15, height: 13, flex: 'none', boxShadow: `inset 0 0 0 1.5px ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 7px/1 ${NL.MONO}`, color }}>{'>_'}</div>;
    case 'ask': return <div style={{ width: 15, display: 'flex', justifyContent: 'center', flex: 'none', font: `700 13px/1 ${NL.MONO}`, color: NL.C.yellow }}>?</div>;
    case 'done': return <div style={{ width: 15, display: 'flex', justifyContent: 'center', flex: 'none', font: `700 12px/1 ${NL.MONO}`, color: NL.C.red }}>✓</div>;
    default: return <div style={{ display: 'flex', gap: 2.5, width: 15, alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{[0, 1, 2].map(i => <div key={i} style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: color }} />)}</div>;
  }
}

// Preview.tsx Icon — paths verbatim
const NL_ICONS = {
  music: <><path d="M9 17V5l11-2v12M9 8l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2.5" /><ellipse cx="17" cy="16" rx="3" ry="2.5" /></>,
  tray: <><path d="M3 14l3-9h12l3 9v6H3Z" /><path d="M3 14h5l2 3h4l2-3h5" /></>,
  settings: <><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  play: <path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none" />,
  pause: <path d="M8 5v14M16 5v14" strokeWidth="4" />,
  next: <><path d="m5 6 10 6-10 6Z" fill="currentColor" stroke="none" /><path d="M18 6v12" /></>,
  back: <><path d="m19 6-10 6 10 6Z" fill="currentColor" stroke="none" /><path d="M6 6v12" /></>,
  close: <path d="m7 7 10 10M17 7 7 17" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  file: <path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6" />,
  folder: <path d="M3 6h7l2 3h9v11H3Z" />,
  clipboard: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></>,
  pin: <path d="M9 3h6l-1 6 3 3H7l3-3ZM12 12v9" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>
};
function NLIcon({ name, size = 18, style }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...style }}>{NL_ICONS[name] || NL_ICONS.file}</svg>;
}
Object.assign(window, { NL, NLLight, NLMono, NLWings, NLBuddy, NLCodexBuddy, NLMark, NLIcon });
