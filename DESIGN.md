# Notchlight design system

## Direction
Operate mode. Extend the incumbent black notch, warm off-white text, terracotta buddy and small status lights. Music is led by original artwork; Tray by recognizable file thumbnails. The desktop surface is an orderly macOS-style preference window, with a persistent working preview: a sidebar with search and one icon tile per pane (General first, About last), a preview strip pinned above the form, and inset grouped rows with a title, a one-line note and the control on the right. Every switch for the resting bar lives in one group under Appearance.

## Tokens and geometry
Notch #000; inset #0a0a0a; text #f2ede7; muted #a69c93; terracotta #c97c5c. Existing status colors remain unchanged. Desktop light #f5f2ed with #ece7e0 sidebar; desktop dark #211f1d with #191817 sidebar. System sans for UI, monospace for time and file metadata. Expanded notch width 472pt, hardware width/height supplied by snapshot. Controls never occupy the camera column. Existing measured shell animates size over 260ms; view content fades over 180ms. Reduced motion disables both.

## Surfaces
Expanded navigation is below the camera: Claude, Music, Tray, then customization. Selected tab is explicit and stable. Attention is amber and remains actionable in all views. The customization surface keeps a notch beside its controls. Native customization uses live state and a real file drop area; browser/gallery previews use mock Finder files and an explicit sample label.

## Assets
Original vector record sleeves and a landscape illustration, bundled locally. These illustrate a fictional sample playlist; they do not represent a service connection or real playback.

## Boundaries
Use the same Island shell and Claude components in previews. Sample controls must remain isolated from production state. Native appearance preferences persist separately from Claude gate configuration. Every preview has empty/error/overflow examples. Gallery remains the exhaustive visual regression surface.

## Today

A fourth face, between Music and Tray. It reads your calendar and never writes
to it — the one exception is ticking off a reminder, which goes back through
Reminders because that is a thing the row is already showing you the state of.

The panel is the whole day in the order it happens, scrolled to the next thing
rather than to the top. What is behind you is dimmed rather than removed: a day
reads better with its shape intact, and "three meetings already gone" is
information. Each row carries its calendar's own colour on the left, which is
the only ornament — it is what makes a row belong to Work or Home at a glance,
and it is a decision someone already made in the app they keep their calendar in.
Reminders take a dot rather than a bar, so the two kinds never have to be read.

The resting bar carries the next thing and how long until it — `in 8m`, `now`,
`All day`. Something already under way says `now`, never a negative countdown.

Three rules can hide things, and the heading says how many they took: all-day
events, finished reminders, and any calendar switched off. Hiding a calendar here
changes nothing in Calendar itself. A day with things in it and nothing showing
says which rule did it, because an empty panel that is empty for a reason you set
last week is the worst kind of empty.

Access is asked for once and macOS remembers the answer, so a refusal is a state
rather than something to retry into. The pane says so and names the pane where it
can be changed. Reminders are a second permission, and asking for them starts a
fresh helper: a process that has already asked for less cannot ask for more.

## The first run

Everything Notchlight can do is off until someone says otherwise. That is the
right default for each of them and the wrong first impression for all of them at
once: a new install is a black notch that does nothing, with the switches that
would change that buried four panes deep.

So the welcome asks once, in the order the answers matter — agents, then music,
then the rest — and every step can be skipped. Skip leaves the setting exactly
where it was; nothing here is a wall, and every row appears again under the same
name in the settings window. Closing the window counts as answering it: someone
who shuts it on the second step has said they do not want to be walked through,
and asking again at every launch would be the app arguing with them.

It takes focus, which the island never does, so it needs the Dock icon for as
long as it is open. It is shown after the island exists, because it points at a
notch, and pointing at one that has not been drawn yet introduces nothing.

What it has been shown for is a version rather than a flag, so a release that
adds something worth introducing can show it again.

## Small touches

**Sneak peek.** A new track shows its title and artist on the resting bar for a
moment. The notch does not open — you did not ask it to, you just pressed next.
Only a change of track counts: not a pause, not a seek, and not the first track
after connecting, which is where the music already was.

**Standing down.** Paused music keeps its place on the bar for a while, because
you are coming back to it. After the chosen quiet it gives the space to whatever
else is there, and playing again brings it straight back. Never is the default.

**The last face.** The open notch returns to the face you were on rather than to
Agents. A face whose feature has since been switched off falls back rather than
opening on a tab that is no longer there.

**Two fingers up.** A swipe up over the open notch folds it away, and it stays
folded while the pointer sits there: a swipe means "not now", and an island that
sprang back open half a second later would be answering the opposite question. A
swipe and a scroll are the same event, so they are told apart by shape — a run of
upward deltas close together that adds up to real distance. A downward flick
abandons the run outright, so reading a long panel never closes it.

**Out of recordings.** macOS can leave the island out of screen captures
entirely. Off by default, because a window that does not appear in a recording is
surprising if you did not ask for it — and worth having, because a session title
or a clipboard preview is not something to leak into a meeting.

