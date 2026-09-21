import type { Snapshot, Status } from '../shared/types';

export type PreviewView = 'agents' | 'music' | 'tray' | 'clipboard';
export interface PreviewPreferences {
  theme: 'system' | 'light' | 'dark';
  density: 'compact' | 'comfortable';
  reducedMotion: boolean;
  buddy: boolean;
  pulse: boolean;
  artwork: boolean;
  visualizer: boolean;
  thumbnails: 'small' | 'large';
  removeAfterTransfer: boolean;
  restClaude: boolean;
  restCodex: boolean;
  codexBuddy: boolean;
  codexPulse: boolean;
  restMusic: boolean;
  restTray: boolean;
  clipboardEnabled: boolean;
  clipboardHistorySize: '20' | '50' | '100';
  restClipboard: boolean;
  musicPlayer: 'spotify' | 'apple' | 'auto';
  equalizerLayout: 'rising' | 'mirrored';
  artworkGlow: boolean;
  artworkPulse: boolean;
  sparkline: boolean;
  spotifyClientId: string;
  smartShuffle: boolean;
  hudEnabled: boolean;
  hudOptionKey: 'settings' | 'replace';
  hudStyle: 'solid' | 'gradient';
  hudGlow: boolean;
  hudPercentage: boolean;
  hudOpenNotch: boolean;
  hudClosed: 'inline' | 'wide';
  batteryEnabled: boolean;
  restBattery: boolean;
  batteryPercentage: boolean;
  batteryAlerts: boolean;
}
export interface PreviewClip { id: string; kind: 'text' | 'url' | 'image'; preview: string; meta: string; pinned: boolean; thumb?: string }
export interface PreviewTrack { id: string; title: string; artist: string; album: string; duration: number; artwork?: string; /** A Smart Shuffle pick, and the playlist it is not in yet. */ pick?: string }
export interface PreviewFile { id: string; name: string; kind: 'image' | 'pdf' | 'folder' | 'text'; size: string; unavailable?: boolean }
export interface PreviewState {
  codexConnection?: Snapshot['codex'];
  view: PreviewView;
  open: boolean;
  preferences: PreviewPreferences;
  music: { index: number; position: number; playing: boolean; source: 'ready' | 'empty' | 'unavailable'; missingArtwork: boolean; /** Picks the + has already added, by track id. */ added: string[] };
  files: PreviewFile[];
  clips: PreviewClip[];
  selected: string | null;
  received: PreviewFile[];
  drag: { origin: 'finder' | 'tray'; id: string; previousView: PreviewView; previousOpen: boolean } | null;
  notice: string;
  /** The key press the sample notch is answering, or nothing. */
  hud: PreviewHud | null;
  /** What the sample battery reads, or nothing on a Mac without one. */
  battery: PreviewBattery | null;
  codex: 'off' | Status | 'many';
  claude: 'working' | 'asking' | 'done' | 'idle' | 'many';
}
export const DEFAULT_PREFERENCES: PreviewPreferences = {
  theme: 'system', density: 'comfortable', reducedMotion: false, buddy: true, pulse: true,
  artwork: true, visualizer: true, thumbnails: 'large', removeAfterTransfer: true,
  restClaude: true, restCodex: true, codexBuddy: true, codexPulse: true, restMusic: true, restTray: true,
  clipboardEnabled: false, clipboardHistorySize: '50', restClipboard: true,
  musicPlayer: 'spotify', equalizerLayout: 'rising', artworkGlow: true, artworkPulse: true, sparkline: false, spotifyClientId: '', smartShuffle: true,
  hudEnabled: false, hudOptionKey: 'settings', hudStyle: 'solid', hudGlow: true, hudPercentage: false, hudOpenNotch: true, hudClosed: 'inline',
  batteryEnabled: false, restBattery: true, batteryPercentage: true, batteryAlerts: true
};
/** The battery, as the sample notch shows it. */
export interface PreviewBattery { percent: number; charging: boolean; plugged: boolean; low: boolean }
/**
 * The readings worth looking at: a comfortable level, the charger in, the last
 * of it going, and a level low enough to test that a nearly empty shell still
 * reads as a battery rather than an empty box.
 */
