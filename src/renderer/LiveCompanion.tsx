import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { Island, Stubs, Wings } from './IslandView';
import { Icon, FileThumb, RestingWings, type RestingPart } from './Preview';
import { Buddy } from './Buddy';
import { PANEL_W } from './theme';
import type { AgentFilter, Snapshot } from '../shared/types';
import { DEFAULT_COMPANION_PREFERENCES, EMPTY_CAPTURE, EMPTY_CLIPBOARD, EMPTY_SPOTIFY, playhead, type CaptureSnapshot, type CompanionSnapshot, type CompanionView, type OperationResult, type ShelfFile, type SpotifySnapshot } from '../shared/companion';
import { useReducedMotion } from './pulse';
import './preview.css';
import { AgentFilters, AgentConnection, AgentAttention, agentRestingParts, filteredSnapshot, providerOf } from './Agents';

const EMPTY: Snapshot = { sessions: [], overall: 'idle', tokens: 0, elapsed: 0, dormant: true, notchW: 200, notchH: 32, hoverDelay: 550, pulse: true, now: Date.now() };
export function useCompanion() {
  const available = !!window.notchlight?.getCompanion;
  const [state, setState] = useState<CompanionSnapshot>({ preferences: { ...DEFAULT_COMPANION_PREFERENCES }, view: 'agents', files: [], music: { ...EMPTY_SPOTIFY }, capture: { ...EMPTY_CAPTURE }, clipboard: { ...EMPTY_CLIPBOARD }, transfer: null, undoable: 0, notice: '' });
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
const names: Record<CompanionView, string> = { agents: 'Agents', music: 'Music', tray: 'Tray', clipboard: 'Clipboard' };
/** Clipboard joins the row only once its history is switched on; a face with nothing behind it is noise. */
const visibleViews = (enabled: boolean): CompanionView[] => enabled ? ['agents','music','tray','clipboard'] : ['agents','music','tray'];
const ago = (at: number, now: number) => { const s = Math.max(0, Math.round((now - at) / 1000)); return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
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
/**
 * Where playback is right now. Spotify is read every few seconds; between
 * reads the seek bar and the times advance on their own while a track plays,
 * four times a second, so they tick rather than jump. Paused, they hold.
 */
function usePlayhead(music: SpotifySnapshot): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!music.playing || music.status !== 'ready') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [music.playing, music.status, music.at]);
  return playhead(music, now);
}
function LiveMusic({ live }: { live: LiveController }) {
  const { music } = live.state;
  const [seek, setSeek] = useState<number | null>(null);
  // Play/pause shows its new state the moment it is clicked; the read that follows confirms or corrects it.
  const [expected, setExpected] = useState<boolean | null>(null);
  const track = music.track;
  const current = usePlayhead(music);
  useEffect(() => setSeek(null), [track?.id]);
  useEffect(() => setExpected(null), [music.playing, music.at]);
  const command = (name: 'toggle' | 'next' | 'previous') => {
    if (name === 'toggle') setExpected(!music.playing);
    void live.run(() => window.notchlight.controlSpotify(name)).finally(() => { if (name === 'toggle') setExpected(null); });
  };
  const commitSeek = (position: number) => { setSeek(null); void live.run(() => window.notchlight.controlSpotify('seek', position)); };
  if (music.status !== 'ready' || !track) {
    const open = music.status === 'not-running' || music.status === 'empty' && !music.busy;
    return <div className="mp-empty"><Icon name={music.status === 'error' || music.status === 'permission' ? 'warning' : 'music'} size={30}/><p>{music.busy ? 'Connecting to Spotify…' : music.status === 'disconnected' ? 'Your Spotify, closer.' : music.status === 'permission' ? 'Spotify needs your permission.' : open ? 'A little room for music.' : 'Spotify is taking a moment.'}</p><span>{music.message || 'Connect the Spotify desktop app to see and control what’s playing.'}</span><button className="mp-soft-button" disabled={music.busy} onClick={() => void live.run(() => open ? window.notchlight.openSpotify() : window.notchlight.connectSpotify())}>{open ? 'Open Spotify' : music.status === 'disconnected' ? 'Connect Spotify' : 'Reconnect Spotify'}</button></div>;
  }
  const playing = expected ?? music.playing;
  const position = seek ?? current;
  return <div className="mp-music"><div className="mp-track-row"><LiveArtwork live={live}/><div className="mp-track-meta"><h2 title={track.title}>{track.title}</h2><p title={track.artist}>{track.artist}</p><div className="mp-seek"><span>{time(position)}</span><input aria-label="Track position" aria-valuetext={`${time(position)} of ${time(track.duration)}`} type="range" min="0" max={track.duration} step="any" value={position} disabled={music.busy || !track.duration} onChange={e => setSeek(Number(e.target.value))} onPointerUp={e => commitSeek(Number(e.currentTarget.value))} onPointerCancel={() => setSeek(null)} onKeyUp={e => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)) commitSeek(Number(e.currentTarget.value)); }}/><span>−{time(Math.max(0,track.duration-position))}</span></div><div className="mp-transport"><button className="mp-icon-button" disabled={music.busy} aria-label="Previous track" onClick={() => command('previous')}><Icon name="back" size={18}/></button><button className="mp-icon-button mp-play" disabled={music.busy} aria-label={playing ? 'Pause Spotify' : 'Play Spotify'} onClick={() => command('toggle')}><Icon name={playing ? 'pause' : 'play'} size={18}/></button><button className="mp-icon-button" disabled={music.busy} aria-label="Next track" onClick={() => command('next')}><Icon name="next" size={18}/></button></div></div></div></div>;
}
function FileButton({ file, live, selected, dragIds, onSelect }: { file: ShelfFile; live: LiveController; selected: boolean; dragIds: string[]; onSelect: (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => void }) {
  return <div className={`mp-shelf-item ${selected ? 'is-selected' : ''} ${file.unavailable ? 'is-unavailable' : ''}`}><button className="mp-file-button" aria-label={`Select ${file.name}${file.unavailable ? ', unavailable' : ''}`} aria-pressed={selected} draggable={!file.unavailable} onDragStart={e => { e.preventDefault(); window.notchlight.startFileDrag(dragIds); }} onClick={e => onSelect(e)} onDoubleClick={() => void live.run(() => file.unavailable ? window.notchlight.locateFile(file.id) : window.notchlight.revealFile(file.id))}><FileThumb file={file} small={live.state.preferences.thumbnails === 'small'} sample={false}/><span title={file.name}>{file.name}</span><small>{file.unavailable ? 'Missing' : file.size}</small></button><button className="mp-remove" aria-label={`Remove ${file.name} from Tray`} onClick={() => void live.run(() => window.notchlight.removeFiles([file.id]))}><Icon name="close" size={12}/></button></div>;
}
const bytes = (n: number) => n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
/**
 * The shelf. Click selects one, Command-click adds or removes one, Shift-click
 * takes the range from the last click; Escape clears. Every action in the
 * footer works on the whole selection, and dragging any selected item drags
 * them all. Missing files stay identifiable — Locate points the reference at
 * where the file is now, or Remove lets it go.
 */
function LiveTray({ live, dragging }: { live: LiveController; dragging: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const files = live.state.files;
  const ids = files.map(f => f.id);
  const chosen = selected.filter(id => ids.includes(id));
  const chosenFiles = files.filter(f => chosen.includes(f.id));
  const missing = chosenFiles.filter(f => f.unavailable);
  const transfer = live.state.transfer;
  const select = (id: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
    if (e.shiftKey && anchor.current && ids.includes(anchor.current)) {
      const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
      setSelected(ids.slice(a, b + 1));
      return;
    }
    anchor.current = id;
    if (e.metaKey || e.ctrlKey) setSelected(chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id]);
    else setSelected([id]);
  };
  const dragIds = (id: string) => chosen.includes(id) ? chosen : [id];
  const headline = transfer ? `Copying ${transfer.items > 1 ? `${transfer.item} of ${transfer.items} · ` : ''}${transfer.name}` : dragging ? 'Drop it here. Pick it up later.' : chosen.length > 1 ? `${chosen.length} selected` : 'A place between places.';
  return <div className={`mp-tray ${dragging ? 'is-drop-target' : ''}`} onKeyDown={e => { if (e.key === 'Escape' && chosen.length) { e.stopPropagation(); setSelected([]); } if ((e.metaKey || e.ctrlKey) && e.key === 'a' && files.length) { e.preventDefault(); setSelected(ids); } }}><div className="mp-tray-heading"><span>{headline}</span>{live.state.undoable > 0 && !transfer ? <button className="mp-text-button" onClick={() => void live.run(() => window.notchlight.undoRemove())}>Undo remove</button> : <button className="mp-text-button" onClick={() => void live.run(() => window.notchlight.pickFiles())}>Add files…</button>}</div>{transfer && <div className="mp-transfer" role="progressbar" aria-label="Copy progress" aria-valuemin={0} aria-valuemax={transfer.total || 1} aria-valuenow={Math.min(transfer.done, transfer.total || 1)}><i style={{ width: `${transfer.total ? Math.min(100, (transfer.done / transfer.total) * 100) : 100}%` }}/><span>{bytes(transfer.done)} of {bytes(transfer.total)}</span></div>}{!files.length ? <div className="mp-empty mp-empty-tray"><Icon name="tray" size={32}/><p>Keep it here for a moment.</p><span>Drop files from Finder. They stay in their original location.</span><button className="mp-soft-button" onClick={() => void live.run(() => window.notchlight.pickFiles())}>Choose files…</button></div> : <div className={`mp-file-grid ${live.state.preferences.thumbnails}`} role="listbox" aria-multiselectable="true" aria-label="Files in Tray">{files.map(file => <FileButton key={file.id} file={file} live={live} selected={chosen.includes(file.id)} dragIds={dragIds(file.id)} onSelect={e => select(file.id, e)}/>)}</div>}<div className="mp-tray-footer"><span>{chosen.length === 1 ? chosenFiles[0]?.name : chosen.length > 1 ? `${chosen.length} items${missing.length ? `, ${missing.length} missing` : ''}` : 'Drag out to another app. Originals stay put.'}</span>{chosen.length === 1 && missing.length === 1 ? <button className="mp-text-button" onClick={() => void live.run(() => window.notchlight.locateFile(missing[0].id))}>Locate… <Icon name="arrow" size={13}/></button> : <>{chosen.length > 1 && <button className="mp-text-button" onClick={() => { setSelected([]); void live.run(() => window.notchlight.removeFiles(chosen)); }}>Remove {chosen.length}</button>}<button className="mp-text-button" disabled={!chosen.length || missing.length === chosen.length || !!transfer} onClick={() => void live.run(() => window.notchlight.saveFileCopy(chosen.filter(id => !missing.some(m => m.id === id))))}>Save {chosen.length > 1 ? `${chosen.length - missing.length} copies` : 'copy'}… <Icon name="arrow" size={13}/></button></>}</div></div>;
}

/**
 * What you copied, newest first with pins on top. Click copies it back. The
 * filter box takes typing when the island has the keyboard (⌥⇧N) or in the
 * Customize window; the overlay itself never takes focus on its own.
 */
function LiveClipboard({ live }: { live: LiveController }) {
  const { clipboard } = live.state;
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const needle = query.trim().toLowerCase();
  const items = clipboard.items.filter(i => !needle || i.text.toLowerCase().includes(needle) || i.preview.toLowerCase().includes(needle));
  const ordered = [...items.filter(i => i.pinned), ...items.filter(i => !i.pinned)];
  const pins = clipboard.items.filter(i => i.pinned).length;
  return <div className="mp-clip"><div className="mp-tray-heading"><span>{clipboard.paused ? 'Capture paused.' : `${clipboard.items.length} ${clipboard.items.length === 1 ? 'item' : 'items'}${pins ? ` · ${pins} pinned` : ''}`}</span><button className="mp-text-button" onClick={() => void live.run(() => window.notchlight.pauseClipboard(!clipboard.paused))}>{clipboard.paused ? 'Resume capture' : 'Pause capture'}</button></div>
    {clipboard.items.length > 4 && <label className="mp-clip-search"><Icon name="search" size={13}/><input type="search" placeholder="Filter" aria-label="Filter clipboard history" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }}/></label>}
    {!clipboard.items.length ? <div className="mp-empty mp-empty-tray"><Icon name="clipboard" size={32}/><p>Nothing copied yet.</p><span>Text and images you copy show up here. Passwords and one-time codes are skipped.</span></div>
    : !ordered.length ? <div className="mp-empty mp-empty-tray"><Icon name="search" size={28}/><p>No match.</p><span>Nothing in the history contains “{query.trim()}”.</span></div>
    : <ul className="mp-clip-list" aria-label="Clipboard history">{ordered.map(item => <li key={item.id} className={`mp-clip-item ${item.pinned ? 'is-pinned' : ''}`}><button className="mp-clip-copy" title={item.kind === 'image' ? item.preview : item.text.length > 400 ? item.text.slice(0, 400) + '…' : item.text} onClick={() => void live.run(() => window.notchlight.copyClipboardItem(item.id))}>{item.kind === 'image' && item.thumb ? <img className="mp-clip-thumb" src={item.thumb} alt="" draggable={false}/> : <span className="mp-clip-kind" aria-hidden="true">{item.kind === 'url' ? '@' : 'T'}</span>}<span className="mp-clip-text"><span>{item.preview || '(blank)'}</span><small>{item.kind === 'url' ? item.host : item.kind === 'image' ? `${Math.max(1, Math.round(item.bytes / 1024))} KB` : item.lines > 1 ? `${item.lines} lines` : `${item.text.length} chars`} · {ago(item.at, now)}</small></span></button><button className="mp-clip-pin" aria-label={item.pinned ? `Unpin ${item.preview}` : `Pin ${item.preview}`} aria-pressed={item.pinned} onClick={() => void live.run(() => window.notchlight.pinClipboardItem(item.id, !item.pinned))}><Icon name="pin" size={13}/></button><button className="mp-remove mp-clip-remove" aria-label={`Remove ${item.preview}`} onClick={() => void live.run(() => window.notchlight.removeClipboardItem(item.id))}><Icon name="close" size={12}/></button></li>)}</ul>}
    <div className="mp-tray-footer"><span>Click an item to copy it again.</span>{clipboard.items.length > 0 && <button className="mp-text-button" onClick={() => void live.run(() => window.notchlight.clearClipboard(false))}>Clear{pins ? ' unpinned' : ''}</button>}</div></div>;
}

