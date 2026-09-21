// notchprobe — measures every attached display and prints one line of JSON.
//
// Electron knows the menu bar's height and nothing about its hole. Guessing the
// cutout's width costs either dead black beside it or text hidden behind it.
// AppKit knows exactly: auxiliaryTopLeftArea and auxiliaryTopRightArea are the
// usable menu bar strips either side, so whatever lies between them is the
// cutout.
//
// Every screen is reported, not only the notched one, because the island can be
// asked to appear on all of them. `id` is the CGDirectDisplayID, which is what
// Electron calls a Display's id, so the two sides agree on which screen is
// which without matching on width and hoping two monitors are not the same size.
//
// Protocol on stdout, one JSON object:
//   {"displays":[{"id":1,"name":"Built-in","builtin":true,"notch":true,
//                 "notchW":200,"notchH":32,"screenW":1512,"menuBarH":37}, …]}
//
// Exits 0 either way. An empty list means the caller should fall back to its
// configured width, not that something went wrong.
//
//   swiftc -O -o notchprobe notchprobe.swift

import AppKit

func auxAreas(_ s: NSScreen) -> (NSRect, NSRect)? {
    if #available(macOS 12.0, *), let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea {
        return (l, r)
    }
    return nil
}

func displayID(_ s: NSScreen) -> UInt32? {
    (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
}

func isBuiltin(_ s: NSScreen) -> Bool {
    guard let id = displayID(s) else { return false }
    return CGDisplayIsBuiltin(CGDirectDisplayID(id)) != 0
}

func menuBarHeight(_ s: NSScreen) -> CGFloat {
    s.frame.height - s.visibleFrame.height - (s.visibleFrame.origin.y - s.frame.origin.y)
}

/// JSON's own escaping, so a monitor named `"The 27\" one"` cannot break the line.
func quoted(_ text: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [text], options: []),
          let line = String(data: data, encoding: .utf8)
    else { return "\"\"" }
    return String(line.dropFirst().dropLast())
}

let entries: [String] = NSScreen.screens.compactMap { screen in
    guard let id = displayID(screen) else { return nil }
    var fields = [
        "\"id\":\(id)",
        "\"name\":\(quoted(screen.localizedName))",
        "\"builtin\":\(isBuiltin(screen))",
        "\"screenW\":\(screen.frame.width)",
        "\"menuBarH\":\(menuBarHeight(screen))"
    ]
    if let (left, right) = auxAreas(screen) {
        let topInset = screen.safeAreaInsets.top
        fields.append("\"notch\":true")
        fields.append("\"notchW\":\(screen.frame.width - left.width - right.width)")
        fields.append("\"notchH\":\(topInset > 0 ? topInset : left.height)")
    } else {
        // No cutout on this screen. With the lid shut the built-in display is
        // not in NSScreen.screens at all, so a notched MacBook can be missing
        // from this list entirely rather than appearing without a cutout.
        fields.append("\"notch\":false")
    }
    return "{\(fields.joined(separator: ","))}"
}

print("{\"displays\":[\(entries.joined(separator: ","))]}")
