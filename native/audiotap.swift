// audiotap — listens to Spotify's audio output and prints five band levels,
// thirty times a second, one line each.
//
// The bars in the collapsed wing used to loop a canned animation. This is the
// real thing: a Core Audio process tap (macOS 14.2+) on Spotify's own output,
// so what moves in the notch is what comes out of the speakers. Nothing is
// recorded — samples are reduced to five numbers and dropped.
//
// Protocol on stdout:
//   first line   {"ok":true,"rate":48000}  or  {"ok":false,"reason":"..."}
//   then         0.42 0.31 0.18 0.09 0.05   (bass → treble, each 0…1)
// Exits 0 when stdin closes (the parent went away), when Spotify quits, or
// when the tap cannot be built. `ok:false` is a fallback signal, not an error.
//
//   swiftc -O -o audiotap audiotap.swift

import AppKit
import Accelerate
import CoreAudio
import Foundation

let bundleID = "com.spotify.client"
/// Band edges in Hz. Five bars, bass on the left.
let bandEdges: [Double] = [40, 130, 400, 1200, 3500, 11000]
let framesPerSecond = 30.0
let fftSize = 2048
let log2n = vDSP_Length(11)
/// A bar spans this many dB around its band's running average: ±half maps to 0…1.
let swing: Float = 22
/// How quickly the running average follows the music (per frame, at 30 fps ≈ 2 s).
let averageRate: Float = 0.016
/// Overall loudness this far below the recent loudest moment reads as quiet.
let loudnessRange: Float = 26
/// The loudness peak falls this many dB per frame, so a soft outro still moves.
let peakDecay: Float = 0.04
/// Below this, the tap is hearing nothing worth drawing.
let silenceFloor: Float = -66

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

func bail(_ reason: String) -> Never {
    emit("{\"ok\":false,\"reason\":\"\(reason)\"}")
    exit(0)
}

func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

func read<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ initial: T) -> T? {
    var addr = address(selector)
    var value = initial
    var size = UInt32(MemoryLayout<T>.size)
    return withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &addr, 0, nil, &size, $0) } == noErr ? value : nil
}

func readString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = address(selector)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &addr, 0, nil, &size, $0) }
    return status == noErr ? value?.takeRetainedValue() as String? : nil
}

// MARK: - Locate Spotify inside Core Audio

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else { bail("not-running") }
let pid = app.processIdentifier

var processObject = AudioObjectID(kAudioObjectUnknown)
do {
    var addr = address(kAudioHardwarePropertyTranslatePIDToProcessObject)
    var qualifier = pid
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, UInt32(MemoryLayout<pid_t>.size), &qualifier, &size, &processObject)
    if status != noErr || processObject == kAudioObjectUnknown { bail("no-process-object") }
}

// MARK: - Tap and aggregate device

guard #available(macOS 14.2, *) else { bail("needs-macos-14.2") }

let description = CATapDescription(stereoMixdownOfProcesses: [processObject])
description.uuid = UUID()
description.name = "Claude Light levels"
description.muteBehavior = .unmuted
description.isPrivate = true

var tapID = AudioObjectID(kAudioObjectUnknown)
let tapStatus = AudioHardwareCreateProcessTap(description, &tapID)
if tapStatus != noErr || tapID == kAudioObjectUnknown { bail("tap-\(tapStatus)") }

guard let format = read(tapID, kAudioTapPropertyFormat, AudioStreamBasicDescription()) else { bail("no-format") }
let sampleRate = format.mSampleRate > 0 ? format.mSampleRate : 48000
let channels = Int(max(1, format.mChannelsPerFrame))
let interleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0

guard let outputDevice = read(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice, AudioDeviceID(kAudioObjectUnknown)),
      outputDevice != kAudioObjectUnknown,
      let outputUID = readString(outputDevice, kAudioDevicePropertyDeviceUID)
else { bail("no-output-device") }

let aggregateDescription: [String: Any] = [
    kAudioAggregateDeviceNameKey: "Claude Light levels",
    kAudioAggregateDeviceUIDKey: "com.claude-light.levels.\(UUID().uuidString)",
    kAudioAggregateDeviceMainSubDeviceKey: outputUID,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
    kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString]]
]
var aggregateID = AudioObjectID(kAudioObjectUnknown)
let aggregateStatus = AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateID)
if aggregateStatus != noErr || aggregateID == kAudioObjectUnknown {
    AudioHardwareDestroyProcessTap(tapID)
    bail("aggregate-\(aggregateStatus)")
}

// MARK: - Sample ring, filled from the realtime thread

final class Ring {
    private var samples = [Float](repeating: 0, count: fftSize)
    private var head = 0
    private var lock = os_unfair_lock()

    func push(_ list: UnsafePointer<AudioBufferList>) {
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: list))
        guard buffers.count > 0 else { return }
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        if interleaved {
            let buffer = buffers[0]
            guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else { return }
            let frames = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size / channels
            for frame in 0..<frames {
                var sum: Float = 0
                for channel in 0..<channels { sum += data[frame * channels + channel] }
                samples[head] = sum / Float(channels)
                head = (head + 1) % fftSize
            }
        } else {
            let frames = Int(buffers[0].mDataByteSize) / MemoryLayout<Float>.size
            let channelData = (0..<min(channels, buffers.count)).compactMap { buffers[$0].mData?.assumingMemoryBound(to: Float.self) }
            guard !channelData.isEmpty else { return }
            for frame in 0..<frames {
                var sum: Float = 0
                for data in channelData { sum += data[frame] }
                samples[head] = sum / Float(channelData.count)
                head = (head + 1) % fftSize
            }
        }
    }

    /// Oldest sample first, so the window lines up with time.
    func snapshot(into out: inout [Float]) {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        let tail = fftSize - head
        out.replaceSubrange(0..<tail, with: samples[head..<fftSize])
        out.replaceSubrange(tail..<fftSize, with: samples[0..<head])
    }
}

