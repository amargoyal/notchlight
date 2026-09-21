// hudwatch — takes over the volume and brightness keys and says what they did.
//
// macOS answers those keys with a large translucent square in the middle of the
// screen. It covers whatever you were looking at and has nothing to do with the
// notch. The only way to stop it is to get to the key first: an event tap that
// swallows the press, makes the change itself, and leaves the system with
// nothing to announce.
//
// So this listens for the aux-control key events, applies the new level through
// Core Audio (volume) or DisplayServices (brightness), and prints one line per
// change. The app draws the bar; nothing here knows what it looks like.
//
// Protocol on stdout:
//   first line   {"ok":true,"volume":0.4375,"muted":false,"brightness":0.71,"can":["volume","brightness"]}
//                or  {"ok":false,"reason":"accessibility"}
//   then         {"kind":"volume","value":0.5,"muted":false}
//                {"kind":"brightness","value":0.78}
// Exits 0 when stdin closes (the parent went away) or when the tap cannot be
// built. `ok:false` is a fallback signal, not an error.
//
//   swiftc -O -o hudwatch hudwatch.swift
//   hudwatch [--option-key settings|replace]
//     --option-key settings  Option held passes the key to macOS, which opens
//                            the Sound or Displays pane, exactly as it always did
//     --option-key replace   Option held changes the level like any other press
//
// `can` is what this Mac can actually take over. A key outside it is passed
// straight through, so macOS keeps its own overlay for that one rather than the
// key doing nothing at all.
//
// Needs Accessibility. An event tap that can swallow a key is an event tap that
// can read every other one, so macOS gates it; without the grant this exits
// immediately and says why.

import AppKit
import CoreAudio
import Foundation

/// Option held opens System Settings, or changes the level like any other press.
let optionOpensSettings: Bool = {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: "--option-key"), index + 1 < args.count else { return true }
    return args[index + 1] != "replace"
}()

/// One sixteenth, which is what macOS moves per press.
let step: Float = 1.0 / 16
/// Shift and Option together is a quarter step, again following macOS.
let fineStep: Float = 1.0 / 64

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

func bail(_ reason: String) -> Never {
    emit("{\"ok\":false,\"reason\":\"\(reason)\"}")
    exit(0)
}

/// Two decimal places is below what the eye can pick out of a bar this size.
func number(_ value: Float?) -> String {
    guard let value else { return "null" }
    return String(format: "%.4f", value)
}

// MARK: - Volume, through Core Audio

func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, _ element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: element)
}

func outputDevice() -> AudioDeviceID? {
    var addr = address(kAudioHardwarePropertyDefaultOutputDevice)
    var device = AudioDeviceID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &device)
    return status == noErr && device != kAudioObjectUnknown ? device : nil
}

/// The elements that carry the volume: the main one when the device has it,
/// otherwise the two stereo channels, which is how most USB devices present it.
func volumeElements(_ device: AudioDeviceID) -> [AudioObjectPropertyElement] {
    var main = address(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeOutput)
    if AudioObjectHasProperty(device, &main) { return [kAudioObjectPropertyElementMain] }
    var stereoAddress = address(kAudioDevicePropertyPreferredChannelsForStereo, kAudioObjectPropertyScopeOutput)
    var channels: (UInt32, UInt32) = (1, 2)
    var size = UInt32(MemoryLayout<(UInt32, UInt32)>.size)
    _ = withUnsafeMutablePointer(to: &channels) { AudioObjectGetPropertyData(device, &stereoAddress, 0, nil, &size, $0) }
    let candidates = [channels.0, channels.1]
    return candidates.filter { element in
        var addr = address(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeOutput, element)
        return AudioObjectHasProperty(device, &addr)
    }
}

func readVolume() -> Float? {
    guard let device = outputDevice() else { return nil }
    let elements = volumeElements(device)
    guard !elements.isEmpty else { return nil }
    var total: Float = 0
    var read = 0
    for element in elements {
        var addr = address(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeOutput, element)
        var value: Float = 0
        var size = UInt32(MemoryLayout<Float>.size)
        if AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &value) == noErr { total += value; read += 1 }
    }
    return read > 0 ? total / Float(read) : nil
}

@discardableResult
func writeVolume(_ level: Float) -> Bool {
    guard let device = outputDevice() else { return false }
    let clamped = max(0, min(1, level))
    var wrote = false
    for element in volumeElements(device) {
        var addr = address(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeOutput, element)
        var settable: DarwinBoolean = false
        guard AudioObjectIsPropertySettable(device, &addr, &settable) == noErr, settable.boolValue else { continue }
        var value = clamped
        if AudioObjectSetPropertyData(device, &addr, 0, nil, UInt32(MemoryLayout<Float>.size), &value) == noErr { wrote = true }
    }
    return wrote
}

func readMuted() -> Bool {
    guard let device = outputDevice() else { return false }
    var addr = address(kAudioDevicePropertyMute, kAudioObjectPropertyScopeOutput)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &value) == noErr && value != 0
}

@discardableResult
func writeMuted(_ muted: Bool) -> Bool {
    guard let device = outputDevice() else { return false }
    var addr = address(kAudioDevicePropertyMute, kAudioObjectPropertyScopeOutput)
    var settable: DarwinBoolean = false
    guard AudioObjectIsPropertySettable(device, &addr, &settable) == noErr, settable.boolValue else { return false }
    var value: UInt32 = muted ? 1 : 0
    return AudioObjectSetPropertyData(device, &addr, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value) == noErr
}

// MARK: - Brightness, through DisplayServices

typealias GetBrightness = @convention(c) (CGDirectDisplayID, UnsafeMutablePointer<Float>) -> Int32
typealias SetBrightness = @convention(c) (CGDirectDisplayID, Float) -> Int32

