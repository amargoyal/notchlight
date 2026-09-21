// calendarwatch — today's events and reminders, and a fresh list whenever they change.
//
// EventKit has no polling story worth having: EKEventStoreChanged fires when
// anything in the database moves, and the fetch either side of it is cheap for
// a single day. So this asks once, prints the day, and prints it again whenever
// the store says something changed — or when the day itself rolls over.
//
// Access is asked for on the first run and answered by macOS. A refusal is a
// first line and an exit, not an error: the app draws no calendar face and says
// why, and the keys that explain the request live in the app's Info.plist.
//
// Protocol on stdout, one JSON object per line:
//   first line   {"ok":true,"reminders":true,
//                 "calendars":[{"id":"…","title":"Work","color":"#c97c5c","kind":"event"}, …]}
//                or  {"ok":false,"reason":"denied"}     also: restricted, unsupported
//   then         {"day":"2026-09-20","events":[{…}, …]}
//
// Each event: {"id","calendarId","title","start","end","allDay","location","kind","done","past"}
// `start` and `end` are ISO 8601 with an offset. A reminder has `kind":"reminder"`,
// no `end`, and `done` when it has been completed. Exits 0 when stdin closes.
//
//   swiftc -O -o calendarwatch calendarwatch.swift
//   calendarwatch [--reminders]
//     --reminders  also ask for reminders access and include today's reminders

import EventKit
import Foundation

let wantsReminders = CommandLine.arguments.contains("--reminders")
let store = EKEventStore()

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func bail(_ reason: String) -> Never {
    emit(["ok": false, "reason": reason])
    exit(0)
}

/// `#rrggbb` from a calendar's colour, so the app never has to know about CGColor.
func hex(_ color: CGColor?) -> String {
    guard let components = color?.components, components.count >= 3 else { return "#8d8a84" }
    let byte = { (value: CGFloat) in Int((max(0, min(1, value)) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", byte(components[0]), byte(components[1]), byte(components[2]))
}

let iso: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
}()
let dayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
}()

// MARK: - Access

/// Ask for both kinds up front. A refusal for reminders is survivable; one for
/// events is not, because events are the whole point of the face.
@available(macOS 14.0, *)
func requestAccess() -> Bool {
    let group = DispatchGroup()
    var eventsGranted = false
    group.enter()
    store.requestFullAccessToEvents { granted, _ in eventsGranted = granted; group.leave() }
    if wantsReminders {
        group.enter()
        store.requestFullAccessToReminders { _, _ in group.leave() }
    }
    group.wait()
    return eventsGranted
}

// Full access is a macOS 14 idea. Before that the same request meant something
// different, and asking for the old one would be asking for more than this
// needs. Everything else in the app still works on an older Mac; the calendar
// face does not appear.
guard #available(macOS 14.0, *) else { bail("unsupported") }
if EKEventStore.authorizationStatus(for: .event) == .restricted { bail("restricted") }
if !requestAccess() { bail("denied") }

@Sendable func remindersAllowed() -> Bool {
    wantsReminders && EKEventStore.authorizationStatus(for: .reminder) == .fullAccess
}

// MARK: - The day

@Sendable func dayBounds(_ now: Date = Date()) -> (Date, Date) {
    let calendar = Calendar.current
    let start = calendar.startOfDay(for: now)
    return (start, calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86400))
}

@Sendable func calendarList() -> [[String: Any]] {
    var all = store.calendars(for: .event).map { calendar in
        ["id": calendar.calendarIdentifier, "title": calendar.title, "color": hex(calendar.cgColor), "kind": "event"] as [String: Any]
    }
    if remindersAllowed() {
        all += store.calendars(for: .reminder).map { calendar in
            ["id": calendar.calendarIdentifier, "title": calendar.title, "color": hex(calendar.cgColor), "kind": "reminder"] as [String: Any]
        }
    }
    return all
}

@Sendable func eventsToday() -> [[String: Any]] {
    let (start, end) = dayBounds()
    let now = Date()
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    return store.events(matching: predicate)
        .sorted { ($0.startDate ?? start) < ($1.startDate ?? start) }
        .map { event in
            [
                "id": event.eventIdentifier ?? UUID().uuidString,
                "calendarId": event.calendar?.calendarIdentifier ?? "",
                "title": event.title ?? "Untitled",
                "start": iso.string(from: event.startDate ?? start),
                "end": iso.string(from: event.endDate ?? event.startDate ?? start),
                "allDay": event.isAllDay,
                "location": event.location ?? "",
                "kind": "event",
                "done": false,
                "past": (event.endDate ?? start) < now
            ] as [String: Any]
        }
}

/// Reminders due today. The fetch is asynchronous, so this waits for it —
/// everything here runs on one pass and prints one line.
@Sendable func remindersToday() -> [[String: Any]] {
    guard remindersAllowed() else { return [] }
    let (start, end) = dayBounds()
    let now = Date()
    let predicate = store.predicateForIncompleteReminders(withDueDateStarting: start, ending: end, calendars: nil)
    var found: [EKReminder] = []
    let group = DispatchGroup()
    group.enter()
    store.fetchReminders(matching: predicate) { reminders in
        found = reminders ?? []
        group.leave()
    }
    // A store that never answers must not wedge the helper; the events still print.
    _ = group.wait(timeout: .now() + 5)
    return found.compactMap { reminder in
        guard let due = reminder.dueDateComponents?.date else { return nil }
        return [
            "id": reminder.calendarItemIdentifier,
            "calendarId": reminder.calendar?.calendarIdentifier ?? "",
            "title": reminder.title ?? "Untitled",
            "start": iso.string(from: due),
            "allDay": reminder.dueDateComponents?.hour == nil,
            "location": reminder.location ?? "",
            "kind": "reminder",
            "done": reminder.isCompleted,
            "past": due < now
        ] as [String: Any]
    }
}

var lastLine = ""

@Sendable func report() {
    let (start, _) = dayBounds()
    let items = (eventsToday() + remindersToday()).sorted { left, right in
        (left["start"] as? String ?? "") < (right["start"] as? String ?? "")
    }
    let payload: [String: Any] = ["day": dayFormatter.string(from: start), "events": items]
    guard let data = try? JSONSerialization.data(withJSONObject: payload), let line = String(data: data, encoding: .utf8) else { return }
    // EKEventStoreChanged fires for changes to any day, and most of them are not
    // today's. A line the app has already seen is a wake-up for nothing.
    guard line != lastLine else { return }
    lastLine = line
    print(line)
    fflush(stdout)
}

var ready: [String: Any] = ["ok": true, "calendars": calendarList()]
ready["reminders"] = remindersAllowed()
emit(ready)
report()

NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: nil) { _ in
    report()
}

// Midnight is a change nothing notifies about. A minute apart is plenty for a
// day boundary, and it prints nothing at all unless the day's list really moved.
let timer = Timer(timeInterval: 60, repeats: true) { _ in report() }
RunLoop.main.add(timer, forMode: .common)

// stdin closing means the app that started us is gone, or wants us gone.
Thread.detachNewThread {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    exit(0)
}

RunLoop.main.run()
