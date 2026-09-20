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
  const tracks = raw.tracks && typeof raw.tracks === 'object' ? raw.tracks as Record<string, unknown> : null;
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
    const track = item && typeof item === 'object' && (item as Record<string, unknown>).track;
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
