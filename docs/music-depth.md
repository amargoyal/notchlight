# Music depth: what was built, and what was not

The gap brief's music section listed six things. Four are in; two are not, and
this records why, so the question does not have to be reopened from scratch.

## Built

- **Sneak peek on track change.** A new track says its title and artist on the
  resting bar for a moment, without opening the notch.
- **Media inactivity timeout.** Music gives up its place on the resting bar after
  a chosen quiet. Never by default.
- **Fullscreen behaviour.** Stay, hide media only, or hide everything while
  something is fullscreen over that screen.
- **Configurable transport slots.** Previous, next, shuffle, repeat and open the
  player, arranged by dragging or by the arrows on each row. Shuffle and repeat
  are new commands in `native/spotify.js` and `native/music.js`, and both players
  now report their state in the snapshot.

## Not built: any player, through Now Playing

**Finding: the private MediaRemote framework returns nothing to this process on
current macOS.** The symbols still resolve, and the call still succeeds — it
simply hands back an empty dictionary.

Probed directly on macOS 27 (Darwin 27.0.0), with Spotify running and playing:

```
dlopen /System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote  ok
MRMediaRemoteGetNowPlayingInfo                       resolves
MRMediaRemoteRegisterForNowPlayingNotifications      resolves
MRMediaRemoteGetNowPlayingApplicationIsPlaying       resolves
MRMediaRemoteGetNowPlayingInfo callback → 0 keys
```

Apple restricted the framework to entitled processes in macOS 15.4. An empty
dictionary rather than an error is what that restriction looks like from outside,
and no amount of care on this side changes it.

boring.notch works around this with a `mediaremote-adapter` that borrows an
entitled system process. That is not a route open to this repository: it is
GPL-3.0 code that cannot be copied, the technique depends on a specific binary
keeping a specific entitlement across releases, and it cannot be verified here in
any way that would survive a macOS update.

So Notchlight keeps reading Spotify and Apple Music through their own published
scripting dictionaries, which is slower to notice a change but is a supported
interface that will not quietly start returning nothing. **Revisit if** Apple
offers an entitlement or a public Now Playing API, or if enough people ask for
YouTube Music and browser playback to justify a fragile adapter behind a clearly
labelled switch.

## Not built: lyrics

Lyrics need a lyrics source, and every practical one is a third-party service
that has to be sent the track and artist. That is a privacy decision — the first
outbound request Notchlight would make about what someone is listening to — and
it is not one to make silently on a user's behalf while implementing a beta
feature from another app's list.

**Revisit if** it is wanted, as an opt-in with the service named in the settings
row, the same shape the Spotify account already uses: nothing is sent until
someone switches it on and can see where it goes.