let ring = Ring()
var procID: AudioDeviceIOProcID?
let procStatus = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, nil) { _, input, _, _, _ in
    ring.push(input)
}
if procStatus != noErr || procID == nil {
    AudioHardwareDestroyAggregateDevice(aggregateID)
    AudioHardwareDestroyProcessTap(tapID)
    bail("ioproc-\(procStatus)")
}

func teardown() {
    if let procID { AudioDeviceStop(aggregateID, procID); AudioDeviceDestroyIOProcID(aggregateID, procID) }
    AudioHardwareDestroyAggregateDevice(aggregateID)
    AudioHardwareDestroyProcessTap(tapID)
}

let startStatus = AudioDeviceStart(aggregateID, procID)
if startStatus != noErr {
    teardown()
    bail("start-\(startStatus)")
}

// MARK: - Spectrum → five bars

let fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
var window = [Float](repeating: 0, count: fftSize)
vDSP_hann_window(&window, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))
var frame = [Float](repeating: 0, count: fftSize)
var windowed = [Float](repeating: 0, count: fftSize)
var real = [Float](repeating: 0, count: fftSize / 2)
var imag = [Float](repeating: 0, count: fftSize / 2)
var magnitudes = [Float](repeating: 0, count: fftSize / 2)
let bins: [Range<Int>] = (0..<(bandEdges.count - 1)).map { band in
    let lo = max(1, Int(bandEdges[band] * Double(fftSize) / sampleRate))
    let hi = min(fftSize / 2, Int(bandEdges[band + 1] * Double(fftSize) / sampleRate))
    return lo..<max(lo + 1, hi)
}
var averages: [Float?] = Array(repeating: nil, count: bins.count)
var levels = [Float](repeating: 0, count: bins.count)
var loudestRecently = silenceFloor + loudnessRange
var heard = 0

func analyze() -> [Float] {
    ring.snapshot(into: &frame)
    var rms: Float = 0
    vDSP_rmsqv(frame, 1, &rms, vDSP_Length(fftSize))
    let loudness = 20 * log10(max(rms, 1e-9))
    if loudness < silenceFloor {
        for i in levels.indices { levels[i] = max(0, levels[i] * 0.7 - 0.02) }
        return levels
    }
    vDSP_vmul(frame, 1, window, 1, &windowed, 1, vDSP_Length(fftSize))
    real.withUnsafeMutableBufferPointer { realPtr in
        imag.withUnsafeMutableBufferPointer { imagPtr in
            var split = DSPSplitComplex(realp: realPtr.baseAddress!, imagp: imagPtr.baseAddress!)
            windowed.withUnsafeBufferPointer { ptr in
                ptr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: fftSize / 2) { complex in
                    vDSP_ctoz(complex, 2, &split, 1, vDSP_Length(fftSize / 2))
                }
            }
            vDSP_fft_zrip(fftSetup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
            vDSP_zvmags(&split, 1, &magnitudes, 1, vDSP_Length(fftSize / 2))
        }
    }
    loudestRecently = max(loudness, loudestRecently - peakDecay)
    // A plain mean for the first couple of seconds, so a track that fades in
    // does not pin every bar to the top while the average catches up.
    heard += 1
    let rate = max(averageRate, 1 / Float(heard))
    let presence = max(0.2, min(1, (loudness - (loudestRecently - loudnessRange)) / loudnessRange))
    for (index, range) in bins.enumerated() {
        var mean: Float = 0
        magnitudes.withUnsafeBufferPointer { ptr in
            vDSP_meanv(ptr.baseAddress! + range.lowerBound, 1, &mean, vDSP_Length(range.count))
        }
        let db = 10 * log10(max(mean, 1e-12))
        let average = averages[index].map { $0 + (db - $0) * rate } ?? db
        averages[index] = average
        // Where this moment sits against the band's own recent history, then
        // scaled by how loud the whole mix is right now.
        let target = max(0, min(1, 0.5 + (db - average) / swing)) * presence
        // Instant attack, ~120 ms release. Bars jump on a hit and settle on their own.
        levels[index] = target >= levels[index] ? target : max(target, levels[index] * 0.76)
    }
    return levels
}

// MARK: - Run

emit("{\"ok\":true,\"rate\":\(Int(sampleRate))}")

// The aggregate is pinned to one output device. When the default output moves
// (headphones in, AirPods on) the tap goes quiet, so leave and let the app
// start a fresh one against the new device.
var deviceAddress = address(kAudioHardwarePropertyDefaultOutputDevice)
AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &deviceAddress, DispatchQueue.main) { _, _ in
    teardown()
    exit(0)
}

// stdin closing means the app that started us is gone, or wants us gone.
Thread.detachNewThread {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    DispatchQueue.main.async { teardown(); exit(0) }
}

let timer = Timer(timeInterval: 1 / framesPerSecond, repeats: true) { _ in
    if kill(pid, 0) != 0 { teardown(); exit(0) }
    let line = analyze().map { String(format: "%.2f", $0) }.joined(separator: " ")
    emit(line)
}
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
