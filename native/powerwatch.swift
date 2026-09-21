// powerwatch — says what the battery is doing, and the moment it changes.
//
// Electron exposes nothing about power on macOS beyond sleep and wake, and
// shelling out to `pmset -g batt` every thirty seconds is a process every thirty
// seconds for an answer that usually has not moved. IOKit will say the moment it
// does: IOPSNotificationCreateRunLoopSource fires on every change to a power
// source, including the charger going in or coming out.
//
// Only the internal battery is reported. A Mac mini has none, and a keyboard or
// a mouse with one is not what the notch is about.
//
// Protocol on stdout, one JSON object per line:
//   first line   {"ok":true,"percent":0.82,"charging":false,"plugged":false,
//                 "charged":false,"minutes":214}
//                or  {"ok":false,"reason":"no-battery"}
//   then         the same shape, without `ok`, on every change
// `minutes` is the time to full while charging and the time to empty otherwise,
// or null while macOS is still working it out — which it always is for the first
// minute or so after a change. Exits 0 when stdin closes.
//
//   swiftc -O -o powerwatch powerwatch.swift

import Foundation
import IOKit.ps

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

/// The internal battery's description dictionary, or nil on a Mac without one.
func readBattery() -> [String: Any]? {
    guard let snapshot = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
          let sources = IOPSCopyPowerSourcesList(snapshot)?.takeRetainedValue() as? [CFTypeRef]
    else { return nil }
    for source in sources {
        guard let description = IOPSGetPowerSourceDescription(snapshot, source)?.takeUnretainedValue() as? [String: Any] else { continue }
        if description[kIOPSTypeKey] as? String == kIOPSInternalBatteryType { return description }
    }
    return nil
}

/// The description as the app's own shape. `minutes` is null while macOS is still estimating.
func state(_ description: [String: Any]) -> [String: Any] {
    let current = description[kIOPSCurrentCapacityKey] as? Int ?? 0
    let max = description[kIOPSMaxCapacityKey] as? Int ?? 100
    let charging = description[kIOPSIsChargingKey] as? Bool ?? false
    let plugged = description[kIOPSPowerSourceStateKey] as? String == kIOPSACPowerValue
    // -1 is IOKit for "ask me again in a minute", which is not a duration.
    let estimate = (charging ? description[kIOPSTimeToFullChargeKey] as? Int : description[kIOPSTimeToEmptyKey] as? Int) ?? -1
    return [
        "percent": max > 0 ? Double(current) / Double(max) : 0,
        "charging": charging,
        "plugged": plugged,
        "charged": description[kIOPSIsChargedKey] as? Bool ?? false,
        "minutes": estimate > 0 ? estimate : NSNull()
    ]
}

guard let first = readBattery() else {
    emit(["ok": false, "reason": "no-battery"])
    exit(0)
}

var last = ""

/// Only say something when something moved. IOKit is generous with its
/// notifications, and a line the app has already seen is a wake-up for nothing.
func report() {
    guard let description = readBattery() else { return }
    let next = state(description)
    let key = "\(next["percent"] ?? 0)|\(next["charging"] ?? false)|\(next["plugged"] ?? false)|\(next["charged"] ?? false)|\(next["minutes"] ?? "?")"
    guard key != last else { return }
    last = key
    emit(next)
}

var ready = state(first)
ready["ok"] = true
emit(ready)
last = "\(ready["percent"] ?? 0)|\(ready["charging"] ?? false)|\(ready["plugged"] ?? false)|\(ready["charged"] ?? false)|\(ready["minutes"] ?? "?")"

if let source = IOPSNotificationCreateRunLoopSource({ _ in report() }, nil)?.takeRetainedValue() {
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
}

// A backstop, in case a notification is ever missed. A minute apart, and it
// prints nothing at all unless something really changed.
let timer = Timer(timeInterval: 60, repeats: true) { _ in report() }
RunLoop.main.add(timer, forMode: .common)

// stdin closing means the app that started us is gone, or wants us gone.
Thread.detachNewThread {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    exit(0)
}

RunLoop.main.run()
