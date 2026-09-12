# Notchlight

A macOS notch companion for Claude Code, Spotify, and files. Three focused
faces, a customizable resting bar, and nothing behind the lens.

### Codex integration

The current working tree adds local Codex Desktop and CLI activity to a shared
**Agents** face with **All / Claude / Codex** filters and a separate Codex robot.
The Claude-specific descriptions below retain their existing behavior; Codex
setup and status limits are documented in the [Codex integration guide](docs/codex-integration.md).

In **Customize Notchlight… → Agents → Codex**, explicitly enable
**Monitor local Codex**. Monitoring is off by default. Choose the Codex home if
needed; **Install Codex hooks**, review and trust them in Codex's `/hooks`, then
reload or restart existing sessions. **Answer Codex approvals in Notchlight**
is a separate, optional opt-in. The guide covers CLI installation/removal,
custom homes, backups and returning unanswered requests to Codex.

Unknown or interrupted Codex activity stays neutral; silence is not completion.
`npm run test:codex` covers the parser, coordinator, approval bridge, hook client
and installer against the local `0.153.4` format; `npm run smoke:codex replay`
replays your own recorded Codex rollouts read-only, and `npm run smoke:codex live`
runs real `codex exec` tasks in an isolated home to exercise hooks and
approvals. Browser/gallery samples do not establish live behavior.

### Install from the DMG

