# Notchlight — 15-second social cut

15.00 seconds · 1080 × 1920 · 60 fps · vertical · no narration.

The revised notch-and-green-light logo is retained unchanged. This is a separate edit; the user's updated 36-second composition and exports are preserved.

## Edit

| Time | Beat |
|---|---|
| 0–3.05 | “Four tools. One notch.” Already framed on the product; unfold starts at 0.12 s and resolves within the first second. Claude and Codex activity is visible. |
| 3.05–5.50 | Music artwork, animated equalizer and volume steps. |
| 5.50–8.85 | Pull back, grab the PDF, carry it to the notch, and land it in the tray. |
| 8.85–11.55 | Open clipboard, select the visible color, and hold its reorder/copy confirmation. |
| 11.55–15.00 | Fold away, reveal the user's new logo, and hold the brand frame. |

The permission walkthrough and repeated pause/play gestures are omitted. Motion is newly timed rather than applying a speed multiplier to the long video. Sound effects are regenerated at the new cue times, retaining their natural pitch.

## Files

- `Notchlight-Final-15s.mp4`: picture with original sound effects, no music or speech.
- `Notchlight-Silent-15s.mp4`: same picture without an audio track.
- `Notchlight-SFX-15s.wav`: separate 48 kHz / 24-bit stereo effects; align at frame zero.
- `Notchlight-Cover-15s.jpg`: opening feature shot.
- `Notchlight-Source-15s.zip`: editable source and ready-to-open browser previews.

Open `short.html` for the short composition. `index.html` remains the long composition. Browser previews are picture-only; the MP4 contains the effects.

## Rebuild

From the source folder, with the dependencies described in README.md installed:

```sh
npm run build:short
npm run preview
```

In another terminal, with that preview server running:

```sh
npm run render:short
.venv/bin/python sound.py --short
.venv/bin/python finish.py --short
```

Edit `src/film-short.jsx` for short-cut timing, camera and captions. Shared app faces and assets are reused. Calls without `--short` retain the long-cut workflow.

## Verification

Both MP4s decode all 900 frames without errors and report exactly 15 seconds at 60 fps. The five relevant pointer targets, including volume and clipboard selection, were checked against their rendered rectangles. Shell bounds stay inside the frame. Keyframes and the new-logo end card were inspected; no render runtime errors or mechanical design-detector findings.
