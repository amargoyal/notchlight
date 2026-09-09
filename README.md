# Claude Light

A dynamic island for Claude Code. A status light on the left wing, a buddy on the
right, and nothing behind the lens.

When nothing is running there is nothing to see — the island is invisible, and
the notch is just the notch. Hold the cursor on the notch and it reveals itself.
When a session is running, the light says what it wants from you:

| Light | Means |
|---|---|
| 🟢 green | working — leave it alone |
| 🟡 yellow | it wants something from you |
| 🔴 red | finished with what it was doing |

Collapsed it is a light, an activity mark and a buddy, and nothing else — no
clock, no token count. That bar is on screen for as long as something is
running, so anything on it is something you did not ask to read. The numbers are
one hover away.

Hovering unfolds it. One session drops you straight onto its agents, however
many there are. Several sessions give you a list you click into.

```
   ┌──────────────────────────────────────────┐
   │  ●               [ notch ]      🖥  🤖   │   collapsed
   └──────────────────────────────────────────┘

   ┌──────────────────────────────────────────┐
   │  ●               [ notch ]      🖥  🤖   │
   ├──────────────────────────────────────────┤   unfolded
   │  claude-light   ~/dev/claude-light · main│
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
npm run service:logs         # tail ~/.claude-light/island.log
npm run service:uninstall    # stop it and remove the LaunchAgent
```

launchd rather than `nohup … &`: a backgrounded shell job dies with the session
on some terminal setups, does not come back after a reboot, and has nowhere to
put its output. The agent lives at
`~/Library/LaunchAgents/com.claudelight.island.plist` and restarts the app if it
crashes.

Only one copy runs at a time, so stop any `npm start` instance before installing
the service — the second one takes the single-instance lock, sees it is not the
primary, and exits.

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

So Claude Light asks the process table instead, every five seconds: `claude`
runs as a process of that name, and its working directory is the project
directory its session belongs to. That gives a count per directory — two live
processes in `~/dev/thing` means at most the two newest session files there are
still open, and anything older is closed.

It is a count, not an identity: the process does not carry its session id
anywhere readable, so closing the older of two sessions in one directory keeps
the wrong one until the other moves. Everything else fails open — if the scan
cannot run, or finds no processes while transcripts are plainly being written
(a wrapper, a container, a different name), it hides nothing. Set
`watchProcesses: false` to turn it off entirely.

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
`~/.claude-light/config.json`:

```json
{ "gateTools": ["Bash"] }
```

Re-run `npm run install-hooks` after changing `gateTimeoutSec` — the hook's own
timeout is written into `settings.json` at install time, and Claude Code will cut
the hook off at that value however long the daemon is willing to wait.

Now a `Bash` call is held open while the island shows it. Understand the trade:
*every* bash call waits on this app until you answer or `gateTimeoutSec` passes.
Timing out answers nothing, so Claude Code falls back to asking in the terminal
exactly as it would with Claude Light uninstalled — which is also what happens if
the app is down, wedged, or half-installed. That property is the point of the
default being an empty list.

## Config

`~/.claude-light/config.json`. Every key has a working default, so the file never
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
| `processGraceSec` | `8` | how long a process must be missing before its session goes |

## How it is put together

```
native/notchprobe.swift   measures the real cutout — AppKit knows, Electron does not
bin/cl-hook.mjs           the hook client; every failure path exits 0 with no output
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
Customize → Appearance: Claude's light and buddy while a session runs, album
art and playback while a track is ready, a count while Tray holds something.
Faces share the bar, mirrored around the cutout, Claude outermost. A hidden
Claude still shows a dot when it needs you.

The bars beside the artwork in the Music wing follow what Spotify is actually
playing. A second Swift helper (`native/audiotap.swift`, compiled the same way
into `~/.claude-light/bin`) opens a Core Audio process tap on Spotify's output
and streams five band levels while a track plays and the wing is showing.
Nothing is recorded; samples become five numbers and are dropped. macOS 14.2+
asks once to allow audio capture. Say no, run without `swiftc`, or send the
music to another speaker, and the bars keep their canned rhythm instead. The
levels are held back by the output device's reported latency, so over AirPods
the bars land with the sound rather than a beat ahead of it.

Spotify's scripting dictionary names only the lead artist. Claude Light asks
the track's public page once per track for the full credit, so a collaboration
reads "Internet Money, Lil Tecca" rather than a solo record. Offline, the lead
artist stands.


## Multipurpose design preview

Run `npm run customize` for the new desktop customization window, or choose
**Customize Claude Light…** from the menu bar. The faces gallery now includes
an interactive Claude / Music / Tray walkthrough and every new state.

Music, files, and preferences use sample data for this design iteration. Try
play/pause, track seeking, dragging mock Finder files into Tray and out to the
sample destination, or changing appearance beside a live preview. Keyboard
alternatives are available for the sample transfers. Settings reset when the
window closes; **Reset Preview** restores everything immediately.

The normal notch still shows real Claude activity. This prototype does not
control your music apps, move real files, or change the production config.
See [design notes and research](docs/multipurpose-faces.md).
