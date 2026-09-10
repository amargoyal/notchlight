// spotifywatch — says the moment Spotify's playback changes.
//
// Spotify posts a distributed notification, com.spotify.client.PlaybackStateChanged,
// on every play, pause, skip and seek, with the track and position in it. Polling
// the scripting dictionary every few seconds is what the app does without this;
// with it, a click inside Spotify shows on the notch at once, and the polls can
// relax to a slow heartbeat.
//
// Protocol on stdout, one JSON object per line:
//   first line   {"ok":true}
//   then         {"state":"Playing","trackId":"spotify:track:…","position":12.3,"durationMs":234000,
//                 "title":"…","artist":"…","album":"…"}
// Exits 0 when stdin closes. Nothing is polled; this only listens.
//
//   swiftc -O -o spotifywatch spotifywatch.swift

import Foundation

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

let center = DistributedNotificationCenter.default()
center.addObserver(forName: NSNotification.Name("com.spotify.client.PlaybackStateChanged"), object: nil, queue: nil) { note in
    let info = note.userInfo ?? [:]
    var out: [String: Any] = ["state": info["Player State"] as? String ?? "Unknown"]
    if let id = info["Track ID"] as? String { out["trackId"] = id }
    if let position = info["Playback Position"] as? Double { out["position"] = position }
    if let duration = info["Duration"] as? Int { out["durationMs"] = duration }
    if let title = info["Name"] as? String { out["title"] = title }
    if let artist = info["Artist"] as? String { out["artist"] = artist }
    if let album = info["Album"] as? String { out["album"] = album }
    emit(out)
}

// stdin closing means the app that started us is gone, or wants us gone.
Thread.detachNewThread {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    exit(0)
}

emit(["ok": true])
RunLoop.main.run()
