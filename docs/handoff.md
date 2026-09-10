# Handoff: where Notchlight is and what comes next

Written September 9, 2026 so a fresh session can pick this up without the
conversation that produced it. Update it when something below lands or changes.

## Codex integration (branch `codex/codex-integration`)

The integration adds **Agents** (All / Claude / Codex), local Codex
Desktop/CLI monitoring, a separate robot and optional permission answers.
The merged-feature inventory below predates it. The suites pass and the native
checks that could run are recorded in the Codex guide's validation record.

- `src/main/codex.ts` reads local rollouts and optional task titles; the
  coordinator in `src/main/agentCoordinator.ts` namespaces identities by
  provider. Source metadata, unknown status and token availability remain
  explicit. There is no verified Codex process ownership or remote API reader.
- `src/main/codexApprovals.ts` receives the separate `codex.sock` stream.
  Monitoring and approvals default off in companion preferences. Held requests
  allow/deny/defer, expire after 55 seconds and release without a decision on
  shutdown or disabled preferences. Native questions stay in Codex.
- `bin/notchlight-codex-hook.mjs` forwards events and waits only with both
  opt-ins. `bin/install-codex-hooks.mjs` merges only its handlers into the
  selected home's `hooks.json`, creates unique backups and writes atomically.
  It does not edit config or trust. Review `/hooks` and reload sessions.
- `src/renderer/Agents.tsx`, `Buddy.tsx`, live customization and sample/gallery
  surfaces provide provider filters, attention and independent resting options.
  Unknown/interrupted states are neutral; sample interactions are not evidence
  of native operation.

Setup, custom-home precedence, removal, backups, status interpretation, known
limits and the validation record are in [Codex integration](codex-integration.md).
`scripts/smoke-codex.mjs` (`npm run smoke:codex replay|live`) is the native
harness: replay is read-only against a real Codex home; live runs `codex exec`
in an isolated `CODEX_HOME` with hooks installed only there. The live approval
outcomes (allow / deny / defer) still need one run after the Codex usage quota
resets; everything up to the model turn, including hook delivery over the
socket, was observed working. Then `npm run service:restart` so the running
notch picks up the Agents view, and enable **Monitor local Codex** in
Customize → Agents to see real tasks.

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
  customize window under Customize Notchlight… in the menu bar.
  `src/renderer/LiveCompanion.tsx` is the live surface,
  `src/renderer/Preview.tsx` the sample-data version used by the gallery and
  browser-only customization preview. The Electron customization window uses
  live state and saved preferences. Both share `preview.css`.
- **Spotify** via JavaScript for Automation (`native/spotify.js`,
  `src/main/spotify.ts`). Polls every 2.5 s after opt-in. Full artist credit
  comes from the track's public page (`music:musician_description`), cached
  per track; the lead artist stands until it arrives.
- **Live equalizer**: `native/audiotap.swift` opens a Core Audio process tap on
  Spotify (macOS 14.2+), FFT at 30 fps, five band levels on stdout, delayed by
  the output device's reported latency (about 170 ms on AirPods).
  `src/main/audioLevels.ts` compiles it on first use into `~/.notchlight/bin`
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

## Review and recommended priorities — September 9, 2026

The strongest additions are the compact music panel and independently chosen
resting faces: they make the companion useful without opening a panel. Keep
that direction. Prefer reliability and quick actions before more visual effects
or another permanent tab.

The owner specified **Spotify only** in this conversation. Apple Music remains
an optional future expansion, not the next milestone. Existing item numbers
below are retained for reference; use this priority order:

1. Fix resting-wing audio capture eligibility (13). Spotify and capture recovery (14) landed September 9.
2. Improve transport feedback (2) and Tray multi-select/recovery (8, 16).
3. Add keyboard access (15). Native lifecycle and energy checks (17) landed September 9.
4. Apply the selected Notchlight identity and prepare distribution (18, 3–4).
5. Consider clipboard history (12) as an opt-in feature after those foundations.
   Extra players and decorative effects can follow actual demand.

