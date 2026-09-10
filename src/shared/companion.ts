export type CompanionView = 'agents' | 'music' | 'tray' | 'clipboard';
export interface CompanionPreferences {
  theme: 'system' | 'light' | 'dark';
  density: 'compact' | 'comfortable';
  reducedMotion: boolean;
  buddy: boolean;
  pulse: boolean;
  artwork: boolean;
  visualizer: boolean;
  thumbnails: 'small' | 'large';
  removeAfterTransfer: boolean;
  spotifyEnabled: boolean;
  /** Which faces keep a presence on the resting bar. */
  restClaude: boolean;
  restCodex: boolean;
  codexEnabled: boolean;
  codexApprovals: boolean;
  codexBuddy: boolean;
  codexPulse: boolean;
  codexHome: string;
  restMusic: boolean;
  restTray: boolean;
  /** Clipboard history is a privacy choice: off until switched on. */
  clipboardEnabled: boolean;
  clipboardHistorySize: '20' | '50' | '100';
  restClipboard: boolean;
}
export const DEFAULT_COMPANION_PREFERENCES: CompanionPreferences = {
  theme: 'system', density: 'comfortable', reducedMotion: false, buddy: true, pulse: true,
  artwork: true, visualizer: true, thumbnails: 'large', removeAfterTransfer: true, spotifyEnabled: false,
  restClaude: true, restCodex: true, codexEnabled: false, codexApprovals: false, codexBuddy: true, codexPulse: true, codexHome: '', restMusic: true, restTray: true,
  clipboardEnabled: false, clipboardHistorySize: '50', restClipboard: true
};
export interface ShelfFile {
  id: string;
  name: string;
  kind: 'image' | 'pdf' | 'folder' | 'text';
  size: string;
  unavailable?: boolean;
  thumbnail?: string;
}
export interface MusicTrack { id: string; title: string; artist: string; album: string; duration: number; artwork?: string }
export interface SpotifySnapshot {
  status: 'disconnected' | 'not-running' | 'ready' | 'empty' | 'permission' | 'error';
  playing: boolean;
  position: number;
  /** When `position` was read (ms since epoch), so the renderer can let it advance between reads. */
  at: number;
  track: MusicTrack | null;
  busy: boolean;
  message?: string;
}
export const EMPTY_SPOTIFY: SpotifySnapshot = { status: 'disconnected', playing: false, position: 0, at: 0, track: null, busy: false };
/** Where playback is now, given the last read and the clock. Paused stays put; nothing runs past the end. */
export function playhead(music: SpotifySnapshot, now: number): number {
  if (!music.track) return 0;
  const elapsed = music.playing && music.at ? Math.max(0, now - music.at) / 1000 : 0;
  return Math.min(music.track.duration, music.position + elapsed);
}
/**
 * Audio capture, separately from the Spotify connection. Track metadata and
 * transport come over Apple Events; the bars come from a Core Audio tap that
 * has its own permission prompt and its own ways to be unavailable. One can
 * work while the other does not, and the settings pane says which.
 */
