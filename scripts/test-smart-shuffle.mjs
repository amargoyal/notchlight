/**
 * Smart Shuffle without Spotify: the sign-in against a stand-in accounts
 * service and a loopback the test itself answers, the token file, and the
 * pick rule and its two answers against a stand-in account. Run with
 * `npm run test:smart-shuffle`.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notchlight-smart-shuffle-'));
const until = async (test, why) => { for (let i = 0; i < 400; i++) { if (test()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error(`timed out: ${why}`); };
try {
  await build({ entryPoints: ['src/main/spotifyAccount.ts', 'src/main/smartShuffle.ts'], bundle: true, platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, outdir: root, logLevel: 'silent' });
  const require = createRequire(import.meta.url);
  const account = require(path.join(root, 'spotifyAccount.cjs'));
  const shuffle = require(path.join(root, 'smartShuffle.cjs'));

  // The PKCE pair, by the book.
  const bytes = Buffer.alloc(64, 7);
  const pair = account.pkcePair(bytes);
  const b64 = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(pair.verifier, b64(bytes));
  assert.equal(pair.challenge, b64(createHash('sha256').update(pair.verifier).digest()));
  assert.notEqual(account.pkcePair().verifier, account.pkcePair().verifier, 'fresh every time');

  // The authorize page carries everything Spotify asks for.
  const id = 'a'.repeat(32);
  const authorize = new URL(account.authorizeUrl(id, 'st', 'ch'));
  assert.equal(authorize.origin + authorize.pathname, account.AUTHORIZE_URL);
  assert.equal(authorize.searchParams.get('client_id'), id);
  assert.equal(authorize.searchParams.get('redirect_uri'), account.REDIRECT_URI);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('code_challenge'), 'ch');
  assert.equal(authorize.searchParams.get('state'), 'st');
  assert.ok(authorize.searchParams.get('scope').includes('playlist-modify-private'));

  // The browser's answer.
  assert.deepEqual(account.parseCallback('/callback?code=c1&state=st', 'st'), { code: 'c1' });
  assert.ok('error' in account.parseCallback('/callback?code=c1&state=other', 'st'), 'a stranger’s state');
  assert.match(account.parseCallback('/callback?error=access_denied&state=st', 'st').error, /declined/);
  assert.match(account.parseCallback('/callback?state=st', 'st').error, /no code/i);
  assert.ok(account.isClientId(id) && !account.isClientId('nope') && !account.isClientId(id + 'a'));

  // The token file, sealed and plain.
  const cipher = { encrypt: text => Buffer.from([...text].reverse().join('')), decrypt: data => [...data.toString()].reverse().join('') };
  const file = path.join(root, 'state', 'spotify-account.json');
  const record = { clientId: id, refreshToken: 'r', accessToken: 'a', expiresAt: 5, scope: 's', user: { id: 'u', name: 'U' } };
  account.writeTokenFile(file, record, cipher);
  assert.deepEqual(account.readTokenFile(file, cipher), record);
  assert.equal(account.readTokenFile(file, null), null, 'sealed, and no key');
  assert.ok(!JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))).includes('"r"'), 'nothing readable on disk');
  account.writeTokenFile(file, record, null);
  assert.deepEqual(account.readTokenFile(file, null), record);
  fs.writeFileSync(file, '{"plain":"{\\"clientId\\":1}"}');
  assert.equal(account.readTokenFile(file, null), null, 'a record that does not hold together');
  account.writeTokenFile(file, null, null);
  assert.ok(!fs.existsSync(file), 'signing out removes the file');

  // The sign-in, end to end: the test is the browser and the accounts service.
  let now = 1_000_000_000;
  let refreshAnswer = () => ({ status: 200, body: { access_token: 'a2', expires_in: 3600 } });
  let apiAnswer = () => ({ status: 200, body: { id: 'amar', display_name: 'Amar' } });
  const fetches = [];
  const fetchImpl = async (url, init = {}) => {
    fetches.push({ url: String(url), init });
    const answer = (a) => ({ status: a.status, ok: a.status < 400, headers: new Headers(a.headers ?? {}), json: async () => a.body });
    if (String(url) === account.TOKEN_URL) {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'authorization_code') {
        assert.equal(form.get('code'), 'the-code');
        assert.equal(form.get('client_id'), id);
        assert.ok(form.get('code_verifier'));
        assert.match(form.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        return answer({ status: 200, body: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'x' } });
      }
      assert.equal(form.get('refresh_token'), 'r1');
      return answer(refreshAnswer(form));
    }
    return answer(apiAnswer(String(url), init));
  };
  const opened = [];
  const open = async url => {
    opened.push(url);
    const u = new URL(url);
    await fetch(`${u.searchParams.get('redirect_uri')}?code=the-code&state=${u.searchParams.get('state')}`);
  };
  const acct = new account.SpotifyAccount({ file, fetchImpl, open, cipher, now: () => now, port: 0 });
  const states = [];
  acct.on('change', s => states.push(s.status));
  acct.load();
  assert.equal(acct.snapshot().status, 'off', 'no id, nothing to sign in to');
  await assert.rejects(acct.signIn(), /Client ID first/);
  acct.configure(id.toUpperCase());
  assert.equal(acct.snapshot().status, 'signed-out');
  await acct.signIn();
  assert.equal(acct.snapshot().status, 'ready');
  assert.equal(acct.snapshot().user, 'Amar');
  assert.equal(acct.userId(), 'amar');
  assert.deepEqual(states, ['signed-out', 'signing-in', 'ready']);
  assert.equal(opened.length, 1);
  assert.equal(account.readTokenFile(file, cipher).refreshToken, 'r1', 'saved for next time');
  assert.equal(await acct.token(), 'a1');
  now += 3600 * 1000;
  assert.equal(await acct.token(), 'a2', 'refreshed once it ran out');
  assert.equal(account.readTokenFile(file, cipher).refreshToken, 'r1', 'the old refresh token stands when Spotify sends none');
  // A 401 mid-request refreshes and tries once more.
  let denied = true;
  apiAnswer = (url) => denied ? (denied = false, { status: 401, body: { error: { status: 401 } } }) : { status: 200, body: { url } };
  refreshAnswer = () => ({ status: 200, body: { access_token: 'a3', refresh_token: 'r1', expires_in: 3600 } });
  const before = fetches.length;
  const reply = await acct.request('/playlists/x');
  assert.equal(reply.status, 200);
  assert.equal(reply.body.url, `${account.API_URL}/playlists/x`);
  assert.equal(fetches.length - before, 3, 'the call, the refresh, the call again');
  assert.equal(fetches.at(-1).init.headers.authorization, 'Bearer a3');
  // A refresh Spotify refuses is a sign-out, with a sentence.
  now += 3600 * 1000;
  refreshAnswer = () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Refresh token revoked' } });
  assert.equal(await acct.token(), null);
  assert.equal(acct.snapshot().status, 'signed-out');
  assert.match(acct.snapshot().message, /signed you out/i);
  assert.ok(!fs.existsSync(file));
  await assert.rejects(acct.request('/me'), /Sign in/);
  // Another id throws a sign-in away; the same id, spelt differently, does not.
  refreshAnswer = () => ({ status: 200, body: { access_token: 'a4', expires_in: 3600 } });
  await acct.signIn();
  assert.equal(acct.snapshot().status, 'ready');
  acct.configure(id.toUpperCase());
  assert.equal(acct.snapshot().status, 'ready');
  acct.configure('b'.repeat(32));
  assert.equal(acct.snapshot().status, 'signed-out');
  assert.ok(!fs.existsSync(file));
  // A sign-in nobody finishes can be cancelled by signing out.
  const idle = new account.SpotifyAccount({ file, fetchImpl, open: async () => {}, cipher, now: () => now, port: 0 });
  idle.configure(id);
  const pending = idle.signIn();
  await until(() => idle.snapshot().status === 'signing-in', 'listening');
  idle.signOut();
  await assert.rejects(pending, /Signed out/);
  assert.equal(idle.snapshot().status, 'signed-out');
  idle.stop();
  acct.stop();

  // The pick rule and its readers.
  const P = '37i9dQZF1DXcBWIGoYBM5M';
  const playing = (uri, extra = {}) => ({ is_playing: true, smart_shuffle: true, context: { type: 'playlist', uri: `spotify:playlist:${P}` }, item: { uri }, ...extra });
  assert.equal(shuffle.playlistIdOf(`spotify:playlist:${P}`), P);
  assert.equal(shuffle.playlistIdOf(`spotify:user:amar:playlist:${P}`), P);
  assert.equal(shuffle.playlistIdOf('spotify:album:' + P), null);
  assert.equal(shuffle.parsePlayback(null), null, 'a 204');
  assert.equal(shuffle.parsePlayback({ is_playing: false }), null, 'no item');
  assert.deepEqual(shuffle.parsePlayback(playing('spotify:track:t1')), { trackUri: 'spotify:track:t1', linkedUri: null, playlistId: P, smartShuffle: true, playing: true });
  assert.equal(shuffle.parsePlayback(playing('spotify:track:t1', { context: { type: 'album', uri: 'spotify:album:x' } })).playlistId, null);
  assert.equal(shuffle.parsePlayback(playing('spotify:track:t1', { smart_shuffle: undefined })).smartShuffle, null, 'the field is undocumented; its absence is not a no');
  assert.equal(shuffle.parsePlayback(playing('spotify:track:t1', { item: { uri: 'spotify:track:t1', linked_from: { uri: 'spotify:track:t0' } } })).linkedUri, 'spotify:track:t0');
  assert.deepEqual(shuffle.parsePlaylist({ name: 'Late Drives', snapshot_id: 's1', owner: { id: 'amar' }, collaborative: false, tracks: { total: 3 } }), { name: 'Late Drives', snapshotId: 's1', ownerId: 'amar', collaborative: false, total: 3 });
  assert.equal(shuffle.parsePlaylist({ name: 'x' }), null, 'no snapshot id, no playlist');
  assert.deepEqual(shuffle.parsePlaylistPage({ items: [{ track: { uri: 'spotify:track:a' } }, { track: null }, { track: { uri: 'spotify:track:b', linked_from: { uri: 'spotify:track:b0' } } }], next: null }), { uris: ['spotify:track:a', 'spotify:track:b', 'spotify:track:b0'], next: null });
  assert.equal(shuffle.parsePlaylistPage({}), null);
  const members = new Set(['spotify:track:own1', 'spotify:track:own2']);
  assert.equal(shuffle.isPick(shuffle.parsePlayback(playing('spotify:track:pick1')), members), true);
  assert.equal(shuffle.isPick(shuffle.parsePlayback(playing('spotify:track:own1')), members), false, 'one of the playlist’s own');
  assert.equal(shuffle.isPick(shuffle.parsePlayback(playing('spotify:track:pick1', { smart_shuffle: false })), members), false, 'Smart Shuffle off: a queued track, not a pick');
  assert.equal(shuffle.isPick(shuffle.parsePlayback(playing('spotify:track:pick1', { smart_shuffle: undefined })), members), true, 'no word on Smart Shuffle: membership decides');
  assert.equal(shuffle.isPick(shuffle.parsePlayback(playing('spotify:track:x', { item: { uri: 'spotify:track:x', linked_from: { uri: 'spotify:track:own2' } } })), members), false, 'relinked from one of the playlist’s own');
  assert.equal(shuffle.isPick(shuffle.parsePlayback(playing('spotify:track:pick1', { context: null })), members), false, 'not from a playlist');

  // The reads and the answers, against a stand-in account.
  class FakeAccount extends EventEmitter {
    ready = true; calls = []; head = { name: 'Late Drives', snapshot_id: 's1', owner: { id: 'amar' }, collaborative: false, tracks: { total: 2 } };
    playback = playing('spotify:track:pick1');
    signedIn() { return this.ready; }
    userId() { return this.ready ? 'amar' : null; }
    snapshot() { return { status: this.ready ? 'ready' : 'signed-out' }; }
    async request(target, init = {}) {
      this.calls.push({ target, method: init.method ?? 'GET', body: init.body });
      if (target === '/me/player') return this.playback ? { status: 200, body: this.playback } : { status: 204, body: null };
      if (target.startsWith(`/playlists/${P}?`)) return { status: 200, body: this.head };
      if (target.startsWith(`/playlists/${P}/tracks?`)) return { status: 200, body: { items: [{ track: { uri: 'spotify:track:own1' } }], next: `${account.API_URL}/playlists/${P}/tracks?offset=1&limit=100` } };
      if (target.startsWith(`${account.API_URL}/playlists/${P}/tracks?offset=1`)) return { status: 200, body: { items: [{ track: { uri: 'spotify:track:own2' } }], next: null } };
      if (target === `/playlists/${P}/tracks` && init.method === 'POST') return { status: 201, body: { snapshot_id: 's2' } };
      throw new Error(`unexpected ${target}`);
    }
  }
  const fake = new FakeAccount();
  const skips = [];
  const smart = new shuffle.SmartShuffle(fake, { skip: async () => { skips.push(1); }, settleMs: 5, heartbeatMs: 60_000 });
  const notices = [];
  smart.on('notice', n => notices.push(n));
  smart.setEnabled(true);
  assert.equal(smart.snapshot().pick, null);
  smart.observe('spotify:track:pick1', true);
  await until(() => smart.snapshot().pick, 'the first pick');
  assert.deepEqual(smart.snapshot().pick, { trackId: 'spotify:track:pick1', playlistId: P, playlistName: 'Late Drives', canAdd: true });
  assert.deepEqual(fake.calls.map(c => c.method), ['GET', 'GET', 'GET', 'GET'], 'playback, the head, two pages');
  // The +.
  await smart.add();
  assert.equal(smart.snapshot().pick, null, 'one of the playlist’s own now');
  assert.deepEqual(JSON.parse(fake.calls.at(-1).body), { uris: ['spotify:track:pick1'] });
  assert.deepEqual(notices, ['Added to Late Drives.']);
  await assert.rejects(smart.add(), /no Smart Shuffle pick/);
  // The next track is one the playlist holds; the items are not walked again while the snapshot stands.
  fake.head = { ...fake.head, snapshot_id: 's2' };
  fake.playback = playing('spotify:track:own2');
  const walked = fake.calls.length;
  smart.observe('spotify:track:own2', true);
  await until(() => fake.calls.length >= walked + 2, 'a read');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(fake.calls.length, walked + 2, 'playback and the head only');
  assert.equal(smart.snapshot().pick, null);
  // A playlist that is not mine: the + is offered dimmed, the × still works.
  fake.head = { ...fake.head, owner: { id: 'someone' }, snapshot_id: 's3' };
  fake.playback = playing('spotify:track:pick2');
  smart.observe('spotify:track:pick2', true);
  await until(() => smart.snapshot().pick, 'a pick from someone else’s playlist');
  assert.equal(smart.snapshot().pick.canAdd, false);
  await assert.rejects(smart.add(), /not yours/);
  await smart.dismiss();
  assert.equal(skips.length, 1, 'the × skips through the player');
  assert.equal(smart.snapshot().pick, null);
  // The Web API naming another track than the player is left alone, not answered wrong.
  fake.playback = playing('spotify:track:elsewhere');
  smart.observe('spotify:track:pick3', true);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(smart.snapshot().pick, null);
  // Smart Shuffle off in Spotify: a queued track is not a pick.
  fake.playback = playing('spotify:track:pick4', { smart_shuffle: false });
  smart.observe('spotify:track:pick4', true);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(smart.snapshot().pick, null);
  // Nothing playing according to the Web API — another device, say.
  fake.playback = null;
  smart.observe('spotify:track:pick5', true);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(smart.snapshot().pick, null);
  // Apple Music, or nothing ready: no reads at all.
  const quiet = fake.calls.length;
  smart.observe(null, false);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(fake.calls.length, quiet);
  // Signing out takes a mark down; the switch does too.
  fake.head = { ...fake.head, owner: { id: 'amar' }, snapshot_id: 's4' };
  fake.playback = playing('spotify:track:pick6');
  smart.observe('spotify:track:pick6', true);
  await until(() => smart.snapshot().pick, 'a pick to take down');
  fake.ready = false; fake.emit('change');
  assert.equal(smart.snapshot().pick, null);
  fake.ready = true; fake.emit('change');
  await until(() => smart.snapshot().pick, 'signing in reads the track already playing');
  smart.setEnabled(false);
  assert.equal(smart.snapshot().pick, null);
  smart.stop();
  console.log('smart shuffle: ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
