# Native checks

What the running app costs and how it behaves through the events a Mac throws
at it. Gallery renders and the mocked helper tests do not cover any of this;
these steps run against the launchd service on a real notched MacBook.

Two tools, both read-only:

```sh
npm run check:native -- measure --seconds 30 --label idle   # CPU, memory, helper starts, socket
npm run check:native -- log --since 15m                      # what the app saw: power, display, levels, spotify
npm run check:native -- socket                               # does the hook socket accept
node bin/service.mjs status                                  # pid, launchd run count, children
```

The service writes one timestamped line per lifecycle event to
`~/.notchlight/island.log` (`src/main/lifecycle.ts`). A check passes when the
expected line appears, not when the island looked right.

## Steps

Run each on the current build (`npm run service:restart` first). Copy the
record row `measure` prints into the table at the end.

| Step | Do | Expect in `log` | Expect on screen |
|---|---|---|---|
| Restart | `npm run service:restart` twice in a row | one `notchlight ready` per restart, `hooks listening`, `runs` in `status` climbs by one each time | island back within two seconds, one island |
| Sleep / wake | close the lid for a minute, open it | `power suspend`, `spotify polling suspended`, then `power resume`, `display change: resume`, `display settled on …`, `spotify polling resumed`, `spotify status` unchanged or `not-running → ready` | island on the cutout, Spotify state current within three seconds, no second island |
| Lock / unlock | Control-Command-Q, unlock | `power lock-screen` … `power unlock-screen`; `levels listening → idle` on lock if the helper was running, a new `helper start` after unlock only if bars are wanted | bars resume only while Music is showing and playing |
| Spotify quit / relaunch | quit Spotify, wait, open it again | `spotify status ready → not-running`, then `not-running → ready` on relaunch without a reconnect | music wing disappears and returns |
| Output switch | put AirPods on, take them off | `levels helper exit 0 while listening`, `helper start #n` about a second later, once per switch | bars pause briefly and continue in time with the new output |
| Display change | plug in or unplug an external display; change the built-in scaling | one `display change:` line, then `display settled on <id> WxH@scale after N events` | island on the notched display, wings anchored to the cutout |
| Not a display change | start and pause Spotify with the bars showing | `display change:` then `display unchanged after N events; kept` — no `settled` line, no probe | nothing moves |
| Fullscreen / Spaces | enter fullscreen in another app, switch Spaces | nothing new | island stays above the menu bar on every Space |
| Customize | open Customize Notchlight…, change a toggle, close it | nothing new | Dock icon appears while open, goes on close; the change is on the island |
| Reduced motion | System Settings → Accessibility → Display → Reduce motion, on then off | nothing new | lights stop breathing at once, resume at once; no restart |
| Finder drag | drag a file onto the notch and drop; drag another and press Escape | nothing new | dropped file in Tray; cancelled drag adds nothing and the island closes |

## Resource budget

Measure for at least 20 seconds after the island has settled (wait ten seconds
after a restart). `measure` reports the per-process share of one core over
the interval, so the numbers add up across the Electron tree.

Findings on September 9, 2026 (MacBook Pro, Apple M5, macOS 27.0, one
working Claude session on the resting bar):

| date | state | interval | CPU | peak RSS | helpers seen / starts | renderer crashes | socket |
|---|---|---|---|---|---|---|---|
| 2026-09-09 | idle, pulse as CSS animation (before) | 22s | 34.5% | 297 MB | 0 / 0 | 0 | ok |
| 2026-09-09 | idle, pulse off | 15s | 2.6% | 494 MB | 0 / 0 | 0 | ok |
| 2026-09-09 | idle, pulse from the 12 fps timer | 20s | 13.9% | 487 MB | 0 / 0 | 0 | ok |
| 2026-09-09 | playing on the resting bar, canned bars | 22s | 38.2% | 440 MB | 0 / 0 | 0 | ok |
| 2026-09-09 | playing, real bars on the resting bar, Agents selected, 70 ms transition per write | 22s | 45.0% | 484 MB | 1 / 0 | 0 | ok |
| 2026-09-09 | playing, real bars, no transition, 30 fps helper | 20s | 23.6% | 472 MB | 1 / 0 | 0 | ok |
| 2026-09-09 | playing, real bars, 24 fps helper | 20s | 23.1% | 423 MB | 1 / 0 | 0 | ok |

What the numbers say:

- **A CSS animation on the overlay is the whole idle cost.** One 9 px light
  breathing via `@keyframes` kept the GPU process at 27 % and the renderer at
  6 %, because a compositor animation redraws the transparent, screen-wide
  window at 60 fps. The pulse now comes from one shared 12 fps timer
  (`src/renderer/pulse.ts`) and idle dropped from 34.5 % to 13.9 %. With
  nothing pulsing the whole tree is under 3 %.
- **The canned equalizer had the same problem.** With Spotify playing and the
  Music face resting, `mp-wave` ran as a 60 fps animation on five bars and
  cost 25 % in the GPU process. The live island no longer uses it: real
  levels are written to the DOM with unchanged frames skipped, and a quiet
  static shape stands in when nothing can be heard. A CSS `transition` on
  each write was worse still (45 %) because every write became a compositor
  animation; without it, playing costs about 23 % across the tree, of which
  the helper itself is under 1 %.
- **"Screen parameters changed" is not always a screen.** Starting or
  stopping the audio helper, and play/pause in Spotify, each produced a
  burst of 7–14 `display-metrics-changed` events with nothing changed.
  `NotchWindow.settle` now compares a signature of every display's bounds,
  scale and menu bar height and skips the blocking probe when it matches,
  logging `unchanged after N events; kept`. A wake always re-measures.
- **The helper does not respawn on its own.** Zero starts over every idle
  interval; a start appears only when the bars become wanted or the output
  device changes.
- **Memory is steady** at roughly 440–500 MB across the tree, most of it
  the main process and the renderer.

## Known gaps

- Sleep, lock and display steps are manual. `pmset sleepnow` would work but
  is not run by the script because it takes the Mac down under you.
- `measure` reads Spotify's player state through its own scripting
  dictionary to label the row; it never starts or stops playback.
- Native drag, TCC permission recovery and audio synchronization are judged
  by eye; nothing here proves them.
