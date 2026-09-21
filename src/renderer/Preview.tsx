import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type Dispatch, type DragEvent, type ReactNode } from 'react';
import { nextIndex, span, until } from './today';
import { nextEvent, visibleEvents, MUSIC_CONTROL_NAMES, type MusicControl } from '../shared/companion';
import { Island, Stubs, Wings } from './IslandView';
import { Buddy } from './Buddy';
import { PANEL_W } from './theme';
import { initialPreview, previewReducer, previewAgents, BATTERY_SAMPLES, HUD_SAMPLES, SAMPLE_CALENDARS, SAMPLE_FILES, TRACKS,
  type PreviewAction, type PreviewFile, type PreviewState, type PreviewView } from './previewModel';
import './preview.css';
import { AgentFilters, AgentConnection, AgentAttention, agentRestingParts, filteredSnapshot, providerOf } from './Agents';
import type { AgentFilter } from '../shared/types';

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    music: <><path d="M9 17V5l11-2v12M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/></>,
    tray: <><path d="M3 14l3-9h12l3 9v6H3Z"/><path d="M3 14h5l2 3h4l2-3h5"/></>,
    settings: <><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
    play: <path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none"/>,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="4"/></>,
    next: <><path d="m5 6 10 6-10 6Z" fill="currentColor" stroke="none"/><path d="M18 6v12"/></>,
    back: <><path d="m19 6-10 6 10 6Z" fill="currentColor" stroke="none"/><path d="M6 6v12"/></>,
    close: <path d="m7 7 10 10M17 7 7 17"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    file: <><path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6"/></>,
    folder: <path d="M3 6h7l2 3h9v11H3Z"/>,
    appearance: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M9 21h6M12 18v3M12 4v14"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></>,
    expand: <path d="m6 9 6 6 6-6"/>,
    warning: <><path d="m12 3 10 18H2ZM12 9v5"/><path d="M12 17h.01"/></>,
    clipboard: <><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/></>,
    pin: <><path d="M9 3h6l-1 6 3 3H7l3-3ZM12 12v9"/></>,
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
    sparkle: <path d="M12 3c.6 4.6 3.4 7.4 9 9-5.6 1.6-8.4 4.4-9 9-.6-4.6-3.4-7.4-9-9 5.6-1.6 8.4-4.4 9-9Z" fill="currentColor" stroke="none"/>,
    plus: <><circle cx="12" cy="12" r="8.5"/><path d="M12 8.5v7M8.5 12h7"/></>,
    face: <><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="10.5" r="1.3" fill="currentColor" stroke="none"/><path d="M9 15c1.6 1.3 4.4 1.3 6 0"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8h.01"/></>,
    updown: <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4"/>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></>,
    volume: <><path d="M4 9h3l5-4v14l-5-4H4Z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10"/></>,
    mute: <><path d="M4 9h3l5-4v14l-5-4H4Z"/><path d="m16 9.5 5 5m0-5-5 5"/></>,
    bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6Z" fill="currentColor" stroke="none"/>,
    plug: <><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0Z"/><path d="M12 17v4"/></>,
    today: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
    share: <><path d="M12 3v13M8 7l4-4 4 4"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></>,
    shuffle: <><path d="M3 6h3l4 12h4M3 18h3l1.5-4.5"/><path d="M14 6h4M18 6l-2.5-2.5M18 6l-2.5 2.5M14 18h4M18 18l-2.5-2.5M18 18l-2.5 2.5"/></>,
    repeat: <><path d="M5 9a3 3 0 0 1 3-3h11M19 6l-2.5-2.5M19 6l-2.5 2.5"/><path d="M19 15a3 3 0 0 1-3 3H5M5 18l2.5-2.5M5 18l2.5 2.5"/></>,
    launch: <><path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></>,
    pin2: <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>,
    brightness: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></>
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.file}</svg>;
}

export function usePreview(seed?: PreviewState, clock = true) {
  const [state, dispatch] = useReducer(previewReducer, seed, value => value ?? initialPreview());
  useEffect(() => {
    if (!clock || !state.music.playing || state.music.source !== 'ready') return;
    const timer = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(timer);
  }, [clock, state.music.playing, state.music.source]);
  useEffect(() => {
    if (!state.drag) return;
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch({ type: 'drag-end' }); };
    window.addEventListener('keydown', cancel);
    return () => { window.removeEventListener('keydown', cancel); };
  }, [state.drag]);
  return { state, dispatch };
}

type Controls = { state: PreviewState; dispatch: Dispatch<PreviewAction> };
const viewNames: Record<PreviewView, string> = { agents: 'Agents', music: 'Music', tray: 'Tray', clipboard: 'Clipboard', today: 'Today' };
const allViews: PreviewView[] = ['agents', 'music', 'today', 'tray', 'clipboard'];
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function Navigation({ state, onNavigate, onCustomize, id, attention }: { state: PreviewState; onNavigate: (view: PreviewView) => void; onCustomize: () => void; id: string; attention: boolean }) {
  const views = allViews.filter(view =>
    (view !== 'clipboard' || state.preferences.clipboardEnabled) && (view !== 'today' || state.preferences.calendarEnabled));
  return <nav className="mp-nav" aria-label="Notch views">
    <div role="tablist" aria-label="Preview view">
      {views.map((view, index) => <button key={view} role="tab" id={`${id}-${view}`} aria-controls={`${id}-panel`}
        aria-selected={state.view === view} tabIndex={state.view === view ? 0 : -1}
        onClick={() => onNavigate(view)}
        onKeyDown={e => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? views.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length;
          onNavigate(views[next]);
        }}>
        {view === 'agents' ? <span className="mp-mini-buddy"><Buddy size={15} /></span> : <Icon name={view} size={14}/>}
        {viewNames[view]}
        {view === 'agents' && attention && <span className="mp-attention-dot" aria-label="Needs your attention"/>}
        {view === 'tray' && <span className="mp-count">{state.files.length}</span>}
        {view === 'clipboard' && <span className="mp-count">{state.clips.length}</span>}
      </button>)}
    </div>
    <button className="mp-icon-button" aria-label="Open customization" title="Customize Notchlight" onClick={onCustomize}><Icon name="settings" size={16}/></button>
  </nav>;
}