export interface CaptureSnapshot {
  status: 'idle' | 'starting' | 'listening' | 'unavailable';
  reason: 'permission' | 'not-running' | 'unsupported' | 'no-output' | 'no-helper' | 'crashed' | 'failed' | null;
  /** When the next automatic attempt is due, while unavailable. */
  retryAt: number | null;
}
export const EMPTY_CAPTURE: CaptureSnapshot = { status: 'idle', reason: null, retryAt: null };
/** What the settings pane says about capture. Spotify's own state is described elsewhere. */
export function describeCapture(capture: CaptureSnapshot, music: SpotifySnapshot, preferences: { visualizer: boolean; reducedMotion: boolean }): string {
  if (!preferences.visualizer) return 'The bars are off. Turn on Move with the music to capture Spotify’s output.';
  if (preferences.reducedMotion) return 'Reduce motion is on, so the bars stay still and nothing is captured.';
  switch (capture.status) {
    case 'listening': return 'Listening to Spotify’s output. The bars follow the music.';
    case 'starting': return 'Starting audio capture…';
    case 'unavailable': switch (capture.reason) {
      case 'permission': return 'macOS did not allow audio capture. Allow Notchlight under System Settings → Privacy & Security → Screen & System Audio Recording; the bars try again on their own.';
      case 'not-running': return 'Spotify is not open, so there is nothing to capture yet.';
      case 'unsupported': return 'Audio capture needs macOS 14.2 or later. Playback and track details still work.';
      case 'no-output': return 'No output device is selected, so there is nothing to listen to.';
      case 'no-helper': return 'The capture helper could not be built. Install the Xcode command line tools, or use a packaged build.';
      case 'crashed': return 'The capture helper stopped unexpectedly. It will try again shortly.';
      default: return 'Audio capture is unavailable right now. It will try again shortly.';
    }
    default: return music.status === 'ready' && music.playing ? 'Capture starts when the bars are on screen.' : 'Capture runs only while Spotify plays and the bars are showing.';
  }
}
/** One thing that was copied: text, a URL, or an image. */
export interface ClipboardItem {
  id: string;
  kind: 'text' | 'url' | 'image';
  /** The text itself; empty for an image. */
  text: string;
  /** First line, whitespace folded, for the list; "W×H image" for an image. */
  preview: string;
  host?: string;
  lines: number;
  bytes: number;
  at: number;
  pinned: boolean;
  /** Image only: the PNG as a data URL, a small thumbnail, and its size. */
  data?: string;
  thumb?: string;
  width?: number;
  height?: number;
}
export interface ClipboardSnapshot {
  enabled: boolean;
  paused: boolean;
  items: ClipboardItem[];
  limit: number;
}
export const EMPTY_CLIPBOARD: ClipboardSnapshot = { enabled: false, paused: false, items: [], limit: 50 };
/** A Save copy in flight: bytes so far, and which item of how many. */
export interface TransferProgress { name: string; done: number; total: number; item: number; items: number }
export interface CompanionSnapshot {
  preferences: CompanionPreferences;
  view: CompanionView;
  files: ShelfFile[];
  music: SpotifySnapshot;
  capture: CaptureSnapshot;
  clipboard: ClipboardSnapshot;
  transfer: TransferProgress | null;
  /** How many references the last Remove took; Undo puts them back. */
  undoable: number;
  notice: string;
}
export interface OperationResult { ok: boolean; error?: string }
export type SpotifyCommand = 'toggle' | 'next' | 'previous' | 'seek';
export interface CompanionBridge {
  installCodexHooks(remove?: boolean): Promise<OperationResult>;
  chooseCodexHome(): Promise<OperationResult>;
  getCompanion(): Promise<CompanionSnapshot>;
  onCompanion(cb: (state: CompanionSnapshot) => void): () => void;
  updatePreferences(patch: Partial<CompanionPreferences>): Promise<OperationResult>;
  setView(view: CompanionView): Promise<OperationResult>;
  addFiles(files: File[]): Promise<OperationResult>;
  pickFiles(): Promise<OperationResult>;
  removeFiles(ids: string[]): Promise<OperationResult>;
  undoRemove(): Promise<OperationResult>;
  revealFile(id: string): Promise<OperationResult>;
  /** Ask where a missing file lives now. */
  locateFile(id: string): Promise<OperationResult>;
  saveFileCopy(ids: string[]): Promise<OperationResult>;
  startFileDrag(ids: string[]): void;
  connectSpotify(): Promise<OperationResult>;
  openSpotify(): Promise<OperationResult>;
  controlSpotify(command: SpotifyCommand, position?: number): Promise<OperationResult>;
  /** Five band levels, bass first, each 0…1, while Spotify plays and the bars are on screen. */
  onMusicLevels(cb: (levels: number[]) => void): () => void;
  /** Put a history item back on the clipboard. */
  copyClipboardItem(id: string): Promise<OperationResult>;
  pinClipboardItem(id: string, pinned: boolean): Promise<OperationResult>;
  removeClipboardItem(id: string): Promise<OperationResult>;
  /** Forget the history; pins too when asked. */
  clearClipboard(includePinned: boolean): Promise<OperationResult>;
  pauseClipboard(paused: boolean): Promise<OperationResult>;
}

/** Only known, correctly typed preferences may cross the renderer boundary. */
export function validatePreferences(value: unknown): Partial<CompanionPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preferences.');
  const result: Record<string, unknown> = {};
  const choices: Record<string, readonly string[]> = {
    theme: ['system', 'light', 'dark'], density: ['compact', 'comfortable'], thumbnails: ['small', 'large'], clipboardHistorySize: ['20', '50', '100']
  };
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_COMPANION_PREFERENCES, key)) throw new Error('Unknown preference.');
    if (key === 'codexHome') {
      if (typeof item !== 'string' || item.length > 4096 || item.includes('\0') || item !== '' && !item.startsWith('/')) throw new Error('Choose an absolute Codex home directory.');
      result[key] = item; continue;
    }
    if (choices[key] ? !choices[key].includes(String(item)) || typeof item !== 'string' : typeof item !== 'boolean') throw new Error('Invalid preference value.');
    result[key] = item;
  }
  return result;
}
