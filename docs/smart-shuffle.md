# Smart Shuffle picks

Spotify's Smart Shuffle slips tracks it thinks you will like into a playlist's
flow. Inside Spotify such a track carries a small mark, a **+** that adds it to
the playlist, and an **×** that sends it away. Notchlight's Music face shows the
same three things for the track that is playing: a sparkle before the artist's
name, and the two answers stacked beside the track.

- **+** adds the track to the playlist it is playing from. The mark goes with
  it, because the track is now one of the playlist's own.
- **×** skips the track, through the same path as the transport's next button.

The mark and the buttons are only ever for the current track: when the track
changes they come down at once, and a fresh read decides whether the next one
gets them.

## What the × cannot do

Spotify's own × also tells its recommender that the pick missed. Spotify keeps
no public way to say that: the Web API has no endpoint for it (the request is
[an open one on Spotify's community](https://community.spotify.com/t5/Spotify-for-Developers/API-endpoint-for-removing-recommendations/m-p/6778412)),
and the desktop app exposes no accessibility tree for its own buttons, so there
is nothing to press on its behalf. The recommender hears the skip and nothing
more. If Spotify opens a door for this, `dismiss()` in `src/main/smartShuffle.ts`
is where it goes.

## Setting it up

Playback needs no account; picks do. Spotify's Web API gives every app its own
Client ID and lets the app's owner use it without review, so the app is yours:

1. Open [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
   and create an app. Any name and description will do.
2. Under **Redirect URIs** add exactly `http://127.0.0.1:41739/callback`, and
   tick **Web API** under the APIs used. Spotify allows plain `http` only on a
   loopback address, and `localhost` is refused, so it has to be this spelling.
3. Copy the app's **Client ID** into **Customize Notchlight… → Music → Spotify
   account** and press **Sign in to Spotify**. Your browser asks for the
   permissions below; the tab says when it is done.

An app in development mode serves its owner. Anyone else who wants to use the
same Client ID has to be added under the app's **User Management** first.

## What is asked for

The sign-in is OAuth with PKCE, with no client secret involved. The scopes:

| Scope | For |
|---|---|
| `user-read-playback-state` | which playlist is playing, and Spotify's word on whether Smart Shuffle is on |
| `playlist-read-private`, `playlist-read-collaborative` | the playlist's own tracks, to tell a pick from one of them |
| `playlist-modify-public`, `playlist-modify-private` | the + |

Skipping goes through the player's scripting interface, so it needs no scope
and no Premium.

The refresh token is kept in `~/.notchlight/spotify-account.json`, sealed with
the keychain when Electron offers it and owner-only on disk when it does not.
**Sign out** removes the file; Spotify's side of the grant stays until you
remove the app under your account's *Apps* settings. Changing the Client ID
also throws the sign-in away, since the token belongs to the other app.

## How a pick is found

After a track change the app waits half a second — a run of skips is one
read — and asks the Web API for the playback state. Playing from a playlist,
Smart Shuffle not reported as off, and the track not among the playlist's own
tracks: a pick. Spotify's `smart_shuffle` field is real but undocumented, so
its absence is treated as unknown rather than as no; when it is present and
false, a track you queued by hand is left alone.

The playlist's tracks are read in pages of a hundred, once, and remembered by
snapshot id; every later read costs one small call for the playlist's head.
Playlists past 5,000 tracks are not checked. The reads go through the
`/playlists/{id}/items` endpoints of Spotify's March 2026 API; the older
`/tracks` ones answer 403 to a development-mode app. That API also hands a
playlist's items only to its owner and collaborators, so a pick on someone
else's playlist cannot be told from the playlist's own tracks and stays
unmarked. While the same track keeps
playing, the state is read again every thirty seconds, so switching Smart
Shuffle on or off inside Spotify shows within that.

The Web API describes the account's active device. If Spotify is playing on
another device than this Mac, or has not started playing since you signed in,
it may say nothing is playing and no pick is marked. When it names a different
track than the player's scripting interface — which can happen for a beat
around a skip — nothing is marked until the next read agrees.

## Trying it without Spotify

`npm run test:smart-shuffle` plays the browser and the accounts service for
the sign-in, and a stand-in account for the reads: a pick found, added and
dismissed, a playlist that is not yours, the Web API disagreeing with the
player, and signing out. `npm run gallery` has a *Music · Smart Shuffle pick*
scene, and the design preview under Customize has a sample pick that the +
and × answer.

## When nothing shows

- **The button says "Paste your Spotify app's Client ID"** — the field is
  empty, or what is in it is not thirty-two hexadecimal characters.
- **The browser says "INVALID_CLIENT: Invalid redirect URI"** — the address
  registered on the app is not exactly `http://127.0.0.1:41739/callback`.
- **"Port 41739 is in use"** — something else on this Mac has the port. Spotify
  only answers on the registered address, so the other program has to move.
- **Signed in, Smart Shuffle on, no mark** — check `~/.notchlight/island.log`
  for `smart shuffle:` lines. "playback state answered 204" means the Web API
  sees no active playback; play something from Spotify on this Mac. "too many
  to check" is the 5,000-track limit.
- **The + is dimmed** — the playlist is not yours and not collaborative;
  Spotify would refuse the add.
