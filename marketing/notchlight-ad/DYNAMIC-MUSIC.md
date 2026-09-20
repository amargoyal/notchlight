# Ganja / Ooyy — dynamic 15-second cut

The player and background music window now show the actual track and official cover. The soundtrack starts at 0:33.69 in the song. Five frequency bands from that excerpt drive the equalizer.

- 3.75s: cursor clicks Pause; music stops and the progress bar freezes.
- 4.25s: cursor clicks Play; music resumes from the same sample position.
- 4.60 / 4.80 / 5.00s: volume rises to 65 / 70 / 75, with matching sound gains. The total increase is 3.88 dB.
- Sound effects remain independent. Music fades under the final logo.

The 15-second duration, updated Notchlight logo, and four feature demonstrations are retained. Prior comparison exports are preserved.

## Rebuild

With the local rendering server serving this directory on port 4177:

```sh
.venv/bin/python sound.py --dynamic
.venv/bin/python music-dynamic.py
node build.mjs --dynamic
node render.mjs --dynamic --review
node render.mjs --dynamic
.venv/bin/python music-dynamic.py --mux
```

`dynamic-track.json` is the shared timing and metadata source. The mixer expects the previously acquired public listening preview at `review/music/ganja.wav`. Track source: https://www.epidemicsound.com/music/tracks/97b32bde-059a-3e11-b501-12d99abb3e67/ . Official artwork: https://cdn.epidemicsound.com/release-cover-images/6236156b-b7bf-4441-959f-19ed8c76f9ad/3000x3000.png . This remains an audition; publishing rights have not been established.

Final export: `exports/Notchlight-Ganja-Dynamic-15s.mp4` (1080 × 1920, 60 fps, stereo AAC). `dynamic.html` is the picture-only animation source; review the MP4 for the synchronized soundtrack.
