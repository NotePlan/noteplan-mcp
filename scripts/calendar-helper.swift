#!/usr/bin/env swift
// Calendar helper using EventKit - much faster than AppleScript

import EventKit
import Foundation

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

// Parse command line arguments
let args = CommandLine.arguments
let command = args.count > 1 ? args[1] : "list-events"

func formatDate(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    return formatter.string(from: date)
}

func parseDate(_ str: String) -> Date? {
    // Try full ISO8601 with time first
    let fullFormatter = ISO8601DateFormatter()
    fullFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fullFormatter.date(from: str) { return date }

    // Try without fractional seconds
    fullFormatter.formatOptions = [.withInternetDateTime]
    if let date = fullFormatter.date(from: str) { return date }

    // Try date only
    let dateOnlyFormatter = ISO8601DateFormatter()
    dateOnlyFormatter.formatOptions = [.withFullDate]
    return dateOnlyFormatter.date(from: str)
}

store.requestFullAccessToEvents { granted, error in
    defer { semaphore.signal() }

    guard granted else {
        print("{\"error\": \"Calendar access denied. Grant access in System Preferences > Privacy > Calendars.\"}")
        return
    }

    switch command {
    case "list-events":
        // Get events for date range
        let startStr = args.count > 2 ? args[2] : formatDate(Date()).prefix(10).description
        let days = args.count > 3 ? Int(args[3]) ?? 1 : 1
        let calendarFilter = args.count > 4 ? args[4] : ""

        let startDate = parseDate(startStr) ?? Date()
        let endDate = Calendar.current.date(byAdding: .day, value: days, to: startDate) ?? Date()

        var calendars: [EKCalendar]? = nil
        if !calendarFilter.isEmpty {
            calendars = store.calendars(for: .event).filter { $0.title == calendarFilter }
        }

        let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: calendars)
        let events = store.events(matching: predicate)

        var result: [[String: Any]] = []
        for event in events {
            var dict: [String: Any] = [
                "id": event.eventIdentifier ?? "",
                "title": event.title ?? "",
                "startDate": formatDate(event.startDate),
                "endDate": formatDate(event.endDate),
                "allDay": event.isAllDay,
                "calendar": event.calendar.title
            ]
            if let location = event.location, !location.isEmpty {
                dict["location"] = location
            }
            if let notes = event.notes, !notes.isEmpty {
                dict["notes"] = notes
            }
            result.append(dict)
        }

        if let jsonData = try? JSONSerialization.data(withJSONObject: result, options: []),
           let jsonStr = String(data: jsonData, encoding: .utf8) {
            print(jsonStr)
        }

    case "list-calendars":
        let calendars = store.calendars(for: .event)
        var result: [[String: Any]] = []
        for cal in calendars {
            result.append([
                "name": cal.title,
                "id": cal.calendarIdentifier
            ])
        }
        if let jsonData = try? JSONSerialization.data(withJSONObject: result, options: []),
           let jsonStr = String(data: jsonData, encoding: .utf8) {
            print(jsonStr)
        }

    case "create-event":
        guard args.count >= 5 else {
            print("{\"error\": \"Usage: create-event <title> <startDate> <endDate> [calendar] [location] [notes] [allDay]\"}")
            return
        }
        let title = args[2]
        let startDate = parseDate(args[3]) ?? Date()
        let endDate = parseDate(args[4]) ?? Calendar.current.date(byAdding: .hour, value: 1, to: startDate)!
        let calendarName = args.count > 5 ? args[5] : ""
        let location = args.count > 6 ? args[6] : ""
        let notes = args.count > 7 ? args[7] : ""
        let isAllDay = args.count > 8 ? args[8] == "true" : false

        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = startDate
        event.endDate = endDate
        event.isAllDay = isAllDay
        if !location.isEmpty { event.location = location }
        if !notes.isEmpty { event.notes = notes }

        if !calendarName.isEmpty,
           let cal = store.calendars(for: .event).first(where: { $0.title == calendarName }) {
            event.calendar = cal
        } else {
            event.calendar = store.defaultCalendarForNewEvents
        }

        do {
            try store.save(event, span: .thisEvent)
            print("{\"success\": true, \"id\": \"\(event.eventIdentifier ?? "")\"}")
        } catch {
            print("{\"error\": \"\(error.localizedDescription)\"}")
        }

    case "update-event":
        guard args.count >= 4 else {
            print("{\"error\": \"Usage: update-event <eventId> <updatesJson>\"}")
            return
        }
        let eventId = args[2]
        let updatesJson = args[3]

        guard let event = store.event(withIdentifier: eventId) else {
            print("{\"error\": \"Event not found\"}")
            return
        }

        guard let jsonData = updatesJson.data(using: .utf8),
              let updates = try? JSONSerialization.jsonObject(with: jsonData) as? [String: String] else {
            print("{\"error\": \"Invalid updates JSON\"}")
            return
        }

        if let title = updates["title"] { event.title = title }
        if let startDateStr = updates["startDate"], let startDate = parseDate(startDateStr) {
            event.startDate = startDate
        }
        if let endDateStr = updates["endDate"], let endDate = parseDate(endDateStr) {
            event.endDate = endDate
        }
        if let location = updates["location"] { event.location = location }
        if let notes = updates["notes"] { event.notes = notes }

        do {
            try store.save(event, span: .thisEvent)
            print("{\"success\": true}")
        } catch {
            print("{\"error\": \"\(error.localizedDescription)\"}")
        }

    case "delete-event":
        guard args.count >= 3 else {
            print("{\"error\": \"Usage: delete-event <eventId>\"}")
            return
        }
        let eventId = args[2]
        if let event = store.event(withIdentifier: eventId) {
            do {
                try store.remove(event, span: .thisEvent)
                print("{\"success\": true}")
            } catch {
                print("{\"error\": \"\(error.localizedDescription)\"}")
            }
        } else {
            print("{\"error\": \"Event not found\"}")
        }

    default:
        print("{\"error\": \"Unknown command: \(command)\"}")
    }
}

_ = semaphore.wait(timeout: .now() + 30)
