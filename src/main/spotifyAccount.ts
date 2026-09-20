/**
 * The Spotify account behind Smart Shuffle.
 *
 * Reading and controlling the player goes over Apple Events and needs no
 * account. Knowing whether the current track is one Smart Shuffle slipped in —
 * and adding it to the playlist when you want it — needs Spotify's Web API,
 * and that needs a sign-in. Spotify gives every app its own Client ID, so this
 * one is yours: create an app at developer.spotify.com, register the loopback
 * address below as its Redirect URI, and paste the id in Customize.
 *
 * The sign-in is OAuth with PKCE, which is what Spotify asks of desktop apps:
 * a browser tab, a one-shot server on 127.0.0.1 to catch the answer, and a
 * refresh token kept in ~/.notchlight/spotify-account.json — encrypted with
 * the keychain when Electron offers it. No secret is involved; a public client
 * has none to keep.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { logEvent } from './lifecycle';
import type { SpotifyAccountSnapshot } from '../shared/companion';

/** Spotify allows plain http only on a loopback literal, and the port is part of the registered URI. */
export const REDIRECT_PORT = 41739;
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const API_URL = 'https://api.spotify.com/v1';
/** What is playing and from where; playlists, to read and to add to. Skipping goes through the player. */
export const SCOPES = ['user-read-playback-state', 'playlist-read-private', 'playlist-read-collaborative', 'playlist-modify-public', 'playlist-modify-private'];
/** How long the browser tab may take. */
export const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export const isClientId = (value: string): boolean => /^[0-9a-f]{32}$/i.test(value);

const base64url = (buffer: Buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** A fresh PKCE verifier and its S256 challenge. */
export function pkcePair(bytes: Buffer = randomBytes(64)): { verifier: string; challenge: string } {
  const verifier = base64url(bytes);
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}
/** The page the browser opens to ask for access. */
export function authorizeUrl(clientId: string, state: string, challenge: string, redirectUri: string = REDIRECT_URI): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPES.join(' '), state, code_challenge_method: 'S256', code_challenge: challenge }).toString();
  return url.href;
}
/** The browser's answer on the loopback: a code, or why there is none. */
export function parseCallback(url: string, expectedState: string): { code: string } | { error: string } {
  let parsed: URL;
  try { parsed = new URL(url, 'http://127.0.0.1'); } catch { return { error: 'The answer from Spotify could not be read.' }; }
  if (parsed.searchParams.get('state') !== expectedState) return { error: 'The answer from Spotify did not belong to this sign-in.' };
  const error = parsed.searchParams.get('error');
  if (error) return { error: error === 'access_denied' ? 'Spotify access was declined.' : `Spotify refused the sign-in (${error}).` };
  const code = parsed.searchParams.get('code');
  return code ? { code } : { error: 'Spotify did not send a code.' };
}

/** What a sign-in leaves behind. */
export interface TokenRecord {
  /** The app it was issued to; a different id in preferences makes it worthless. */
  clientId: string;
  refreshToken: string;
  accessToken: string;
  /** ms since epoch when the access token stops working. */
  expiresAt: number;
  scope: string;
  user?: { id: string; name: string };
}
/** Electron's safeStorage, or anything shaped like it. */
export interface Cipher { encrypt(text: string): Buffer; decrypt(data: Buffer): string }
function isRecord(value: unknown): value is TokenRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return isClientId(String(r.clientId)) && typeof r.refreshToken === 'string' && !!r.refreshToken && typeof r.accessToken === 'string' && typeof r.expiresAt === 'number' && typeof r.scope === 'string';
}
/** The saved sign-in, or null for none, unreadable, or sealed with a key this Mac no longer has. */
export function readTokenFile(file: string, cipher: Cipher | null): TokenRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const text = typeof raw.sealed === 'string' ? cipher?.decrypt(Buffer.from(raw.sealed, 'base64')) : typeof raw.plain === 'string' ? raw.plain : undefined;
    const record = text ? JSON.parse(text) : null;
    return isRecord(record) ? record : null;
  } catch { return null; }
}
/** Write the sign-in for next time, sealed when a cipher is offered, or remove it. */
export function writeTokenFile(file: string, record: TokenRecord | null, cipher: Cipher | null): void {
  if (!record) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(record);
  const body = cipher ? { sealed: cipher.encrypt(text).toString('base64') } : { plain: text };
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(body) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export interface AccountOptions {
  /** Where the sign-in is kept. */
  file: string;
  fetchImpl?: typeof fetch;
  /** Show the sign-in page; the system browser in the app. */
  open?: (url: string) => Promise<void>;
  cipher?: Cipher | null;
  now?: () => number;
  /** Where to catch the browser's answer. 0 picks a free port, for tests; the app must use the registered one. */
  port?: number;
}

/** One account: signed out until a browser says otherwise, and a bearer token for as long as the refresh token holds. */
export class SpotifyAccount extends EventEmitter {
  private clientId = '';
  private record: TokenRecord | null = null;
  private state: SpotifyAccountSnapshot = { status: 'off' };
  private readonly cipher: Cipher | null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  constructor(private readonly options: AccountOptions) {
    super();
    this.cipher = options.cipher ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }
  snapshot(): SpotifyAccountSnapshot { return this.state; }
  signedIn(): boolean { return this.state.status === 'ready'; }
  /** Who is signed in, by Spotify's id, for telling their playlists from everyone else's. */
  userId(): string | null { return this.signedIn() ? this.record?.user?.id ?? null : null; }
  private publish(next: SpotifyAccountSnapshot): void {
    if (next.status === this.state.status && next.user === this.state.user && next.message === this.state.message) return;
    if (next.status !== this.state.status) logEvent('spotify', `account ${this.state.status} → ${next.status}`);
    this.state = next;
    this.emit('change', next);
  }
  /** Say where things stand from the id and the record alone. */
  private settle(message?: string): void {
    if (!this.clientId) return this.publish({ status: 'off', message: 'Paste your Spotify app’s Client ID to sign in.' });
    if (this.record?.clientId === this.clientId) return this.publish({ status: 'ready', user: this.record.user?.name, message });
    this.publish({ status: 'signed-out', message });
  }
  /** The saved sign-in from disk, if there is one for this Client ID. */
  load(): void {
    this.record = readTokenFile(this.options.file, this.cipher);
    if (this.record) logEvent('spotify', `account: found a sign-in for ${this.record.user?.name ?? 'someone'}`);
    this.settle();
  }
  stop(): void { /* nothing waits yet */ }
}
