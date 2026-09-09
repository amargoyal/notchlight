# Handoff: where Claude Light is and what comes next

Written September 9, 2026 so a fresh session can pick this up without the
conversation that produced it. Update it when something below lands or changes.

## How the owner likes work done

- One branch per task, cut from `main`. Name it `feat/...` or `fix/...`.
- Many small commits with real messages, then push, open a PR with `gh`, and
  merge it with a merge commit (`gh pr merge N --merge`). Fast-forward local
  `main` afterwards (`git fetch origin main:main`).
- After any change the owner should see, run `npm run service:restart`. The app
  runs as a launchd service on this Mac (`node bin/service.mjs status`).
- Before a PR: `npm run typecheck`, `npm run build`, `npm run test:companion`,
  `npm run test:preview`, `git diff --check`.
- Visual checks without a display: render the gallery offscreen with a tiny
  Electron script (`BrowserWindow({ show: false, webPreferences: { offscreen: true } })`,
  `loadFile('dist/renderer/gallery.html')`, `capturePage()`), then crop the PNG.
  Native window screenshots are blocked by macOS permissions here.
- Spotify is usually playing on the owner's Mac. Do not toggle playback for
  tests unless it is paused already; pause it again if you started it.
- Commit trailers in use: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## What exists today (merged PRs #2–#5)

- **Three faces**: Claude, Music, Tray. Navigation in the expanded island,
  customize window under Customize Claude Light… in the menu bar.
  `src/renderer/LiveCompanion.tsx` is the live surface,
  `src/renderer/Preview.tsx` the sample-data version used by the gallery and
  the customize preview. Both share `preview.css`.
- **Spotify** via JavaScript for Automation (`native/spotify.js`,
  `src/main/spotify.ts`). Polls every 2.5 s after opt-in. Full artist credit
  comes from the track's public page (`music:musician_description`), cached
  per track; the lead artist stands until it arrives.
- **Live equalizer**: `native/audiotap.swift` opens a Core Audio process tap on
  Spotify (macOS 14.2+), FFT at 30 fps, five band levels on stdout, delayed by
  the output device's reported latency (about 170 ms on AirPods).
  `src/main/audioLevels.ts` compiles it on first use into `~/.claude-light/bin`
  and runs it only while wanted (`wantsLevels`). Levels reach the renderer over
  the `music:levels` channel; `LiveEqualizer` writes them straight to the DOM.
- **Compact music panel**: one row, 88 px artwork, centered title/artist, times
  flanking the seek bar, plain transport icons (PR #3).
- **Resting faces**: `restClaude`, `restMusic`, `restTray` preferences choose
  which faces sit on the collapsed bar. `RestingWings` in `Preview.tsx` lays
  them out mirrored around the cutout; `restingClaude` in `IslandView.tsx`
  exposes Claude's collapsed pieces (PR #4).
- **Tray**: real files, persisted references, native drag-out of one file,
  Save copy… to a chosen folder.
- Design notes: `docs/multipurpose-faces.md`, `DESIGN.md`, `PRODUCT.md`.

## Backlog, roughly in the order worth doing

### 1. Apple Music and other players (biggest gap)
Only Spotify is supported. Options, in order of preference:
- Apple Music has a scripting dictionary like Spotify's (`Application('Music')`,
  `currentTrack`, `playerState`, `playerPosition`, `artwork`). Add a second
  runner beside `native/spotify.js` and a `player` field on the snapshot.
  Artwork comes as raw image data, not a URL; convert to a data URL in main.
- The audio tap already works per process. Pass the bundle id into
  `audiotap` as an argument instead of hard-coding `com.spotify.client`.
- MediaRemote (system Now Playing) would cover every player at once but is
  a private framework and broke for third parties in macOS 15.4. Avoid.
- The customize window's Music section needs a player picker or auto-detect
  (whichever app is playing).

### 2. Faster play/pause feedback
The 2.5 s poll makes pause feel late. Either flip `playing` optimistically
inside `SpotifyPlayer.command('toggle')` and let the next poll confirm, or
listen for Spotify's distributed notification
`com.spotify.client.PlaybackStateChanged` from a small helper (or from
`audiotap` itself, which already runs a run loop) and poll immediately on it.
Also interpolate `position` between polls while playing so the seek bar and
times tick instead of jumping every 2.5 s.

### 3. Prebuilt helpers
`audiotap` and `notchprobe` compile at runtime and need Xcode command line
tools. Build them in GitHub Actions on a macOS runner (`swiftc -O`), commit or
attach the binaries, and fall back to compiling only when a prebuilt one is
missing or older than its source. Removes the `swiftc` requirement from the
README.

### 4. Packaged app
Run through `electron-builder` with a real bundle id and its own
`NSAudioCaptureUsageDescription`. Today the audio capture prompt says
"Electron". Also fixes TCC attribution for the helpers.

### 5. Levels drive more than the bars
The level stream is cheap to reuse: pulse the mini artwork's scale with the
bass band, or tint a soft glow behind the equalizer with the artwork's
dominant color. Both are renderer-only changes in `LiveEqualizer` /
`LiveArtwork`.

### 6. Mirrored equalizer
Bars run bass → treble left to right. Many notch players mirror them
(treble–bass–treble) so the shape reads as one blob. Change `bandEdges` in
`audiotap.swift` to three bands and mirror them in the renderer, or mirror the
five as-is. Worth an A/B in the gallery first.

### 7. Volume from the wing
Spotify exposes `soundVolume` in its dictionary. Scroll wheel over the music
wing adjusts it; show a brief level in place of the equalizer. Add a `volume`
command to `native/spotify.js` and `SpotifyPlayer.command`.

### 8. Tray improvements
- Multi-select and drag several files out at once (`startDrag` takes one file
  today; Electron supports `files: []`).
- Accept text and images from the clipboard, not only Finder files.
- Optional expiry per item (an hour, a day) so the shelf stays temporary.

### 9. Claude face extras
- Click the notch while a session is asking → focus that session's terminal.
  The store knows the cwd and pid via `watchProcesses`; use AppleScript or
  `open -a` on the terminal app.
- A tiny tokens-per-second sparkline in the wing, written to the DOM the same
  way the equalizer is.

### 10. Display changes
`resetProbe()` exists in `src/main/notchProbe.ts`; confirm something calls it
on `screen.on('display-metrics-changed')` so docking and undocking a MacBook
re-measures the cutout.

### 11. Bluetooth latency tuning
CoreAudio's latency figure for AirPods is an estimate. If the bars still feel
early or late, add a `levelsOffsetMs` config key in `src/main/config.ts` and
pass it to `audiotap` as an argument to add to `delayFrames`.

## Things to know before touching the music code

- `SpotifyPlayer` serializes every command and status read through one promise
  queue and a generation counter; disconnecting while a read is in flight must
  not publish stale state. Tests in `scripts/test-companion.mjs` cover this.
- `wantsLevels` gates the helper on: Spotify enabled, visualizer preference on,
  reduced motion off, Music view showing, status ready, playing. The helper is
  restarted automatically when the default output device changes (it exits on
  the property listener; `AudioLevels` respawns after 750 ms).
- Renderer falls back to the canned keyframe animation when no levels arrive
  for 400 ms, or after 1.5 s of silence while the track still reports playing
  (music on another speaker).
- Every renderer-facing string that crosses IPC is validated in
  `validatePreferences` / `normalizeSpotify`; new preferences must be booleans
  or listed choices.