export const BATTERY_SAMPLES: { id: string; label: string; battery: PreviewBattery }[] = [
  { id: 'half', label: 'Half full', battery: { percent: 0.62, charging: false, plugged: false, low: false } },
  { id: 'charging', label: 'On the charger', battery: { percent: 0.41, charging: true, plugged: true, low: false } },
  { id: 'full', label: 'Fully charged', battery: { percent: 1, charging: false, plugged: true, low: false } },
  { id: 'low', label: 'Low', battery: { percent: 0.18, charging: false, plugged: false, low: true } },
  { id: 'critical', label: 'Nearly flat', battery: { percent: 0.04, charging: false, plugged: false, low: true } }
];
/** One key press, as the sample notch shows it. */
export interface PreviewHud { kind: 'volume' | 'brightness'; value: number; muted: boolean }
/**
 * The HUD states worth looking at: the ordinary one, both ends of the bar, mute,
 * and a level low enough to test that a nearly empty bar still reads.
 */
export const HUD_SAMPLES: { id: string; label: string; hud: PreviewHud }[] = [
  { id: 'volume', label: 'Volume, half way', hud: { kind: 'volume', value: 0.44, muted: false } },
  { id: 'volume-full', label: 'Volume, all the way up', hud: { kind: 'volume', value: 1, muted: false } },
  { id: 'volume-muted', label: 'Volume, muted', hud: { kind: 'volume', value: 0, muted: true } },
  { id: 'brightness', label: 'Brightness', hud: { kind: 'brightness', value: 0.71, muted: false } },
  { id: 'brightness-low', label: 'Brightness, nearly off', hud: { kind: 'brightness', value: 0.05, muted: false } }
];
export const SAMPLE_CLIPS: PreviewClip[] = [
  { id: 'clip-url', kind: 'url', preview: 'https://developer.apple.com/documentation/coreaudio', meta: 'developer.apple.com · 2m', pinned: false },
  { id: 'clip-cmd', kind: 'text', preview: 'npm run service:restart', meta: '23 chars · 9m', pinned: true },
  { id: 'clip-shot', kind: 'image', preview: '1512×982 image', meta: '312 KB · 18m', pinned: false, thumb: './assets/landscape.svg' },
  { id: 'clip-note', kind: 'text', preview: 'Bars follow the resting face; capture stays with what is showing.', meta: '2 lines · 41m', pinned: false },
  { id: 'clip-hex', kind: 'text', preview: '#d9c4a6', meta: '7 chars · 1h', pinned: false },
  { id: 'clip-path', kind: 'text', preview: '~/.notchlight/island.log', meta: '24 chars · 3h', pinned: false }
];
export const TRACKS: PreviewTrack[] = [
  { id: 'late-light', title: 'Late Light', artist: 'The Quiet Hours', album: 'Somewhere, Slowly', duration: 234, artwork: './assets/late-light.svg' },
  { id: 'blue-room', title: 'Blue Room', artist: 'Soft Signal', album: 'After the Rain', duration: 198, artwork: './assets/blue-room.svg' },
  { id: 'long-way', title: 'The long way home, through the hills and past the sleeping city', artist: 'The Quiet Hours & Friends', album: 'Somewhere, Slowly', duration: 267, artwork: './assets/late-light.svg' },
  { id: 'glass-hours', title: 'Glass Hours', artist: 'Night Ferry', album: 'Harbour Lights', duration: 212, artwork: './assets/blue-room.svg', pick: 'Late Drives' }
];
export const SAMPLE_FILES: PreviewFile[] = [
  { id: 'coast', name: 'Coast.jpg', kind: 'image', size: '2.4 MB' },
  { id: 'brief', name: 'Project brief.pdf', kind: 'pdf', size: '184 KB' },
  { id: 'assets', name: 'Brand assets', kind: 'folder', size: '8 items' },
  { id: 'notes', name: 'Notes for the next iteration and final handoff.md', kind: 'text', size: '4 KB' }
];
export function initialPreview(): PreviewState {
  return { view: 'music', open: true, preferences: { ...DEFAULT_PREFERENCES },
    music: { index: 0, position: 72, playing: true, source: 'ready', missingArtwork: false, added: [] },
    files: SAMPLE_FILES.slice(0, 2), clips: SAMPLE_CLIPS, selected: null, received: [], drag: null, notice: '', hud: null, battery: BATTERY_SAMPLES[0].battery, codex: 'off', claude: 'working' };
}
export type PreviewAction =
  | { type: 'view'; view: PreviewView } | { type: 'open'; value: boolean }
  | { type: 'preferences'; patch: Partial<PreviewPreferences> } | { type: 'reset' }
  | { type: 'start-playlist' } | { type: 'play' } | { type: 'skip'; delta: number } | { type: 'seek'; position: number } | { type: 'tick' }
  | { type: 'music-state'; source: PreviewState['music']['source']; missingArtwork?: boolean }
  | { type: 'pick-add' } | { type: 'pick-dismiss' }
  | { type: 'hud'; hud: PreviewHud | null }
  | { type: 'battery'; battery: PreviewBattery | null }
  | { type: 'codex'; value: PreviewState['codex'] }
  | { type: 'claude'; value: PreviewState['claude'] }
  | { type: 'add'; id: string } | { type: 'remove'; id: string } | { type: 'select'; id: string }
  | { type: 'take'; id: string } | { type: 'files'; files: PreviewFile[] }
  | { type: 'drag-start'; origin: 'finder' | 'tray'; id: string } | { type: 'drag-enter' } | { type: 'drag-end' }
  | { type: 'clip-copy'; id: string } | { type: 'clip-pin'; id: string } | { type: 'clip-remove'; id: string } | { type: 'clip-clear' };

