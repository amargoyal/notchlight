// Faces of the island, ported from IslandView.tsx, Preview.tsx, LiveCompanion.tsx, Agents.tsx + preview.css values.
const { C: NC, MONO: NMONO, SANS: NSANS, PANEL_W: NPW } = NL;
const ART = './assets/late-light.svg', LAND = './assets/landscape.svg', TINT = '#c47a4a';
const SESS = {
  claude: { title: 'A quieter place to work', project: 'notchlight', cwd: '~/dev/notchlight', branch: 'faces', agent: 'Shaping the music view', tokens0: 24100 },
  codex: { title: 'Bring the Codex companion to life', project: 'notchlight', cwd: '~/dev/notchlight', branch: 'faces', agent: 'Designing the shared Agents view', ask: { command: 'npm run test:codex', message: 'Allow Codex to run the test suite?' } }
};
const elapsed = (T) => NL.duration(124000 + T * 1000);
const clTokens = (T) => NL.fmtTokens(24100 + T * 35);

function NLDivider() { return <div style={{ height: 1, background: NC.hair, margin: '0 14px' }} />; }

// .mp-nav
function NLNav({ view, asking, files = 1, clips = 6 }) {
  const tab = (id, label, icon, extra) => <div data-target={`tab-${id}`} style={{ background: view === id ? '#26221f' : 'transparent', color: view === id ? '#f2ede7' : '#a69c93', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 7, font: `400 12px/1.5 ${NSANS}`, whiteSpace: 'nowrap' }}>{icon}{label}{extra}</div>;
  const count = (n) => <span style={{ font: `400 10px/1.4 ${NMONO}`, color: '#c8bfb5' }}>{n}</span>;
  return <nav style={{ height: 43, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 13px', borderBottom: '1px solid #24211e' }}>
    <div style={{ display: 'flex', gap: 4 }}>
      {tab('agents', 'Agents', <span style={{ display: 'flex' }}><NLBuddy size={15} /></span>, asking && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e0b04a', display: 'inline-block', flex: 'none' }} />)}
      {tab('music', 'Music', <NLIcon name="music" size={14} />)}
      {tab('tray', 'Tray', <NLIcon name="tray" size={14} />, count(files))}
      {tab('clipboard', 'Clipboard', <NLIcon name="clipboard" size={14} />, count(clips))}
    </div>
    <div style={{ width: 32, height: 32, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f2ede7' }}><NLIcon name="settings" size={16} /></div>
  </nav>;
}
// .agent-filters
function NLFilters() {
  const b = (label, n, on) => <div style={{ borderRadius: 7, background: on ? '#292623' : 'transparent', color: on ? '#f2ede7' : '#b6ada3', padding: '6px 9px', display: 'flex', gap: 7, alignItems: 'center', font: `500 11px/1.2 ${NSANS}` }}>{label}<span style={{ color: '#b6ada3', fontVariantNumeric: 'tabular-nums' }}>{n}</span></div>;
  return <div style={{ display: 'flex', gap: 4, padding: '6px 14px 9px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>{b('All', 2, true)}{b('Claude', 1, false)}{b('Codex', 1, false)}</div>;
}
// .agent-attention
function NLAttention() {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, padding: '7px 14px' }}><div data-target="attention" style={{ color: '#e0b04a', display: 'flex', alignItems: 'center', gap: 7, font: `500 11px/1.3 ${NSANS}` }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e0b04a', flex: 'none' }} />Codex needs you</div></div>;
}
const provLabel = { display: 'block', font: `400 10px/1.4 ${NSANS}`, color: '#b7afa6', marginTop: 3, ...NL.CLIP };

function FaceStubs() {
  const stub = <div style={{ width: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 14, height: 2, borderRadius: 1, background: 'rgba(255,255,255,.3)' }} /></div>;
  return <NLWings left={stub} right={stub} />;
}

// SessionList — two sessions; when asking, Codex ranks first and the attention row appears
function SessionRow({ T, provider, status, hover, target }) {
  const s = SESS[provider]; const asking = status === 'asking';
  const face = NL.faceFor(status, true);
  const sub = asking ? s.ask.message : `1 agent · ${s.agent}`;
  return <div data-target={target} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 8px', borderRadius: 13, background: hover ? 'rgba(255,255,255,.06)' : 'transparent' }}>
    <NLLight status={status} size={7} />
    <NLBuddy provider={provider} face={face} size={24} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ font: `500 13px/1.25 ${NSANS}`, color: NC.text, ...NL.CLIP }}>{s.title}</div>
      <span style={provLabel}>{provider === 'codex' ? 'Codex · Desktop' : 'Claude · CLI'} · {s.project} · {status}</span>
      <div style={{ font: `400 11px/1.35 ${NMONO}`, color: asking ? NC.yellow : NC.ghost, marginTop: 2, ...NL.CLIP }}>{sub}</div>
    </div>
    <div style={{ textAlign: 'right', flex: 'none' }}>
      <div style={{ font: `500 11px/1.35 ${NMONO}`, color: NC.muted }}>{provider === 'codex' ? '—' : clTokens(T)}</div>
      <div style={{ font: `400 11px/1.35 ${NMONO}`, color: NC.faint, marginTop: 2 }}>{elapsed(T)}</div>
    </div>
    <div style={{ font: `400 14px/1 ${NMONO}`, color: NC.faint, flex: 'none', width: 9 }}>›</div>
  </div>;
}
function FaceList({ T, asking, hoverRow }) {
  const codexStatus = asking ? 'asking' : 'working';
  const lights = asking ? ['asking', 'working'] : ['working', 'working'];
  return <div style={{ width: NPW }}>
    <NLWings width={NPW}
      left={<div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 15 }}>{lights.map((st, i) => <NLLight key={i} status={st} size={8} pulse={i === 0} T={T} />)}</div>}
      right={<div style={{ display: 'flex', alignItems: 'center', paddingRight: 14 }}><NLMono color={NC.dim} size={10}>— · {elapsed(T)}</NLMono></div>} />
    <NLNav view="agents" asking={asking} />
    <NLFilters />
    {asking && <NLAttention />}
    <NLDivider />
    <div style={{ padding: '8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {asking ? <><SessionRow T={T} provider="codex" status="asking" hover={hoverRow} target="codex-row" /><SessionRow T={T} provider="claude" status="working" /></>
        : <><SessionRow T={T} provider="claude" status="working" /><SessionRow T={T} provider="codex" status="working" /></>}
    </div>
  </div>;
}

// SessionPanel for the Codex session: 'ask' shows the AskCard, 'ok' shows the agent list after Allow once
function FacePanel({ T, phase, hoverAllow, face }) {
  const asking = phase === 'ask'; const status = asking ? 'asking' : 'working'; const s = SESS.codex;
  const robot = face || (asking ? 'asking' : 'working');
  return <div style={{ width: NPW }}>
    <NLWings width={NPW}
      left={<div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 14 }}><div style={{ font: `400 15px/1 ${NMONO}`, color: NC.faint }}>‹</div><NLLight status={status} pulse T={T} /></div>}
      right={<div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingRight: 13 }}>
        <div style={{ font: `500 11px/1 ${NSANS}`, color: asking ? NC.yellow : NC.muted, border: `1px solid ${asking ? NC.yellow : NC.dead}`, borderRadius: 7, padding: '5px 8px', whiteSpace: 'nowrap' }}>{asking ? 'Open ↗' : 'Jump ↗'}</div>
        <NLMark activity={asking ? 'ask' : 'code'} color={NC.dim} />
        <NLBuddy provider="codex" face={robot} size={26} />
      </div>} />
    <NLNav view="agents" asking={asking} />
    <NLFilters />
    {asking && <NLAttention />}
    <NLDivider />
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px 8px' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ font: `500 13px/1.3 ${NSANS}`, color: NC.text, ...NL.CLIP }}>{s.title}</div>
        <span style={provLabel}>Codex · Desktop · {status}</span>
        <div style={{ font: `400 10px/1.5 ${NMONO}`, color: NC.faint, marginTop: 3, ...NL.CLIP }}>{s.project} · {s.cwd} · {s.branch}</div>
      </div>
      <div style={{ flex: 'none', paddingTop: 2 }}><NLMono color={NC.faint} weight={400} size={10}>1 agent · {elapsed(T)}</NLMono></div>
    </div>
    {asking ? <div style={{ margin: '0 12px 12px', padding: '13px 14px', background: 'rgba(224,176,74,.09)', borderRadius: 14, boxShadow: 'inset 0 0 0 1px rgba(224,176,74,.22)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><NLBuddy provider="codex" face="asking" size={22} /><div style={{ flex: 1, minWidth: 0, font: `500 12.5px/1.3 ${NSANS}`, color: NC.text }}>{s.ask.message}</div><NLMono color={NC.faint} weight={400}>—</NLMono></div>
      <div style={{ margin: '11px 0 12px', padding: '9px 11px', background: NC.well, borderRadius: 9, font: `400 11.5px/1.45 ${NMONO}`, color: '#C8BFB6' }}>{s.ask.command}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div data-target="allow" style={{ flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 9, background: hoverAllow ? '#E8BC5E' : NC.yellow, font: `600 12px/1 ${NSANS}`, color: '#1A1408' }}>Allow once</div>
        <div style={{ flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 9, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)', font: `600 12px/1 ${NSANS}`, color: '#D8D0C8' }}>Deny</div>
        <div style={{ border: '1px solid #5a4c32', borderRadius: 9, color: NC.yellow, font: `500 11px/1.2 ${NSANS}`, padding: '6px 9px', whiteSpace: 'nowrap' }}>Answer in Codex</div>
      </div>
    </div>
    : <div style={{ padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 13, background: 'rgba(255,255,255,.04)' }}>
        <NLLight status="working" size={6} /><NLBuddy provider="codex" face="working" size={22} /><NLMark activity="shell" color={NC.faint} />
        <div style={{ flex: 1, minWidth: 0, font: `400 12.5px/1.3 ${NSANS}`, color: NC.body, ...NL.CLIP }}>{phase === 'ok' ? 'Running the test suite' : s.agent}</div>
        <div style={{ font: `500 11px/1 ${NMONO}`, color: NC.muted, width: 46, textAlign: 'right' }}>—</div>
        <div style={{ font: `400 11px/1 ${NMONO}`, color: NC.faint, width: 52, textAlign: 'right' }}>{elapsed(T)}</div>
      </div>
    </div>}
  </div>;
}

// Equalizer: mp-wave 1.1s ease-in-out alternate, delay band*-0.19s → pure function of T
function NLEqualizer({ T, active = true }) {
  const bars = [0, 1, 2, 3, 4].map(band => { const ph = ((T + band * 0.19) / 1.1) % 2; const tri = ph < 1 ? ph : 2 - ph; const v = -(Math.cos(Math.PI * tri) - 1) / 2; return 0.25 + 0.75 * v; });
  return <span style={{ height: 18, display: 'flex', alignItems: 'center', gap: 2, borderRadius: 6, padding: '0 3px', boxShadow: `0 0 10px ${TINT}` }}>
    {bars.map((s, i) => <i key={i} style={{ display: 'block', width: 2, height: 14, borderRadius: 2, background: `color-mix(in srgb, ${TINT} 45%, #c9b79d)`, transform: `scaleY(${active ? s : 0.29})`, transformOrigin: 'center' }} />)}
  </span>;
}
function NLVolume({ level }) {
  return <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 44, height: 18, borderRadius: 4, background: '#1c1917', overflow: 'hidden' }}><i style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${level}%`, background: '#6e5b47' }} /><b style={{ position: 'relative', width: '100%', textAlign: 'center', font: `600 9px/18px ${NMONO}`, color: '#f2ede7' }}>{level}</b></span>;
}
function NLArtwork({ mini }) {
  return <div style={{ width: mini ? 23 : 88, height: mini ? 23 : 88, borderRadius: mini ? 5 : 9, overflow: 'hidden', background: '#28231e', flex: 'none', boxShadow: `0 0 ${mini ? 10 : 26}px ${TINT}66` }}><img src={ART} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></div>;
}
const shelfWing = (icon, n) => <span style={{ display: 'flex', gap: 7, alignItems: 'center', color: '#c7beb2', font: `400 11px/1 ${NMONO}` }}><NLIcon name={icon} size={17} />{n}</span>;
const clipKind = (ch) => <span style={{ flex: 'none', width: 18, height: 18, borderRadius: 5, background: '#2a2521', color: '#c9b79d', font: `600 10px/18px ${NMONO}`, textAlign: 'center' }}>{ch}</span>;
const wingL = { display: 'flex', alignItems: 'center', padding: '0 16px' };
const wingR = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, padding: '0 16px', minHeight: 30 };
const iconBtn = (name, white) => <div style={{ width: 32, height: 32, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: white ? '#f2ede7' : '#a69c93' }}><NLIcon name={name} size={18} /></div>;

function FaceMusic({ T, volume, files, paused = false }) {
  const pos = 72 + T, dur = 234; const pct = pos / dur * 100;
  return <div style={{ width: NPW }}>
    <NLWings width={NPW} left={<div style={wingL}><NLArtwork mini /></div>} right={<div style={wingR} data-target="bars">{volume != null ? <NLVolume level={volume} /> : <NLEqualizer T={T} />}</div>} />
    <NLNav view="music" files={files} />
    <div style={{ padding: '14px 22px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <NLArtwork />
        <div style={{ minWidth: 0, flex: 1, textAlign: 'center' }}>
          <h2 style={{ font: `600 14px/1.25 ${NSANS}`, color: NC.text, margin: '0 0 2px', letterSpacing: '-.015em', ...NL.CLIP }}>Late Light</h2>
          <p style={{ font: `400 11px/1.5 ${NSANS}`, color: '#a69c93', margin: 0, ...NL.CLIP }}>The Quiet Hours</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, font: `400 9px/1 ${NMONO}`, color: '#a69c93' }}>
            <span style={{ flex: 'none', minWidth: 28 }}>{NL.time(pos)}</span>
            <div style={{ flex: 1, height: 12, display: 'flex', alignItems: 'center', position: 'relative' }}><div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.16)' }} /><div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 4, borderRadius: 2, background: '#d1bca2' }} /><div style={{ position: 'absolute', left: `calc(${pct}% - 5px)`, width: 10, height: 10, borderRadius: '50%', background: '#d1bca2' }} /></div>
            <span style={{ flex: 'none', minWidth: 28, textAlign: 'right' }}>−{NL.time(dur - pos)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 2 }}>{iconBtn('back')}<span data-target="music-toggle">{iconBtn(paused ? 'play' : 'pause', true)}</span>{iconBtn('next')}</div>
        </div>
      </div>
    </div>
  </div>;
}

// FileThumb + Tray (LiveTray copy: heading, footer)
function NLFileThumb({ kind, small }) {
  const box = { display: 'inline-flex', position: 'relative', width: small ? 38 : 58, height: small ? 40 : 62, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', flex: 'none', color: kind === 'folder' ? '#b8c8cf' : '#cdbda7' };
  if (kind === 'image') return <span style={box}><img src={LAND} alt="" style={{ width: 58, height: 48, objectFit: 'cover', border: '3px solid #eee8df', borderRadius: 3, display: 'block' }} /></span>;
  if (kind === 'folder') return <span style={box}><NLIcon name="folder" size={46} /></span>;
  return <span style={box}><NLIcon name="file" size={34} /><span style={{ font: `400 8px/1 ${NMONO}`, marginTop: 3 }}>{kind === 'pdf' ? 'PDF' : 'MD'}</span></span>;
}
const FILES = [{ id: 'coast', name: 'Coast.jpg', kind: 'image', size: '2.4 MB' }, { id: 'brief', name: 'Project brief.pdf', kind: 'pdf', size: '184 KB' }];
function FaceTray({ T, dropping, count }) {
  const files = FILES.slice(0, count);
  return <div style={{ width: NPW }}>
    <NLWings width={NPW} left={<div style={wingL}>{shelfWing('tray', count)}</div>} right={<div style={{ ...wingR, color: NC.text }}><NLIcon name="file" size={16} /></div>} />
    <NLNav view="tray" files={count} />
    <div style={{ padding: '15px 17px 0', background: dropping ? '#b89d7920' : 'transparent', outline: dropping ? '1px dashed #d3b38e' : 'none', outlineOffset: -7, borderRadius: '0 0 23px 23px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a69c93', font: `400 11px/1.5 ${NSANS}`, marginBottom: 13 }}><span>{dropping ? 'Drop it here. Pick it up later.' : 'A place between places.'}</span><span style={{ color: '#e1d2bf', font: `400 11px/1.5 ${NSANS}` }}>Add files…</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, padding: '4px 2px 8px' }}>
        {files.map(f => <div key={f.id} style={{ position: 'relative', borderRadius: 8, minWidth: 0 }}><div style={{ display: 'flex', alignItems: 'center', flexDirection: 'column', gap: 7, padding: '10px 5px', minWidth: 0 }}><span data-target={f.id === 'brief' ? 'tray-brief' : undefined}><NLFileThumb kind={f.kind} /></span><span style={{ width: '100%', font: `400 10px/1.5 ${NSANS}`, color: NC.text, textAlign: 'center', ...NL.CLIP }}>{f.name}</span><small style={{ font: `400 9px/1.5 ${NSANS}`, color: '#a69c93' }}>{f.size}</small></div></div>)}
      </div>
      <div style={{ height: 40, borderTop: '1px solid #27211b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: '#a69c93', font: `400 10px/1.5 ${NSANS}` }}><span style={NL.CLIP}>Drag out to another app. Originals stay put.</span><span style={{ flex: 'none', color: '#6b625a', opacity: .45, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Save copy… <NLIcon name="arrow" size={13} /></span></div>
    </div>
  </div>;
}

// Clipboard history (SAMPLE_CLIPS)
const CLIPS = [
  { id: 'cmd', kind: 'text', preview: 'npm run service:restart', meta: '23 chars · 9m', pinned: true },
  { id: 'url', kind: 'url', preview: 'https://developer.apple.com/documentation/coreaudio', meta: 'developer.apple.com · 2m' },
  { id: 'shot', kind: 'image', preview: '1512×982 image', meta: '312 KB · 18m' },
  { id: 'note', kind: 'text', preview: 'Bars follow the resting face; capture stays with what is showing.', meta: '2 lines · 41m' },
  { id: 'hex', kind: 'text', preview: '#d9c4a6', meta: '7 chars · 1h' },
  { id: 'path', kind: 'text', preview: '~/.notchlight/island.log', meta: '24 chars · 3h' }
];
function FaceClip({ T = 0, after, hoverId, files }) {
  const order = ['cmd', 'url', 'hex', 'shot', 'note', 'path'];
  const reorder = after ? progress(T, K.copy, .55) : 0;
  const copied = after && T < K.copy + 1.65;
  const items = order.map(id => CLIPS.find(c => c.id === id));
  return <div style={{ width: NPW }}>
    <NLWings width={NPW} left={<div style={wingL}>{shelfWing('clipboard', 6)}</div>} right={<div style={wingR}>{clipKind('T')}</div>} />
    <NLNav view="clipboard" files={files} />
    <div style={{ display: 'flex', flexDirection: 'column', padding: '15px 17px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a69c93', font: `400 11px/1.5 ${NSANS}`, marginBottom: 13 }}><span style={{color:copied ? NC.green : undefined}}>{copied ? '✓ Copied to clipboard' : '6 items · 1 pinned'}</span><span style={{ color: '#e1d2bf' }}>Pause capture</span></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 2px 6px', padding: '0 8px', height: 24, borderRadius: 6, background: '#1c1917', color: '#a69c93', font: `400 11px/1 ${NSANS}` }}><NLIcon name="search" size={13} /><span style={{ color: '#6f665e' }}>Filter</span></label>
      <ul style={{ listStyle: 'none', margin: '0 -6px', padding: '0 0 6px', maxHeight: 188, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(it => { const hov = hoverId === it.id; return <li key={it.id} data-target={after ? undefined : `clip-${it.id}`} style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 'none', height: 48, transform: `translateY(${it.id === 'hex' ? -50 * reorder : it.id === 'url' ? 50 * reorder : 0}px)`, zIndex: it.id === 'hex' ? 2 : 1, borderRadius: 7, background: (hov || (it.id === 'hex' && copied)) ? '#211e19' : '#000' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px' }}>
            {it.id === 'hex' ? <span style={{width:18,height:18,borderRadius:4,background:'#d9c4a6',flex:'none'}} /> : it.kind === 'image' ? <img src={LAND} alt="" style={{ flex: 'none', width: 34, height: 24, objectFit: 'cover', borderRadius: 4, background: '#2a2521' }} /> : clipKind(it.kind === 'url' ? '@' : 'T')}
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 }}><span style={{ font: `400 12px/1.5 ${NSANS}`, color: NC.text, ...NL.CLIP }}>{it.preview}</span><small style={{ font: `400 10px/1.3 ${NMONO}`, color: '#8f857c' }}>{it.meta}</small></span>
          </div>
          <span style={{ flex: 'none', width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 6, color: it.pinned ? '#d9c4a6' : '#8f857c', opacity: it.pinned || hov ? 1 : 0, marginRight: 22 }}><NLIcon name="pin" size={13} /></span>
          <span style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: 4, width: 20, height: 20, display: 'grid', placeItems: 'center', borderRadius: '50%', background: '#2f2923', color: NC.text, opacity: hov ? 1 : 0 }}><NLIcon name="close" size={12} /></span>
        </li>; })}
      </ul>
      <div style={{ height: 40, borderTop: '1px solid #27211b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: '#a69c93', font: `400 10px/1.5 ${NSANS}` }}><span>Click an item to copy it again.</span><span style={{ color: '#e1d2bf' }}>Clear unpinned</span></div>
    </div>
  </div>;
}

// RestingWings with both providers: budget leaves no room for the other faces → "+3" overflow, Cx/Cl lights, buddies
function FaceResting({ T, codexFace = 'working' }) {
  const div = <i style={{ display: 'block', width: 1, height: 12, background: '#ffffff1f', flex: 'none' }} />;
  const light = (status, label, pulse) => { const b = pulse ? NL.breath(T) : 0; return <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#e4ddd5', font: `500 9px/1 ${NSANS}` }}><i style={{ display: 'block', width: 7, height: 7, borderRadius: '50%', background: NL.lightColor(status), opacity: 1 - 0.6 * b, transform: `scale(${1 - 0.2 * b})` }} /><span>{label}</span></span>; };
  const over = { color: '#b7afa6', font: `500 10px/1 ${NSANS}` };
  const wing = { display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', minHeight: 30 };
  return <NLWings
    left={<div style={wing}><span style={over}>+3</span>{div}{light('working', 'Cx', false)}{div}{light('working', 'Cl', true)}</div>}
    right={<div style={wing}><NLBuddy face="working" size={22} />{div}<NLBuddy provider="codex" face={codexFace} size={22} />{div}<span style={over}>···</span></div>} />;
}
Object.assign(window, { FaceStubs, FaceList, FacePanel, FaceMusic, FaceTray, FaceClip, FaceResting, NLFileThumb, NLArtwork, NLEqualizer, NL_SESS: SESS });
