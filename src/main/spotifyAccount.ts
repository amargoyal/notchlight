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
/** Spotify's own words for a refusal, or ours. */
const describeRefusal = (body: Record<string, unknown> | null, fallback = 'Spotify refused the sign-in.') => {
  const detail = body && typeof body.error_description === 'string' ? body.error_description : body && typeof body.error === 'string' ? body.error : '';
  return detail ? `${fallback.replace(/\.$/, '')}: ${detail}.` : fallback;
};
/** What the browser tab shows once the answer is in. */
const answerPage = (message: string) => `<!doctype html><meta charset="utf-8"><title>Notchlight</title><body style="font: 15px/1.5 -apple-system, sans-serif; color: #f2ede7; background: #141210; display: grid; place-items: center; height: 100vh; margin: 0"><p style="max-width: 32em; text-align: center">${message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</p></body>`;

export class SpotifyAccount extends EventEmitter {
  private clientId = '';
  private record: TokenRecord | null = null;
  /** The sign-in in progress: how to stop it, and the port it listens on. */
  private signing: { cancel: (why: string) => void; port: number } | null = null;
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
  /** The Client ID from preferences. A sign-in belongs to one id; another id starts from signed out. */
  configure(clientId: string): void {
    const id = isClientId(clientId) ? clientId.toLowerCase() : '';
    if (id === this.clientId) return;
    this.clientId = id;
    if (this.record && this.record.clientId !== id) {
      this.record = null;
      try { writeTokenFile(this.options.file, null, this.cipher); } catch { /* the id check hides it anyway */ }
    }
    this.settle();
  }
  /**
   * Sign in: a one-shot server on the loopback, the authorize page in the
   * browser, and the code the browser brings back. Resolves once the account
   * is ready; rejects with a sentence when the tab is closed, times out, or
   * says no. Starting again cancels the one in progress.
   */
  async signIn(): Promise<void> {
    if (!this.clientId) throw new Error('Paste your Spotify app’s Client ID first.');
    this.signing?.cancel('Sign-in started over.');
    const { verifier, challenge } = pkcePair();
    const state = base64url(randomBytes(16));
    const wanted = this.options.port ?? REDIRECT_PORT;
    let redirectUri = '';
    const code = await new Promise<string>((resolve, reject) => {
      let done = false;
      const server = http.createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') { response.statusCode = 404; response.end(); return; }
        const answer = parseCallback(request.url ?? '', state);
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(answerPage('code' in answer ? 'Signed in. You can close this tab and go back to Notchlight.' : answer.error));
        if ('code' in answer) finish(null, answer.code); else finish(new Error(answer.error));
      });
      const timer = setTimeout(() => finish(new Error('The sign-in took too long. Try again.')), SIGN_IN_TIMEOUT_MS);
      const finish = (error: Error | null, code?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.signing = null;
        server.close();
        if (error) reject(error); else resolve(code!);
      };
      server.on('error', (error: NodeJS.ErrnoException) => finish(new Error(error.code === 'EADDRINUSE' ? `Port ${wanted} is in use by something else, and Spotify only answers on the registered one.` : `The sign-in could not listen for Spotify’s answer (${error.message}).`)));
      server.listen(wanted, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port;
        this.signing = { cancel: why => finish(new Error(why)), port };
        redirectUri = `http://127.0.0.1:${port}/callback`;
        this.publish({ status: 'signing-in', message: 'Finish signing in in your browser.' });
        const open = this.options.open ?? (async () => { throw new Error('No browser to open.'); });
        open(authorizeUrl(this.clientId, state, challenge, redirectUri)).catch(error => finish(new Error(`The browser could not be opened (${(error as Error).message}).`)));
      });
    }).catch(error => { this.settle((error as Error).message); throw error; });
    const { status, body } = await this.accounts({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: this.clientId, code_verifier: verifier }).catch(error => { throw new Error(`Spotify could not be reached to finish the sign-in (${(error as Error).message}).`); });
    if (status !== 200 || !body) { const why = describeRefusal(body); this.settle(why); throw new Error(why); }
    this.record = this.accept(body, null);
    this.persist();
    this.settle();
  }
  /** One call to the accounts service, with a deadline; the body as JSON, or null when it is not. */
  private async accounts(form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: controller.signal });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      return { status: response.status, body };
    } finally { clearTimeout(timer); }
  }
  /** The token response into a record, keeping the old refresh token when Spotify sends none. */
  private accept(body: Record<string, unknown>, previous: TokenRecord | null): TokenRecord {
    const access = body.access_token;
    const refresh = typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : previous?.refreshToken;
    const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
    if (typeof access !== 'string' || !access || !refresh) throw new Error('Spotify’s answer had no token in it.');
    return { clientId: this.clientId, accessToken: access, refreshToken: refresh, expiresAt: this.now() + expiresIn * 1000, scope: typeof body.scope === 'string' ? body.scope : previous?.scope ?? '', user: previous?.user };
  }
  private refreshing: Promise<string | null> | null = null;
  /**
   * A bearer token that works right now: the saved one while it has half a
   * minute left, otherwise a fresh one from the refresh token. Null when signed
   * out, or when Spotify no longer honours the refresh token — which signs the
   * account out, with a sentence saying so.
   */
  token(): Promise<string | null> {
    const record = this.record;
    if (!record || record.clientId !== this.clientId) return Promise.resolve(null);
    if (record.expiresAt - this.now() > 30_000) return Promise.resolve(record.accessToken);
    this.refreshing ??= this.refresh(record).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  private async refresh(record: TokenRecord): Promise<string | null> {
    let answer: { status: number; body: Record<string, unknown> | null };
    try { answer = await this.accounts({ grant_type: 'refresh_token', refresh_token: record.refreshToken, client_id: this.clientId }); }
    catch (error) { logEvent('spotify', `account: refresh failed (${(error as Error).message})`); return null; }
    if (this.record !== record) return this.record?.accessToken ?? null;
    if (answer.status === 200 && answer.body) {
      this.record = this.accept(answer.body, record);
      this.persist();
      return this.record.accessToken;
    }
    // 400 invalid_grant: revoked, or the app was deleted. Anything else is Spotify having a moment.
    if (answer.status === 400) {
      logEvent('spotify', `account: refresh refused (${describeRefusal(answer.body, '')})`);
      this.record = null;
      this.persist();
      this.settle('Spotify signed you out. Sign in again to see Smart Shuffle picks.');
    } else logEvent('spotify', `account: refresh answered ${answer.status}`);
    return null;
  }
  private persist(): void {
    try { writeTokenFile(this.options.file, this.record, this.cipher); }
    catch (error) { logEvent('spotify', `account: could not save the sign-in (${(error as Error).message})`); }
  }
  stop(): void { this.signing?.cancel('Notchlight is quitting.'); }
}