function Artwork({ state, mini = false }: { state: PreviewState; mini?: boolean }) {
  const track = TRACKS[state.music.index];
  const glow = state.preferences.artworkGlow && state.music.source === 'ready' && !state.music.missingArtwork;
  return <div className={`mp-artwork ${mini ? 'mp-artwork-mini' : ''}`} style={glow ? { boxShadow: `0 0 ${mini ? 10 : 26}px ${SAMPLE_TINT}66` } : undefined}>
    {state.preferences.artwork && !state.music.missingArtwork && track.artwork
      ? <img src={track.artwork} alt={mini ? '' : `${track.album} — sample artwork`} draggable={false}/>
      : <Icon name="music" size={mini ? 14 : 34}/>}
  </div>;
}
/** How a HUD bar is dressed, which is four preferences and nothing else. */
export interface HudLook { style: 'solid' | 'gradient'; glow: boolean; percentage: boolean }
/**
 * One level, as a bar.
 *
 * It stands in for the grey square macOS puts in the middle of the screen, so it
 * says the same two things and no more: which key was pressed, and where the
 * level landed. The width is written inline rather than animated — the value is
 * already the end of the movement, and the overlay is a transparent window whose
 * every frame costs the compositor.
 */
export function HudBar({ kind, value, muted, look, wide = false }: { kind: 'volume' | 'brightness'; value: number; muted?: boolean; look: HudLook; wide?: boolean }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const icon = kind === 'brightness' ? 'brightness' : muted || percent === 0 ? 'mute' : 'volume';
  const name = kind === 'brightness' ? 'Brightness' : muted ? 'Volume, muted' : 'Volume';
  return <span className={`mp-hud ${wide ? 'is-wide' : ''} ${look.style === 'gradient' ? 'is-gradient' : ''} ${look.glow ? 'is-glowing' : ''} ${muted ? 'is-muted' : ''}`} role="status" aria-label={`${name} ${percent}%`}>
    <Icon name={icon} size={14}/>
    <span className="mp-hud-track"><i style={{ width: `${percent}%` }}/></span>
    {look.percentage && <b>{percent}</b>}
  </span>;
}
/** The HUD on the resting bar: the key on the left, the level on the right. */
export function hudRestingPart(activity: { kind: 'volume' | 'brightness'; value: number; muted: boolean }, look: HudLook): RestingPart {
  const percent = Math.round(Math.max(0, Math.min(1, activity.value)) * 100);
  const icon = activity.kind === 'brightness' ? 'brightness' : activity.muted || percent === 0 ? 'mute' : 'volume';
  return {
    left: <span className="mp-shelf-wing"><Icon name={icon} size={16}/></span>,
    right: <HudBar kind={activity.kind} value={activity.value} muted={activity.muted} look={look}/>
  };
}
/**
 * The battery, drawn the way the hardware reads.
 *
 * A level is a length, so it is a length here too rather than a number you have
 * to parse. Charging puts a bolt through it; low turns it amber, which is the
 * one state that should catch your eye from the corner of it. The number beside
 * it is optional, because the shape already says roughly what it needs to.
 */
export function BatteryGlyph({ percent, charging, plugged, low, showPercent = false }: { percent: number; charging: boolean; plugged?: boolean; low?: boolean; showPercent?: boolean }) {
  const level = Math.max(0, Math.min(1, percent));
  const shown = Math.round(level * 100);
  return <span className={`mp-battery ${charging ? 'is-charging' : ''} ${low ? 'is-low' : ''} ${plugged && !charging ? 'is-plugged' : ''}`} role="img" aria-label={`Battery ${shown}%${charging ? ', charging' : plugged ? ', on the charger' : ''}`}>
    <span className="mp-battery-shell"><i style={{ width: `${Math.max(shown ? 6 : 0, shown)}%` }}/>{charging && <Icon name="bolt" size={9}/>}</span>
    {showPercent && <b>{shown}</b>}
  </span>;
}
/**
 * One thing happening today.
 *
 * The calendar's own colour is the only ornament: it is what makes a row
 * belong to Work or Home at a glance, and it is already a decision someone
 * made in the app they keep their calendar in. Something already behind you is
 * dimmed rather than removed — the day reads better with its shape intact.
 */
