# Multipurpose faces

## Research and interpretation
Reviewed September 9, 2026 using Google image search and the products' published pages.

- [Boring Notch](https://boringnotch.com/) uses artwork-led music and a temporary file shelf in a hardware-attached black surface.
- [Boring Notch source and usage](https://github.com/TheBoredTeam/boring.notch) documents hover expansion and menu-bar access to customization.
- [NotchBox published screenshots and description](https://apps.apple.com/us/app/notchbox-easier-drag-drop/id6737410946?mt=12) show music wings and a drag-in/drag-out file pocket.

Adopt focused tabs, recognizable file thumbnails, and a separate settings window. Preserve Claude Light's buddy and status contract. Do not reproduce either product's branding or claim category exclusivity.

## Reviewing the prototype
`npm run customize` opens the desktop customization preview. `npm run gallery` includes the interactive walkthrough plus the full state matrix. The tray menu also opens customization. The normal overlay remains Claude-only.

Music controls change a fictional playlist without playing audio. Drag sample documents from the mock Finder into the notch, then drag shelf items into the Finder's destination area. Keyboard users can use Add to Tray and Take out instead. Real filesystem drops are ignored. Preferences and demo activity last only for the current window session; Reset Preview restores defaults.

## Live levels in the Music wing
The five bars used to loop a fixed keyframe animation regardless of the sound. They now follow Spotify's output: `native/audiotap.swift` taps the Spotify process through Core Audio (`CATapDescription` + a private aggregate device, macOS 14.2+), runs a 2048-point FFT thirty times a second, and prints five band levels, bass to treble. `src/main/audioLevels.ts` compiles and supervises the helper, only while Spotify is playing, the Music view is showing, the visualizer preference is on, and reduced motion is off. Levels reach the notch and customize windows over the `music:levels` channel and are written straight to the bar transforms without a React render.

Each bar sits against its own running average (±11 dB spans the bar) scaled by overall loudness, with instant attack and ~120 ms release. That keeps compressed pop moving as much as a sparse piano piece. Whenever levels stop arriving — helper unavailable, capture refused, playback on another device, silence for 1.5 s — the bars drop back to the old animation, so nothing ever looks broken.

## Intended follow-up
Real music adapters, native filesystem drag-out, persistent preferences, and distribution are separate work. No integration permission is requested by this prototype.

## Validation of this iteration

- `npm run typecheck`, `npm run build`, `npm run test:preview`, and `git diff --check` pass.
- The Impeccable detector reports no findings for the changed interface files.
- Browser checks covered playback, seek-to-end, keyboard navigation across Claude and Music, accessible panel relationships, sample transfers through the keyboard controls, theme/reduced-motion controls, attention hints, and reset.
- All 20 new gallery scenarios fit their frames and load their assets, including the wider camera cutout and overflowing shelf. The desktop layout also fits the 980pt minimum width.
- The running service was restarted successfully with this build. Native window inspection remained blocked by macOS Accessibility/Screen Recording permissions; window close/reopen and pointer drag gestures still need a manual native check.
