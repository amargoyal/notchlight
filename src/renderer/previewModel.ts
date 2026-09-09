import type { Snapshot, Status } from '../shared/types';

export type PreviewView = 'claude' | 'music' | 'tray';
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
  restMusic: boolean;
  restTray: boolean;
}
export interface PreviewTrack { id: string; title: string; artist: string; album: string; duration: number; artwork?: string }
export interface PreviewFile { id: string; name: string; kind: 'image' | 'pdf' | 'folder' | 'text'; size: string; unavailable?: boolean }
export interface PreviewState {
  view: PreviewView;
  open: boolean;
  preferences: PreviewPreferences;
  music: { index: number; position: number; playing: boolean; source: 'ready' | 'empty' | 'unavailable'; missingArtwork: boolean };
  files: PreviewFile[];
  selected: string | null;
  received: PreviewFile[];
  drag: { origin: 'finder' | 'tray'; id: string; previousView: PreviewView; previousOpen: boolean } | null;
  notice: string;
  claude: 'working' | 'asking' | 'done' | 'idle' | 'many';
}
export const DEFAULT_PREFERENCES: PreviewPreferences = {
  theme: 'system', density: 'comfortable', reducedMotion: false, buddy: true, pulse: true,
  artwork: true, visualizer: true, thumbnails: 'large', removeAfterTransfer: true,
  restClaude: true, restMusic: true, restTray: true
};
export const TRACKS: PreviewTrack[] = [
  { id: 'late-light', title: 'Late Light', artist: 'The Quiet Hours', album: 'Somewhere, Slowly', duration: 234, artwork: './assets/late-light.svg' },
  { id: 'blue-room', title: 'Blue Room', artist: 'Soft Signal', album: 'After the Rain', duration: 198, artwork: './assets/blue-room.svg' },
  { id: 'long-way', title: 'The long way home, through the hills and past the sleeping city', artist: 'The Quiet Hours & Friends', album: 'Somewhere, Slowly', duration: 267, artwork: './assets/late-light.svg' }
];
export const SAMPLE_FILES: PreviewFile[] = [
  { id: 'coast', name: 'Coast.jpg', kind: 'image', size: '2.4 MB' },
  { id: 'brief', name: 'Project brief.pdf', kind: 'pdf', size: '184 KB' },
  { id: 'assets', name: 'Brand assets', kind: 'folder', size: '8 items' },
  { id: 'notes', name: 'Notes for the next iteration and final handoff.md', kind: 'text', size: '4 KB' }
];
export function initialPreview(): PreviewState {
  return { view: 'music', open: true, preferences: { ...DEFAULT_PREFERENCES },
    music: { index: 0, position: 72, playing: true, source: 'ready', missingArtwork: false },
    files: SAMPLE_FILES.slice(0, 2), selected: null, received: [], drag: null, notice: '', claude: 'working' };
}
export type PreviewAction =
  | { type: 'view'; view: PreviewView } | { type: 'open'; value: boolean }
  | { type: 'preferences'; patch: Partial<PreviewPreferences> } | { type: 'reset' }
  | { type: 'start-playlist' } | { type: 'play' } | { type: 'skip'; delta: number } | { type: 'seek'; position: number } | { type: 'tick' }
  | { type: 'music-state'; source: PreviewState['music']['source']; missingArtwork?: boolean }
  | { type: 'claude'; value: PreviewState['claude'] }
  | { type: 'add'; id: string } | { type: 'remove'; id: string } | { type: 'select'; id: string }
  | { type: 'take'; id: string } | { type: 'files'; files: PreviewFile[] }
  | { type: 'drag-start'; origin: 'finder' | 'tray'; id: string } | { type: 'drag-enter' } | { type: 'drag-end' };

export function previewReducer(s: PreviewState, a: PreviewAction): PreviewState {
  switch (a.type) {
    case 'reset': return initialPreview();
    case 'view': return { ...s, view: a.view, open: true };
    case 'open': return { ...s, open: a.value };
    case 'preferences': return { ...s, preferences: { ...s.preferences, ...a.patch } };
    case 'claude': return { ...s, claude: a.value };
    case 'music-state': return { ...s, music: { ...s.music, source: a.source, missingArtwork: !!a.missingArtwork } };
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
  }
}

export function previewSnapshot(state: PreviewState['claude'], pulse: boolean, notchW = 190, notchH = 34): Snapshot {
  const now = Date.now();
  const status: Status = state === 'many' ? 'working' : state;
  const base = {
    id: 'sample-claude', title: 'A quieter place to work', project: 'claude-light', cwd: '/Users/you/dev/claude-light', branch: 'faces',
    status, tokens: 24100, startedAt: now - 124000, lastAt: now, endedAt: status === 'done' ? now : undefined,
    agents: [{ id: 'main', kind: 'main' as const, title: status === 'asking' ? 'Waiting for your answer' : status === 'done' ? 'Finished the new faces' : 'Shaping the music view', activity: 'code' as const, status, tokens: 24100, startedAt: now - 124000 }],
    ask: status === 'asking' ? { id: 'preview-ask', tool: 'Write', command: '', message: 'Claude needs your permission to use Write', at: now, answerable: false } : null,
    tail: []
  };
  return { sessions: state === 'idle' ? [] : state === 'many' ? [base, { ...base, id: 'sample-2', project: 'notes-api', cwd: '/Users/you/dev/notes-api' }] : [base],
    overall: status, tokens: 24100, elapsed: 124000, dormant: state === 'idle', notchW, notchH, hoverDelay: 550, pulse, now };
}
