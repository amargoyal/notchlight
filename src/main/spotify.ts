import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { EMPTY_SPOTIFY, PLAYER_NAMES, type MusicPlayer, type SpotifySnapshot, type SpotifyCommand } from '../shared/companion';
import { logEvent } from './lifecycle';
import type { PlaybackChange } from './spotifyWatch';

const execute = promisify(execFile);
export type SpotifyRunner = (command: string, position?: number, player?: MusicPlayer) => Promise<unknown>;
/** Apple Music hands artwork over as raw bytes; this turns the current track's into a data URL, or null. */
export type ArtworkLookup = (trackId: string) => Promise<string | null>;
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
const str = (v: unknown) => typeof v === 'string' ? v.slice(0, 2000) : '';
export function normalizeSpotify(value: unknown, player: MusicPlayer = 'spotify'): SpotifySnapshot {
  const name = PLAYER_NAMES[player];
  if (!value || typeof value !== 'object') return { ...EMPTY_SPOTIFY, player, status: 'error', message: `${name} did not return playback information.` };
  const raw = value as Record<string, unknown>;
  const base = { ...EMPTY_SPOTIFY, player };
  if (raw.status === 'not-running') return { ...base, status: 'not-running', message: `Open ${name} to see what’s playing.` };
  if (raw.status === 'empty') return { ...base, status: 'empty', message: `Choose something to play in ${name}.` };
  if (raw.status === 'permission') return { ...base, status: 'permission', message: `Allow Notchlight to control ${name} in System Settings → Privacy & Security → Automation, then reconnect.` };
  if (raw.status !== 'ready' || !raw.track || typeof raw.track !== 'object') return { ...base, status: 'error', message: `Could not read ${name}.` };
  const track = raw.track as Record<string, unknown>;
  const duration = number(track.durationMs) / 1000;
  const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) && raw.volume >= 0 ? Math.min(100, Math.round(raw.volume)) : -1;
  return { ...base, status: 'ready', playing: raw.playing === true, position: Math.min(number(raw.position), duration), at: Date.now(), volume,
    track: { id: str(track.id), title: str(track.title) || 'Untitled track', artist: str(track.artist), album: str(track.album), duration, artwork: validArtwork(str(track.artwork)) } };
}
export function validArtwork(value: string): string | undefined {
  // Apple Music artwork arrives as bytes and is carried as a PNG data URL the app made itself.
  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 400_000) return value;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'i.scdn.co' || u.hostname.endsWith('.scdn.co')) && !u.username && !u.password ? u.href : undefined;
  } catch { return undefined; }
}
/**
 * Every artist on the track, not just the first.
 *
 * Spotify's scripting dictionary hands back one `artist` string and it is only
 * the lead: a collaboration shows as a solo record. The public track page
 * still lists everyone, so ask it once per track and remember the answer.
 * Best effort — offline, throttled, or oddly shaped, the lead artist stands.
 */
export type ArtistLookup = (trackId: string) => Promise<string | undefined>;
/** The artwork's colour, for a glow behind the bars. Best effort, cached per artwork URL. */
export type TintLookup = (artworkUrl: string) => Promise<string | null>;
const decode = (v: string) => v.replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, '\'');
export function artistsFromPage(html: string): string | undefined {
  const meta = /<meta\s+(?:name|property)="music:musician_description"\s+content="([^"]*)"/.exec(html)?.[1]
    ?? /<meta\s+property="og:description"\s+content="([^"]*?) · /.exec(html)?.[1];
  const artists = meta ? decode(meta).trim() : '';
  return artists && artists.length <= 300 ? artists : undefined;
}
async function fetchArtists(trackId: string): Promise<string | undefined> {
  const id = /^[A-Za-z0-9]{22}$/.test(trackId) ? trackId : /^spotify:track:([A-Za-z0-9]{22})$/.exec(trackId)?.[1];
  if (!id) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`https://open.spotify.com/track/${id}`, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html' }, redirect: 'follow' });
    if (!response.ok) return undefined;
    return artistsFromPage((await response.text()).slice(0, 400_000));
  } catch { return undefined; }
  finally { clearTimeout(timer); }
}

