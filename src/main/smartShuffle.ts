/**
 * Smart Shuffle picks, and the + and × that answer them.
 *
 * Smart Shuffle slips tracks Spotify thinks you will like into a playlist's
 * flow. Inside Spotify a pick carries a mark, a + that adds it to the playlist
 * and an × that sends it away and tells the recommender it missed. The
 * scripting dictionary says nothing about any of this — it names the track,
 * not where it came from — so the answer comes from the Web API: the playback
 * state says which playlist is playing and whether Smart Shuffle is on, and the
 * playlist's own items say whether the track is one of its own. Playing from a
 * playlist, Smart Shuffle on, not in the playlist: a pick.
 *
 * The + is Spotify's own: the track goes into the playlist, and the mark goes
 * with it because the track is now one of the playlist's own. The × is half of
 * Spotify's: it skips the track, but Spotify keeps no public door for "not for
 * me", so the recommender hears the skip and nothing more. Spotify's desktop
 * app exposes no accessibility tree for its own buttons either, so there is
 * nothing to press on its behalf.
 */
import { EventEmitter } from 'node:events';
import { logEvent } from './lifecycle';
import type { SpotifyAccount } from './spotifyAccount';
import type { SmartShufflePick, SmartShuffleSnapshot } from '../shared/companion';

/** What the playback state says, as much of it as a pick needs. */
export interface Playback {
  trackUri: string | null;
  /** The track this one stands in for, when Spotify relinked it for this market. */
  linkedUri: string | null;
  playlistId: string | null;
  /** Spotify's word on Smart Shuffle; null when the answer does not carry it. */
  smartShuffle: boolean | null;
  playing: boolean;
}
const str = (v: unknown) => typeof v === 'string' && v ? v : null;
/** spotify:playlist:… and the older spotify:user:…:playlist:… both name a playlist. */
export const playlistIdOf = (uri: string | null): string | null => uri ? /^spotify:(?:user:[^:]+:)?playlist:([A-Za-z0-9]{22})$/.exec(uri)?.[1] ?? null : null;
/** GET /me/player into a Playback; null when nothing is playing (a 204, or a body with no item). */
export function parsePlayback(body: unknown): Playback | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const item = raw.item && typeof raw.item === 'object' ? raw.item as Record<string, unknown> : null;
  if (!item) return null;
  const linked = item.linked_from && typeof item.linked_from === 'object' ? item.linked_from as Record<string, unknown> : null;
  const context = raw.context && typeof raw.context === 'object' ? raw.context as Record<string, unknown> : null;
  return {
    trackUri: str(item.uri),
    linkedUri: linked ? str(linked.uri) : null,
    playlistId: context?.type === 'playlist' ? playlistIdOf(str(context.uri)) : null,
    smartShuffle: typeof raw.smart_shuffle === 'boolean' ? raw.smart_shuffle : null,
    playing: raw.is_playing === true
  };
}
/** The playlist itself: enough to name it, to know whose it is, and to notice when it changes. */
export interface PlaylistInfo { name: string; snapshotId: string; ownerId: string; collaborative: boolean; total: number }
export function parsePlaylist(body: unknown): PlaylistInfo | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const owner = raw.owner && typeof raw.owner === 'object' ? raw.owner as Record<string, unknown> : null;
  // The playlist's contents are `items` since March 2026, `tracks` before.
  const tracks = raw.items && typeof raw.items === 'object' ? raw.items as Record<string, unknown> : raw.tracks && typeof raw.tracks === 'object' ? raw.tracks as Record<string, unknown> : null;
  const snapshotId = str(raw.snapshot_id);
  if (!snapshotId) return null;
  return { name: str(raw.name) ?? 'the playlist', snapshotId, ownerId: (owner && str(owner.id)) ?? '', collaborative: raw.collaborative === true, total: typeof tracks?.total === 'number' ? tracks.total : 0 };
}
/** One page of a playlist's items: every track uri on it, and where the next page is. */
export function parsePlaylistPage(body: unknown): { uris: string[]; next: string | null } | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>).items)) return null;
  const raw = body as { items: unknown[]; next?: unknown };
  const uris: string[] = [];
  for (const item of raw.items) {
    // Since the March 2026 API the entry is `item`; `track` is what it was called before.
    const entry = item && typeof item === 'object' ? item as Record<string, unknown> : null;
    const track = entry?.item ?? entry?.track;
    if (!track || typeof track !== 'object') continue;
    const t = track as Record<string, unknown>;
    const uri = str(t.uri);
    if (uri) uris.push(uri);
    const linked = t.linked_from && typeof t.linked_from === 'object' ? str((t.linked_from as Record<string, unknown>).uri) : null;
    if (linked) uris.push(linked);
  }
  return { uris, next: str(raw.next) };
}
/** Playing from a playlist, Smart Shuffle not off, and the track not among the playlist's own. */
export function isPick(playback: Playback, members: ReadonlySet<string>): boolean {
  if (!playback.playlistId || !playback.trackUri || playback.smartShuffle === false) return false;
  return !members.has(playback.trackUri) && !(playback.linkedUri && members.has(playback.linkedUri));
}

