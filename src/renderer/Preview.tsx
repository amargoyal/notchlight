import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type Dispatch, type DragEvent, type ReactNode } from 'react';
import { Island, Stubs, Wings } from './IslandView';
import { Buddy } from './Buddy';
import { PANEL_W } from './theme';
import { initialPreview, previewReducer, previewAgents, SAMPLE_FILES, TRACKS,
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
    warning: <><path d="m12 3 10 18H2ZM12 9v5"/><path d="M12 17h.01"/></>
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
const viewNames: Record<PreviewView, string> = { agents: 'Agents', music: 'Music', tray: 'Tray' };
const views: PreviewView[] = ['agents', 'music', 'tray'];
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function Navigation({ state, onNavigate, onCustomize, id, attention }: { state: PreviewState; onNavigate: (view: PreviewView) => void; onCustomize: () => void; id: string; attention: boolean }) {
  return <nav className="mp-nav" aria-label="Notch views">
    <div role="tablist" aria-label="Preview view">
      {views.map((view, index) => <button key={view} role="tab" id={`${id}-${view}`} aria-controls={`${id}-panel`}
        aria-selected={state.view === view} tabIndex={state.view === view ? 0 : -1}
        onClick={() => onNavigate(view)}
        onKeyDown={e => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
          onNavigate(views[next]);
        }}>
        {view === 'agents' ? <span className="mp-mini-buddy"><Buddy size={15} /></span> : <Icon name={view} size={14}/>}
        {viewNames[view]}
        {view === 'agents' && attention && <span className="mp-attention-dot" aria-label="Needs your attention"/>}
        {view === 'tray' && <span className="mp-count">{state.files.length}</span>}
      </button>)}
    </div>
    <button className="mp-icon-button" aria-label="Open customization" title="Customize Notchlight" onClick={onCustomize}><Icon name="settings" size={16}/></button>
  </nav>;
}

function Artwork({ state, mini = false }: { state: PreviewState; mini?: boolean }) {
  const track = TRACKS[state.music.index];
  return <div className={`mp-artwork ${mini ? 'mp-artwork-mini' : ''}`}>
    {state.preferences.artwork && !state.music.missingArtwork && track.artwork
      ? <img src={track.artwork} alt={mini ? '' : `${track.album} — sample artwork`} draggable={false}/>
      : <Icon name="music" size={mini ? 14 : 34}/>}
  </div>;
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
function Equalizer({ active }: { active: boolean }) {
  return <span className={`mp-equalizer ${active ? 'is-playing' : ''}`} aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} style={{ animationDelay: `${i * -0.19}s` }}/>)}</span>;
}