async function runSpotify(command: string, position?: number, player: MusicPlayer = 'spotify'): Promise<unknown> {
  const script = path.join(__dirname, `../../native/${player === 'apple' ? 'music' : 'spotify'}.js`);
  try {
    const { stdout } = await execute('/usr/bin/osascript', ['-l', 'JavaScript', script, command, ...(position === undefined ? [] : [String(position)])], { timeout: 8000, maxBuffer: 128 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    const message = String((error as Error).message);
    return { status: message.includes('-1743') || message.includes('not authorized') ? 'permission' : 'error' };
  }
}

/** Poll only after opt-in; serialize status and transport to avoid command races. */
export class SpotifyPlayer extends EventEmitter {
  private state: SpotifySnapshot = { ...EMPTY_SPOTIFY };
  private enabled = false;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private polling = false;
  private generation = 0;
  private artists = new Map<string, string | undefined>();
  private pendingArtists = new Set<string>();
  private suspended = false;
  /** Consecutive failed reads. Drives the retry delay and resets on the first good one. */
  private failures = 0;
  private retryAt = 0;
  private tints = new Map<string, string | null>();
  private pendingTints = new Set<string>();
  /** The player being read right now, and whether auto is choosing it. */
  private player: MusicPlayer = 'spotify';
  private auto = false;
  private artworks = new Map<string, string | null>();
  private pendingArtwork = new Set<string>();
  constructor(private run: SpotifyRunner = runSpotify, private lookup: ArtistLookup = fetchArtists, private interval = 2500, private tint: TintLookup = async () => null, private artwork: ArtworkLookup = async () => null) { super(); }
  currentPlayer(): MusicPlayer { return this.player; }
  /**
   * Follow one player, or whichever is open. Auto starts with Spotify and,
   * while that is not running, tries Apple Music on the next read, and back —
   * so the first one found stays until it quits. A change of player resets
   * the state, like a reconnect, so nothing from the other app lingers.
   */
  setPlayer(choice: 'spotify' | 'apple' | 'auto'): void {
    const auto = choice === 'auto';
    const player: MusicPlayer = auto ? (this.player ?? 'spotify') : choice;
    if (auto === this.auto && player === this.player) return;
    this.auto = auto;
    this.player = player;
    logEvent('spotify', `following ${auto ? 'whichever is open, starting with ' : ''}${PLAYER_NAMES[player]}`);
    if (this.enabled) this.setEnabled(true);
  }
  /**
   * How often to read while nothing else says a change happened. With the
   * watcher listening a slow heartbeat is enough — every read spawns osascript
   * for a quarter of a second — and without it the usual pace comes back.
   */
  setPollInterval(ms: number): void {
    if (ms === this.interval) return;
    this.interval = ms;
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), this.interval);
  }
  /**
   * Spotify said something changed. Apply what the notification carries at
   * once — the click inside Spotify shows on the notch before osascript could
   * answer — then read the full status for what it does not carry.
   */
  onExternalChange(change: PlaybackChange): void {
    if (!this.enabled || this.suspended) return;
    if (change.player && change.player !== this.player) {
      // The other app moved. Under auto that is worth a look; otherwise it is not ours.
      if (this.auto && change.playing) this.refresh();
      return;
    }
    logEvent('spotify', `notified ${change.playing ? 'playing' : 'paused'}${change.trackId && change.trackId !== this.state.track?.id ? ' new track' : ''} at ${change.position?.toFixed(1) ?? '?'}s`);
    const current = this.state;
    if (current.status === 'ready' && current.track) {
      const sameTrack = !change.trackId || change.trackId === current.track.id;
      const track = sameTrack ? current.track : { ...current.track, id: change.trackId!, title: change.title || 'Untitled track', artist: change.artist ?? '', album: change.album ?? '', duration: change.durationMs !== undefined ? change.durationMs / 1000 : current.track.duration, artwork: undefined, tint: undefined };
      const position = change.position !== undefined ? Math.min(change.position, track.duration) : sameTrack ? current.position : 0;
      this.publish({ ...current, playing: change.playing, position, at: Date.now(), track, busy: false });
    }
    this.refresh();
  }
  /** How long to wait after the nth failed read: 5 s, 10 s, 20 s, 40 s, then a minute. */
  static retryDelay(failures: number): number { return Math.min(60_000, 5_000 * 2 ** Math.max(0, failures - 1)); }
  current() { return this.state; }
  private publish(state: SpotifySnapshot) {
    if (state.status !== this.state.status) logEvent('spotify', `status ${this.state.status} → ${state.status}`);
    this.state = state; this.emit('change', state);
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled; this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!enabled) { this.publish({ ...EMPTY_SPOTIFY }); return; }
    this.failures = 0; this.retryAt = 0;
    this.publish({ ...EMPTY_SPOTIFY, player: this.player, status: 'empty', busy: true, message: `Connecting to ${PLAYER_NAMES[this.player]}…` });
    void this.poll();
    this.timer = setInterval(() => this.tick(), this.interval);
  }
  /**
   * The interval's decision. Permission denial stays put — polling cannot
   * grant it and the message tells the user what to do. A read error is
   * usually transient (Spotify mid-launch, a hung Apple Event, the Mac just
   * back from sleep), so those retry with a growing delay rather than either
   * hammering osascript or stopping for good.
   */
  private tick(): void {
    if (this.suspended || this.state.status === 'permission') return;
    if (this.state.status === 'error' && Date.now() < this.retryAt) return;
    void this.poll();
  }
  /** When the next automatic read happens, for tests and the settings pane. */
  nextRetry(): number | null { return this.state.status === 'error' ? this.retryAt : null; }
  /**
   * The Mac is going to sleep. Every poll spawns osascript, and a poll that
   * starts as the lid closes tends to time out and read as an error, which
   * would stop the timer for good. Hold the polls instead and pick up on wake.
   */
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    logEvent('spotify', 'polling suspended');
  }
  /** Back from sleep: read immediately rather than waiting out the interval. */
  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    logEvent('spotify', 'polling resumed');
    this.refresh();
  }
  /** One status read now, outside the interval. A no-op while disabled or asleep. */
  refresh(): void {
    if (!this.enabled || this.suspended) return;
    this.retryAt = 0;
    void this.poll();
  }
  private async poll(): Promise<void> {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    try { await this.enqueue('status'); } finally { this.polling = false; }
  }
  command(command: unknown, position?: unknown): Promise<void> {
    if (!this.enabled) return Promise.reject(new Error('Connect Spotify first.'));
    if (typeof command !== 'string' || !['toggle','next','previous','seek','volume'].includes(command)) return Promise.reject(new Error('Unknown music control.'));
    if (command === 'seek' && (typeof position !== 'number' || !Number.isFinite(position) || !this.state.track)) return Promise.reject(new Error('No track is ready to seek.'));
    if (command === 'volume' && (typeof position !== 'number' || !Number.isFinite(position))) return Promise.reject(new Error('Choose a volume between 0 and 100.'));
    if (this.state.busy) return Promise.reject(new Error('Spotify is still responding.'));
    return this.enqueue(command as SpotifyCommand, command === 'seek' ? Math.min(number(position), this.state.track!.duration) : command === 'volume' ? Math.min(100, Math.round(number(position))) : undefined);
  }
  private enqueue(command: string, position?: number): Promise<void> {
    const generation = this.generation;
    const work = this.queue.then(async () => {
      if (!this.enabled || generation !== this.generation) return;
      if (command !== 'status' && command !== 'volume') this.publish({ ...this.state, busy: true });
      const player = this.player;
      let next = normalizeSpotify(await this.run(command, position, player).catch(() => ({ status: 'error' })), player);
      if (!this.enabled || generation !== this.generation) return;
      // Auto: the chosen player is not open, so look at the other one; whichever answers stays.
      if (this.auto && command === 'status' && next.status === 'not-running') {
        const other: MusicPlayer = player === 'spotify' ? 'apple' : 'spotify';
        const alternative = normalizeSpotify(await this.run('status', undefined, other).catch(() => ({ status: 'error' })), other);
        if (!this.enabled || generation !== this.generation) return;
        if (alternative.status !== 'not-running' && alternative.status !== 'error') { this.player = other; next = alternative; logEvent('spotify', `auto: ${PLAYER_NAMES[other]} is open`); }
      }
      if (next.status === 'error') {
        this.failures++;
        const delay = SpotifyPlayer.retryDelay(this.failures);
        this.retryAt = Date.now() + delay;
        logEvent('spotify', `read failed (${this.failures}), retry in ${Math.round(delay / 1000)}s`);
        this.publish({ ...next, message: `${next.message} Trying again in ${Math.round(delay / 1000)} seconds.` });
        return;
      }
      if (this.failures) logEvent('spotify', `recovered after ${this.failures} failed read${this.failures === 1 ? '' : 's'}`);
      this.failures = 0;
      this.publish(this.withTint(this.withArtists(this.withArtwork(next))));
    });
    this.queue = work.catch(() => {});
    return work;
  }
  /** Apple Music: the sleeve comes as bytes through a script, once per track; Spotify already has a URL. */
  private withArtwork(state: SpotifySnapshot): SpotifySnapshot {
    const track = state.track;
    if (state.player !== 'apple' || !track?.id || track.artwork) return state;
    if (this.artworks.has(track.id)) {
      const artwork = this.artworks.get(track.id);
      return artwork ? { ...state, track: { ...track, artwork } } : state;
    }
    if (!this.pendingArtwork.has(track.id)) {
      this.pendingArtwork.add(track.id);
      const generation = this.generation;
      void this.artwork(track.id).catch(() => null).then(artwork => {
        this.pendingArtwork.delete(track.id);
        const usable = artwork ? validArtwork(artwork) ?? null : null;
        this.artworks.set(track.id, usable);
        if (this.artworks.size > 30) this.artworks.delete(this.artworks.keys().next().value!);
        if (usable && this.enabled && generation === this.generation && this.state.track?.id === track.id) this.publish(this.withTint({ ...this.state, track: { ...this.state.track, artwork: usable } }));
      });
    }
    return state;
  }
  /** Attach the artwork's colour when known; otherwise start finding it. Missing artwork means no tint. */
  private withTint(state: SpotifySnapshot): SpotifySnapshot {
    const artwork = state.track?.artwork;
    if (!state.track || !artwork) return state;
    if (this.tints.has(artwork)) {
      const tint = this.tints.get(artwork);
      return tint ? { ...state, track: { ...state.track, tint } } : state;
    }
    if (!this.pendingTints.has(artwork)) {
      this.pendingTints.add(artwork);
      const generation = this.generation;
      void this.tint(artwork).catch(() => null).then(tint => {
        this.pendingTints.delete(artwork);
        const usable = typeof tint === 'string' && /^#[0-9a-f]{6}$/i.test(tint) ? tint : null;
        this.tints.set(artwork, usable);
        if (this.tints.size > 60) this.tints.delete(this.tints.keys().next().value!);
        if (usable && this.enabled && generation === this.generation && this.state.track?.artwork === artwork) this.publish({ ...this.state, track: { ...this.state.track, tint: usable } });
      });
    }
    return state;
  }
  /** Swap in the full credit when known; otherwise start finding it and keep the lead for now. */
  private withArtists(state: SpotifySnapshot): SpotifySnapshot {
    const track = state.track;
    if (!track?.id || state.player !== 'spotify') return state;
    if (this.artists.has(track.id)) {
      const full = this.artists.get(track.id);
      return full ? { ...state, track: { ...track, artist: full } } : state;
    }
    if (!this.pendingArtists.has(track.id)) {
      this.pendingArtists.add(track.id);
      const generation = this.generation;
      void this.lookup(track.id).catch(() => undefined).then(full => {
        this.pendingArtists.delete(track.id);
        // Only trust a credit that still names the lead Spotify told us about.
        const usable = full && track.artist && full.toLowerCase().includes(track.artist.toLowerCase()) && full !== track.artist ? full : undefined;
        this.artists.set(track.id, usable);
        if (this.artists.size > 60) this.artists.delete(this.artists.keys().next().value!);
        if (usable && this.enabled && generation === this.generation && this.state.track?.id === track.id) this.publish({ ...this.state, track: { ...this.state.track, artist: usable } });
      });
    }
    return state;
  }
  stop() { this.enabled = false; this.generation++; if (this.timer) clearInterval(this.timer); this.timer = null; }
}
