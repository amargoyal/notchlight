import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { EMPTY_SPOTIFY, type SpotifySnapshot, type SpotifyCommand } from '../shared/companion';

const execute = promisify(execFile);
export type SpotifyRunner = (command: string, position?: number) => Promise<unknown>;
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
const str = (v: unknown) => typeof v === 'string' ? v.slice(0, 2000) : '';
export function normalizeSpotify(value: unknown): SpotifySnapshot {
  if (!value || typeof value !== 'object') return { ...EMPTY_SPOTIFY, status: 'error', message: 'Spotify did not return playback information.' };
  const raw = value as Record<string, unknown>;
  const base = { ...EMPTY_SPOTIFY };
  if (raw.status === 'not-running') return { ...base, status: 'not-running', message: 'Open Spotify to see what’s playing.' };
  if (raw.status === 'empty') return { ...base, status: 'empty', message: 'Choose something to play in Spotify.' };
  if (raw.status === 'permission') return { ...base, status: 'permission', message: 'Allow Claude Light to control Spotify in System Settings → Privacy & Security → Automation, then reconnect.' };
  if (raw.status !== 'ready' || !raw.track || typeof raw.track !== 'object') return { ...base, status: 'error', message: 'Could not read Spotify. Try reconnecting.' };
  const track = raw.track as Record<string, unknown>;
  const duration = number(track.durationMs) / 1000;
  return { ...base, status: 'ready', playing: raw.playing === true, position: Math.min(number(raw.position), duration),
    track: { id: str(track.id), title: str(track.title) || 'Untitled track', artist: str(track.artist), album: str(track.album), duration, artwork: validArtwork(str(track.artwork)) } };
}
export function validArtwork(value: string): string | undefined {
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

async function runSpotify(command: string, position?: number): Promise<unknown> {
  const script = path.join(__dirname, '../../native/spotify.js');
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
  constructor(private run: SpotifyRunner = runSpotify, private lookup: ArtistLookup = fetchArtists) { super(); }
  current() { return this.state; }
  private publish(state: SpotifySnapshot) { this.state = state; this.emit('change', state); }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled; this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!enabled) { this.publish({ ...EMPTY_SPOTIFY }); return; }
    this.publish({ ...EMPTY_SPOTIFY, status: 'empty', busy: true, message: 'Connecting to Spotify…' });
    void this.poll();
    this.timer = setInterval(() => { if (!['permission', 'error'].includes(this.state.status)) void this.poll(); }, 2500);
  }
  private async poll(): Promise<void> {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    try { await this.enqueue('status'); } finally { this.polling = false; }
  }
  command(command: unknown, position?: unknown): Promise<void> {
    if (!this.enabled) return Promise.reject(new Error('Connect Spotify first.'));
    if (typeof command !== 'string' || !['toggle','next','previous','seek'].includes(command)) return Promise.reject(new Error('Unknown music control.'));
    if (command === 'seek' && (typeof position !== 'number' || !Number.isFinite(position) || !this.state.track)) return Promise.reject(new Error('No track is ready to seek.'));
    if (this.state.busy) return Promise.reject(new Error('Spotify is still responding.'));
    return this.enqueue(command as SpotifyCommand, command === 'seek' ? Math.min(number(position), this.state.track!.duration) : undefined);
  }
  private enqueue(command: string, position?: number): Promise<void> {
    const generation = this.generation;
    const work = this.queue.then(async () => {
      if (!this.enabled || generation !== this.generation) return;
      if (command !== 'status') this.publish({ ...this.state, busy: true });
      const next = normalizeSpotify(await this.run(command, position).catch(() => ({ status: 'error' })));
      if (this.enabled && generation === this.generation) this.publish(this.withArtists(next));
    });
    this.queue = work.catch(() => {});
    return work;
  }
  /** Swap in the full credit when known; otherwise start finding it and keep the lead for now. */
  private withArtists(state: SpotifySnapshot): SpotifySnapshot {
    const track = state.track;
    if (!track?.id) return state;
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
