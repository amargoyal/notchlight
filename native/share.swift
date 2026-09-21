// share — hands files to macOS's own share sheet, AirDrop included.
//
// NSSharingService needs an app context: a process with no activation policy
// gets a picker that never draws, or draws behind everything and cannot be
// dismissed. Electron's own menus cannot offer AirDrop at all. So this is a
// tiny accessory app that exists for the length of one share — it puts up the
// picker anchored where it was told, waits for an answer, prints it and goes.
//
// Protocol on stdout, one JSON object:
//   {"ok":true,"service":"AirDrop"}     something was shared
//   {"ok":true,"service":null}          the picker was dismissed
//   {"ok":false,"reason":"no-files"}    also: missing, no-window
//
// Unlike the streaming helpers this one does its work and exits; there is no
// ready line and nothing to keep alive.
//
//   swiftc -O -o share share.swift
//   share --at <x> <y> <path> [<path> …]
//     --at  where to hang the picker from, in screen points from the top left

import AppKit

func emit(_ object: [String: Any]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
    exit(0)
}

var arguments = Array(CommandLine.arguments.dropFirst())
var anchor: NSPoint?
if let index = arguments.firstIndex(of: "--at"), index + 2 < arguments.count,
   let x = Double(arguments[index + 1]), let y = Double(arguments[index + 2]) {
    anchor = NSPoint(x: x, y: y)
    arguments.removeSubrange(index...(index + 2))
}

let paths = arguments.filter { !$0.hasPrefix("--") }
if paths.isEmpty { emit(["ok": false, "reason": "no-files"]) }
let urls = paths.filter { FileManager.default.fileExists(atPath: $0) }.map { URL(fileURLWithPath: $0) }
if urls.isEmpty { emit(["ok": false, "reason": "missing"]) }

/// Notified when the sheet is answered, so the process can print and leave.
final class ShareDelegate: NSObject, NSSharingServicePickerDelegate, NSSharingServiceDelegate {
    func sharingServicePicker(_ picker: NSSharingServicePicker, didChoose service: NSSharingService?) {
        guard let service else { emit(["ok": true, "service": NSNull()]) }
        service.delegate = self
        // The service takes over from here; it reports back through its own
        // delegate, which is this object.
    }
    func sharingService(_ service: NSSharingService, didShareItems items: [Any]) {
        emit(["ok": true, "service": service.title])
    }
    func sharingService(_ service: NSSharingService, didFailToShareItems items: [Any], error: Error) {
        emit(["ok": false, "reason": (error as NSError).localizedDescription])
    }
    func sharingService(_ service: NSSharingService, sourceWindowForShareItems items: [Any], sharingContentScope: UnsafeMutablePointer<NSSharingService.SharingContentScope>) -> NSWindow? {
        window
    }
}

let delegate = ShareDelegate()
let app = NSApplication.shared
// Accessory, not regular: a Dock icon appearing for a share sheet would be a
// second app arriving on screen for two seconds.
app.setActivationPolicy(.accessory)

/// An invisible window to hang the picker from. `relativeTo` needs a view in a
/// window on screen; without one the picker has nothing to point at.
let screen = NSScreen.screens.first { screen in
    guard let anchor else { return false }
    return screen.frame.contains(NSPoint(x: anchor.x, y: screen.frame.maxY - anchor.y))
} ?? NSScreen.main
guard let screen else { emit(["ok": false, "reason": "no-window"]) }
// Screen points come in from the top left, the way Electron counts them; AppKit
// counts from the bottom left of the primary screen.
let point = anchor.map { NSPoint(x: $0.x, y: (NSScreen.screens.first?.frame.maxY ?? screen.frame.maxY) - $0.y) }
    ?? NSPoint(x: screen.frame.midX, y: screen.frame.maxY - 40)
let window = NSWindow(contentRect: NSRect(x: point.x - 1, y: point.y - 1, width: 2, height: 2), styleMask: .borderless, backing: .buffered, defer: false)
window.level = .popUpMenu
window.backgroundColor = .clear
window.isOpaque = false
window.alphaValue = 0
window.orderFrontRegardless()

let picker = NSSharingServicePicker(items: urls)
picker.delegate = delegate

DispatchQueue.main.async {
    app.activate(ignoringOtherApps: true)
    guard let view = window.contentView else { emit(["ok": false, "reason": "no-window"]) }
    picker.show(relativeTo: view.bounds, of: view, preferredEdge: .minY)
}

// A picker nobody answers must not leave a process behind for the rest of the
// session. Two minutes is far longer than anyone spends choosing.
DispatchQueue.main.asyncAfter(deadline: .now() + 120) {
    emit(["ok": true, "service": NSNull()])
}

app.run()
