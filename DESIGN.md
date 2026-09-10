# Notchlight design system

## Direction
Operate mode. Extend the incumbent black notch, warm off-white text, terracotta buddy and small status lights. Music is led by original artwork; Tray by recognizable file thumbnails. The desktop surface is an orderly macOS-style preference window, with a persistent working preview.

## Tokens and geometry
Notch #000; inset #0a0a0a; text #f2ede7; muted #a69c93; terracotta #c97c5c. Existing status colors remain unchanged. Desktop light #f5f2ed with #ece7e0 sidebar; desktop dark #211f1d with #191817 sidebar. System sans for UI, monospace for time and file metadata. Expanded notch width 472pt, hardware width/height supplied by snapshot. Controls never occupy the camera column. Existing measured shell animates size over 260ms; view content fades over 180ms. Reduced motion disables both.

## Surfaces
Expanded navigation is below the camera: Claude, Music, Tray, then customization. Selected tab is explicit and stable. Attention is amber and remains actionable in all views. The customization surface keeps a notch beside its controls. Native customization uses live state and a real file drop area; browser/gallery previews use mock Finder files and an explicit sample label.

## Assets
Original vector record sleeves and a landscape illustration, bundled locally. These illustrate a fictional sample playlist; they do not represent a service connection or real playback.

## Boundaries
Use the same Island shell and Claude components in previews. Sample controls must remain isolated from production state. Native appearance preferences persist separately from Claude gate configuration. Every preview has empty/error/overflow examples. Gallery remains the exhaustive visual regression surface.

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
