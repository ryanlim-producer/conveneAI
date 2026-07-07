// asisvoz-audio-router
//
// Keeps a self-managing Multi-Output device ("AsisVoz Audio") as the Mac's
// default output so that BlackHole ALWAYS receives a copy of system audio
// (Internal Audio recording in the AsisVoz desktop app keeps working), while
// playback follows your real listening device:
//
//   Bluetooth output connected  -> [Bluetooth device + BlackHole]
//   otherwise                   -> [built-in speakers + BlackHole]
//
// The tool listens for CoreAudio topology / default-device changes and
// reconciles: it rebuilds the aggregate's membership and re-asserts it as
// the default output (macOS likes to switch the default to a Bluetooth
// device the moment it connects — we switch it back to the aggregate that
// contains it).
//
// It also maintains "AsisVoz Meeting Input" — a combined INPUT device
// [microphone + BlackHole] so the desktop app's "Meeting" source records
// your own voice and the meeting's system audio at the same time. The
// microphone member follows Bluetooth the same way playback does.
//
// Usage:
//   asisvoz-audio-router --once    reconcile once and exit (setup / testing)
//   asisvoz-audio-router           run forever (for launchd)

import CoreAudio
import Foundation

let AGGREGATE_UID = "com.asisvoz.audio-router.aggregate"
let AGGREGATE_NAME = "AsisVoz Audio"
let INPUT_AGGREGATE_UID = "com.asisvoz.audio-router.meeting-input"
let INPUT_AGGREGATE_NAME = "AsisVoz Meeting Input"
let BLACKHOLE_NAME_PREFIX = "BlackHole"

func log(_ msg: String) {
    let ts = ISO8601DateFormatter().string(from: Date())
    print("[\(ts)] \(msg)")
    fflush(stdout)
}

// ── CoreAudio property helpers ──────────────────────────────────────────────

func propertyAddress(_ selector: AudioObjectPropertySelector,
                     scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal)
    -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope,
                               mElement: kAudioObjectPropertyElementMain)
}

func getDeviceIDs() -> [AudioDeviceID] {
    var address = propertyAddress(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject),
                                         &address, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),
                                     &address, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

func getStringProperty(_ device: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
    var address = propertyAddress(selector)
    var size = UInt32(MemoryLayout<CFString?>.size)
    var value: CFString? = nil
    let err = withUnsafeMutablePointer(to: &value) { ptr in
        AudioObjectGetPropertyData(device, &address, 0, nil, &size, ptr)
    }
    guard err == noErr, let cf = value else { return nil }
    return cf as String
}

func getTransportType(_ device: AudioDeviceID) -> UInt32 {
    var address = propertyAddress(kAudioDevicePropertyTransportType)
    var size = UInt32(MemoryLayout<UInt32>.size)
    var value: UInt32 = 0
    guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr else { return 0 }
    return value
}

func channelCount(_ device: AudioDeviceID, scope: AudioObjectPropertyScope) -> Int {
    var address = propertyAddress(kAudioDevicePropertyStreamConfiguration, scope: scope)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let buffer = UnsafeMutableRawPointer.allocate(byteCount: Int(size),
                                                  alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { buffer.deallocate() }
    guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, buffer) == noErr else { return 0 }
    let list = UnsafeMutableAudioBufferListPointer(buffer.assumingMemoryBound(to: AudioBufferList.self))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}

struct Device {
    let id: AudioDeviceID
    let uid: String
    let name: String
    let transport: UInt32
}

func devices(scope: AudioObjectPropertyScope) -> [Device] {
    getDeviceIDs().compactMap { id in
        guard channelCount(id, scope: scope) > 0,
              let uid = getStringProperty(id, kAudioDevicePropertyDeviceUID),
              let name = getStringProperty(id, kAudioObjectPropertyName) as String? else { return nil }
        return Device(id: id, uid: uid, name: name, transport: getTransportType(id))
    }
}

func getDefaultOutput() -> AudioDeviceID {
    var address = propertyAddress(kAudioHardwarePropertyDefaultOutputDevice)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var value: AudioDeviceID = 0
    _ = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),
                                   &address, 0, nil, &size, &value)
    return value
}

func setDefaultOutput(_ device: AudioDeviceID) {
    var address = propertyAddress(kAudioHardwarePropertyDefaultOutputDevice)
    var value = device
    let err = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject),
                                         &address, 0, nil,
                                         UInt32(MemoryLayout<AudioDeviceID>.size), &value)
    if err != noErr { log("failed to set default output (err \(err))") }
}

// ── Aggregate management ────────────────────────────────────────────────────

func currentSubDeviceUIDs(_ aggregate: AudioDeviceID) -> [String] {
    var address = propertyAddress(kAudioAggregateDevicePropertyFullSubDeviceList)
    var size = UInt32(MemoryLayout<CFArray?>.size)
    var value: CFArray? = nil
    let err = withUnsafeMutablePointer(to: &value) { ptr in
        AudioObjectGetPropertyData(aggregate, &address, 0, nil, &size, ptr)
    }
    guard err == noErr, let array = value as? [String] else { return [] }
    return array
}

func setSubDevices(_ aggregate: AudioDeviceID, uids: [String]) {
    var address = propertyAddress(kAudioAggregateDevicePropertyFullSubDeviceList)
    var value = uids as CFArray
    let err = withUnsafeMutablePointer(to: &value) { ptr in
        AudioObjectSetPropertyData(aggregate, &address, 0, nil,
                                   UInt32(MemoryLayout<CFArray>.size), ptr)
    }
    if err != noErr { log("failed to set sub-device list (err \(err))") }
}

