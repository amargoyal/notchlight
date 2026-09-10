import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { Island, Stubs, Wings } from './IslandView';
import { Icon, FileThumb, RestingWings, type RestingPart } from './Preview';
import { Buddy } from './Buddy';
import { PANEL_W } from './theme';
import type { AgentFilter, Snapshot } from '../shared/types';
import { DEFAULT_COMPANION_PREFERENCES, EMPTY_CAPTURE, EMPTY_SPOTIFY, type CaptureSnapshot, type CompanionSnapshot, type CompanionView, type OperationResult, type ShelfFile } from '../shared/companion';
import { useReducedMotion } from './pulse';
import './preview.css';
import { AgentFilters, AgentConnection, AgentAttention, agentRestingParts, filteredSnapshot, providerOf } from './Agents';

const EMPTY: Snapshot = { sessions: [], overall: 'idle', tokens: 0, elapsed: 0, dormant: true, notchW: 200, notchH: 32, hoverDelay: 550, pulse: true, now: Date.now() };
export function useCompanion() {
  const available = !!window.notchlight?.getCompanion;
  const [state, setState] = useState<CompanionSnapshot>({ preferences: { ...DEFAULT_COMPANION_PREFERENCES }, view: 'agents', files: [], music: { ...EMPTY_SPOTIFY }, capture: { ...EMPTY_CAPTURE }, notice: '' });
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (operation: () => Promise<OperationResult>) => {
    setError('');
    try { const result = await operation(); if (!result.ok) setError(result.error || 'The action could not be completed.'); }
    catch { setError('The app could not complete that action. Try again.'); }
  }, []);
  useEffect(() => {
    if (!available) return;
    const bridge = window.notchlight;
    let active = true, received = false, gotSnapshot = false;
    const stop = bridge.onCompanion(s => { received = true; setState(s); setReady(true); });
    const stopSnapshot = bridge.onSnapshot(s => { gotSnapshot = true; setSnapshot(s); });
    void bridge.getCompanion().then(s => { if (active && !received) { setState(s); setReady(true); } }).catch(() => setError('Could not load companion settings.'));
    void bridge.getSnapshot().then(s => { if (active && !gotSnapshot) setSnapshot(s); }).catch(() => {});
    return () => { active = false; stop(); stopSnapshot(); };
  }, [available]);
  return { available, state, snapshot, ready, error, run };
}
export type LiveController = ReturnType<typeof useCompanion>;
const views: CompanionView[] = ['agents','music','tray'];
const names = { agents: 'Agents', music: 'Music', tray: 'Tray' };
const time = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2,'0')}`;

function LiveArtwork({ live, mini = false }: { live: LiveController; mini?: boolean }) {
  const source = live.state.preferences.artwork ? live.state.music.track?.artwork : undefined;
  const [failed, setFailed] = useState<string>();
  return <div className={`mp-artwork ${mini ? 'mp-artwork-mini' : ''}`}>{source && source !== failed ? <img src={source} alt={mini ? '' : live.state.music.track?.album || 'Album artwork'} draggable={false} onError={() => setFailed(source)}/> : <Icon name="music" size={mini ? 14 : 34}/>}</div>;
}
const BARS = [0, 1, 2, 3, 4];
/** Bars at rest while a track plays but nothing can be heard: a shape, not a rhythm. */
const QUIET = [0.38, 0.55, 0.46, 0.6, 0.42];
const scale = (level: number) => (0.18 + 0.82 * Math.min(1, Math.max(0, level))).toFixed(3);
/**
 * Five bars that follow Spotify's actual output. Levels arrive ~30 times a
 * second and are written straight to the DOM — re-rendering the whole surface
 * at that rate would be silly, and a frame identical to the last one is not
 * written at all, so real silence costs nothing.
 *
 * There is no canned animation here. A CSS animation on the overlay redraws the
 * whole transparent window at 60 fps (see pulse.ts); the gallery keeps its
 * sample rhythm, the live island does not. When capture is not listening, or
 * has heard nothing for a while because the music is on another speaker, the
 * bars hold a quiet shape until sound comes back. Real silence settles them.
 */
function LiveEqualizer({ active, live, capture }: { active: boolean; live: boolean; capture: CaptureSnapshot['status'] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const listening = active && live && !reduced && capture === 'listening';
  const [mode, setMode] = useState<'off' | 'quiet' | 'live'>('off');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = Array.from(el.children) as HTMLElement[];
    if (!active) { setMode('off'); for (const bar of bars) bar.style.transform = ''; return; }
    if (!listening || !window.notchlight?.onMusicLevels) { setMode('quiet'); bars.forEach((bar, i) => { bar.style.transform = `scaleY(${scale(QUIET[i])})`; }); return; }
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSound = Date.now();
    let lastFrame = '';
    let current: 'quiet' | 'live' = 'quiet';
    const quiet = () => {
      quietTimer = null;
      if (current === 'quiet') return;
      current = 'quiet'; lastFrame = '';
      setMode('quiet');
      bars.forEach((bar, i) => { bar.style.transform = `scaleY(${scale(QUIET[i])})`; });
    };
    quiet();
    const stop = window.notchlight.onMusicLevels(levels => {
      const now = Date.now();
      if (levels.some(level => level > 0.03)) lastSound = now;
      // Heard nothing for a while with the track still "playing": the sound is
      // somewhere else — another speaker, another room. Hold the quiet shape.
      if (now - lastSound > 1500) { quiet(); return; }
      if (current !== 'live') { current = 'live'; setMode('live'); }
      const frame = levels.map(scale).join(' ');
      if (frame !== lastFrame) {
        lastFrame = frame;
        const parts = frame.split(' ');
        bars.forEach((bar, i) => { bar.style.transform = `scaleY(${parts[i] ?? parts[0]})`; });
      }
      // Levels stopping altogether — helper gone, device changing — is the quiet shape too, not a freeze.
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(quiet, 800);
    });
    return () => { stop(); if (quietTimer) clearTimeout(quietTimer); };
  }, [active, listening]);
  return <span ref={ref} className={`mp-equalizer ${mode === 'live' ? 'is-live' : mode === 'quiet' ? 'is-quiet' : ''}`} aria-hidden="true">{BARS.map(i => <i key={i}/>)}</span>;
}
function LiveMusic({ live }: { live: LiveController }) {
  const { music } = live.state;
  const [seek, setSeek] = useState<number | null>(null);
  const track = music.track;
  useEffect(() => setSeek(null), [track?.id]);
  const command = (name: 'toggle' | 'next' | 'previous') => { void live.run(() => window.notchlight.controlSpotify(name)); };
  const commitSeek = (position: number) => { setSeek(null); void live.run(() => window.notchlight.controlSpotify('seek', position)); };
  if (music.status !== 'ready' || !track) {
    const open = music.status === 'not-running' || music.status === 'empty' && !music.busy;
    return <div className="mp-empty"><Icon name={music.status === 'error' || music.status === 'permission' ? 'warning' : 'music'} size={30}/><p>{music.busy ? 'Connecting to Spotify…' : music.status === 'disconnected' ? 'Your Spotify, closer.' : music.status === 'permission' ? 'Spotify needs your permission.' : open ? 'A little room for music.' : 'Spotify is taking a moment.'}</p><span>{music.message || 'Connect the Spotify desktop app to see and control what’s playing.'}</span><button className="mp-soft-button" disabled={music.busy} onClick={() => void live.run(() => open ? window.notchlight.openSpotify() : window.notchlight.connectSpotify())}>{open ? 'Open Spotify' : music.status === 'disconnected' ? 'Connect Spotify' : 'Reconnect Spotify'}</button></div>;
  }
  const position = seek ?? music.position;
  return <div className="mp-music"><div className="mp-track-row"><LiveArtwork live={live}/><div className="mp-track-meta"><h2 title={track.title}>{track.title}</h2><p title={track.artist}>{track.artist}</p><div className="mp-seek"><span>{time(position)}</span><input aria-label="Track position" aria-valuetext={`${time(position)} of ${time(track.duration)}`} type="range" min="0" max={track.duration} value={position} disabled={music.busy || !track.duration} onChange={e => setSeek(Number(e.target.value))} onPointerUp={e => commitSeek(Number(e.currentTarget.value))} onPointerCancel={() => setSeek(null)} onKeyUp={e => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)) commitSeek(Number(e.currentTarget.value)); }}/><span>−{time(Math.max(0,track.duration-position))}</span></div><div className="mp-transport"><button className="mp-icon-button" disabled={music.busy} aria-label="Previous track" onClick={() => command('previous')}><Icon name="back" size={18}/></button><button className="mp-icon-button mp-play" disabled={music.busy} aria-label={music.playing ? 'Pause Spotify' : 'Play Spotify'} onClick={() => command('toggle')}><Icon name={music.playing ? 'pause' : 'play'} size={18}/></button><button className="mp-icon-button" disabled={music.busy} aria-label="Next track" onClick={() => command('next')}><Icon name="next" size={18}/></button></div></div></div></div>;
}
function FileButton({ file, live, selected, onSelect }: { file: ShelfFile; live: LiveController; selected: boolean; onSelect: () => void }) {
  return <div className={`mp-shelf-item ${selected ? 'is-selected' : ''}`}><button className="mp-file-button" aria-label={`Select ${file.name}${file.unavailable ? ', unavailable' : ''}`} aria-pressed={selected} draggable={!file.unavailable} onDragStart={e => { e.preventDefault(); window.notchlight.startFileDrag(file.id); }} onClick={onSelect} onDoubleClick={() => void live.run(() => window.notchlight.revealFile(file.id))}><FileThumb file={file} small={live.state.preferences.thumbnails === 'small'} sample={false}/><span title={file.name}>{file.name}</span><small>{file.unavailable ? 'Unavailable' : file.size}</small></button><button className="mp-remove" aria-label={`Remove ${file.name} from Tray`} onClick={() => void live.run(() => window.notchlight.removeFile(file.id))}><Icon name="close" size={12}/></button></div>;
}
function LiveTray({ live, dragging }: { live: LiveController; dragging: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const file = live.state.files.find(f => f.id === selected);
  return <div className={`mp-tray ${dragging ? 'is-drop-target' : ''}`}><div className="mp-tray-heading"><span>{dragging ? 'Drop it here. Pick it up later.' : 'A place between places.'}</span><button className="mp-text-button" onClick={() => void live.run(() => window.notchlight.pickFiles())}>Add files…</button></div>{!live.state.files.length ? <div className="mp-empty mp-empty-tray"><Icon name="tray" size={32}/><p>Keep it here for a moment.</p><span>Drop files from Finder. They stay in their original location.</span><button className="mp-soft-button" onClick={() => void live.run(() => window.notchlight.pickFiles())}>Choose files…</button></div> : <div className={`mp-file-grid ${live.state.preferences.thumbnails}`} aria-label="Files in Tray">{live.state.files.map(file => <FileButton key={file.id} file={file} live={live} selected={file.id === selected} onSelect={() => setSelected(file.id)}/>)}</div>}<div className="mp-tray-footer"><span>{file?.name || 'Drag out to another app. Originals stay put.'}</span><button className="mp-text-button" disabled={!file || file.unavailable} onClick={() => file && void live.run(() => window.notchlight.saveFileCopy(file.id))}>Save copy… <Icon name="arrow" size={13}/></button></div></div>;
}

export function CompanionSurface({ live, open, hovering, onBox, onCustomize }: { live: LiveController; open: boolean; hovering: boolean; onBox?: (r: {x:number;y:number;w:number;h:number}) => void; onCustomize: () => void }) {
  const id = useId();
  const [filter,setFilter] = useState<AgentFilter>('all');
  const [target,setTarget] = useState<string>();
  const focus = useRef(false);
  const [dragging, setDragging] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preferences = live.state.preferences;
  const view = dragging ? 'tray' : live.state.view;
  const expanded = open || dragging;
  // Reduced motion stills the lights too; the pulse timer never starts for them.
  const motion = !preferences.reducedMotion;
  const snapshot = { ...live.snapshot, pulse: preferences.pulse && motion };
  useLayoutEffect(() => { if (focus.current && expanded) { document.getElementById(`${id}-${view}`)?.focus(); focus.current = false; } }, [id, view, expanded]);
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  const choose = (view: CompanionView, keyboard = false) => { focus.current = keyboard; void live.run(() => window.notchlight.setView(view)); };
  const tabs = <nav className="mp-nav" aria-label="Notch views"><div role="tablist" aria-label="Companion view">{views.map((item,index) => <button key={item} role="tab" id={`${id}-${item}`} aria-controls={`${id}-panel`} aria-selected={view === item} tabIndex={view === item ? 0 : -1} onClick={() => choose(item,true)} onKeyDown={e => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); choose(views[e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3],true); }}>{item === 'agents' ? <Buddy size={15}/> : <Icon name={item} size={14}/>} {names[item]}{item === 'agents' && snapshot.overall === 'asking' && <span className="mp-attention-dot" aria-label="Needs your attention"/>}{item === 'tray' && <span className="mp-count">{live.state.files.length}</span>}</button>)}</div><button className="mp-icon-button" aria-label="Open customization" onClick={onCustomize}><Icon name="settings" size={16}/></button></nav>;
  const { music, files } = live.state;
  const selectProvider = (provider: 'claude' | 'codex') => { setFilter(provider); choose('agents'); };
  const agents = agentRestingParts(snapshot, { ...preferences, pulse: preferences.pulse && motion, codexPulse: preferences.codexPulse && motion }, selectProvider);
  const parts: RestingPart[] = [...agents,
    ...(preferences.restMusic && music.status === 'ready' && music.track ? [{left:<LiveArtwork live={live} mini/>,right:<LiveEqualizer active={music.playing && preferences.visualizer} live={!preferences.reducedMotion} capture={live.state.capture.status}/>}]:[]),
    ...(preferences.restTray && files.length || dragging ? [{left:<span className="mp-shelf-wing"><Icon name="tray" size={16}/>{files.length}</span>,right:<Icon name="file" size={16}/>}]:[])
  ];
  const resting = parts.length ? <RestingWings notchW={snapshot.notchW} height={snapshot.notchH} parts={parts}/> : snapshot.sessions.length ? (hovering ? <Stubs snap={snapshot}/> : <div style={{width:snapshot.notchW,height:snapshot.notchH}}/>) : undefined;
  const navigation = <>{tabs}{view === 'agents' && <AgentFilters snapshot={snapshot} value={filter} onChange={f => {setFilter(f);setTarget(undefined);}}/>}{view === 'agents' && <AgentConnection snapshot={snapshot} filter={filter}/>}<AgentAttention sessions={snapshot.sessions} onSelect={s => {setFilter(providerOf(s));setTarget(s.id);choose('agents');}}/>{view === 'agents' && live.error && <p role="alert" className="mp-live-error">{live.error}</p>}</>;
  const active = !snapshot.dormant || parts.length > 0;
  const left = <div className="mp-left-wing">{view === 'music' ? <LiveArtwork live={live} mini/> : <span className="mp-shelf-wing"><Icon name="tray" size={17}/>{live.state.files.length}</span>}</div>;
  const right = <div className="mp-right-wing">{snapshot.overall === 'asking' && <button className="mp-attention-button" aria-label="Agents need attention" onClick={() => choose('agents')}><span className="mp-attention-dot"/></button>}{view === 'music' ? <LiveEqualizer active={live.state.music.playing && preferences.visualizer} live={!preferences.reducedMotion} capture={live.state.capture.status}/> : <Icon name="file" size={16}/>}</div>;
  const wing = (full: boolean) => <Wings notchW={snapshot.notchW} height={snapshot.notchH} width={full ? PANEL_W : undefined} left={left} right={right}/>;
  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return <div className={`mp-surface ${preferences.density} ${preferences.reducedMotion ? 'mp-reduced-motion' : ''} ${!preferences.buddy ? 'mp-hide-buddy' : ''} ${!preferences.codexBuddy ? 'mp-hide-codex-buddy' : ''}`}
    onDragOver={e => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (leaveTimer.current) clearTimeout(leaveTimer.current); setDragging(true); } }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leaveTimer.current = setTimeout(() => setDragging(false),220); }}
    onDrop={e => { if (!isFileDrag(e)) return; e.preventDefault(); if (leaveTimer.current) clearTimeout(leaveTimer.current); const files = Array.from(e.dataTransfer.files); void live.run(() => window.notchlight.addFiles(files)).finally(() => setDragging(false)); }}>
    <Island snap={filteredSnapshot(snapshot,filter)} open={expanded} hovering={hovering} onBox={onBox} onDismiss={sessionId => window.notchlight.dismiss(sessionId)} onDecide={(sessionId,askId,decision) => live.run(() => window.notchlight.decide(sessionId,askId,decision))} surface={{ active, navigation, selectedSession: target, panel: { id: `${id}-panel`, 'aria-labelledby': `${id}-${view}` }, expanded: view === 'agents' ? undefined : <div style={{ width: PANEL_W }}>{wing(true)}{navigation}<div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}`}>{view === 'music' ? <LiveMusic live={live}/> : <LiveTray live={live} dragging={dragging}/>}</div>{live.error && <p role="alert" className="mp-live-error">{live.error}</p>}</div>, collapsed: resting }}/>
  </div>;
}