Download `Notchlight-<version>-arm64.dmg` from the
[latest release](https://github.com/amargoyal/notchlight/releases), drag
Notchlight into Applications and open it. The build is not signed or notarized
yet, so the first launch needs a right-click → **Open**, or:

```sh
xattr -dr com.apple.quarantine /Applications/Notchlight.app
```

The app ships its Swift helpers prebuilt for Apple silicon under
`native/prebuilt/`, so nothing needs the Xcode command line tools; each binary
is installed into `~/.notchlight/bin` when its manifest hash matches the source
beside it, and `swiftc` is used only for an edited source or another
architecture. Because the helpers then run as children of Notchlight.app, the
Automation and audio capture prompts name Notchlight rather than Electron.
**Start at login** is in the menu bar item of the packaged app.

The packaged app checks GitHub for a newer release shortly after it starts and
every six hours after that. When one exists, a small card offers **Download**,
**Later** (a day) or **Skip this version**; **Check for updates…** in the menu
bar item asks right away and ignores both holds. Nothing installs itself: the
download opens in your browser, and the new copy is dragged into Applications
like the first one. Decisions are kept in `~/.notchlight/updates.json`. A
checkout never checks on its own; `npm run update-preview` opens the card with
a sample release, and `npm run test:updates` covers the comparison and holds.

The packaged app and the checkout's launchd service share one single-instance
lock; stop the service (`npm run service:uninstall`) before switching to the
app, or keep using the service and skip the DMG. Build your own with
`npm run dist` (output under `release/`); `npm run helpers` rebuilds the
prebuilt binaries and the GitHub Actions workflow does the same on a macOS
runner for every push that touches `native/` and every `v*` tag, attaching the
DMG to the release.

Open **Customize Notchlight…** from the menu bar to choose its appearance.
Settings and Tray references are saved on this Mac. See the
[rename and migration notes](docs/rename.md) for existing installations.

When no face has activity there is nothing to see — the island is invisible, and
the notch is just the notch. Hold the cursor on the notch and it reveals itself.
In the Claude face, the light says what a session wants from you:

| Light | Means |
|---|---|
| 🟢 green | working — leave it alone |
| 🟡 yellow | it wants something from you |
| 🔴 red | finished with what it was doing |

The collapsed Claude face is a light, an activity mark, and a buddy. Choose
which of Claude, Music, and Tray also keep a presence on the resting bar.
Detailed session information and controls are one hover away.

Hovering unfolds it. One session drops you straight onto its agents, however
many there are. Several sessions give you a list you click into. Every session
panel has **Jump ↗** — **Answer there ↗** while it is asking — which brings the
terminal that session lives in to the front: Terminal and iTerm2 on the right
tab, Ghostty, VS Code and the rest as an app. Claude sessions name their
process through the hooks; without hooks the process table finds the `claude`
working in the session's directory. Codex Desktop sessions open ChatGPT.

```
   ┌──────────────────────────────────────────┐
   │  ●               [ notch ]      🖥  🤖   │   collapsed
   └──────────────────────────────────────────┘

   ┌──────────────────────────────────────────┐
   │  ●               [ notch ]      🖥  🤖   │
   ├──────────────────────────────────────────┤   unfolded
   │  notchlight   ~/dev/notchlight · main│
   │  ● 🤖 🖥  Editing Buddy.tsx   24.1k 2m 04s│
   │  ● 🤖 >_  Running test suite  12.9k 1m 03s│
   └──────────────────────────────────────────┘
```

## Running it

```sh
npm install
npm start            # the island, over your own notch
npm run demo         # invented sessions, to check geometry on your hardware
npm run gallery      # every face on one page
```

The tray icon carries the same menu: the gallery, the hook installer, the config
folder, and quit.

### Leaving it running

`npm start` holds the terminal. To have it start at login and stay up on its own:

```sh
npm run service              # build, install a LaunchAgent, start it
npm run service:status       # running · pid 97741
npm run service:restart      # rebuild and kick it
npm run service:logs         # tail ~/.notchlight/island.log
npm run service:uninstall    # stop it and remove the LaunchAgent
npm run check:native -- measure   # CPU, memory and helper starts over 30 s
npm run check:native -- log       # what the app saw: sleep, wake, displays, Spotify
```

launchd rather than `nohup … &`: a backgrounded shell job dies with the session
on some terminal setups, does not come back after a reboot, and has nowhere to
put its output. The agent lives at
`~/Library/LaunchAgents/com.notchlight.island.plist` and restarts the app if it
crashes.

Only one copy runs at a time, so stop any `npm start` instance before installing
the service — the second one takes the single-instance lock, sees it is not the
primary, and exits. `service:restart` waits for the old process to be gone
before starting the new one, for the same reason.

The service goes dark on sleep and screen lock — Spotify polls hold and the
audio helper stops — and comes back on wake by re-measuring the display and
reading Spotify at once. [Native checks](docs/native-checks.md) lists the
steps that verify this on real hardware and the resource budget they measured.

### Keyboard

The island never takes focus on its own, so its Allow and Deny buttons can be
clicked without pulling you out of the terminal. **⌥⇧N** gives it the keyboard
for as long as you want it: the panel opens, the selected tab takes focus,
arrows move between faces, Tab walks into the panel, Enter and Space press
things, and **Escape** hands the keyboard back to the app you were in. The
same action is in the menu bar item, and `shortcut` in `config.json` changes
the key (Electron accelerator syntax; an empty string registers nothing).

### Hooks (optional, recommended)

```sh
npm run install-hooks      # ~/.claude/settings.json, backed up first
npm run uninstall-hooks
```

Everything works without them. Transcripts alone give you the project, the
agents, the tokens and the words for what each one is doing.

What hooks add is the *phase*, instantly and correctly. A tool call that has been
open for ninety seconds looks identical on disk whether Claude is compiling
something or waiting for you to say yes.

That is the whole difference between green and yellow, so **without hooks the
island never shows yellow.** Guessing was tried: a `TaskOutput` blocking on a
workflow lit the notch up as "waiting on you" for an hour while nothing was
waiting on anybody. Yellow asks a person to get up and do something, so it is the
one colour that must never be a guess.

Two things and only two things turn the light yellow: a tool call this app is
holding open (see *Answering from the island* below), and Claude Code's own
permission prompt sitting in the terminal with numbered choices. Claude Code also
sends a `Notification` about a minute after it stops to say nobody has typed
anything yet — that one is deliberately ignored. It is not a question, it is a
finished session whose user is reading the answer, and it used to leave every
completed session yellow.

The installer is idempotent, keeps every hook you already have, and writes a
backup before it touches anything.

## Where the data comes from

Claude Code writes everything down already:

```
~/.claude/projects/<slug>/<sessionId>.jsonl                              the main thread
~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl         one per subagent
~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.meta.json
~/.claude/projects/<slug>/<sessionId>/subagents/workflows/<runId>/…      a workflow's fleet
```

Subagents are not all in one directory: a `Task` writes straight into
`subagents/`, a workflow puts its whole fleet a level deeper. The tree is walked,
not listed — scanning only the top level is how five agents reviewing this very
file showed up on the island as "one agent, no subagents".

Knowing when an agent *stopped* takes three sources, because a `tool_result` on a
`Task` means launched, never finished:

- a `queue-operation` carrying a `<task-notification>` (also delivered, about a
  tenth of the time, as a plain user message)
- a workflow's `journal.jsonl`, one `result` line per agent as it returns
- failing both, a long silence — ten minutes, or forty-five if the agent's last
  act was a tool call that has not come back. It used to be forty-five *seconds*,
  and that greyed out working agents constantly: three quarters of the real agent
  transcripts on this machine contain a mid-run gap longer than that.

Every file is read forward from a remembered offset, so the steady state is a few
kilobytes of new JSON per tick rather than a re-parse of a transcript that can
run to tens of megabytes.

### Knowing a session was closed

Nothing on disk answers this. Closing a terminal window kills `claude` with a
signal, so its transcript simply stops — which is byte for byte what an idle
session waiting for you to type looks like. No timing threshold can separate
them, and a session shut an hour ago went on burning a light on the notch.

So Notchlight asks the process table instead, every three seconds: `claude`
runs as a process of that name, and its working directory is the project
directory its session belongs to.

Where hooks are installed that is an exact answer. The hook client runs as a
child of `claude`, so it reports the session's own process id; once a scan has
confirmed that pid really is a `claude`, the session is alive precisely while
the pid is. Close the window and the row leaves the process table, and the
light goes out on the next scan — no grace period, no waiting for a sibling
session to move.

Without a hook there is only the count per directory: two live processes in
`~/dev/thing` means at most the two newest session files there are still open,
and anything older is closed. That is a count, not an identity, so closing the
older of two sessions in one directory keeps the wrong one until the other
moves.

Uncertainty fails open. If the scan cannot run, nothing is hidden. Finding no
processes at all is only treated as a blind spot — a wrapper, a container, a
different name — until the probe has resolved its first `claude`; after that it
is known to work on this machine, and zero processes means every session really
did close. Set `watchProcesses: false` to turn it off entirely.

**Tokens** are input + output + cache creation, counted once per API turn.

Two things are easy to get wrong here and both were, at first. Cache reads are
left out on purpose: every turn re-reads the same cached prefix, so summing them
counts the same tokens over and over — a quarter of a billion on a long
afternoon, which measures how long the session has been alive rather than how
much work it did. And Claude Code writes one JSONL record *per content block*,
each repeating the same `usage` object, so adding every record counted each turn
two or three times over — measured totals came out 2.4x to 3.4x the truth. Turns
are deduplicated by `message.id`, last record wins, because `output_tokens`
climbs to its final value as the response streams.

## Answering from the island

By default the island is read-only, and the yellow card says *"waiting for your
answer in the terminal"*. Nothing this app does can ever block a tool call.

If you want real **Allow once / Deny** buttons, opt in per tool in
`~/.notchlight/config.json`:

```json
{ "gateTools": ["Bash"] }
```

Re-run `npm run install-hooks` after changing `gateTimeoutSec` — the hook's own
timeout is written into `settings.json` at install time, and Claude Code will cut
the hook off at that value however long the daemon is willing to wait.

Now a `Bash` call is held open while the island shows it. Understand the trade:
*every* bash call waits on this app until you answer or `gateTimeoutSec` passes.
Timing out answers nothing, so Claude Code falls back to asking in the terminal
exactly as it would with Notchlight uninstalled — which is also what happens if
the app is down, wedged, or half-installed. That property is the point of the
default being an empty list.

## Config

`~/.notchlight/config.json`. Every key has a working default, so the file never
has to exist.

| key | default | |
|---|---|---|
| `hoverDelay` | `550` | ms of dwell before a hover opens the island |
| `leaveGrace` | `220` | ms after the cursor leaves before it closes |
| `windowHeight` | `560` | how far the panel is allowed to drop |
| `notchW` / `notchH` | `200` / `32` | fallback cutout size if the probe cannot run |
| `pulse` | `true` | breathe the light while working |
| `allowWithoutNotch` | `false` | run on a Mac with no cutout |
| `gateTools` | `[]` | tools whose calls the island may answer |
| `gateTimeoutSec` | `55` | how long a held call waits |
| `doneLingerSec` | `0` | how long a red light stays; 0 keeps it until stale or dismissed |
| `staleSec` | `10800` | forget a session quieter than this |
| `watchProcesses` | `true` | check `ps`/`lsof` so closed sessions drop off |
| `processGraceSec` | `8` | how long a process must be missing before its session goes, when only the directory count can answer |

## How it is put together

```
native/notchprobe.swift   measures the real cutout — AppKit knows, Electron does not
bin/notchlight-hook.mjs   the hook client; every failure path exits 0 with no output
bin/install-hooks.mjs     wires the above into ~/.claude/settings.json

src/main/notchWindow.ts   full-width, transparent, above the menu bar, click-through
src/main/transcripts.ts   the read side — sessions, subagents, tokens, activity
src/main/liveness.ts      which sessions are still open, from the process table
src/main/hookServer.ts    the write side — a unix socket, and the optional gate
src/main/store.ts         the one place that decides what the light should be
src/renderer/IslandView.tsx  every face of the island
src/renderer/gallery.tsx  all of them at once, plus a live one
```

Two rules hold the geometry together, and both are easy to get wrong by four
pixels:

- The island is a three-column grid — `1fr <cutout> 1fr` — inside a `max-content`
  container, which makes both side tracks as wide as the wider one. That is what
  keeps the middle track dead centre whatever the wings are holding, so text
  never creeps under the camera.
- The overlay window sits at `y = 0`, not at the top of the work area, and needs
  `enableLargerThanScreen` to stay there. Without it AppKit pushes it down and
  the island lands *under* the menu bar instead of being it.

Requires macOS with a notch, and `swiftc` (Xcode command line tools) to measure
it. Without `swiftc` it falls back to the configured width and is wrong by a few
points; without a notch, set `allowWithoutNotch`.

**While resting**, the collapsed bar shows whichever faces you switch on under
Customize → Appearance (Music, Tray) and Customize → Agents (Claude, Codex):
an agent's light and buddy while a session runs, album art and playback while a
track is ready, a count while Tray holds something. Faces share the bar,
mirrored around the cutout, with Claude nearest the lens, then Codex, then the
others. A hidden agent still shows an identifiable request when it needs you.

The bars beside the artwork in the Music wing follow what Spotify is actually
playing. A second Swift helper (`native/audiotap.swift`, compiled the same way
into `~/.notchlight/bin`) opens a Core Audio process tap on Spotify's output
and streams five band levels while a track plays and the wing is showing.
Nothing is recorded; samples become five numbers and are dropped. macOS 14.2+
asks once to allow audio capture. The bars run wherever they are showing:
on the Music face, and on the resting bar whichever face is selected. Say no,
run without `swiftc`, or send the music to another speaker, and the bars hold
a quiet shape instead — never a fake rhythm, which on a transparent overlay
costs a quarter of a core. Real silence settles them. The levels are held back
by the output device's reported latency, so over AirPods the bars land with
the sound rather than a beat ahead of it.

Core Audio's latency figure for Bluetooth outputs is an estimate. If the bars
still run early or late over AirPods, set `levelsOffsetMs` in
`~/.notchlight/config.json` — try 80 if they are early, -80 if they are late —
and restart; the helper's first log line shows the offset and the resulting
delay in frames.

Capture is separate from the Spotify connection. Track details and the
transport come over Apple Events; the bars come from the tap, which has its
own permission and its own ways to be unavailable. **Customize → Music → Audio
capture** says which is the case — refused, Spotify not open, unsupported
macOS, no output device, helper missing or crashed — and a refusal is retried
on its own, so allowing it a minute later takes effect without a reconnect. A
Spotify read that fails is retried after 5, 10, 20, 40 and then 60 seconds
rather than stopping; only a permission denial waits for you.

**Customize → Music → Player** chooses what the face follows: **Spotify**
(the default), **Apple Music**, or **whichever is open** — which starts with
Spotify and moves to Apple Music while Spotify is not running, and back.
Apple Music goes through its own scripting dictionary (`native/music.js`);
its artwork arrives as bytes through a short AppleScript and is carried as a
PNG the app made itself; the bars tap `com.apple.Music` instead; play, pause
and skips inside Music reach the notch through the same helper that hears
Spotify. Only one player is followed at a time.

**Customize → Music** also has the finish: bars **rising** bass to treble or
**mirrored** around the bass as one shape (compare both in the gallery), a
soft **glow** in the artwork's own colour behind the artwork and the bars
(the sleeve is fetched once per track and its liveliest pixels averaged in
the main process; offline there is simply no glow), and the small artwork
**breathing with the bass** while real levels arrive — off under Reduce
motion. **Customize → Agents** can add a tokens-per-second line to the
session panel. None of these run a CSS animation: the glow is static and the
breath rides on the same frame the bars already draw.

Scroll over the music wing — the artwork or the bars, resting or expanded —
to turn Spotify's own volume in steps of five; the level shows in place of
the bars for a second and goes out as one command once the wheel rests.
Spotify rounds what it is given, so 93 may read back as 92.

A click inside Spotify shows on the notch at once. A third helper,
`native/spotifywatch.swift`, listens for Spotify's own playback notification
and hands the app the new state, position and track name the moment they
change; the full read that follows fills in artwork. While it listens, the
scripting polls relax to one every ten seconds. The seek bar and times tick
between reads rather than jumping, and play/pause shows its new state the
moment you click it.

Spotify's scripting dictionary names only the lead artist. Notchlight asks
the track's public page once per track for the full credit, so a collaboration
reads "Internet Money, Lil Tecca" rather than a solo record. Offline, the lead
artist stands.


## Clipboard history

Off until you switch it on in **Customize → Clipboard**, because it is a
privacy choice. Once on, a fourth face lists what you copy — text, links and
images — newest first with pins on top; click an item to copy it again, pin
what you want to keep, filter when the list grows, pause capture, and clear
the history with or without its pins. Images show a thumbnail and their size.
The resting bar shows a count and the kind of the latest item.

What it will not do: read anything a password manager or autofill marks as
concealed or transient, keep text over 20 KB or an image over 2 MB, let the
history pass 8 MB, or let pins pass 20. Nothing leaves the Mac — the history
is `~/.notchlight/clipboard.json`, readable by you alone. macOS has no
clipboard change event, so a fourth helper (`native/pasteboardwatch.swift`)
watches the pasteboard's change count four times a second and says when it
moved and which types it holds; the app reads only then, and an image is never
re-read while the pasteboard has not changed. Without the helper it falls back
to looking at the types every half second.

## Live companion and design preview

Run `npm run customize` or choose **Customize Notchlight…** from the menu bar
for the native window. Its controls update the live notch and save preferences.
Connect Spotify in Music; macOS may request Automation access and, separately,
audio capture for the visualizer. No Spotify account sign-in is required here.

Tray keeps real file references. Click selects one, Command-click adds,
Shift-click takes a range, Command-A takes all; every action then works on
the selection, and a drag from any selected item carries them all out.
Native drag-out keeps an item on the shelf; **Save copy…** shows progress,
never overwrites, carries on past an item that fails and says exactly what
was and was not copied — a folder that fails part way is reported as a
partial copy at the destination, not deleted and not claimed. Remove can be
undone; a file that has moved stays on the shelf marked missing until you
**Locate…** it or let it go.
Neither action deletes the original file, and Save copy does not overwrite
existing destinations.

`npm run gallery` includes an interactive sample walkthrough and state matrix.
Opening `customize.html` in a browser also uses sample music/files and temporary
preferences, with **Reset Preview**. Sample playback never plays audio.
See [design notes and research](docs/multipurpose-faces.md).