func createAggregate(name: String, uid: String, subDeviceUIDs: [String],
                     mainUID: String, stacked: Bool) -> AudioDeviceID? {
    let subDevices = subDeviceUIDs.map { subUID -> [String: Any] in
        [kAudioSubDeviceUIDKey as String: subUID,
         kAudioSubDeviceDriftCompensationKey as String: subUID == mainUID ? 0 : 1]
    }
    let description: [String: Any] = [
        kAudioAggregateDeviceNameKey as String: name,
        kAudioAggregateDeviceUIDKey as String: uid,
        kAudioAggregateDeviceSubDeviceListKey as String: subDevices,
        kAudioAggregateDeviceMainSubDeviceKey as String: mainUID,
        // stacked = Multi-Output (mirrored playback); non-stacked = combined channels
        kAudioAggregateDeviceIsStackedKey as String: stacked ? 1 : 0,
    ]
    var aggregateID: AudioDeviceID = 0
    let err = AudioHardwareCreateAggregateDevice(description as CFDictionary, &aggregateID)
    guard err == noErr else {
        log("failed to create aggregate (err \(err))")
        return nil
    }
    return aggregateID
}

// ── Reconcile ───────────────────────────────────────────────────────────────

func isBluetooth(_ d: Device) -> Bool {
    d.transport == kAudioDeviceTransportTypeBluetooth ||
    d.transport == kAudioDeviceTransportTypeBluetoothLE
}

/// Ensure an aggregate exists with exactly these members; returns its id.
func ensureAggregate(name: String, uid: String, wantedUIDs: [String], mainUID: String,
                     stacked: Bool, existing: Device?) -> AudioDeviceID? {
    if let existing = existing {
        if currentSubDeviceUIDs(existing.id) != wantedUIDs {
            log("updating '\(name)' members -> \(wantedUIDs.joined(separator: " + "))")
            setSubDevices(existing.id, uids: wantedUIDs)
        }
        return existing.id
    }
    log("creating '\(name)' -> \(wantedUIDs.joined(separator: " + "))")
    return createAggregate(name: name, uid: uid, subDeviceUIDs: wantedUIDs,
                           mainUID: mainUID, stacked: stacked)
}

func reconcile() {
    let outputs = devices(scope: kAudioDevicePropertyScopeOutput)
    let inputs = devices(scope: kAudioDevicePropertyScopeInput)

    guard let blackholeOut = outputs.first(where: { $0.name.hasPrefix(BLACKHOLE_NAME_PREFIX) }),
          let blackholeIn = inputs.first(where: { $0.name.hasPrefix(BLACKHOLE_NAME_PREFIX) }) else {
        log("BlackHole not found — nothing to do (install BlackHole 2ch)")
        return
    }

    // ── Output: [listening device + BlackHole], default output ──
    let btOut = outputs.first { isBluetooth($0) && $0.uid != blackholeOut.uid }
    let builtInOut = outputs.first { $0.transport == kAudioDeviceTransportTypeBuiltIn }

    if let companion = btOut ?? builtInOut {
        let target = ensureAggregate(
            name: AGGREGATE_NAME, uid: AGGREGATE_UID,
            wantedUIDs: [companion.uid, blackholeOut.uid], mainUID: companion.uid,
            stacked: true,
            existing: outputs.first { $0.uid == AGGREGATE_UID })
        if let target = target, getDefaultOutput() != target {
            log("setting default output -> '\(AGGREGATE_NAME)' (hearing via \(companion.name))")
            setDefaultOutput(target)
        }
    } else {
        log("no companion output device found")
    }

    // ── Input: [microphone + BlackHole] combined, for the app's Meeting source ──
    let btMic = inputs.first { isBluetooth($0) && $0.uid != blackholeIn.uid }
    let builtInMic = inputs.first { $0.transport == kAudioDeviceTransportTypeBuiltIn }

    if let mic = btMic ?? builtInMic {
        _ = ensureAggregate(
            name: INPUT_AGGREGATE_NAME, uid: INPUT_AGGREGATE_UID,
            wantedUIDs: [mic.uid, blackholeIn.uid], mainUID: mic.uid,
            stacked: false,
            existing: inputs.first { $0.uid == INPUT_AGGREGATE_UID })
    } else {
        log("no microphone found for the meeting input")
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

reconcile()

if CommandLine.arguments.contains("--once") {
    log("reconciled once, exiting")
    exit(0)
}

// Debounced re-reconcile on any device topology or default-output change
// (Bluetooth connects fire several events in quick succession).
let queue = DispatchQueue(label: "audio-router")
var pending: DispatchWorkItem? = nil
let listener: AudioObjectPropertyListenerBlock = { _, _ in
    pending?.cancel()
    let work = DispatchWorkItem { reconcile() }
    pending = work
    queue.asyncAfter(deadline: .now() + 0.7, execute: work)
}

var devicesAddress = propertyAddress(kAudioHardwarePropertyDevices)
var defaultAddress = propertyAddress(kAudioHardwarePropertyDefaultOutputDevice)
AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &devicesAddress, queue, listener)
AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &defaultAddress, queue, listener)

log("watching for audio device changes (Ctrl-C to stop)")
RunLoop.main.run()