function MusicFace({ state, dispatch }: Controls) {
  const track = TRACKS[state.music.index];
  if (state.music.source !== 'ready') return <div className="mp-empty">
    <Icon name={state.music.source === 'empty' ? 'music' : 'warning'} size={30}/>
    <p>{state.music.source === 'empty' ? 'A little room for music.' : 'Music is taking a moment.'}</p>
    <span>{state.music.source === 'empty' ? 'Start the sample playlist to see this face in motion.' : 'The sample player is unavailable. Try reconnecting.'}</span>
    <button className="mp-soft-button" onClick={() => dispatch(state.music.source === 'empty' ? { type: 'start-playlist' } : { type: 'music-state', source: 'ready' })}>{state.music.source === 'empty' ? 'Start sample playlist' : 'Reconnect sample player'}</button>
  </div>;
  return <div className="mp-music">
    <div className="mp-track-row">
      <Artwork state={state}/>
      <div className="mp-track-meta">
        <h2 title={track.title}>{track.title}</h2>
        <p title={track.artist}>{track.artist}</p>
        <div className="mp-seek"><span>{time(state.music.position)}</span><input aria-label="Track position" aria-valuetext={`${time(state.music.position)} of ${time(track.duration)}`} type="range" min="0" max={track.duration} value={state.music.position} onChange={e => dispatch({ type: 'seek', position: Number(e.target.value) })}/><span>−{time(track.duration - state.music.position)}</span></div>
        <div className="mp-transport">
          <button className="mp-icon-button" aria-label="Previous track" onClick={() => dispatch({ type: 'skip', delta: -1 })}><Icon name="back" size={18}/></button>
          <button className="mp-icon-button mp-play" aria-label={state.music.playing ? 'Pause sample music' : 'Play sample music'} onClick={() => dispatch({ type: 'play' })}><Icon name={state.music.playing ? 'pause' : 'play'} size={18}/></button>
          <button className="mp-icon-button" aria-label="Next track" onClick={() => dispatch({ type: 'skip', delta: 1 })}><Icon name="next" size={18}/></button>
        </div>
      </div>
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
  const music = state.view === 'music';
  const headLeft = music ? <Artwork state={state} mini/> : <span className="mp-shelf-wing"><Icon name="tray" size={17}/><span>{state.files.length}</span></span>;
  const headRight = <div className="mp-right-wing">
    {snap.overall === 'asking' && <button className="mp-attention-button" aria-label="Agents need attention" title="Agents need attention" onClick={() => dispatch({ type: 'view', view: 'agents' })}><span className="mp-attention-dot"/></button>}
    {music ? <Equalizer active={playing}/> : <Icon name="file" size={16}/>}
  </div>;
  const wing = (expanded: boolean) => <Wings notchW={notchW} height={notchH} width={expanded ? PANEL_W : undefined} left={<div className="mp-left-wing">{headLeft}</div>} right={headRight}/>;
  const nav = <>{tabs}{state.view === 'agents' && <AgentFilters snapshot={snap} value={filter} onChange={f => {setFilter(f);setTarget(undefined);}}/>}{state.view === 'agents' && <AgentConnection snapshot={snap} filter={filter}/>}<AgentAttention sessions={snap.sessions} onSelect={s => {setFilter(providerOf(s));setTarget(s.id);dispatch({type:'view',view:'agents'});}}/></>;
  const prefs = state.preferences;
  const agentParts = agentRestingParts(snap,prefs,p => {setFilter(p);dispatch({type:'view',view:'agents'});});
  const parts: RestingPart[] = [
    ...agentParts,
    ...(prefs.restMusic && state.music.source === 'ready' ? [{ left: <Artwork state={state} mini/>, right: <Equalizer active={playing}/> }] : []),
    ...(prefs.restTray && state.files.length > 0 || state.drag?.origin === 'finder' ? [{ left: <span className="mp-shelf-wing"><Icon name="tray" size={17}/><span>{state.files.length}</span></span>, right: <Icon name="file" size={16}/> }] : [])
  ];
  const attention = undefined;
  const resting = parts.length || attention ? <RestingWings notchW={notchW} height={notchH} parts={parts} attention={attention}/>
    : !prefs.restClaude && snap.sessions.length ? <Stubs snap={snap}/> : undefined;
  return <div className={`mp-surface ${state.preferences.density} ${state.preferences.reducedMotion ? 'mp-reduced-motion' : ''} ${!state.preferences.buddy ? 'mp-hide-buddy' : ''} ${!state.preferences.codexBuddy ? 'mp-hide-codex-buddy' : ''}`}
    onDragOver={e => { if (state.drag?.origin === 'finder') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dispatch({ type: 'drag-enter' }); } }}
    onDrop={e => { if (state.drag?.origin === 'finder') { e.preventDefault(); dispatch({ type: 'add', id: state.drag.id }); } }}>
    <Island snap={filteredSnapshot(snap,filter)} open={state.open} hovering
      onDismiss={id => dispatch(id.startsWith('codex:') ? {type:'codex',value:'off'} : {type:'claude',value:'idle'})}
      onDecide={id => dispatch(id.startsWith('codex:') ? {type:'codex',value:'done'} : {type:'claude',value:'done'})}
      surface={{ selectedSession:target,navigation: nav, active: true, panel: { id: `${id}-panel`, 'aria-labelledby': `${id}-${state.view}` },
        expanded: state.view === 'agents' ? undefined : <div style={{ width: PANEL_W }}>{wing(true)}{nav}<div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${state.view}`}>{music ? <MusicFace state={state} dispatch={dispatch}/> : <TrayFace state={state} dispatch={dispatch}/>}</div></div>,
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
  { name: 'Music · paused', note: 'A quiet playback indicator; your place is preserved.', patch: s => ({ ...s, music: { ...s.music, playing: false } }) },
  { name: 'Music · nothing playing', note: 'A useful invitation, not an empty black box.', patch: s => ({ ...s, music: { ...s.music, source: 'empty' } }) },
  { name: 'Music · missing artwork', note: 'The music symbol holds the composition together.', patch: s => ({ ...s, music: { ...s.music, missingArtwork: true } }) },
  { name: 'Music · unavailable', note: 'Explain what happened and offer a way back.', patch: s => ({ ...s, music: { ...s.music, source: 'unavailable' } }) },
  { name: 'Music · long title, wider notch', note: 'A two-line title and a 240 × 38pt camera exclusion.', notchW: 240, notchH: 38, patch: s => ({ ...s, music: { ...s.music, index: 2 } }) },
  { name: 'Resting · everything on', note: 'Agent identities nearest the lens; Music and Tray use the outer space.', patch: s => ({ ...s, open: false }) },
  { name: 'Resting · music only', note: 'Album on the left. Playback on the right.', patch: s => ({ ...s, open: false, preferences: { ...s.preferences, restClaude: false, restTray: false } }) },
  { name: 'Resting · Claude and music', note: 'Two faces share the bar without crowding it.', patch: s => ({ ...s, open: false, preferences: { ...s.preferences, restTray: false } }) },
  { name: 'Resting · Claude hidden, needs you', note: 'A hidden face still gets a word in when it must.', patch: s => ({ ...s, open: false, claude: 'asking', preferences: { ...s.preferences, restClaude: false, restTray: false } }) },
  { name: 'Tray · empty', note: 'A clear target for the next thing you pick up.', patch: s => ({ ...s, view: 'tray', files: [] }) },
  { name: 'Tray · populated', note: 'Recognizable thumbnails, readable names.', patch: s => ({ ...s, view: 'tray' }) },
  { name: 'Tray · selected', note: 'Select a file, then take it out with the keyboard.', patch: s => ({ ...s, view: 'tray', selected: 'brief' }) },
  { name: 'Tray · drag over', note: 'A sample drag temporarily reveals the shelf.', patch: s => ({ ...s, view: 'tray', drag: { origin: 'finder', id: 'assets', previousView: 'music', previousOpen: true } }) },
  { name: 'Tray · overflow', note: 'A bounded shelf scrolls; filenames never widen it.', patch: s => ({ ...s, view: 'tray', files: Array.from({ length: 12 }, (_, i) => ({ ...SAMPLE_FILES[i % 4], id: `overflow-${i}` })) }) },
  { name: 'Tray · unavailable file', note: 'Keep the filename and a safe removal action.', patch: s => ({ ...s, view: 'tray', files: [{ ...SAMPLE_FILES[1], unavailable: true }], selected: 'brief' }) },
  { name: 'Resting · tray only', note: 'A small stack, a count, and nothing under the lens.', patch: s => ({ ...s, view: 'tray', open: false, preferences: { ...s.preferences, restClaude: false, restMusic: false } }) },
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