Code review also found that display remeasurement already exists (10), and
transport commands already publish their result immediately (2). Neither should
be scoped as a missing implementation without first reproducing the problem.

This review adds work to the backlog; it does not implement the proposed fixes.

## Backlog (stable item numbers)

### 1. Apple Music and other players (deferred)
Only Spotify is supported, matching the owner's current player preference.
Revisit for a wider audience. Options, in order of preference:
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
`SpotifyPlayer.enqueue()` already publishes the snapshot returned by a transport
command immediately. The 2.5 s interval affects passive updates, including
actions taken inside Spotify; it does not by itself explain slow in-app clicks.
Measure command queue wait and JXA response time before choosing a fix.
If optimistic feedback is needed, reconcile or roll it back on failure. Another
candidate is Spotify's distributed notification
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
Already implemented in `src/main/notchWindow.ts`: display metrics, added, and
removed events share a 250 ms debounce, reset the probe, reposition, then
notify geometry consumers, and now log the change and the display they
settled on. A wake runs the same settle. Docking, undocking, clamshell,
scaling and identical-width displays are steps in [Native checks](native-checks.md).

### 11. Bluetooth latency tuning
CoreAudio's latency figure for AirPods is an estimate. If the bars still feel
early or late, add a `levelsOffsetMs` config key in `src/main/config.ts` and
pass it to `audiotap` as an argument to add to `delayFrames`.

### 12. Clipboard manager (a fourth face)
Not the one-shot clipboard drop in item 8. A history of what was copied,
shown as its own tab beside Tray, with a resting wing that shows the latest
item's kind and a count.
- **Watching**: macOS has no clipboard change event. Poll
  `clipboard.readText()` / `readImage()` in main every ~500 ms and compare
  against the last seen value; on macOS Electron exposes no `changeCount`, so
  a cheap hash of the text or image bytes is the comparison. Skip when the
  pasteboard carries `org.nspasteboard.ConcealedType` or
  `org.nspasteboard.TransientType` (password managers, autofill) — read them
  with `clipboard.availableFormats()`.
- **Storage**: `~/.notchlight/clipboard.json`, capped (50 items, images
  under 2 MB as PNG data URLs, text under 20 kB). Pinned items survive the cap
  and the clear action. Nothing leaves the Mac.
- **Face**: list of entries newest first, each with a preview (first line of
  text, image thumbnail, URL host), a time, pin, and remove. Click to copy it
  back; the poller must ignore its own write. Cmd-K style filter box when
  the list grows.
- **Preferences**: `clipboardEnabled` (off by default — it is a privacy
  choice), `clipboardHistorySize`, `restClipboard` for the resting bar.
- **Before shipping**: check the pasteboard's excluded formats before reading
  content; these markers cannot catch every secret. Provide pause capture,
  retention limits, and a separate explicit Clear all action that includes
  pins. Cap total bytes and pinned items too, so pinning cannot bypass storage
  limits. Avoid reading/encoding the same image every 500 ms; use a native
  change-count helper if needed. Turning capture off must stop the poller.
- **Where it plugs in**: `CompanionView` gains `'clipboard'`; `CompanionStore`
  or a sibling `ClipboardStore` owns the list; IPC in `companionIpc.ts`
  (`clipboard:copy`, `clipboard:pin`, `clipboard:remove`, `clipboard:clear`);
  the nav in `LiveCompanion.tsx` and `Preview.tsx` gets a fourth tab, and
  `RestingWings` a fourth part. Add gallery scenarios and a
  `scripts/test-clipboard.mjs` for the store and the poller's skip rules.

### 13. Make real audio levels follow visible resting faces
`wantsLevels()` in `src/main/audioLevels.ts` still requires `view === 'music'`,
but `LiveCompanion.tsx` renders the music resting part whenever `restMusic` is
enabled and a track is ready. Selecting Claude or Tray therefore stops the real
tap even though its bars remain visible; they fall back to decorative motion.
Base capture on the surfaces actually showing bars, including the resting face,
while preserving opt-in, playback, visualizer, and reduced-motion gates. Update
the existing test that assumes Claude view always means the bars are off screen.

