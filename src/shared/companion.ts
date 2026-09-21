export type CompanionView = 'agents' | 'music' | 'tray' | 'clipboard' | 'today';
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
  /** Bars rising bass→treble, or folded around the middle so they read as one shape. */
  /** Which player the Music face follows. Auto follows whichever is open, Spotify first. */
  musicPlayer: 'spotify' | 'apple' | 'auto';
  equalizerLayout: 'rising' | 'mirrored';
  /** A soft glow in the artwork's colour behind the mini artwork and the bars. */
  artworkGlow: boolean;
  /** The mini artwork breathes with the bass while real levels arrive. */
  artworkPulse: boolean;
  /** A tokens-per-second line in the session panel. */
  sparkline: boolean;
  /** The Client ID of your own Spotify developer app; empty until you paste one. */
  spotifyClientId: string;
  /** Mark Smart Shuffle picks in the Music face, with a + and an × to answer them. */
  smartShuffle: boolean;
  /** Read the battery at all. Off until switched on; the menu bar already shows one. */
  batteryEnabled: boolean;
  /** The battery keeps a place on the resting bar. */
  restBattery: boolean;
  /** The level as a number beside the glyph. */
  batteryPercentage: boolean;
  /** A moment in the notch when the charger goes in or comes out, and when the last of it is going. */
  batteryAlerts: boolean;
  /** Come back to the face you were last on, rather than to Agents. */
  rememberTab: boolean;
  /** A new track shows its title and artist for a moment, without opening the notch. */
  sneakPeek: boolean;
  /** Drop Music from the resting bar this long after playback stops. `never` keeps it. */
  musicIdleHide: 'never' | '30' | '120' | '600';
  /** Two fingers up over the open notch closes it. */
  swipeToClose: boolean;
  /** Read today's events at all. Off until switched on. */
  calendarEnabled: boolean;
  /** Reminders due today, beside the events. A separate macOS permission. */
  calendarReminders: boolean;
  /** Today keeps a place on the resting bar: the next thing, and when. */
  restToday: boolean;
  /** Calendars whose events are left out, by identifier. */
  calendarHidden: string[];
  /** Leave out events that take the whole day. */
  hideAllDay: boolean;
  /** Leave out reminders that have been ticked off. */
  hideDone: boolean;
  /** The whole title, wrapped, rather than one line ending in an ellipsis. */
  fullEventTitles: boolean;
  /** Answer the volume and brightness keys in the notch instead of the macOS square. Needs Accessibility. */
  hudEnabled: boolean;
  /** Option held keeps its macOS meaning — open the matching settings pane — or moves the level like any other press. */
  hudOptionKey: 'settings' | 'replace';
  /** A solid bar, or one that ramps across its own length. */
  hudStyle: 'solid' | 'gradient';
  /** A soft light under the filled part of the bar. */
  hudGlow: boolean;
  /** The level as a number beside the bar. */
  hudPercentage: boolean;
  /** Show the bar above the tabs while the notch is open, not only while it rests. */
  hudOpenNotch: boolean;
  /** Resting, the bar sits in the wings beside the cutout, or takes the full panel width. */
  hudClosed: 'inline' | 'wide';
}
export const DEFAULT_COMPANION_PREFERENCES: CompanionPreferences = {
  theme: 'system', density: 'comfortable', reducedMotion: false, buddy: true, pulse: true,
  artwork: true, visualizer: true, thumbnails: 'large', removeAfterTransfer: true, spotifyEnabled: false,
  restClaude: true, restCodex: true, codexEnabled: false, codexApprovals: false, codexBuddy: true, codexPulse: true, codexHome: '', restMusic: true, restTray: true,
  clipboardEnabled: false, clipboardHistorySize: '50', restClipboard: true,
  musicPlayer: 'spotify', equalizerLayout: 'rising', artworkGlow: true, artworkPulse: true, sparkline: false, spotifyClientId: '', smartShuffle: true,
  hudEnabled: false, hudOptionKey: 'settings', hudStyle: 'solid', hudGlow: true, hudPercentage: false, hudOpenNotch: true, hudClosed: 'inline',
  batteryEnabled: false, restBattery: true, batteryPercentage: true, batteryAlerts: true,
  rememberTab: true, sneakPeek: true, musicIdleHide: 'never', swipeToClose: true,
  calendarEnabled: false, calendarReminders: false, restToday: true, calendarHidden: [], hideAllDay: false, hideDone: true, fullEventTitles: false
};
export type MusicPlayer = 'spotify' | 'apple';
export const PLAYER_NAMES: Record<MusicPlayer, string> = { spotify: 'Spotify', apple: 'Apple Music' };
export const PLAYER_BUNDLES: Record<MusicPlayer, string> = { spotify: 'com.spotify.client', apple: 'com.apple.Music' };
export interface ShelfFile {
  id: string;
  name: string;
  kind: 'image' | 'pdf' | 'folder' | 'text';
  size: string;
  unavailable?: boolean;
  thumbnail?: string;
}
export interface MusicTrack { id: string; title: string; artist: string; album: string; duration: number; artwork?: string; /** The artwork's colour as #rrggbb, once known. */ tint?: string }
export interface SpotifySnapshot {
  status: 'disconnected' | 'not-running' | 'ready' | 'empty' | 'permission' | 'error';
  /** The player this snapshot describes. */
  player: MusicPlayer;
  playing: boolean;
  position: number;
  /** When `position` was read (ms since epoch), so the renderer can let it advance between reads. */
  at: number;
  /** Spotify's own volume, 0–100, or -1 when it did not say. */
  volume: number;
  track: MusicTrack | null;
  busy: boolean;
  message?: string;
}
/**
 * The Spotify account behind Smart Shuffle: the Web API sign-in, separate
 * from the scripting connection that reads and controls the player.
 */