export interface SmartShuffleOptions {
  /** Skip the current track through the player: instant, and no Premium needed. */
  skip: () => Promise<void>;
  /** How long a track change waits before the read, so a run of skips is one read. */
  settleMs?: number;
  /** While the same track keeps playing, look again this often: Smart Shuffle can be switched mid-track. */
  heartbeatMs?: number;
  /** Pages of a hundred a playlist may run to; past that its membership is unknown and nothing is marked. */
  maxPages?: number;
}
type Playlist = { info: PlaylistInfo; members: Set<string> };

/** Follows the player's current track and says whether it is a pick; answers with the + and the ×. */
export class SmartShuffle extends EventEmitter {
  private enabled = false;
  private trackId: string | null = null;
  private playing = false;
  private pick: SmartShufflePick | null = null;
  private busy = false;
  private readonly settleMs: number;
  private readonly heartbeatMs: number;
  private readonly maxPages: number;
  constructor(private readonly account: SpotifyAccount, private readonly options: SmartShuffleOptions) {
    super();
    this.settleMs = options.settleMs ?? 500;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
    this.maxPages = options.maxPages ?? 50;
    // Signing in starts a read for the track already playing; signing out takes the mark down.
    account.on('change', () => { if (account.signedIn()) this.schedule(); else { this.clearTimers(); this.pick = null; } this.publish(); });
  }
  snapshot(): SmartShuffleSnapshot { return { account: this.account.snapshot(), pick: this.pick, busy: this.busy }; }
  private publish(): void { this.emit('change', this.snapshot()); }
  private setPick(pick: SmartShufflePick | null): void {
    if (pick === this.pick || pick && this.pick && pick.trackId === this.pick.trackId && pick.playlistId === this.pick.playlistId && pick.canAdd === this.pick.canAdd) return;
    if (pick) logEvent('spotify', `smart shuffle: pick from ${pick.playlistName}`);
    this.pick = pick;
    this.publish();
  }
  private setBusy(busy: boolean): void { if (busy !== this.busy) { this.busy = busy; this.publish(); } }
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.timer = this.heartbeat = null;
  }
  /** The preference, and whether Spotify is connected at all. Off clears the mark at once. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) { this.clearTimers(); this.setPick(null); return; }
    this.schedule();
  }
  /** The player's word: which Spotify track is current, and whether it plays. Null when there is none, or the player is Apple Music. */
  observe(trackId: string | null, playing: boolean): void {
    const changed = trackId !== this.trackId;
    this.trackId = trackId;
    this.playing = playing;
    if (!changed) {
      if (!playing) { if (this.heartbeat) clearTimeout(this.heartbeat); this.heartbeat = null; }
      else if (!this.heartbeat && !this.timer && !this.reading) this.armHeartbeat();
      return;
    }
    this.setPick(null);
    this.clearTimers();
    if (trackId) this.schedule();
  }
  private schedule(delay = this.settleMs): void {
    if (!this.enabled || !this.trackId || !this.account.signedIn()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.read(); }, delay);
  }
  private reading = false;
  private again = false;
  /** One look at the playback state for the track the player says is current. */
  private async read(): Promise<void> {
    if (this.reading) { this.again = true; return; }
    this.reading = true;
    const trackId = this.trackId;
    try {
      if (!trackId || !this.enabled) return;
      const { status, body } = await this.account.request('/me/player');
      if (this.trackId !== trackId || !this.enabled) return;
      if (status !== 200) { if (status !== 204) logEvent('spotify', `smart shuffle: playback state answered ${status}`); this.setPick(null); return; }
      const playback = parsePlayback(body);
      // The Web API and the scripting read can disagree for a beat around a skip; the heartbeat looks again.
      if (!playback || playback.trackUri !== trackId) return;
      if (!playback.playlistId || playback.smartShuffle === false) { this.setPick(null); return; }
      const playlist = await this.playlist(playback.playlistId);
      if (this.trackId !== trackId || !this.enabled) return;
      if (!playlist) { this.setPick(null); return; }
      const me = this.account.userId();
      this.setPick(isPick(playback, playlist.members) ? { trackId, playlistId: playback.playlistId, playlistName: playlist.info.name, canAdd: playlist.info.collaborative || !!me && playlist.info.ownerId === me } : null);
    } catch (error) {
      logEvent('spotify', `smart shuffle: read failed (${(error as Error).message})`);
    } finally {
      this.reading = false;
      if (this.again) { this.again = false; this.schedule(0); }
      else this.armHeartbeat();
    }
  }
  /** Look again in a while, as long as something is playing. */
  private armHeartbeat(): void {
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.heartbeat = this.enabled && this.trackId && this.playing ? setTimeout(() => { this.heartbeat = null; void this.read(); }, this.heartbeatMs) : null;
  }
  private playlists = new Map<string, Playlist>();
  /**
   * The playlist and every track uri in it. Its particulars are read each
   * time — one small call — and the items only when the snapshot id says they
   * moved, so a long playlist is walked once and then remembered.
   */
  private async playlist(id: string): Promise<Playlist | null> {
    const head = await this.account.request(`/playlists/${id}?fields=name,snapshot_id,owner(id),collaborative,items(total)`);
    const info = head.status === 200 ? parsePlaylist(head.body) : null;
    if (!info) { logEvent('spotify', `smart shuffle: playlist ${id} answered ${head.status}`); return null; }
    const cached = this.playlists.get(id);
    if (cached && cached.info.snapshotId === info.snapshotId) { cached.info = info; return cached; }
    if (info.total > this.maxPages * 100) { logEvent('spotify', `smart shuffle: ${info.name} has ${info.total} tracks, too many to check`); return null; }
    const members = new Set<string>();
    // /tracks answers 403 to development-mode apps since March 9, 2026; /items is the door now, and linked_from is gone with it.
    let next: string | null = `/playlists/${id}/items?fields=items(item(uri)),next&limit=100`;
    for (let page = 0; next && page < this.maxPages; page++) {
      const answer = await this.account.request(next);
      const parsed = answer.status === 200 ? parsePlaylistPage(answer.body) : null;
      if (!parsed) { logEvent('spotify', `smart shuffle: playlist items answered ${answer.status}`); return null; }
      for (const uri of parsed.uris) members.add(uri);
      next = parsed.next;
    }
    const entry = { info, members };
    this.playlists.delete(id);
    this.playlists.set(id, entry);
    if (this.playlists.size > 8) this.playlists.delete(this.playlists.keys().next().value!);
    logEvent('spotify', `smart shuffle: read ${members.size} of ${info.name}`);
    return entry;
  }
  /** The pick the buttons are for, or a sentence about why there is none. */
  private current(): SmartShufflePick {
    const pick = this.pick;
    if (!pick || pick.trackId !== this.trackId) throw new Error('There is no Smart Shuffle pick to answer right now.');
    if (this.busy) throw new Error('Still answering the last pick.');
    return pick;
  }
  /** The +: the track becomes one of the playlist's own, and the mark goes. */
  async add(): Promise<void> {
    const pick = this.current();
    if (!pick.canAdd) throw new Error(`${pick.playlistName} is not yours to add to.`);
    this.setBusy(true);
    try {
      const { status, body } = await this.account.request(`/playlists/${pick.playlistId}/items`, { method: 'POST', body: JSON.stringify({ uris: [pick.trackId] }) });
      if (status !== 200 && status !== 201) {
        const detail = body && typeof body === 'object' && (body as { error?: { message?: unknown } }).error?.message;
        throw new Error(status === 403 ? `Spotify would not let this account add to ${pick.playlistName}.` : `Spotify did not add the track${typeof detail === 'string' ? ` (${detail})` : ''}.`);
      }
      const playlist = this.playlists.get(pick.playlistId);
      if (playlist) {
        playlist.members.add(pick.trackId);
        const snapshotId = body && typeof body === 'object' ? (body as { snapshot_id?: unknown }).snapshot_id : undefined;
        if (typeof snapshotId === 'string') playlist.info.snapshotId = snapshotId;
      }
      logEvent('spotify', `smart shuffle: added to ${pick.playlistName}`);
      if (this.pick === pick) this.setPick(null);
      this.emit('notice', `Added to ${pick.playlistName}.`);
    } finally { this.setBusy(false); }
  }
  /**
   * The ×: away with it. Spotify's own × also tells the recommender it missed;
   * there is no public door for that, so the skip is the whole of the message.
   */
  async dismiss(): Promise<void> {
    const pick = this.current();
    this.setBusy(true);
    try {
      await this.options.skip();
      logEvent('spotify', `smart shuffle: skipped a pick from ${pick.playlistName}`);
      if (this.pick === pick) this.setPick(null);
    } finally { this.setBusy(false); }
  }
  stop(): void { this.clearTimers(); }
}
