# Notchlight — A little more useful

Finished vertical social ad, 36 seconds, 1080 × 1920, 60 fps. No narration. The source uses the supplied Claude composition's UI, buddies, and original vector assets, with a new timeline and camera system. The original Downloads files are unchanged.

## Deliverables

- **Notchlight-Final-36s.mp4** — H.264 video with original stereo sound effects, AAC 256 kb/s. No music.
- **Notchlight-Silent-36s.mp4** — the same picture, no audio track; ready for your music.
- **Notchlight-SFX-36s.wav** — separate 48 kHz, 24-bit stereo effects, aligned to the first video frame. Peak approximately −17.5 dBFS, leaving room for music.
- **Notchlight-Cover.jpg** — a still from the agents scene.
- **Notchlight-Editable-Source.zip** — source, bundled browser preview, assets, build/render scripts, storyboard and sound cue sheet.

The mock UI demonstrates sample workflows. It does not execute commands, control music, copy clipboard contents, or move actual files. Codex approvals in the real app depend on supported integration and opt-in. No reference footage, third-party soundtrack, or voice was reused.

## What changed

The former 15-second cut became a 36-second sequence with separate setup, action, and result holds. The camera now uses deliberate framing and minimum-jerk glides rather than continuously chasing the cursor. Background windows darken and defocus during feature demonstrations. The notch stays fixed to its hardware position while its shell expands and contracts.

The permission request holds before the click. Music visibly pauses, resumes, and changes volume. The PDF follows an arced carry and settles into its actual tray slot. The clipboard color is visible before selection, then moves up below the pinned item with a copy confirmation. The previous offscreen selection and review-only SFX captions are removed. Short feature phrases establish context with sound off. The closing brand frame holds for several seconds.

## Preview and edit

The source archive includes `dist/film.js`; opening `index.html` locally works without installing anything. It has Play, Pause, Restart and a scrubber. Space toggles playback; left/right arrows step one second when the timeline is not focused. The browser preview is picture-only; use the final MP4 to review sound.

For development, from this folder:

```sh
npm install
npx playwright install chromium
python3 -m venv .venv
.venv/bin/pip install imageio-ffmpeg numpy pillow
npm run build
npm run preview
```

In another terminal in this folder:

```sh
npm run review
npm run render
.venv/bin/python sound.py
.venv/bin/python finish.py
```

`src/film.jsx` contains scene/event times in `K`, framing in `CAMERA`, and headlines in `TITLES`. All animation is a pure function of seconds, allowing reproducible scrubbing and offline rendering. `src/nl-faces.jsx` contains the product UI. `sound.py` synthesizes effects from scratch with a fixed random seed. `sfx-cues.json` lists their start times. `render.mjs` produces four contiguous frame ranges and joins them without frame interpolation. Set `FFMPEG` to use a different FFmpeg executable.

## Verification

- Both finished MP4s decode all 2,160 frames without errors; 36.00 seconds at 60 fps.
- Nineteen keyframe screenshots inspected, including each feature and the end card.
- Eight cursor actions checked against their rendered target rectangles, all inside their controls.
- Shell bounds checked every 0.1 second; no clipping by the video frame.
- No browser runtime errors in the render; no mechanical design-detector findings.
- Rechecked an encoded frame at the Allow once click rather than relying only on browser screenshots.

See `storyboard.md` for timing and research references.