export function CompanionSurface({ live, open, hovering, keyboard = false, onBox, onCustomize }: { live: LiveController; open: boolean; hovering: boolean; keyboard?: boolean; onBox?: (r: {x:number;y:number;w:number;h:number}) => void; onCustomize: () => void }) {
  const id = useId();
  const [filter,setFilter] = useState<AgentFilter>('all');
  const [target,setTarget] = useState<string>();
  const focus = useRef(false);
  const [dragging, setDragging] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preferences = live.state.preferences;
  const views = visibleViews(preferences.clipboardEnabled);
  const view: CompanionView = dragging ? 'tray' : live.state.view === 'clipboard' && !preferences.clipboardEnabled ? 'agents' : live.state.view;
  const expanded = open || dragging;
  // Reduced motion stills the lights too; the pulse timer never starts for them.
  const motion = !preferences.reducedMotion;
  const snapshot = { ...live.snapshot, pulse: preferences.pulse && motion };
  useLayoutEffect(() => { if (focus.current && expanded) { document.getElementById(`${id}-${view}`)?.focus(); focus.current = false; } }, [id, view, expanded]);
  // The keyboard arrives: the selected tab takes focus so arrows move between faces and Tab walks into the panel.
  useEffect(() => { if (keyboard) { focus.current = true; requestAnimationFrame(() => { if (focus.current) { document.getElementById(`${id}-${view}`)?.focus(); focus.current = false; } }); } }, [keyboard]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  const choose = (view: CompanionView, keyboard = false) => { focus.current = keyboard; void live.run(() => window.notchlight.setView(view)); };
  const tabs = <nav className="mp-nav" aria-label="Notch views"><div role="tablist" aria-label="Companion view">{views.map((item,index) => <button key={item} role="tab" id={`${id}-${item}`} aria-controls={`${id}-panel`} aria-selected={view === item} tabIndex={view === item ? 0 : -1} onClick={() => choose(item,true)} onKeyDown={e => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); choose(views[e.key === 'Home' ? 0 : e.key === 'End' ? views.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length],true); }}>{item === 'agents' ? <Buddy size={15}/> : <Icon name={item} size={14}/>} {names[item]}{item === 'agents' && snapshot.overall === 'asking' && <span className="mp-attention-dot" aria-label="Needs your attention"/>}{item === 'tray' && <span className="mp-count">{live.state.files.length}</span>}{item === 'clipboard' && <span className="mp-count">{live.state.clipboard.items.length}</span>}</button>)}</div><button className="mp-icon-button" aria-label="Open customization" onClick={onCustomize}><Icon name="settings" size={16}/></button></nav>;
  const { music, files, clipboard } = live.state;
  const selectProvider = (provider: 'claude' | 'codex') => { setFilter(provider); choose('agents'); };
  const agents = agentRestingParts(snapshot, { ...preferences, pulse: preferences.pulse && motion, codexPulse: preferences.codexPulse && motion }, selectProvider);
  const parts: RestingPart[] = [...agents,
    ...(preferences.restMusic && music.status === 'ready' && music.track ? [{left:<LiveArtwork live={live} mini/>,right:<LiveEqualizer active={music.playing && preferences.visualizer} live={!preferences.reducedMotion} capture={live.state.capture.status}/>}]:[]),
    ...(preferences.restTray && files.length || dragging ? [{left:<span className="mp-shelf-wing"><Icon name="tray" size={16}/>{files.length}</span>,right:<Icon name="file" size={16}/>}]:[]),
    ...(preferences.clipboardEnabled && preferences.restClipboard && clipboard.items.length ? [{left:<span className="mp-shelf-wing"><Icon name="clipboard" size={16}/>{clipboard.items.length}</span>,right:<span className="mp-clip-kind" aria-hidden="true">{clipboard.paused ? '‖' : clipboard.items[0].kind === 'url' ? '@' : clipboard.items[0].kind === 'image' ? '▣' : 'T'}</span>}]:[])
  ];
  const resting = parts.length ? <RestingWings notchW={snapshot.notchW} height={snapshot.notchH} parts={parts}/> : snapshot.sessions.length ? (hovering ? <Stubs snap={snapshot}/> : <div style={{width:snapshot.notchW,height:snapshot.notchH}}/>) : undefined;
  const navigation = <>{tabs}{view === 'agents' && <AgentFilters snapshot={snapshot} value={filter} onChange={f => {setFilter(f);setTarget(undefined);}}/>}{view === 'agents' && <AgentConnection snapshot={snapshot} filter={filter}/>}<AgentAttention sessions={snapshot.sessions} onSelect={s => {setFilter(providerOf(s));setTarget(s.id);choose('agents');}}/>{view === 'agents' && live.error && <p role="alert" className="mp-live-error">{live.error}</p>}</>;
  const active = !snapshot.dormant || parts.length > 0 || keyboard;
  const left = <div className="mp-left-wing">{view === 'music' ? <LiveArtwork live={live} mini/> : view === 'clipboard' ? <span className="mp-shelf-wing"><Icon name="clipboard" size={17}/>{clipboard.items.length}</span> : <span className="mp-shelf-wing"><Icon name="tray" size={17}/>{live.state.files.length}</span>}</div>;
  const right = <div className="mp-right-wing">{snapshot.overall === 'asking' && <button className="mp-attention-button" aria-label="Agents need attention" onClick={() => choose('agents')}><span className="mp-attention-dot"/></button>}{view === 'music' ? <LiveEqualizer active={live.state.music.playing && preferences.visualizer} live={!preferences.reducedMotion} capture={live.state.capture.status}/> : view === 'clipboard' ? <span className="mp-clip-kind" aria-hidden="true">{clipboard.paused ? '‖' : 'T'}</span> : <Icon name="file" size={16}/>}</div>;
  const wing = (full: boolean) => <Wings notchW={snapshot.notchW} height={snapshot.notchH} width={full ? PANEL_W : undefined} left={left} right={right}/>;
  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return <div className={`mp-surface ${preferences.density} ${preferences.reducedMotion ? 'mp-reduced-motion' : ''} ${!preferences.buddy ? 'mp-hide-buddy' : ''} ${!preferences.codexBuddy ? 'mp-hide-codex-buddy' : ''} ${keyboard ? 'mp-keyboard' : ''}`}
    onKeyDown={e => { if (e.key === 'Escape' && keyboard && window.notchlight?.keyboardDone) { e.preventDefault(); window.notchlight.keyboardDone(); } }}
    onDragOver={e => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (leaveTimer.current) clearTimeout(leaveTimer.current); setDragging(true); } }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leaveTimer.current = setTimeout(() => setDragging(false),220); }}
    onDrop={e => { if (!isFileDrag(e)) return; e.preventDefault(); if (leaveTimer.current) clearTimeout(leaveTimer.current); const files = Array.from(e.dataTransfer.files); void live.run(() => window.notchlight.addFiles(files)).finally(() => setDragging(false)); }}>
    <Island snap={filteredSnapshot(snapshot,filter)} open={expanded} hovering={hovering} onBox={onBox} onDismiss={sessionId => window.notchlight.dismiss(sessionId)} onJump={sessionId => void live.run(() => window.notchlight.focusSession(sessionId))} onDecide={(sessionId,askId,decision) => live.run(() => window.notchlight.decide(sessionId,askId,decision))} surface={{ active, navigation, selectedSession: target, panel: { id: `${id}-panel`, 'aria-labelledby': `${id}-${view}` }, expanded: view === 'agents' ? undefined : <div style={{ width: PANEL_W }}>{wing(true)}{navigation}<div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}`}>{view === 'music' ? <LiveMusic live={live}/> : view === 'clipboard' ? <LiveClipboard live={live}/> : <LiveTray live={live} dragging={dragging}/>}</div>{live.error && <p role="alert" className="mp-live-error">{live.error}</p>}</div>, collapsed: resting }}/>
  </div>;
}

export function CompanionDesktop({ live, onCustomize }: { live: LiveController; onCustomize: () => void }) {
  const [open, setOpen] = useState(true);
  return <div className="mp-preview-column"><div className="mp-preview-toolbar"><span><i/> Your live companion</span><button className="mp-text-button" onClick={() => setOpen(!open)}>{open ? 'Collapse notch' : 'Expand notch'}<Icon name="expand" size={14}/></button></div><div className="mp-desktop"><div className="mp-menubar" aria-hidden="true"><span>Notchlight</span><span>On this Mac</span></div><div className="mp-camera" style={{width:live.snapshot.notchW,height:live.snapshot.notchH}}/><CompanionSurface live={live} open={open} hovering onCustomize={onCustomize}/><div className="mp-finder-position"><section className="mp-finder mp-real-files" onDragOver={e => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect='copy'; } }} onDrop={e => { e.preventDefault(); void live.run(() => window.notchlight.addFiles(Array.from(e.dataTransfer.files))); }}><div className="mp-finder-title"><Icon name="tray" size={15}/><strong>Your file shelf</strong><span>{live.state.files.length} items</span></div><div className="mp-real-drop"><Icon name="folder" size={28}/><div><strong>Drop files here or on the notch.</strong><p>A temporary shelf. Originals stay where they are.</p></div><button className="mp-soft-button" onClick={() => void live.run(() => window.notchlight.pickFiles())}>Choose files…</button></div><div className="mp-destination"><span>Double-click an item in Tray to reveal it in Finder.</span></div></section></div></div><p className="mp-preview-note">Connected to your Mac.<span>Changes apply to the live notch and are saved automatically.</span></p><div className="mp-notice" role={live.error ? 'alert' : 'status'}>{live.error || live.state.notice || 'Music connects to Spotify. Tray accepts your real files.'}</div></div>;
}