export function CompanionDesktop({ live, onCustomize }: { live: LiveController; onCustomize: () => void }) {
  const [open, setOpen] = useState(true);
  return <div className="mp-preview-column"><div className="mp-preview-toolbar"><span><i/> Your live companion</span><button className="mp-text-button" onClick={() => setOpen(!open)}>{open ? 'Collapse notch' : 'Expand notch'}<Icon name="expand" size={14}/></button></div><div className="mp-desktop"><div className="mp-menubar" aria-hidden="true"><span>Notchlight</span><span>On this Mac</span></div><div className="mp-camera" style={{width:live.snapshot.notchW,height:live.snapshot.notchH}}/><CompanionSurface live={live} open={open} hovering onCustomize={onCustomize}/><div className="mp-finder-position"><section className="mp-finder mp-real-files" onDragOver={e => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect='copy'; } }} onDrop={e => { e.preventDefault(); void live.run(() => window.notchlight.addFiles(Array.from(e.dataTransfer.files))); }}><div className="mp-finder-title"><Icon name="tray" size={15}/><strong>Your file shelf</strong><span>{live.state.files.length} items</span></div><div className="mp-real-drop"><Icon name="folder" size={28}/><div><strong>Drop files here or on the notch.</strong><p>A temporary shelf. Originals stay where they are.</p></div><button className="mp-soft-button" onClick={() => void live.run(() => window.notchlight.pickFiles())}>Choose files…</button></div><div className="mp-destination"><span>Double-click an item in Tray to reveal it in Finder.</span></div></section></div></div><p className="mp-preview-note">Connected to your Mac.<span>Changes apply to the live notch and are saved automatically.</span></p><div className="mp-notice" role={live.error ? 'alert' : 'status'}>{live.error || live.state.notice || 'Music connects to Spotify. Tray accepts your real files.'}</div></div>;
}