export function EventRow({ event, color, full, onToggle }: { event: import('../shared/companion').CalendarEvent; color: string; full: boolean; onToggle?: () => void }) {
  const Tag = onToggle ? 'button' : 'div';
  return <Tag className={`mp-event ${event.past ? 'is-past' : ''} ${event.done ? 'is-done' : ''} ${event.kind === 'reminder' ? 'is-reminder' : ''}`}
    {...(onToggle ? { onClick: onToggle, type: 'button' as const, 'aria-pressed': event.done, 'aria-label': `${event.done ? 'Not done' : 'Done'}: ${event.title}` } : {})}>
    <i className="mp-event-mark" style={{ background: color }} aria-hidden="true"/>
    <span className="mp-event-text">
      <b className={full ? 'is-full' : ''} title={event.title}>{event.title}</b>
      <small>{span(event)}{event.location ? ` · ${event.location}` : ''}</small>
    </span>
  </Tag>;
}
/** The whole day, in the order it happens, scrolled to the next thing. */
export function DayList({ events, colorOf, full, empty, onToggle }: { events: import('../shared/companion').CalendarEvent[]; colorOf: (id: string) => string; full: boolean; empty: ReactNode; onToggle?: (event: import('../shared/companion').CalendarEvent) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const index = nextIndex(events);
  useLayoutEffect(() => {
    if (index < 0) return;
    const row = list.current?.children[index] as HTMLElement | undefined;
    // `nearest` rather than `center`: the things after it are the rest of your
    // day, and shoving them below the fold to centre one row helps nobody.
    row?.scrollIntoView({ block: 'nearest' });
  }, [index, events.length]);
  if (!events.length) return <>{empty}</>;
  return <div className="mp-day" ref={list} role="list" aria-label="Today">
    {events.map(event => <EventRow key={event.id} event={event} color={colorOf(event.calendarId)} full={full} onToggle={onToggle && event.kind === 'reminder' ? () => onToggle(event) : undefined}/>)}
  </div>;
}
/** Today on the resting bar: the next thing, and how long until it. */
export function todayRestingPart(event: import('../shared/companion').CalendarEvent | null, color: string, now: number): RestingPart {
  if (!event) return { left: <span className="mp-shelf-wing"><Icon name="today" size={15}/></span>, right: <span className="mp-today-wing"><span>Clear</span></span> };
  return {
    left: <span className="mp-shelf-wing"><i className="mp-event-mark" style={{ background: color }} aria-hidden="true"/></span>,
    right: <span className="mp-today-wing"><b title={event.title}>{event.title}</b><span>{event.allDay ? 'All day' : until(event, now)}</span></span>
  };
}
/** The battery on the resting bar: the glyph on the right, where the hardware one sits. */
export function batteryRestingPart(battery: { percent: number; charging: boolean; plugged: boolean; low: boolean }, showPercent: boolean): RestingPart {
  return {
    left: <span className="mp-shelf-wing"><Icon name={battery.plugged ? 'plug' : 'bolt'} size={14}/></span>,
    right: <BatteryGlyph percent={battery.percent} charging={battery.charging} plugged={battery.plugged} low={battery.low} showPercent={showPercent}/>
  };
}
export interface RestingPart { left: ReactNode; right: ReactNode; provider?: boolean }
/**
 * The resting bar, assembled from whichever faces are switched on and have
 * something to say. Claude sits nearest the camera, followed by Codex. Music and Tray
 * use the remaining outer space. A hairline keeps neighbours from reading as one object.
 */
export function RestingWings({ notchW, height, parts, attention }: { notchW: number; height: number; parts: RestingPart[]; attention?: ReactNode }) {
  const join = (items: ReactNode[]) => items.flatMap((item, i) => i ? [<i key={`d${i}`} className="mp-rest-divider" aria-hidden="true"/>, item] : [item]);
  const budget = Math.max(48,(PANEL_W - notchW)/2);
  const compact = budget < 120;
  // Keep agent identities nearest the lens. Other faces use the outer space.
  const providers = parts.filter(p => p.provider);
  const others = parts.filter(p => !p.provider);
  const available = Math.max(0,Math.floor((budget - providers.length*43 - 16)/44));
  const visible = [...others.slice(0,available),...providers];
  const hidden = others.length - Math.min(available,others.length);
  if (hidden) visible.unshift({left:<span className="agent-overflow" title="More faces available when expanded">+{hidden}</span>,right:<span className="agent-overflow" aria-hidden="true">···</span>});
  const right = [...visible].reverse().map(p => p.right);
  if (attention) right.unshift(attention);
  return <Wings notchW={notchW} height={height} left={<div className={`mp-rest-wing ${compact ? 'is-tight' : ''}`}>{join(visible.map(p => p.left))}</div>} right={<div className={`mp-rest-wing ${compact ? 'is-tight' : ''}`}>{join(right)}</div>}/>;

}
const SAMPLE_TINT = '#c47a4a';
function Equalizer({ active, layout = 'rising', tint }: { active: boolean; layout?: 'rising' | 'mirrored'; tint?: string }) {
  const bars = layout === 'mirrored' ? [4, 3, 2, 1, 0, 1, 2, 3, 4] : [0, 1, 2, 3, 4];
  return <span className={`mp-equalizer ${active ? 'is-playing' : ''} ${layout === 'mirrored' ? 'is-mirrored' : ''}`} style={tint ? { '--mp-tint': tint } as React.CSSProperties : undefined} aria-hidden="true">{bars.map((band, i) => <i key={i} style={{ animationDelay: `${band * -0.19}s` }}/>)}</span>;
}

function MusicFace({ state, dispatch }: Controls) {
  const track = TRACKS[state.music.index];
  const pick = track.pick && !state.music.added.includes(track.id) ? track.pick : null;
  if (state.music.source !== 'ready') return <div className="mp-empty">
    <Icon name={state.music.source === 'empty' ? 'music' : 'warning'} size={30}/>
    <p>{state.music.source === 'empty' ? 'A little room for music.' : 'Music is taking a moment.'}</p>
    <span>{state.music.source === 'empty' ? 'Start the sample playlist to see this face in motion.' : 'The sample player is unavailable. Try reconnecting.'}</span>
    <button className="mp-soft-button" onClick={() => dispatch(state.music.source === 'empty' ? { type: 'start-playlist' } : { type: 'music-state', source: 'ready' })}>{state.music.source === 'empty' ? 'Start sample playlist' : 'Reconnect sample player'}</button>
  </div>;
  // Play keeps the middle; the chosen controls fill out from it, left first.
  const slots = state.preferences.musicSlots;
  const half = Math.ceil(slots.length / 2);
  const leftSlots = slots.slice(0, half);
  const rightSlots = slots.slice(half);
  return <div className="mp-music">
    <div className="mp-track-row">
      <Artwork state={state}/>
      <div className="mp-track-meta">
        <h2 title={track.title}>{track.title}</h2>
        <p title={track.artist}>{pick && <span className="mp-pick" role="img" aria-label="Smart Shuffle pick" title={`A Smart Shuffle pick — not in ${pick} yet`}><Icon name="sparkle" size={11}/></span>}{track.artist}</p>
        <div className="mp-seek"><span>{time(state.music.position)}</span><input aria-label="Track position" aria-valuetext={`${time(state.music.position)} of ${time(track.duration)}`} type="range" min="0" max={track.duration} value={state.music.position} onChange={e => dispatch({ type: 'seek', position: Number(e.target.value) })}/><span>−{time(track.duration - state.music.position)}</span></div>
        <div className="mp-transport">
          {leftSlots.map(control => <SampleSlot key={control} control={control} state={state} dispatch={dispatch}/>)}
          <button className="mp-icon-button mp-play" aria-label={state.music.playing ? 'Pause sample music' : 'Play sample music'} onClick={() => dispatch({ type: 'play' })}><Icon name={state.music.playing ? 'pause' : 'play'} size={18}/></button>
          {rightSlots.map(control => <SampleSlot key={control} control={control} state={state} dispatch={dispatch}/>)}
        </div>
      </div>
      {pick && <div className="mp-track-actions">
        <button className="mp-icon-button mp-pick-button" aria-label="Not for me: skip this pick" title="Not for me" onClick={() => dispatch({ type: 'pick-dismiss' })}><Icon name="close" size={16}/></button>
        <button className="mp-icon-button mp-pick-button" aria-label={`Add to ${pick}`} title={`Add to ${pick}`} onClick={() => dispatch({ type: 'pick-add' })}><Icon name="plus" size={16}/></button>
      </div>}
    </div>
  </div>;
}

export function FileThumb({ file, small = false, sample = true }: { file: PreviewFile & { thumbnail?: string }; small?: boolean; sample?: boolean }) {
  return <span className={`mp-file-thumb mp-file-${file.kind} ${small ? 'small' : ''}`} aria-hidden="true">
    {file.thumbnail ? <img src={file.thumbnail} alt="" draggable={false}/> : file.kind === 'image' && sample ? <img src="./assets/landscape.svg" alt="" draggable={false}/> : file.kind === 'folder' ? <Icon name="folder" size={small ? 26 : 46}/> : <><Icon name="file" size={small ? 23 : 34}/><span>{file.kind === 'pdf' ? 'PDF' : 'MD'}</span></>}
    {file.unavailable && <span className="mp-file-missing">!</span>}
  </span>;
}
function beginDrag(e: DragEvent, dispatch: Dispatch<PreviewAction>, origin: 'finder' | 'tray', file: PreviewFile) {
  // Only our own local sample drag is accepted. Never turn a real OS file into a demo item.
  e.dataTransfer.setData('application/x-notchlight-sample', file.id);
  e.dataTransfer.effectAllowed = 'copy';
  dispatch({ type: 'drag-start', origin, id: file.id });
}
function TrayFace({ state, dispatch }: Controls) {
  return <div className={`mp-tray ${state.drag?.origin === 'finder' ? 'is-drop-target' : ''}`}>
    <div className="mp-tray-heading"><span>{state.drag?.origin === 'finder' ? 'Drop it here. Pick it up later.' : 'A place between places.'}</span><span>{state.files.length} {state.files.length === 1 ? 'item' : 'items'}</span></div>
    {state.files.length === 0 ? <div className="mp-empty mp-empty-tray"><Icon name="tray" size={32}/><p>Keep it here for a moment.</p><span>Drag a sample file up from Finder below.</span><button className="mp-soft-button" onClick={() => dispatch({ type: 'add', id: SAMPLE_FILES[0].id })}>Add a sample file</button></div> : <div className={`mp-file-grid ${state.preferences.thumbnails}`} aria-label="Files in Tray">
      {state.files.map(file => <div key={file.id} className={`mp-shelf-item ${state.selected === file.id ? 'is-selected' : ''}`}>
        <button className="mp-file-button" aria-label={`Select ${file.name}${file.unavailable ? ', unavailable' : ''}`} aria-pressed={state.selected === file.id}
          draggable={!file.unavailable} onDragStart={e => beginDrag(e, dispatch, 'tray', file)} onDragEnd={() => dispatch({ type: 'drag-end' })}
          onClick={() => dispatch({ type: 'select', id: file.id })}>
          <FileThumb file={file} small={state.preferences.thumbnails === 'small'}/><span title={file.name}>{file.name}</span><small>{file.unavailable ? 'Unavailable' : file.size}</small>
        </button>
        <button className="mp-remove" aria-label={`Remove ${file.name} from Tray`} onClick={() => dispatch({ type: 'remove', id: file.id })}><Icon name="close" size={12}/></button>
      </div>)}
    </div>}
    <div className="mp-tray-footer"><span>{state.selected ? state.files.find(f => f.id === state.selected)?.name : 'Drag out when you’re ready.'}</span><button className="mp-text-button" disabled={!state.selected || state.files.find(f => f.id === state.selected)?.unavailable} onClick={() => state.selected && dispatch({ type: 'take', id: state.selected })}>Take out <Icon name="arrow" size={13}/></button></div>
  </div>;
}

/** The sample clipboard: a few things one might have copied. Click copies nothing real. */
function ClipboardFace({ state, dispatch }: Controls) {
  const pins = state.clips.filter(c => c.pinned).length;
  const ordered = [...state.clips.filter(c => c.pinned), ...state.clips.filter(c => !c.pinned)];
  return <div className="mp-clip"><div className="mp-tray-heading"><span>{state.clips.length} {state.clips.length === 1 ? 'item' : 'items'}{pins ? ` · ${pins} pinned` : ''}</span><span>Sample history</span></div>
    {ordered.length > 4 && <label className="mp-clip-search"><Icon name="search" size={13}/><input type="search" placeholder="Filter" aria-label="Filter clipboard history" readOnly/></label>}
    {!ordered.length ? <div className="mp-empty mp-empty-tray"><Icon name="clipboard" size={32}/><p>Nothing copied yet.</p><span>Text and images you copy show up here. Passwords and one-time codes are skipped.</span></div>
    : <ul className="mp-clip-list" aria-label="Sample clipboard history">{ordered.map(item => <li key={item.id} className={`mp-clip-item ${item.pinned ? 'is-pinned' : ''}`}><button className="mp-clip-copy" onClick={() => dispatch({ type: 'clip-copy', id: item.id })}>{item.kind === 'image' && item.thumb ? <img className="mp-clip-thumb" src={item.thumb} alt="" draggable={false}/> : <span className="mp-clip-kind" aria-hidden="true">{item.kind === 'url' ? '@' : 'T'}</span>}<span className="mp-clip-text"><span>{item.preview}</span><small>{item.meta}</small></span></button><button className="mp-clip-pin" aria-label={item.pinned ? `Unpin ${item.preview}` : `Pin ${item.preview}`} aria-pressed={item.pinned} onClick={() => dispatch({ type: 'clip-pin', id: item.id })}><Icon name="pin" size={13}/></button><button className="mp-remove mp-clip-remove" aria-label={`Remove ${item.preview}`} onClick={() => dispatch({ type: 'clip-remove', id: item.id })}><Icon name="close" size={12}/></button></li>)}</ul>}
    <div className="mp-tray-footer"><span>Click an item to copy it again.</span>{ordered.length > 0 && <button className="mp-text-button" onClick={() => dispatch({ type: 'clip-clear' })}>Clear{pins ? ' unpinned' : ''}</button>}</div></div>;
}

/** Today, with the sample day. Reminders can be ticked; events cannot. */
/** One sample transport slot. Shuffle and repeat flip a sample flag and nothing else. */
function SampleSlot({ control, state, dispatch }: Controls & { control: MusicControl }) {
  const name = MUSIC_CONTROL_NAMES[control];
  if (control === 'previous' || control === 'next') {
    return <button className="mp-icon-button" aria-label={`${name} track`} onClick={() => dispatch({ type: 'skip', delta: control === 'next' ? 1 : -1 })}><Icon name={control === 'next' ? 'next' : 'back'} size={18}/></button>;
  }
  if (control === 'open') return <button className="mp-icon-button" aria-label="Open the sample player" title="Sample only" onClick={() => dispatch({ type: 'music-state', source: 'ready' })}><Icon name="launch" size={17}/></button>;
  const on = control === 'shuffle' ? state.music.shuffling : state.music.repeating;
  return <button className={`mp-icon-button mp-toggle ${on ? 'is-on' : ''}`} aria-pressed={on} aria-label={name} title={`${name} ${on ? 'on' : 'off'}`}
    onClick={() => dispatch({ type: 'music-toggle', control })}><Icon name={control} size={17}/></button>;
}

function TodayFace({ state, dispatch }: Controls) {
  const events = visibleEvents(state.today, state.preferences);
  const colorOf = (id: string) => SAMPLE_CALENDARS.find(c => c.id === id)?.color ?? '#8d8a84';
  const hidden = state.today.length - events.length;
  return <div className="mp-today">
    <div className="mp-tray-heading">
      <span>{events.length ? `${events.length} today` : 'Nothing today'}{hidden ? ` · ${hidden} hidden` : ''}</span>
      <button className="mp-text-button" onClick={() => dispatch({ type: 'today', today: [] })}>Clear the day</button>
    </div>
    <DayList events={events} colorOf={colorOf} full={state.preferences.fullEventTitles}
      onToggle={event => dispatch({ type: 'today', today: state.today.map(e => e.id === event.id ? { ...e, done: !e.done } : e) })}
      empty={<div className="mp-empty mp-empty-tray"><Icon name="today" size={32}/><p>{state.today.length ? 'Everything today is hidden.' : 'Nothing in the diary.'}</p><span>{state.today.length ? 'Some calendars are switched off, or all-day events are hidden.' : 'A clear day. Sample events return with Reset.'}</span></div>}/>
  </div>;
}

export function PreviewSurface({ state, dispatch, onCustomize, notchW = 190, notchH = 34 }: Controls & { onCustomize: () => void; notchW?: number; notchH?: number }) {
  const id = useId();
  const [filter,setFilter] = useState<AgentFilter>(state.codexConnection ? 'codex' : 'all');
  const [target,setTarget] = useState<string>();
  const pendingFocus = useRef(false);
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      document.getElementById(`${id}-${state.view}`)?.focus();
      pendingFocus.current = false;
    }
  }, [id, state.view]);
  const snap = previewAgents(state,notchW,notchH);
  const tabs = <Navigation state={state} attention={snap.overall === 'asking'} onNavigate={view => { pendingFocus.current = true; dispatch({ type: 'view', view }); }} onCustomize={onCustomize} id={id}/>;
  const playing = state.music.source === 'ready' && state.music.playing && state.preferences.visualizer;
  const prefs = state.preferences;
  const music = state.view === 'music';
  const clips = state.view === 'clipboard';
  const today = state.view === 'today';
  const shownToday = prefs.calendarEnabled ? visibleEvents(state.today, prefs) : [];
  const upNext = nextEvent(shownToday);
  const headLeft = music ? <Artwork state={state} mini/> : today ? <span className="mp-shelf-wing"><Icon name="today" size={17}/><span>{shownToday.length}</span></span> : clips ? <span className="mp-shelf-wing"><Icon name="clipboard" size={17}/><span>{state.clips.length}</span></span> : <span className="mp-shelf-wing"><Icon name="tray" size={17}/><span>{state.files.length}</span></span>;
  const headRight = <div className="mp-right-wing">
    {snap.overall === 'asking' && <button className="mp-attention-button" aria-label="Agents need attention" title="Agents need attention" onClick={() => dispatch({ type: 'view', view: 'agents' })}><span className="mp-attention-dot"/></button>}
    {music ? <Equalizer active={playing} layout={prefs.equalizerLayout} tint={prefs.artworkGlow && state.music.source === 'ready' ? SAMPLE_TINT : undefined}/> : today ? <Icon name="today" size={16}/> : clips ? <span className="mp-clip-kind" aria-hidden="true">T</span> : <Icon name="file" size={16}/>}
  </div>;
  const wing = (expanded: boolean) => <Wings notchW={notchW} height={notchH} width={expanded ? PANEL_W : undefined} left={<div className="mp-left-wing">{headLeft}</div>} right={headRight}/>;
  const hudLook: HudLook = { style: prefs.hudStyle, glow: prefs.hudGlow, percentage: prefs.hudPercentage };
  const hud = prefs.hudEnabled ? state.hud : null;
  const hudStrip = hud && prefs.hudOpenNotch ? <div className="mp-hud-strip"><HudBar kind={hud.kind} value={hud.value} muted={hud.muted} look={hudLook} wide/></div> : null;
  const nav = <>{hudStrip}{tabs}{state.view === 'agents' && <AgentFilters snapshot={snap} value={filter} onChange={f => {setFilter(f);setTarget(undefined);}}/>}{state.view === 'agents' && <AgentConnection snapshot={snap} filter={filter}/>}<AgentAttention sessions={snap.sessions} onSelect={s => {setFilter(providerOf(s));setTarget(s.id);dispatch({type:'view',view:'agents'});}}/></>;
  const agentParts = agentRestingParts(snap,prefs,p => {setFilter(p);dispatch({type:'view',view:'agents'});});
  const parts: RestingPart[] = [
    ...agentParts,
    ...(prefs.restMusic && state.music.source === 'ready' ? [{ left: <Artwork state={state} mini/>, right: <Equalizer active={playing} layout={prefs.equalizerLayout} tint={prefs.artworkGlow ? SAMPLE_TINT : undefined}/> }] : []),
    ...(prefs.restTray && state.files.length > 0 || state.drag?.origin === 'finder' ? [{ left: <span className="mp-shelf-wing"><Icon name="tray" size={17}/><span>{state.files.length}</span></span>, right: <Icon name="file" size={16}/> }] : []),
    ...(prefs.calendarEnabled && prefs.restToday && upNext ? [todayRestingPart(upNext, SAMPLE_CALENDARS.find(c => c.id === upNext.calendarId)?.color ?? '#8d8a84', Date.now())] : []),
    ...(prefs.batteryEnabled && prefs.restBattery && state.battery ? [batteryRestingPart(state.battery, prefs.batteryPercentage)] : []),
    ...(prefs.clipboardEnabled && prefs.restClipboard && state.clips.length > 0 ? [{ left: <span className="mp-shelf-wing"><Icon name="clipboard" size={17}/><span>{state.clips.length}</span></span>, right: <span className="mp-clip-kind" aria-hidden="true">{state.clips[0].kind === 'url' ? '@' : state.clips[0].kind === 'image' ? '▣' : 'T'}</span> }] : [])
  ];
  const attention = undefined;
  // The HUD answers a key press, so it takes the resting bar rather than joining it.
  const hudResting = !hud ? undefined
    : prefs.hudClosed === 'wide' ? <Wings notchW={notchW} height={notchH} width={PANEL_W} left={<div className="mp-left-wing"><Icon name={hud.kind === 'brightness' ? 'brightness' : hud.muted || hud.value === 0 ? 'mute' : 'volume'} size={17}/></div>} right={<div className="mp-right-wing"><HudBar kind={hud.kind} value={hud.value} muted={hud.muted} look={hudLook} wide/></div>}/>
    : <RestingWings notchW={notchW} height={notchH} parts={[hudRestingPart(hud, hudLook)]}/>;
  const resting = hudResting ?? (parts.length || attention ? <RestingWings notchW={notchW} height={notchH} parts={parts} attention={attention}/>
    : !prefs.restClaude && snap.sessions.length ? <Stubs snap={snap}/> : undefined);
  return <div className={`mp-surface ${state.preferences.density} ${state.preferences.reducedMotion ? 'mp-reduced-motion' : ''} ${!state.preferences.buddy ? 'mp-hide-buddy' : ''} ${!state.preferences.codexBuddy ? 'mp-hide-codex-buddy' : ''}`}
    onDragOver={e => { if (state.drag?.origin === 'finder') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dispatch({ type: 'drag-enter' }); } }}
    onDrop={e => { if (state.drag?.origin === 'finder') { e.preventDefault(); dispatch({ type: 'add', id: state.drag.id }); } }}>
    <Island snap={{ ...filteredSnapshot(snap,filter), sparkline: prefs.sparkline }} open={state.open} hovering
      onDismiss={id => dispatch(id.startsWith('codex:') ? {type:'codex',value:'off'} : {type:'claude',value:'idle'})}
      onDecide={id => dispatch(id.startsWith('codex:') ? {type:'codex',value:'done'} : {type:'claude',value:'done'})}
      surface={{ selectedSession:target,navigation: nav, active: true, panel: { id: `${id}-panel`, 'aria-labelledby': `${id}-${state.view}` },
        expanded: state.view === 'agents' ? undefined : <div style={{ width: PANEL_W }}>{wing(true)}{nav}<div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${state.view}`}>{music ? <MusicFace state={state} dispatch={dispatch}/> : today ? <TodayFace state={state} dispatch={dispatch}/> : clips ? <ClipboardFace state={state} dispatch={dispatch}/> : <TrayFace state={state} dispatch={dispatch}/>}</div></div>,
        collapsed: resting }}/>
  </div>;
}

export function MockFinder({ state, dispatch }: Controls) {
  return <section className="mp-finder" aria-label="Sample Finder">
    <div className="mp-finder-title"><span className="mp-traffic" aria-hidden="true"><i/><i/><i/></span><Icon name="folder" size={15}/><strong>Sample files</strong><span>Finder preview</span></div>
    <div className="mp-finder-body"><aside><span>Favorites</span><b><Icon name="folder" size={14}/> Desktop</b><span><Icon name="file" size={14}/> Documents</span></aside>
      <div className="mp-finder-files">{SAMPLE_FILES.map(file => <div key={file.id} className="mp-finder-file">
        <button draggable onDragStart={e => beginDrag(e, dispatch, 'finder', file)} onDragEnd={() => dispatch({ type: 'drag-end' })} onClick={() => dispatch({ type: 'add', id: file.id })} aria-label={`Add ${file.name} to Tray`} title={`Add ${file.name} to Tray`}><FileThumb file={file}/><span>{file.name}</span></button>
      </div>)}</div>
    </div>
    <div className={`mp-destination ${state.drag?.origin === 'tray' ? 'is-drop-target' : ''}`} aria-label="Sample destination"
      onDragOver={e => { if (state.drag?.origin === 'tray') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={e => { if (state.drag?.origin === 'tray') { e.preventDefault(); dispatch({ type: 'take', id: state.drag.id }); } }}>
      <Icon name={state.received.length ? 'check' : 'tray'} size={17}/><span>{state.received.length ? `Received ${state.received.length} sample ${state.received.length === 1 ? 'file' : 'files'}` : 'Drop files from Tray here'}</span>
      <small title={state.received.map(f => f.name).join(', ')}>{state.received.map(f => f.name).join(', ') || 'Sample destination'}</small>
    </div>
  </section>;
}

export function PreviewDesktop({ state, dispatch, onCustomize }: Controls & { onCustomize: () => void }) {
  return <div className="mp-preview-column">
    <div className="mp-preview-toolbar"><span><i/> Live preview</span><button className="mp-text-button" onClick={() => dispatch({ type: 'open', value: !state.open })}>{state.open ? 'Collapse notch' : 'Expand notch'}<Icon name="expand" size={14}/></button></div>
    <div className="mp-desktop">
      <div className="mp-menubar" aria-hidden="true"><span>Finder <b>File</b> <b>Edit</b> <b>View</b></span><span>Wed 9:41</span></div>
      <div className="mp-camera" style={{ width: 190, height: 34 }}/>
      <PreviewSurface state={state} dispatch={dispatch} onCustomize={onCustomize}/>
      <div className="mp-finder-position"><MockFinder state={state} dispatch={dispatch}/></div>
    </div>
    <p className="mp-preview-note">Your notch, a little more useful. <span>Sample data · no audio or real file transfers</span></p>
    <div className="mp-notice" role="status" aria-live="polite">{state.notice || 'Tip: drag a sample file to the notch, or click it to add.'}</div>
  </div>;
}

export function PreviewWalkthrough() {
  const { state, dispatch } = usePreview({...initialPreview(),codex:'working'});
  const customize = () => { if (window.notchlight) window.notchlight.openCustomize(); else window.open('./customize.html', '_blank'); };
  return <div className="mp-walkthrough"><div className="mp-walkthrough-intro"><span className="mp-kicker">The next chapter</span><h2>A little space.<br/>For more of your day.</h2><p>Follow your agents. Find your rhythm. Keep a file close. Three faces, one familiar place.</p><button className="mp-primary-button" onClick={customize}>Open customization <Icon name="arrow" size={16}/></button><small>Interactive design preview</small></div><PreviewDesktop state={state} dispatch={dispatch} onCustomize={customize}/></div>;
}

const scenarios: { name: string; note: string; patch: (s: PreviewState) => PreviewState; notchW?: number; notchH?: number }[] = [
  ...(['working','asking','done','failed','idle','interrupted','unknown','many'] as const).map(codex => ({name:`Codex · ${codex}`,note:'Local Codex identity and status, distinct from Claude.',patch:(s:PreviewState):PreviewState=>({...s,view:'agents',claude:'idle',codex})})),
  {name:'Codex · disconnected',note:'Missing local data leaves other faces available. Select Codex to see setup guidance.',patch:s=>({...s,view:'agents',claude:'idle',codex:'off',codexConnection:{state:'missing',message:'No readable Codex sessions folder. Choose your Codex home in Customize → Agents.',hooksSeen:false}})},
  {name:'Agents · empty',note:'No local work is running. Choose a provider to inspect its connection.',patch:s=>({...s,view:'agents',claude:'idle',codex:'off'})},
  {name:'Resting · identities without buddies',note:'Cl and Cx stay distinct when both buddies are hidden.',patch:s=>({...s,open:false,codex:'working',preferences:{...s.preferences,buddy:false,codexBuddy:false}})},
  {name:'Agents · both working',note:'Different providers, same project. Both remain identifiable.',patch:s=>({...s,view:'agents',codex:'working'})},
  {name:'Agents · simultaneous requests',note:'Each request belongs to one provider and one session.',patch:s=>({...s,view:'agents',claude:'asking',codex:'asking'})},
  {name:'Resting · both providers',note:'Claude and Codex have separate lights and buddies.',patch:s=>({...s,open:false,codex:'working'})},
  {name:'Resting · wide camera, many tasks',note:'Provider identities remain visible under width pressure.',notchW:280,patch:s=>({...s,open:false,codex:'many',claude:'many'})},
  {name:'Agents · reduced motion',note:'Expressions stay meaningful without animated status lights.',patch:s=>({...s,view:'agents',codex:'working',preferences:{...s.preferences,reducedMotion:true}})},
  { name: 'Music · playing', note: 'Artwork leads. Controls stay one glance away.', patch: s => s },
  { name: 'Music · mirrored bars', note: 'A/B: nine bars folded around the bass read as one shape.', patch: s => ({ ...s, preferences: { ...s.preferences, equalizerLayout: 'mirrored' } }) },
  { name: 'Music · no glow', note: 'A/B: plain black behind the artwork and bars.', patch: s => ({ ...s, preferences: { ...s.preferences, artworkGlow: false } }) },
  { name: 'Resting · mirrored bars', note: 'A/B: the folded shape on the collapsed bar.', patch: s => ({ ...s, open: false, preferences: { ...s.preferences, equalizerLayout: 'mirrored', restClaude: false, restTray: false } }) },
  { name: 'Music · paused', note: 'A quiet playback indicator; your place is preserved.', patch: s => ({ ...s, music: { ...s.music, playing: false } }) },
  { name: 'Music · nothing playing', note: 'A useful invitation, not an empty black box.', patch: s => ({ ...s, music: { ...s.music, source: 'empty' } }) },
  { name: 'Music · missing artwork', note: 'The music symbol holds the composition together.', patch: s => ({ ...s, music: { ...s.music, missingArtwork: true } }) },
  { name: 'Music · unavailable', note: 'Explain what happened and offer a way back.', patch: s => ({ ...s, music: { ...s.music, source: 'unavailable' } }) },
  { name: 'Music · long title, wider notch', note: 'A two-line title and a 240 × 38pt camera exclusion.', notchW: 240, notchH: 38, patch: s => ({ ...s, music: { ...s.music, index: 2 } }) },
  { name: 'Music · four controls', note: 'Play keeps the middle; shuffle and repeat fill out from it.', patch: s => ({ ...s, preferences: { ...s.preferences, musicSlots: ['shuffle', 'previous', 'next', 'repeat'] } }) },
  { name: 'Music · shuffle and repeat on', note: 'A lit toggle carries a dot, so the state survives a small icon.', patch: s => ({ ...s, music: { ...s.music, shuffling: true, repeating: true }, preferences: { ...s.preferences, musicSlots: ['shuffle', 'previous', 'next', 'repeat'] } }) },
  { name: 'Music · play alone', note: 'No slots at all. The seek bar and the scroll wheel still work.', patch: s => ({ ...s, preferences: { ...s.preferences, musicSlots: [] } }) },
  { name: 'Music · Smart Shuffle pick', note: 'A track Spotify slipped in: the mark by the artist, + keeps it, × moves on.', patch: s => ({ ...s, music: { ...s.music, index: 3 } }) },
  { name: 'Resting · everything on', note: 'Agent identities nearest the lens; Music and Tray use the outer space.', patch: s => ({ ...s, open: false }) },
  { name: 'Resting · music only', note: 'Album on the left. Playback on the right.', patch: s => ({ ...s, open: false, preferences: { ...s.preferences, restClaude: false, restTray: false } }) },
  { name: 'Resting · Claude and music', note: 'Two faces share the bar without crowding it.', patch: s => ({ ...s, open: false, preferences: { ...s.preferences, restTray: false } }) },
  { name: 'Resting · Claude hidden, needs you', note: 'A hidden face still gets a word in when it must.', patch: s => ({ ...s, open: false, claude: 'asking', preferences: { ...s.preferences, restClaude: false, restTray: false } }) },
  { name: 'HUD · volume', note: 'The key press takes the resting bar; nothing else shares it.', patch: s => ({ ...s, open: false, hud: HUD_SAMPLES[0].hud, preferences: { ...s.preferences, hudEnabled: true } }) },
  { name: 'HUD · all the way up', note: 'A full bar still reads as a bar, not as a block.', patch: s => ({ ...s, open: false, hud: HUD_SAMPLES[1].hud, preferences: { ...s.preferences, hudEnabled: true } }) },
  { name: 'HUD · muted', note: 'The slashed speaker, and a track with nothing in it.', patch: s => ({ ...s, open: false, hud: HUD_SAMPLES[2].hud, preferences: { ...s.preferences, hudEnabled: true } }) },
  { name: 'HUD · brightness with the number', note: 'A/B: the level spelled out beside the bar.', patch: s => ({ ...s, open: false, hud: HUD_SAMPLES[3].hud, preferences: { ...s.preferences, hudEnabled: true, hudPercentage: true } }) },
  { name: 'HUD · gradient, no glow', note: 'A/B: the bar ramps across itself and sits flat.', patch: s => ({ ...s, open: false, hud: HUD_SAMPLES[3].hud, preferences: { ...s.preferences, hudEnabled: true, hudStyle: 'gradient', hudGlow: false } }) },
  { name: 'HUD · nearly off', note: 'Five percent has to be visible, or the key feels dead.', patch: s => ({ ...s, open: false, hud: HUD_SAMPLES[4].hud, preferences: { ...s.preferences, hudEnabled: true } }) },
  { name: 'HUD · wide bar', note: 'A/B: one press takes the full panel width instead of the wings.', patch: s => ({ ...s, open: false, hud: HUD_SAMPLES[0].hud, preferences: { ...s.preferences, hudEnabled: true, hudClosed: 'wide' } }) },
  { name: 'HUD · open notch', note: 'Above the tabs, whichever face you were on.', patch: s => ({ ...s, open: true, hud: HUD_SAMPLES[3].hud, preferences: { ...s.preferences, hudEnabled: true } }) },
  { name: 'Today · the day', note: 'The whole day in order, scrolled to the next thing. What is behind you is dimmed, not removed.', patch: s => ({ ...s, view: 'today', open: true, preferences: { ...s.preferences, calendarEnabled: true } }) },
  { name: 'Today · full titles', note: 'A/B: long titles wrap to two lines instead of ending in an ellipsis.', patch: s => ({ ...s, view: 'today', open: true, preferences: { ...s.preferences, calendarEnabled: true, fullEventTitles: true } }) },
  { name: 'Today · all-day hidden', note: 'A/B: the birthday goes, the count says how many are hidden.', patch: s => ({ ...s, view: 'today', open: true, preferences: { ...s.preferences, calendarEnabled: true, hideAllDay: true } }) },
  { name: 'Today · one calendar off', note: 'Home is switched off; Work and Reminders stay.', patch: s => ({ ...s, view: 'today', open: true, preferences: { ...s.preferences, calendarEnabled: true, calendarHidden: ['home'] } }) },
  { name: 'Today · a clear day', note: 'An empty diary is an answer, not an error state.', patch: s => ({ ...s, view: 'today', open: true, today: [], preferences: { ...s.preferences, calendarEnabled: true } }) },
  { name: 'Today · everything hidden', note: 'A day with things in it and nothing showing says which rule did it.', patch: s => ({ ...s, view: 'today', open: true, preferences: { ...s.preferences, calendarEnabled: true, calendarHidden: ['work', 'home', 'later'] } }) },
  { name: 'Today · on the resting bar', note: 'The next thing, and how long until it.', patch: s => ({ ...s, open: false, preferences: { ...s.preferences, calendarEnabled: true, restClaude: false, restMusic: false, restTray: false } }) },
  { name: 'Battery · on the resting bar', note: 'A level is a length; the number beside it is optional.', patch: s => ({ ...s, open: false, battery: BATTERY_SAMPLES[0].battery, preferences: { ...s.preferences, batteryEnabled: true, restClaude: false, restMusic: false, restTray: false } }) },
  { name: 'Battery · charging', note: 'A bolt through the level, and green rather than ivory.', patch: s => ({ ...s, open: false, battery: BATTERY_SAMPLES[1].battery, preferences: { ...s.preferences, batteryEnabled: true, restClaude: false, restMusic: false, restTray: false } }) },
  { name: 'Battery · low', note: 'Amber is the one state meant to catch the corner of your eye.', patch: s => ({ ...s, open: false, battery: BATTERY_SAMPLES[3].battery, preferences: { ...s.preferences, batteryEnabled: true, restClaude: false, restMusic: false, restTray: false } }) },
  { name: 'Battery · nearly flat', note: 'Four percent still reads as a battery, not an empty box.', patch: s => ({ ...s, open: false, battery: BATTERY_SAMPLES[4].battery, preferences: { ...s.preferences, batteryEnabled: true, restClaude: false, restMusic: false, restTray: false } }) },
  { name: 'Battery · beside the other faces', note: 'It takes the outer space, like Music and Tray.', patch: s => ({ ...s, open: false, battery: BATTERY_SAMPLES[0].battery, preferences: { ...s.preferences, batteryEnabled: true } }) },
  { name: 'Tray · empty', note: 'A clear target for the next thing you pick up.', patch: s => ({ ...s, view: 'tray', files: [] }) },
  { name: 'Tray · populated', note: 'Recognizable thumbnails, readable names.', patch: s => ({ ...s, view: 'tray' }) },
  { name: 'Tray · selected', note: 'Select a file, then take it out with the keyboard.', patch: s => ({ ...s, view: 'tray', selected: 'brief' }) },
  { name: 'Tray · drag over', note: 'A sample drag temporarily reveals the shelf.', patch: s => ({ ...s, view: 'tray', drag: { origin: 'finder', id: 'assets', previousView: 'music', previousOpen: true } }) },
  { name: 'Tray · overflow', note: 'A bounded shelf scrolls; filenames never widen it.', patch: s => ({ ...s, view: 'tray', files: Array.from({ length: 12 }, (_, i) => ({ ...SAMPLE_FILES[i % 4], id: `overflow-${i}` })) }) },
  { name: 'Tray · unavailable file', note: 'Keep the filename and a safe removal action.', patch: s => ({ ...s, view: 'tray', files: [{ ...SAMPLE_FILES[1], unavailable: true }], selected: 'brief' }) },
  { name: 'Resting · tray only', note: 'A small stack, a count, and nothing under the lens.', patch: s => ({ ...s, view: 'tray', open: false, preferences: { ...s.preferences, restClaude: false, restMusic: false } }) },
  { name: 'Clipboard · history', note: 'Newest first, pins on top. Click copies it back.', patch: s => ({ ...s, view: 'clipboard', preferences: { ...s.preferences, clipboardEnabled: true } }) },
  { name: 'Clipboard · empty', note: 'Opt-in, and honest about what is skipped.', patch: s => ({ ...s, view: 'clipboard', clips: [], preferences: { ...s.preferences, clipboardEnabled: true } }) },
  { name: 'Resting · clipboard count', note: 'A count and the kind of the latest item, out at the edge.', patch: s => ({ ...s, open: false, preferences: { ...s.preferences, clipboardEnabled: true, restClaude: false, restMusic: false, restTray: false } }) },
  { name: 'Claude · needs you', note: 'Attention stays visible without changing your tab.', patch: s => ({ ...s, claude: 'asking' }) },
  ...(['working', 'asking', 'done', 'idle', 'many'] as const).map(claude => ({ name: `Claude · ${claude}`, note: 'The existing Claude face inside shared navigation.', patch: (s: PreviewState): PreviewState => ({ ...s, view: 'agents', claude }) }))
];
function Scenario({ scenario }: { scenario: typeof scenarios[number] }) {
  const { state, dispatch } = usePreview(scenario.patch(initialPreview()), false);
  return <article className="mp-scenario"><div className="mp-scenario-screen"><PreviewSurface state={state} dispatch={dispatch} notchW={scenario.notchW} notchH={scenario.notchH} onCustomize={() => window.notchlight ? window.notchlight.openCustomize() : window.open('./customize.html', '_blank')}/></div><h3>{scenario.name}</h3><p>{scenario.note}</p></article>;
}
export function PreviewGallery() {
  return <section className="mp-gallery"><PreviewWalkthrough/><div className="agent-buddy-sheet" aria-label="Codex robot expressions">{(['working','thinking','asking','done','failed','idle','approved'] as const).map(face => <figure key={face}><Buddy provider="codex" face={face} size={44}/><figcaption>{face}</figcaption></figure>)}</div><div className="agent-buddy-sheet" aria-label="Both buddies at every supported size">{[18,22,24,44].map(size => <figure key={size}><span style={{display:'flex',gap:10,alignItems:'flex-end'}}><Buddy size={size}/><Buddy provider="codex" size={size}/></span><figcaption>{size}pt</figcaption></figure>)}</div><div className="mp-gallery-heading"><h2>Every new face.</h2><p>Fixed sample states. Real components. Try the controls.</p></div><div className="mp-scenario-grid">{scenarios.map(s => <Scenario key={s.name} scenario={s}/>)}</div></section>;
}
