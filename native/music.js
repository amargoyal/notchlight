/* JavaScript for Automation for Apple Music. Only Music's published scripting dictionary is used.
   Same protocol as spotify.js: one command, one JSON line. Durations are reported in ms. */
function run(argv) {
  var music = Application('com.apple.Music');
  if (!music.running()) return JSON.stringify({ status: 'not-running' });
  try {
    var command = argv[0] || 'status';
    if (command === 'toggle') music.playpause();
    else if (command === 'next') music.nextTrack();
    else if (command === 'previous') music.previousTrack();
    else if (command === 'seek') {
      var position = Number(argv[1]);
      if (!isFinite(position) || position < 0) throw new Error('Invalid playback position.');
      music.playerPosition = position;
    } else if (command === 'volume') {
      var level = Number(argv[1]);
      if (!isFinite(level) || level < 0 || level > 100) throw new Error('Invalid volume.');
      music.soundVolume = Math.round(level);
    } else if (command !== 'status') throw new Error('Unknown music command.');
    var playing = music.playerState() === 'playing';
    var track;
    try { track = music.currentTrack(); } catch (_) { return JSON.stringify({ status: 'empty' }); }
    var title;
    try { title = track.name(); } catch (_) { return JSON.stringify({ status: 'empty' }); }
    if (!title) return JSON.stringify({ status: 'empty' });
    var id = '';
    try { id = 'music:' + track.persistentID(); } catch (_) { id = 'music:' + title; }
    var hasArtwork = false;
    try { hasArtwork = track.artworks().length > 0; } catch (_) {}
    var volume = -1;
    try { volume = music.soundVolume(); } catch (_) {}
    var position = 0;
    try { position = music.playerPosition() || 0; } catch (_) {}
    return JSON.stringify({ status: 'ready', player: 'apple', playing: playing, position: position, volume: volume,
      track: { id: id, title: title, artist: track.artist(), album: track.album(), durationMs: Math.round((track.duration() || 0) * 1000), artwork: '', hasArtwork: hasArtwork } });
  } catch (error) {
    return JSON.stringify({ status: Number(error.errorNumber) === -1743 ? 'permission' : 'error', code: Number(error.errorNumber) || 0 });
  }
}