Keep silence distinct from unavailable capture. `LiveEqualizer` currently
switches to canned animation after 1.5 s of silence; let real silence settle
the bars. If capture is unavailable, show a restrained playback indicator and
explain its status in Music settings. Check runtime changes to the system's
reduced-motion preference, not just the media-query value at effect setup.

### 14. Recover Spotify and audio capture without repeated reconnects — implemented September 9, 2026
`SpotifyPlayer` retries failed reads after 5, 10, 20, 40 then 60 seconds
(`SpotifyPlayer.retryDelay`, overridable in tests), logs the failure and the
recovery, and says in the message when the next try is. Permission denial
still stops polling. Generation checks are unchanged. `refresh()` clears the
wait, which is what a wake does.

`AudioLevels` carries a `reason` with every unavailable status (`permission`,
`not-running`, `unsupported`, `no-output`, `no-helper`, `crashed`, `failed`),
its retry timer survives `kill()` and is cancelled only by `stop()` or
`setActive(false)`, and an exit before the first status line backs off for
15 seconds instead of respawning every 750 ms. The companion snapshot has a
separate `capture` field; `describeCapture()` in `src/shared/companion.ts`
words it for the **Audio capture** group in Customize → Music. Fixtures in
`scripts/test-companion.mjs` cover refusal, permission granted later,
output-device exit and a crash before the first line.

### 15. Keyboard access without stealing terminal focus
The live overlay is intentionally non-focusable. Browser tab-key tests alone
cannot establish native keyboard access. Add a configurable shortcut that opens
a focusable companion surface, restores the previously focused app on Escape,
and supports tabs, playback, file selection, and actions. Preserve the usual
hover behavior and the existing Claude Allow/Deny permission contract. Verify
VoiceOver names and focus order in the actual desktop window.

### 16. Tray recovery and predictable transfers
Alongside multi-select in item 8, add Undo remove and Locate missing file.
Keep references when an external disk is temporarily unavailable. Expiry must
remove references only, never originals. For large Save copy operations, show
progress and a clear outcome; report partial failures without claiming a
successful transfer. Preserve no-overwrite behavior and native drag retention.
Acceptance examples: duplicate filenames, renamed source, unplugged volume,
cancelled drag, and a failed directory copy with a partial destination.

### 17. Native verification and resource budget — implemented September 9, 2026
[Native checks](native-checks.md) records the repeatable steps and the
budget. `scripts/native-check.mjs` (`npm run check:native`) measures the
service's process tree, counts helper starts and renderer crashes, and reads
the lifecycle log (`src/main/lifecycle.ts`) that every power, display,
levels and Spotify transition now writes. `powerMonitor` stops the helper
and holds Spotify polls on sleep or lock and recovers on wake;
`bin/service.mjs` waits for the old process before bootstrapping the new one.
The idle budget was dominated by the CSS pulse animation (34 % of a core);
the light now breathes from a shared 12 fps timer (`src/renderer/pulse.ts`)
and idle is under 14 %, under 3 % with nothing pulsing. The canned equalizer
animation costs the same 25 % while Music rests — item 13 fixes that.
Sleep, lock, output switching and display steps remain manual; the doc says
which log lines prove each one.

### 18. Naming, accurate docs, and migration — implemented locally
The owner selected **Notchlight**. Repository, checkout, visible titles, menu
labels, package metadata, renderer bridge, service, and hooks now use it.
Saved data was preserved, and compatibility aliases keep cached hook paths
working. See [rename notes](rename.md) and [naming decision](naming.md).
The prototype-only documentation was corrected to distinguish the native app
from browser/gallery samples. Signed app packaging and release materials
remain in item 4; Claude's buddy and permission meanings are retained.

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
