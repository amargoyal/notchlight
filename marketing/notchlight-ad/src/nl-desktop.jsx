// Desktop set dressing: display, menu bar, terminal, Finder (MockFinder style from preview.css), small player window
const DW = 1512, DH = 982; // MacBook Pro 14" points
const { SANS: DSANS, MONO: DMONO } = NL;

const TERM_LINES = [
  { at: 0.0, t: '~/dev/notchlight  faces', c: '#8a817a' },
  { at: 0.0, t: '› claude', c: '#d8d0c8' },
  { at: 0.3, t: '● Shaping the music view', c: '#5FBE86' },
  { at: 0.7, t: '  ⎿ Read src/renderer/Preview.tsx', c: '#a69c93' },
  { at: 1.1, t: '  ⎿ Edit src/renderer/Preview.tsx  +42 −7', c: '#a69c93' },
  { at: 1.6, t: '● Running npm run typecheck', c: '#5FBE86' },
  { at: 3.4, t: '  ⎿ Bash  npm run typecheck', c: '#a69c93' },
  { at: 6.2, t: '  ⎿ 0 errors · 38 files', c: '#a69c93' },
  { at: 8.0, t: '● Wiring the volume wheel', c: '#5FBE86' },
  { at: 10.4, t: '  ⎿ Edit src/renderer/LiveCompanion.tsx  +31 −4', c: '#a69c93' },
  { at: 12.6, t: '● Checking the resting bar', c: '#5FBE86' }
];
function Traffic({ dark }) {
  const dot = (bg) => <i style={{ display: 'block', width: 12, height: 12, borderRadius: '50%', background: bg }} />;
  return <span style={{ display: 'flex', gap: 8, marginRight: 12 }}>{dot(dark ? '#c4836d' : '#c4836d')}{dot('#cdbb86')}{dot('#9daa8c')}</span>;
}
function TerminalWindow({ T }) {
  const cursorOn = Math.floor(T * 2) % 2 === 0;
  return <div style={{ position: 'absolute', left: 500, top: 92, width: 640, height: 560, borderRadius: 11, background: '#1c1a18', boxShadow: '0 30px 60px -20px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.08)', overflow: 'hidden' }}>
    <div style={{ height: 38, background: '#2a2724', display: 'flex', alignItems: 'center', padding: '0 14px', font: `500 13px/1 ${DSANS}`, color: '#b7afa6' }}><Traffic dark /><span style={{ flex: 1, textAlign: 'center', paddingRight: 60 }}>notchlight — claude — 110×34</span></div>
    <div style={{ padding: '16px 18px', font: `400 13px/1.75 ${DMONO}`, whiteSpace: 'pre' }}>
      {TERM_LINES.filter(l => T >= l.at).map((l, i) => <div key={i} style={{ color: l.c }}>{l.t}</div>)}
      <div style={{ color: '#d8d0c8' }}>{'› '}<span style={{ display: 'inline-block', width: 8, height: 15, background: cursorOn ? '#d8d0c8' : 'transparent', verticalAlign: '-2px' }} /></div>
    </div>
  </div>;
}
// The app's own MockFinder (preview.css .mp-finder*) — light, warm, four sample files
const FINDER_FILES = [{ id: 'coast', name: 'Coast.jpg', kind: 'image' }, { id: 'brief', name: 'Project brief.pdf', kind: 'pdf' }, { id: 'assets', name: 'Brand assets', kind: 'folder' }, { id: 'notes', name: 'Notes for the next iteration and final handoff.md', kind: 'text' }];
function FinderWindow({ lifted }) {
  return <div style={{ position: 'absolute', left: 560, top: 540, width: 560, borderRadius: 10, background: '#f5f2ed', color: '#45423c', overflow: 'hidden', boxShadow: '0 18px 35px -15px #162c3580, 0 0 0 1px #ffffff66', font: `400 11px/1.5 ${DSANS}` }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#eae7e1', height: 36, padding: '0 12px', borderBottom: '1px solid #d4cfc5' }}><span style={{ display: 'flex', gap: 5, marginRight: 10 }}>{['#c4836d', '#cdbb86', '#9daa8c'].map(c => <i key={c} style={{ display: 'block', width: 7, height: 7, borderRadius: '50%', background: c }} />)}</span><NLIcon name="folder" size={15} /><strong style={{ fontWeight: 600 }}>Desktop</strong><span style={{ marginLeft: 'auto', color: '#706b62', fontSize: 9 }}>4 items</span></div>
    <div style={{ display: 'flex', minHeight: 140 }}>
      <aside style={{ background: '#e6e5dd', width: 95, flex: 'none', padding: '12px 6px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 9 }}>
        <span style={{ padding: '3px 5px' }}>Favorites</span>
        <b style={{ padding: '3px 5px', display: 'flex', alignItems: 'center', gap: 5, background: '#d4d9d0', borderRadius: 4, fontWeight: 500 }}><NLIcon name="folder" size={14} /> Desktop</b>
        <span style={{ padding: '3px 5px', display: 'flex', alignItems: 'center', gap: 5 }}><NLIcon name="file" size={14} /> Documents</span>
      </aside>
      <div style={{ padding: '8px 9px', display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 5, flex: 1, minWidth: 0 }}>
        {FINDER_FILES.map(f => <div key={f.id} data-target={f.id === 'brief' ? 'finder-brief' : undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 3, borderRadius: 5, color: f.kind === 'folder' ? '#739aa9' : '#8e7258', opacity: f.id === 'brief' && lifted ? .35 : 1 }}>
          <NLFileThumb kind={f.kind} />
          <span style={{ fontSize: 9, color: '#45423c', textAlign: 'center', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{f.name}</span>
        </div>)}
      </div>
    </div>
  </div>;
}
function PlayerWindow({ T }) {
  const pos = 72 + T;
  return <div style={{ position: 'absolute', left: 1000, top: 96, width: 260, borderRadius: 11, background: '#141210', overflow: 'hidden', boxShadow: '0 30px 60px -20px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.08)', color: '#f2ede7' }}>
    <div style={{ height: 38, display: 'flex', alignItems: 'center', padding: '0 14px' }}><Traffic /></div>
    <div style={{ padding: '4px 22px 22px' }}>
      <img src="./assets/late-light.svg" alt="" style={{ width: 216, height: 216, borderRadius: 8, display: 'block' }} />
      <div style={{ font: `600 15px/1.3 ${DSANS}`, marginTop: 16 }}>Late Light</div>
      <div style={{ font: `400 12px/1.4 ${DSANS}`, color: '#a69c93' }}>The Quiet Hours</div>
      <div style={{ marginTop: 14, height: 3, borderRadius: 2, background: 'rgba(255,255,255,.14)' }}><div style={{ width: `${pos / 234 * 100}%`, height: '100%', borderRadius: 2, background: '#d1bca2' }} /></div>
    </div>
  </div>;
}
function MenuBar() {
  const item = (t, bold) => <span style={{ font: `${bold ? 600 : 400} 13px/1 ${DSANS}`, color: '#1d1b18' }}>{t}</span>;
  return <div style={{ position: 'absolute', left: 0, top: 0, width: DW, height: NL.NOTCH_H, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', background: 'rgba(233,229,221,.78)' }}>
    <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>{item('Terminal', true)}{item('Shell')}{item('Edit')}{item('View')}{item('Window')}{item('Help')}</div>
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}><span style={{ width: 22, height: 10, border: '1.5px solid #1d1b18', borderRadius: 3, position: 'relative' }}><i style={{ position: 'absolute', left: 1, top: 1, bottom: 1, width: '70%', background: '#1d1b18', borderRadius: 1 }} /></span>{item('Wed 9:41')}</div>
  </div>;
}
// The display: bezel + screen + hardware notch. Children draw over the screen (island, cursor, veil).
function Display({ T, lifted, children, focus = 0 }) {
  return <div style={{ position: 'absolute', left: -16, top: -16, width: DW + 32, height: DH + 32, borderRadius: 26, background: '#050505', boxShadow: '0 0 0 2px #2a2725, 0 40px 120px rgba(0,0,0,.6)' }}>
    <div data-nl-screen style={{ position: 'absolute', left: 16, top: 16, width: DW, height: DH, borderRadius: 12, overflow: 'hidden', background: '#526c65' }}>
      <img src="./assets/landscape.svg" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <MenuBar />
      <div style={{filter:`blur(${focus*1.4}px) brightness(${1-focus*.55}) saturate(${1-focus*.4})`}}><TerminalWindow T={T} /><PlayerWindow T={T} /><FinderWindow lifted={lifted} /></div>
      <div style={{position:'absolute',inset:0,background:'#0c0b0a',opacity:focus*.3,pointerEvents:'none'}}/>
      <div style={{ position: 'absolute', left: (DW - NL.NOTCH_W) / 2, top: 0, width: NL.NOTCH_W, height: NL.NOTCH_H, background: '#000', borderRadius: '0 0 15px 15px' }} />
      {children}
    </div>
  </div>;
}
Object.assign(window, { Display, DW, DH });