## Battery

Off by default: the menu bar already shows a battery, and a second one that
arrives uninvited is clutter rather than information. Switched on, the level
takes a place on the resting bar beside Music and Tray, in the outer space.

A level is a length, so it is drawn as one — a shell filled to the level, not a
number you have to read. The percentage beside it is optional. Charging puts a
bolt through the fill and turns it green; low turns it amber, which is the only
state meant to catch the corner of your eye. Four percent still has to read as a
battery rather than an empty box, so the fill never goes below a sliver.

The charger going in or coming out takes the resting bar for a few seconds, the
way a volume key does — but longer, because it is telling you something you did
not already know. A volume bar you asked for outranks it. The low warning is
given once and then latched: IOKit's percentage drifts back up a point now and
then, and "crossed twenty percent" on its own would announce every wobble. The
latch clears on the charger, or once the level is properly clear of the mark.

## Displays

One island on the built-in panel is the default and the only thing a
single-screen Mac ever sees. Plugged into a monitor, the island can appear on
every eligible screen, on one you pick, or follow the pointer across screen
edges. Following the pointer moves the existing overlay rather than building a
new one, so crossing an edge is instant instead of a reload.

Each screen carries its own hover intent and its own measurements. The cursor is
only on one screen at a time, so islands never fight — but one unfolding on the
display you are not looking at would be worse than useless, so the dwell belongs
to the overlay the pointer is actually on.

A screen with a cutout matches the hole, the menu bar it sits in, or a figure
between 15 and 45 points. The cutout can measure a point shorter than its own
menu bar, and a bar that misses by a pixel leaves a sliver of menu bar above it,
so matching the cutout means the taller of the two. A screen with no cutout has
no hole to fill: it takes a plain height between 0 and 40, and 0 means leave that
screen alone. Those screens need the same opt-in as a Mac without a notch — a bar
hanging off a menu bar is not something to arrive by surprise on a second monitor.

A chosen screen that is unplugged falls back to the built-in panel rather than
leaving the island on nothing.

## System HUD

The volume and brightness keys are answered by one bar, which stands in for the
grey square macOS draws in the middle of the screen. It says two things: which
key was pressed, and where the level landed. Nothing else.

A HUD **takes** the resting bar rather than joining it. Faces share the bar
because each is a standing state; a HUD answers something you did a moment ago,
and a bar competing with three faces is not an answer. It holds for 1.5 s and
each further press restarts that hold, so a key held down reads as one bar
moving. Closed, it sits in the wings beside the cutout, or takes the panel width
when *Wide bar* is chosen. Open, it is a strip above the tabs, on every face, and
the face underneath is never replaced.

The bar is solid or a left-to-right ramp, optionally with a soft light under the
filled part and the level spelled out beside it. It uses the existing ink and
text tokens; when the accent colour preference lands it follows that instead. The
fill width is written directly, never animated — the value is already the end of
the movement, and every frame of the overlay costs the compositor. Nothing here
moves under reduced motion; the level still changes.

Replacement is off until switched on, because it needs Accessibility. The pane
says what is actually being replaced: a Mac whose brightness cannot be read keeps
the macOS overlay for that key, and the HUD pane says so rather than claiming
both. The permission row is the only actionable line and names the exact pane.

## Agents extension — implementation pending validation

The current navigation uses **Agents, Music, Tray**, with **All / Claude / Codex**
filters in Agents. Rows show task title, provider, known Desktop/CLI source,
project and status. Provider identity must remain legible when tasks share a
project or a title. Attention buttons remain available across provider filters
and faces without changing the selected view until activated.

Claude keeps its terracotta buddy. Codex uses an original cool ivory robot
(`#DCE7EA` shell, `#89AAB5` trim, `#15252D` visor), an antenna and two feet.
Expressions cover working, thinking, asking, done, failed, idle and approved.
Provider lights and buddies have separate resting visibility and motion
preferences; `Cl` / `Cx` distinguish mixed activity. An asking provider remains
available even with its resting preference off. All controls stay outside the
camera column within the shared measured shell.

Green means observed work, amber an observed request, and red recorded done or
failed. Idle, interrupted and unknown use the neutral light. Unknown activity
reads **Waiting for fresh activity**; do not turn silence into success or an
invented request. Unknown and mixed-provider token totals use an em dash.

Only a live held Codex permission request has **Allow once / Deny / Answer in
Codex** controls. Read-only requests say **Continue in Codex**. Monitoring and
approval opt-ins, home selection, hook install/remove and trust/reload guidance
live in native customization; browser/gallery interactions remain samples.

See [Codex integration](docs/codex-integration.md) for the implemented data and
status limits. Reduced motion, small robot sizes, mixed-provider overflow,
simultaneous requests and native notch behavior still require validation;
existing sample scenarios are not a passing visual or native smoke result.