export function previewReducer(s: PreviewState, a: PreviewAction): PreviewState {
  switch (a.type) {
    case 'reset': return initialPreview();
    case 'view': return { ...s, view: a.view, open: true };
    case 'open': return { ...s, open: a.value };
    case 'preferences': return { ...s, preferences: { ...s.preferences, ...a.patch } };
    case 'hud': return { ...s, hud: a.hud };
    case 'battery': return { ...s, battery: a.battery };
    case 'codex': return { ...s, codex: a.value };
    case 'claude': return { ...s, claude: a.value };
    case 'music-state': return { ...s, music: { ...s.music, source: a.source, missingArtwork: !!a.missingArtwork } };
    case 'pick-add': return { ...s, music: { ...s.music, added: [...s.music.added, TRACKS[s.music.index].id] }, notice: `Added to ${TRACKS[s.music.index].pick ?? 'the playlist'}.` };
    case 'pick-dismiss': return previewReducer(s, { type: 'skip', delta: 1 });
    case 'start-playlist': return { ...s, music: { ...s.music, source: 'ready', playing: true } };
    case 'play': return s.music.source !== 'ready' ? s : { ...s, music: { ...s.music, playing: !s.music.playing } };
    case 'skip': return s.music.source !== 'ready' ? s : { ...s, music: { ...s.music, index: (s.music.index + a.delta + TRACKS.length) % TRACKS.length, position: 0 } };
    case 'seek': return Number.isFinite(a.position) && s.music.source === 'ready' ? { ...s, music: { ...s.music, position: Math.min(TRACKS[s.music.index].duration, Math.max(0, a.position)) } } : s;
    case 'tick': {
      if (!s.music.playing || s.music.source !== 'ready') return s;
      return s.music.position + 1 >= TRACKS[s.music.index].duration
        ? previewReducer(s, { type: 'skip', delta: 1 }) : { ...s, music: { ...s.music, position: s.music.position + 1 } };
    }
    case 'files': return { ...s, files: a.files, selected: null };
    case 'select': return { ...s, selected: a.id };
    case 'add': {
      const file = SAMPLE_FILES.find(f => f.id === a.id);
      if (!file) return s;
      return { ...s, files: s.files.some(f => f.id === a.id) ? s.files : [...s.files, file],
        drag: null, view: 'tray', open: true, notice: s.files.some(f => f.id === a.id) ? `${file.name} is already in Tray.` : `${file.name} added to Tray.` };
    }
    case 'remove': return { ...s, files: s.files.filter(f => f.id !== a.id), selected: s.selected === a.id ? null : s.selected, notice: 'Removed from the sample tray.' };
    case 'take': {
      const file = s.files.find(f => f.id === a.id);
      if (!file || file.unavailable) return { ...s, notice: 'This sample file is unavailable. Remove it from Tray.' };
      return { ...s, files: s.preferences.removeAfterTransfer ? s.files.filter(f => f.id !== a.id) : s.files,
        received: s.received.some(f => f.id === a.id) ? s.received : [...s.received, file], selected: null, drag: null,
        notice: `${file.name} delivered to the sample destination.` };
    }
    case 'drag-start': return { ...s, notice: 'Moving a sample file…', drag: { origin: a.origin, id: a.id, previousView: s.view, previousOpen: s.open } };
    case 'drag-enter': return s.drag?.origin === 'finder' ? { ...s, view: 'tray', open: true } : s;
    case 'drag-end': return s.drag ? { ...s, view: s.drag.previousView, open: s.drag.previousOpen, drag: null, notice: 'Transfer canceled. Nothing changed.' } : s;
    case 'clip-copy': { const clip = s.clips.find(c => c.id === a.id); return clip ? { ...s, clips: [clip, ...s.clips.filter(c => c !== clip)], notice: 'Copied again (sample only; nothing reaches your clipboard).' } : s; }
    case 'clip-pin': return { ...s, clips: s.clips.map(c => c.id === a.id ? { ...c, pinned: !c.pinned } : c) };
    case 'clip-remove': return { ...s, clips: s.clips.filter(c => c.id !== a.id), notice: 'Removed from the sample history.' };
    case 'clip-clear': return { ...s, clips: s.clips.filter(c => c.pinned), notice: 'Sample history cleared. Pins stay.' };
  }
}

