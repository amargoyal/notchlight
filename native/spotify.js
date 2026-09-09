/* JavaScript for Automation. Only Spotify's published scripting dictionary is used. */
function run(argv) {
  var spotify = Application('com.spotify.client');
  if (!spotify.running()) return JSON.stringify({ status: 'not-running' });
  try {
    var command = argv[0] || 'status';
    if (command === 'toggle') spotify.playpause();
    else if (command === 'next') spotify.nextTrack();
    else if (command === 'previous') spotify.previousTrack();
    else if (command === 'seek') {
      var position = Number(argv[1]);
      if (!isFinite(position) || position < 0) throw new Error('Invalid playback position.');
      spotify.playerPosition = position;
    } else if (command !== 'status') throw new Error('Unknown music command.');
    var playing = spotify.playerState() === 'playing';
    var track;
    try { track = spotify.currentTrack(); } catch (_) { return JSON.stringify({ status: 'empty' }); }
    var title;
    try { title = track.name(); } catch (_) { return JSON.stringify({ status: 'empty' }); }
    if (!title) return JSON.stringify({ status: 'empty' });
    var artwork = '';
    try { artwork = track.artworkUrl(); } catch (_) {}
    return JSON.stringify({ status: 'ready', playing: playing, position: spotify.playerPosition(),
      track: { id: track.id(), title: title, artist: track.artist(), album: track.album(), durationMs: track.duration(), artwork: artwork } });
  } catch (error) {
    return JSON.stringify({ status: Number(error.errorNumber) === -1743 ? 'permission' : 'error', code: Number(error.errorNumber) || 0 });
  }
}
