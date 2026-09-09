export type CompanionView = 'claude' | 'music' | 'tray';
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
}
export const DEFAULT_COMPANION_PREFERENCES: CompanionPreferences = {
  theme: 'system', density: 'comfortable', reducedMotion: false, buddy: true, pulse: true,
  artwork: true, visualizer: true, thumbnails: 'large', removeAfterTransfer: true, spotifyEnabled: false
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
  track: MusicTrack | null;
  busy: boolean;
  message?: string;
}
export const EMPTY_SPOTIFY: SpotifySnapshot = { status: 'disconnected', playing: false, position: 0, track: null, busy: false };
export interface CompanionSnapshot {
  preferences: CompanionPreferences;
  view: CompanionView;
  files: ShelfFile[];
  music: SpotifySnapshot;
  notice: string;
}
export interface OperationResult { ok: boolean; error?: string }
export type SpotifyCommand = 'toggle' | 'next' | 'previous' | 'seek';
export interface CompanionBridge {
  getCompanion(): Promise<CompanionSnapshot>;
  onCompanion(cb: (state: CompanionSnapshot) => void): () => void;
  updatePreferences(patch: Partial<CompanionPreferences>): Promise<OperationResult>;
  setView(view: CompanionView): Promise<OperationResult>;
  addFiles(files: File[]): Promise<OperationResult>;
  pickFiles(): Promise<OperationResult>;
  removeFile(id: string): Promise<OperationResult>;
  revealFile(id: string): Promise<OperationResult>;
  saveFileCopy(id: string): Promise<OperationResult>;
  startFileDrag(id: string): void;
  connectSpotify(): Promise<OperationResult>;
  openSpotify(): Promise<OperationResult>;
  controlSpotify(command: SpotifyCommand, position?: number): Promise<OperationResult>;
  /** Five band levels, bass first, each 0…1, while Spotify plays and the bars are on screen. */
  onMusicLevels(cb: (levels: number[]) => void): () => void;
}

/** Only known, correctly typed preferences may cross the renderer boundary. */
export function validatePreferences(value: unknown): Partial<CompanionPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preferences.');
  const result: Record<string, unknown> = {};
  const choices: Record<string, readonly string[]> = {
    theme: ['system', 'light', 'dark'], density: ['compact', 'comfortable'], thumbnails: ['small', 'large']
  };
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_COMPANION_PREFERENCES, key)) throw new Error('Unknown preference.');
    if (choices[key] ? !choices[key].includes(String(item)) || typeof item !== 'string' : typeof item !== 'boolean') throw new Error('Invalid preference value.');
    result[key] = item;
  }
  return result;
}