export function previewSnapshot(state: PreviewState['claude'], pulse: boolean, notchW = 190, notchH = 34): Snapshot {
  const now = Date.now();
  const status: Status = state === 'many' ? 'working' : state;
  const base = {
    id: 'sample-claude', title: 'A quieter place to work', project: 'notchlight', cwd: '/Users/you/dev/notchlight', branch: 'faces',
    status, tokens: 24100, startedAt: now - 124000, lastAt: now, endedAt: status === 'done' ? now : undefined,
    agents: [{ id: 'main', kind: 'main' as const, title: status === 'asking' ? 'Waiting for your answer' : status === 'done' ? 'Finished the new faces' : 'Shaping the music view', activity: 'code' as const, status, tokens: 24100, startedAt: now - 124000 }],
    ask: status === 'asking' ? { id: 'preview-ask', tool: 'Write', command: '', message: 'Claude needs your permission to use Write', at: now, answerable: false } : null,
    tail: []
  };
  return { sessions: state === 'idle' ? [] : state === 'many' ? [base, { ...base, id: 'sample-2', project: 'notes-api', cwd: '/Users/you/dev/notes-api' }] : [base],
    overall: status, tokens: 24100, elapsed: 124000, dormant: state === 'idle', notchW, notchH, hoverDelay: 550, pulse, now };
}

export function previewAgents(state: PreviewState, notchW = 190, notchH = 34): Snapshot {
  const base = previewSnapshot(state.claude,state.preferences.pulse,notchW,notchH);
  base.claude = {state:'demo',message:'Sample Claude activity.'};
  base.codex = state.codexConnection ?? {state:state.codex === 'off' ? 'disabled' : 'ready',message:state.codex === 'off' ? 'Codex monitoring is off. Enable it in Customize → Agents.' : 'Sample local Codex activity.',hooksSeen:false};
  base.sessions = base.sessions.map(s => ({...s,provider:'claude',source:'cli',originalId:s.id,id:`claude:${s.id}`}));
  if (state.codex !== 'off') {
    const status: Status = state.codex === 'many' ? 'working' : state.codex;
    const sample = previewSnapshot('working',true,notchW,notchH).sessions[0];
    const codex = {...sample,id:'codex:sample-1',originalId:'sample-1',provider:'codex' as const,source:'desktop' as const,status,
      title:'Bring the Codex companion to life',tokensKnown:false,
      agents:sample.agents.map(a => ({...a,status,tokensKnown:false,title:'Designing the shared Agents view'})),
      ask:status === 'asking' ? {id:'codex:sample-approval',tool:'Bash',command:'npm run test:codex',message:'Allow Codex to run the test suite?',at:Date.now(),answerable:true} : null};
    base.sessions.push(codex);
    if (state.codex === 'many') base.sessions.push({...codex,id:'codex:sample-2',source:'cli',title:'A long task title that stays readable while another agent works in exactly the same project'});
  }
  const rank: Record<Status,number> = {asking:0,working:1,failed:2,done:3,interrupted:4,unknown:5,idle:6};
  base.sessions.sort((a,b) => rank[a.status]-rank[b.status]);
  return {...base,overall:base.sessions[0]?.status || 'idle',dormant:!base.sessions.length,tokensKnown:state.codex === 'off',tokens:base.sessions.reduce((n,s)=>n+s.tokens,0)};
}