export interface SpotifyAccountSnapshot {
  status: 'off' | 'signed-out' | 'signing-in' | 'ready' | 'error';
  /** The display name of who is signed in. */
  user?: string;
  message?: string;
}
/** A track Smart Shuffle slipped into the playlist's flow — not one of the playlist's own. */
export interface SmartShufflePick {
  /** spotify:track:… — only meaningful while it is the current track. */
  trackId: string;
  playlistId: string;
  playlistName: string;
  /** The playlist is yours or collaborative, so the + can add to it. */
  canAdd: boolean;
}
export interface SmartShuffleSnapshot {
  account: SpotifyAccountSnapshot;
  pick: SmartShufflePick | null;
  /** An add or a dismiss is on its way to Spotify. */
  busy: boolean;
}
export const EMPTY_SMART_SHUFFLE: SmartShuffleSnapshot = { account: { status: 'off' }, pick: null, busy: false };
/** Where the browser brings the sign-in back to. Spotify wants this exact address registered on the app. */
export const SPOTIFY_REDIRECT_PORT = 41739;
export const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/callback`;
export const EMPTY_SPOTIFY: SpotifySnapshot = { status: 'disconnected', player: 'spotify', playing: false, position: 0, at: 0, volume: -1, track: null, busy: false };
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
/** The two things the volume and brightness keys move. */
export type HudChannel = 'volume' | 'brightness';
/**
 * Taking over the system volume and brightness overlay.
 *
 * The helper installs an event tap, so this is off until it is switched on and
 * Accessibility is granted. `can` is what this Mac can actually take over: a key
 * outside it keeps the macOS overlay rather than doing nothing, and the settings
 * pane says so rather than claiming more than it does.
 */
export interface HudSnapshot {
  status: 'off' | 'starting' | 'listening' | 'unavailable';
  reason: 'accessibility' | 'no-tap' | 'no-output' | 'unsupported' | 'no-helper' | 'crashed' | null;
  can: HudChannel[];
  /** The last levels seen, 0…1, or null before the helper has said. */
  volume: number | null;
  muted: boolean;
  brightness: number | null;
}
export const EMPTY_HUD: HudSnapshot = { status: 'off', reason: null, can: [], volume: null, muted: false, brightness: null };
/** One key press, as the notch draws it. */
export interface HudActivity { kind: HudChannel; value: number; muted: boolean; at: number }
/**
 * The internal battery, as IOKit reports it.
 *
 * A Mac without one — a mini, a Studio — is `present: false`, which is a fact
 * about the hardware rather than a failure, and the pane says so plainly.
 */
export interface BatterySnapshot {
  status: 'off' | 'starting' | 'reading' | 'unavailable';
  reason: 'no-battery' | 'no-helper' | 'crashed' | null;
  /** 0…1, or null before the first reading. */
  percent: number | null;
  charging: boolean;
  plugged: boolean;
  charged: boolean;
  /** Time to full while charging, time to empty otherwise, or null while macOS is still estimating. */
  minutes: number | null;
}
export const EMPTY_BATTERY: BatterySnapshot = { status: 'off', reason: null, percent: null, charging: false, plugged: false, charged: false, minutes: null };
/** Twenty percent, the figure macOS itself warns at. */
export const LOW_BATTERY = 0.2;
/** Running down and nearly out. Charging at the same level is not a warning. */
export function batteryIsLow(battery: BatterySnapshot): boolean {
  return battery.percent !== null && battery.percent <= LOW_BATTERY && !battery.plugged;
}
/** Something worth a moment of the notch: the charger, or the last of the battery. */
export type BatteryEvent = 'plugged' | 'unplugged' | 'low' | 'charged';
export interface BatteryActivity { event: BatteryEvent; percent: number; minutes: number | null; at: number }
/** `2:14 left`, `45m to full`, or nothing while macOS is still estimating. */
export function batteryTime(battery: BatterySnapshot): string {
  if (battery.charged) return 'Charged';
  if (battery.minutes === null) return battery.charging ? 'Charging' : '';
  const hours = Math.floor(battery.minutes / 60);
  const span = hours ? `${hours}h ${battery.minutes % 60}m` : `${battery.minutes}m`;
  return battery.charging ? `${span} to full` : `${span} left`;
}
/** What the settings pane says about the battery. */
export function describeBattery(battery: BatterySnapshot, enabled: boolean): string {
  if (!enabled) return 'Off. The menu bar still shows the battery in its usual place.';
  switch (battery.status) {
    case 'reading': {
      const percent = battery.percent === null ? '' : `${Math.round(battery.percent * 100)}%`;
      const time = batteryTime(battery);
      return `${percent}${battery.plugged ? ', on the charger' : ''}${time ? ` · ${time}` : ''}.`;
    }
    case 'starting': return 'Reading the battery…';
    case 'unavailable': switch (battery.reason) {
      case 'no-battery': return 'This Mac has no internal battery, so there is nothing to show.';
      case 'no-helper': return 'The power helper could not be built. Install the Xcode command line tools, or use a packaged build.';
      default: return 'The power helper stopped unexpectedly. It will try again shortly.';
    }
    default: return 'Waiting for the first reading.';
  }
}
/** One calendar or reminder list, with the colour its own app gives it. */
export interface CalendarInfo { id: string; title: string; color: string; kind: 'event' | 'reminder' }
/** One thing happening today. A reminder has no end and can be done. */
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  /** ISO 8601 with an offset. */
  start: string;
  end?: string;
  allDay: boolean;
  location: string;
  kind: 'event' | 'reminder';
  done: boolean;
  past: boolean;
}
/**
 * Today, as EventKit has it.
 *
 * Off until switched on, like everything else that reads something of yours.
 * A refusal is a state rather than an error: macOS only asks once, so the pane
 * has to say plainly where the answer can be changed.
 */
export interface CalendarSnapshot {
  status: 'off' | 'starting' | 'reading' | 'unavailable';
  reason: 'denied' | 'restricted' | 'unsupported' | 'no-helper' | 'crashed' | null;
  /** The day these events belong to, as yyyy-mm-dd, or empty before the first read. */
  day: string;
  calendars: CalendarInfo[];
  events: CalendarEvent[];
  /** Reminders were asked for and allowed. */
  reminders: boolean;
}
export const EMPTY_CALENDAR: CalendarSnapshot = { status: 'off', reason: null, day: '', calendars: [], events: [], reminders: false };
/**
 * The events worth showing, given what has been hidden. Takes a list rather
 * than a snapshot, so the sample day can be filtered by the same rules.
 */
export function visibleEvents(events: CalendarEvent[], preferences: { calendarHidden: string[]; hideAllDay: boolean; hideDone: boolean }): CalendarEvent[] {
  const hidden = new Set(preferences.calendarHidden);
  return events.filter(event =>
    !hidden.has(event.calendarId)
    && !(preferences.hideAllDay && event.allDay)
    && !(preferences.hideDone && event.done));
}
/** The next thing that has not happened yet, which is what the resting bar carries. */
export function nextEvent(events: CalendarEvent[]): CalendarEvent | null {
  return events.find(event => !event.past && !event.done) ?? null;
}
/** What the settings pane says about the calendar. */
export function describeCalendar(calendar: CalendarSnapshot, enabled: boolean): string {
  if (!enabled) return 'Off. Nothing in your calendar is read.';
  switch (calendar.status) {
    case 'reading': {
      const count = calendar.events.length;
      return `${count === 0 ? 'Nothing' : count === 1 ? 'One thing' : `${count} things`} today, across ${calendar.calendars.length} ${calendar.calendars.length === 1 ? 'calendar' : 'calendars'}.${calendar.reminders ? '' : ' Reminders are not included.'}`;
    }
    case 'starting': return 'Asking macOS for access to your calendar…';
    case 'unavailable': switch (calendar.reason) {
      case 'denied': return 'macOS did not allow access. Turn Notchlight on under System Settings → Privacy & Security → Calendars; macOS only asks once.';
      case 'restricted': return 'Calendar access is restricted on this Mac, which is usually a profile or parental controls.';
      case 'unsupported': return 'Reading the calendar needs macOS 14 or later. Everything else still works.';
      case 'no-helper': return 'The calendar helper could not be built. Install the Xcode command line tools, or use a packaged build.';
      default: return 'The calendar helper stopped unexpectedly. It will try again shortly.';
    }
    default: return 'Waiting for the first reading.';
  }
}
/** What the settings pane says about the Spotify account. */
export function describeAccount(account: SpotifyAccountSnapshot): string {
  switch (account.status) {
    case 'off': return account.message ?? 'Paste your Spotify app’s Client ID to sign in.';
    case 'signing-in': return account.message ?? 'Finish signing in in your browser.';
    case 'ready': return `Signed in${account.user ? ` as ${account.user}` : ''}. Picks show in Music while Spotify plays a playlist with Smart Shuffle on.`;
    default: return account.message ?? 'Not signed in. Picks need the account; playback does not.';
  }
}
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
/** The names the settings pane and the notch use for the two channels. */
export const HUD_NAMES: Record<HudChannel, string> = { volume: 'Volume', brightness: 'Brightness' };
/**
 * What the settings pane says about the system HUD. The permission is the one
 * line a user can act on, so it names the pane and what to look for in it.
 */
export function describeHud(hud: HudSnapshot, enabled: boolean): string {
  if (!enabled) return 'Off. macOS shows its own square in the middle of the screen for volume and brightness.';
  switch (hud.status) {
    case 'listening': {
      const missing = (['volume', 'brightness'] as HudChannel[]).filter(channel => !hud.can.includes(channel));
      const taken = hud.can.map(channel => HUD_NAMES[channel].toLowerCase()).join(' and ') || 'nothing';
      return `Replacing the system overlay for ${taken}.${missing.length ? ` macOS still handles ${missing.map(channel => HUD_NAMES[channel].toLowerCase()).join(' and ')} on this Mac.` : ''}`;
    }
    case 'starting': return 'Starting the key listener…';
    case 'unavailable': switch (hud.reason) {
      case 'accessibility': return 'macOS has not allowed Notchlight to see the keys. Allow it under System Settings → Privacy & Security → Accessibility; this tries again on its own. An app update can need the box ticked again.';
      case 'no-tap': return 'macOS refused the key listener. Allowing Notchlight under Accessibility again usually settles it.';
      case 'no-output': return 'No output device is selected, so there is no volume to change.';
      case 'unsupported': return 'Neither the volume nor the brightness can be changed on this Mac. macOS keeps its own overlay.';
      case 'no-helper': return 'The key helper could not be built. Install the Xcode command line tools, or use a packaged build.';
      default: return 'The key helper stopped unexpectedly. It will try again shortly.';
    }
    default: return 'Waiting for the key listener to start.';
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
  hud: HudSnapshot;
  battery: BatterySnapshot;
  calendar: CalendarSnapshot;
  clipboard: ClipboardSnapshot;
  smartShuffle: SmartShuffleSnapshot;
  transfer: TransferProgress | null;
  /** How many references the last Remove took; Undo puts them back. */
  undoable: number;
  notice: string;
}
export interface OperationResult { ok: boolean; error?: string }
export type SpotifyCommand = 'toggle' | 'next' | 'previous' | 'seek' | 'volume';
export type SmartShuffleAnswer = 'add' | 'dismiss';
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
  /** macOS's own share sheet, AirDrop included. The items stay in Tray. */
  shareFiles(ids: string[]): Promise<OperationResult>;
  startFileDrag(ids: string[]): void;
  connectSpotify(): Promise<OperationResult>;
  openSpotify(): Promise<OperationResult>;
  controlSpotify(command: SpotifyCommand, position?: number): Promise<OperationResult>;
  /** Sign in to the Spotify account in the browser, for Smart Shuffle picks. */
  signInSpotify(): Promise<OperationResult>;
  signOutSpotify(): Promise<OperationResult>;
  /** Answer the current pick: + adds it to the playlist, × skips it. */
  answerPick(answer: SmartShuffleAnswer): Promise<OperationResult>;
  /** Five band levels, bass first, each 0…1, while Spotify plays and the bars are on screen. */
  onMusicLevels(cb: (levels: number[]) => void): () => void;
  /** One volume or brightness key press, the moment it lands. */
  onHud(cb: (activity: HudActivity) => void): () => void;
  /** The charger going in or coming out, or the last of the battery going. */
  onBattery(cb: (activity: BatteryActivity) => void): () => void;
  /** Fold this island up now — a swipe, rather than the cursor leaving. */
  closeIsland(): void;
  /** Show System Settings → Privacy & Security → Accessibility. */
  openAccessibility(): Promise<OperationResult>;
  /** Show System Settings → Privacy & Security → Calendars, where a refusal can be undone. */
  openCalendarPrivacy(): Promise<OperationResult>;
  /** Open Calendar, for the things the notch cannot do. */
  openCalendarApp(): Promise<OperationResult>;
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
    theme: ['system', 'light', 'dark'], density: ['compact', 'comfortable'], thumbnails: ['small', 'large'], clipboardHistorySize: ['20', '50', '100'], equalizerLayout: ['rising', 'mirrored'], musicPlayer: ['spotify', 'apple', 'auto'],
    hudOptionKey: ['settings', 'replace'], hudStyle: ['solid', 'gradient'], hudClosed: ['inline', 'wide'],
    musicIdleHide: ['never', '30', '120', '600']
  };
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_COMPANION_PREFERENCES, key)) throw new Error('Unknown preference.');
    if (key === 'codexHome') {
      if (typeof item !== 'string' || item.length > 4096 || item.includes('\0') || item !== '' && !item.startsWith('/')) throw new Error('Choose an absolute Codex home directory.');
      result[key] = item; continue;
    }
    if (key === 'calendarHidden') {
      if (!Array.isArray(item) || item.length > 100 || item.some(id => typeof id !== 'string' || id.length > 256)) throw new Error('Invalid calendar list.');
      result[key] = [...new Set(item as string[])]; continue;
    }
    if (key === 'spotifyClientId') {
      if (typeof item !== 'string' || item !== '' && !/^[0-9a-f]{32}$/i.test(item.trim())) throw new Error('A Spotify Client ID is 32 hexadecimal characters.');
      result[key] = item.trim().toLowerCase(); continue;
    }
    if (choices[key] ? !choices[key].includes(String(item)) || typeof item !== 'string' : typeof item !== 'boolean') throw new Error('Invalid preference value.');
    result[key] = item;
  }
  return result;
}