// There is no public way to set the display's backlight. DisplayServices is the
// one every brightness utility on the platform uses; it is resolved by name so a
// macOS that moved or dropped it costs the brightness keys and nothing else.
let displayServices = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY)
let getBrightness: GetBrightness? = displayServices
    .flatMap { dlsym($0, "DisplayServicesGetBrightness") }
    .map { unsafeBitCast($0, to: GetBrightness.self) }
let setBrightness: SetBrightness? = displayServices
    .flatMap { dlsym($0, "DisplayServicesSetBrightness") }
    .map { unsafeBitCast($0, to: SetBrightness.self) }

/// Every attached display, the built-in one first.
func displays() -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return [] }
    return ids.prefix(Int(count)).sorted { CGDisplayIsBuiltin($0) != 0 && CGDisplayIsBuiltin($1) == 0 }
}

/// The display whose backlight the keys move, and its level.
///
/// Not the main display: with a MacBook driving an external monitor, the main
/// display is usually the monitor, whose brightness is the monitor's own
/// business. The built-in panel is the one the key belongs to, so it is asked
/// first and only then anything else. Resolved per press, because a lid closing
/// or a cable coming out changes the answer.
func brightnessTarget() -> (CGDirectDisplayID, Float)? {
    guard let getBrightness else { return nil }
    for id in displays() {
        var value: Float = 0
        if getBrightness(id, &value) == 0 { return (id, max(0, min(1, value))) }
    }
    return nil
}

func readBrightness() -> Float? { brightnessTarget()?.1 }

// MARK: - What this Mac can take over

let canVolume = readVolume() != nil
let canBrightness = readBrightness() != nil

// MARK: - The tap

guard AXIsProcessTrusted() else { bail("accessibility") }

let capabilities = [canVolume ? "volume" : nil, canBrightness ? "brightness" : nil].compactMap { $0 }
if capabilities.isEmpty { bail(outputDevice() == nil ? "no-output" : "unsupported") }

/// Aux control buttons — the volume, brightness and media keys — arrive as
/// system-defined events with this subtype and the key packed into `data1`.
let auxSubtype: Int16 = 8
let keySoundUp = 0
let keySoundDown = 1
let keyBrightnessUp = 2
let keyBrightnessDown = 3
let keyMute = 7

/// True while the key is down, which includes every auto-repeat while it is held.
func isPress(_ flags: Int) -> Bool { (flags & 0xFF00) >> 8 == 0x0A }

func handle(_ event: CGEvent) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
    guard let nsEvent = NSEvent(cgEvent: event), nsEvent.subtype.rawValue == auxSubtype else { return pass }
    let data = nsEvent.data1
    let key = (data & 0xFFFF_0000) >> 16
    let flags = data & 0x0000_FFFF
    let modifiers = nsEvent.modifierFlags
    let wantsVolume = key == keySoundUp || key == keySoundDown || key == keyMute
    let wantsBrightness = key == keyBrightnessUp || key == keyBrightnessDown
    // A key this Mac cannot answer keeps its own overlay rather than doing nothing.
    guard wantsVolume && canVolume || wantsBrightness && canBrightness else { return pass }
    // Option is macOS's shortcut to the matching settings pane. Leaving the
    // event alone is what opens it — there is nothing to reimplement.
    if optionOpensSettings && modifiers.contains(.option) && !modifiers.contains(.shift) { return pass }
    // Swallow the release too, or macOS answers that one with the overlay.
    guard isPress(flags) else { return nil }

    let fine = modifiers.contains(.option) && modifiers.contains(.shift)
    let delta = fine ? fineStep : step
    if key == keyMute {
        let muted = !readMuted()
        writeMuted(muted)
        emit("{\"kind\":\"volume\",\"value\":\(number(readVolume())),\"muted\":\(muted)}")
        return nil
    }
    if wantsVolume {
        let level = max(0, min(1, (readVolume() ?? 0) + (key == keySoundUp ? delta : -delta)))
        writeVolume(level)
        // Turning it up past silence unmutes, the way the hardware key always has.
        if key == keySoundUp && readMuted() { writeMuted(false) }
        emit("{\"kind\":\"volume\",\"value\":\(number(level)),\"muted\":\(readMuted())}")
        return nil
    }
    guard let (display, current) = brightnessTarget(), let setBrightness else { return pass }
    let level = max(0, min(1, current + (key == keyBrightnessUp ? delta : -delta)))
    _ = setBrightness(display, level)
    emit("{\"kind\":\"brightness\",\"value\":\(number(level))}")
    return nil
}

/// The tap itself, held where the callback can reach it. The callback is a C
/// function and captures nothing, so a timeout has no other way back in.
var tapPort: CFMachPort?

let mask = CGEventMask(1 << 14) // NSEvent.EventType.systemDefined
guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: mask,
    callback: { _, type, event, _ in
        // A tap that takes too long over one event is switched off rather than
        // slowing the whole session down. Switch it back on and carry on.
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let port = tapPort { CGEvent.tapEnable(tap: port, enable: true) }
            return Unmanaged.passUnretained(event)
        }
        return handle(event)
    },
    userInfo: nil
) else { bail("no-tap") }
tapPort = tap

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

emit("{\"ok\":true,\"volume\":\(number(readVolume())),\"muted\":\(readMuted()),\"brightness\":\(number(readBrightness())),\"can\":[\(capabilities.map { "\"\($0)\"" }.joined(separator: ","))]}")

// stdin closing means the app that started us is gone, or wants us gone.
Thread.detachNewThread {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    exit(0)
}

CFRunLoopRun()
