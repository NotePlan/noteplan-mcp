#!/usr/bin/env swift
// Reminders helper using EventKit - much faster than AppleScript

import EventKit
import Foundation

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

// Parse command line arguments
let args = CommandLine.arguments
let command = args.count > 1 ? args[1] : "list-reminders"

func formatDate(_ date: Date?) -> String {
    guard let date = date else { return "" }
    let formatter = ISO8601DateFormatter()
    return formatter.string(from: date)
}

func parseDate(_ str: String) -> Date? {
    let trimmed = str.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { return nil }

    // Full ISO 8601 with fractional seconds (2026-02-23T14:00:00.000Z)
    let isoFrac = ISO8601DateFormatter()
    isoFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = isoFrac.date(from: trimmed) { return date }

    // Full ISO 8601 without fractional seconds (2026-02-23T14:00:00Z or +00:00)
    let iso = ISO8601DateFormatter()
    if let date = iso.date(from: trimmed) { return date }

    // Local datetime variants (no timezone — treat as local)
    let localFormatter = DateFormatter()
    localFormatter.locale = Locale(identifier: "en_US_POSIX")
    for fmt in [
        "yyyy-MM-dd'T'HH:mm:ss.SSS",
        "yyyy-MM-dd'T'HH:mm:ss",
        "yyyy-MM-dd'T'HH:mm",
        "yyyy-MM-dd HH:mm:ss",
        "yyyy-MM-dd HH:mm",
    ] {
        localFormatter.dateFormat = fmt
        if let date = localFormatter.date(from: trimmed) { return date }
    }

    // Date-only (2026-02-23) — midnight local
    localFormatter.dateFormat = "yyyy-MM-dd"
    return localFormatter.date(from: trimmed)
}

func escapeJsonString(_ str: String) -> String {
    return str
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
        .replacingOccurrences(of: "\r", with: "\\r")
        .replacingOccurrences(of: "\t", with: "\\t")
}

func outputJson(_ obj: Any) {
    if let jsonData = try? JSONSerialization.data(withJSONObject: obj, options: []),
       let jsonStr = String(data: jsonData, encoding: .utf8) {
        print(jsonStr)
    }
    fflush(stdout)
}

store.requestFullAccessToReminders { granted, error in
    guard granted else {
        print("{\"error\": \"Reminders access denied. Grant access in System Preferences > Privacy > Reminders.\"}")
        fflush(stdout)
        semaphore.signal()
        return
    }

    switch command {
    case "list-reminders":
        let listFilter = args.count > 2 ? args[2] : ""
        let includeCompleted = args.count > 3 ? args[3] == "true" : false

        var calendars: [EKCalendar]? = nil
        if !listFilter.isEmpty {
            calendars = store.calendars(for: .reminder).filter { $0.title == listFilter }
        }

        let predicate = store.predicateForReminders(in: calendars)

        store.fetchReminders(matching: predicate) { reminders in
            var result: [[String: Any]] = []

            for reminder in reminders ?? [] {
                if !includeCompleted && reminder.isCompleted { continue }

                var dict: [String: Any] = [
                    "id": reminder.calendarItemIdentifier,
                    "title": reminder.title ?? "",
                    "completed": reminder.isCompleted,
                    "list": reminder.calendar.title
                ]

                if let dueDate = reminder.dueDateComponents {
                    if let date = Calendar.current.date(from: dueDate) {
                        dict["dueDate"] = formatDate(date)
                    }
                }

                if let notes = reminder.notes, !notes.isEmpty {
                    dict["notes"] = notes
                }

                if reminder.priority > 0 {
                    dict["priority"] = reminder.priority
                }

                result.append(dict)
            }

            // Sort by due date
            result.sort { (a, b) in
                let dateA = a["dueDate"] as? String ?? "9999"
                let dateB = b["dueDate"] as? String ?? "9999"
                return dateA < dateB
            }

            outputJson(result)
            semaphore.signal()
        }
        // Don't signal here - the async callback will do it

    case "list-lists":
        let calendars = store.calendars(for: .reminder)
        var result: [[String: Any]] = []

        for cal in calendars {
            result.append([
                "name": cal.title,
                "id": cal.calendarIdentifier
            ])
        }

        outputJson(result)
        semaphore.signal()

    case "create-reminder":
        guard args.count >= 3 else {
            print("{\"error\": \"Usage: create-reminder <title> [listName] [dueDate] [notes] [priority]\"}")
            fflush(stdout)
            semaphore.signal()
            return
        }
        let title = args[2]
        let listName = args.count > 3 ? args[3] : ""
        let dueDateStr = args.count > 4 ? args[4] : ""
        let notes = args.count > 5 ? args[5] : ""
        let priority = args.count > 6 ? Int(args[6]) ?? 0 : 0

        let reminder = EKReminder(eventStore: store)
        reminder.title = title

        if !listName.isEmpty,
           let cal = store.calendars(for: .reminder).first(where: { $0.title == listName }) {
            reminder.calendar = cal
        } else {
            reminder.calendar = store.defaultCalendarForNewReminders()
        }

        if let dueDate = parseDate(dueDateStr) {
            reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
        }

        if !notes.isEmpty { reminder.notes = notes }
        if priority > 0 { reminder.priority = priority }

        do {
            try store.save(reminder, commit: true)
            print("{\"success\": true, \"id\": \"\(reminder.calendarItemIdentifier)\"}")
        } catch {
            print("{\"error\": \"\(escapeJsonString(error.localizedDescription))\"}")
        }
        fflush(stdout)
        semaphore.signal()

    case "complete-reminder":
        guard args.count >= 3 else {
            print("{\"error\": \"Usage: complete-reminder <reminderId>\"}")
            fflush(stdout)
            semaphore.signal()
            return
        }
        let reminderId = args[2]

        guard let reminder = store.calendarItem(withIdentifier: reminderId) as? EKReminder else {
            print("{\"error\": \"Reminder not found\"}")
            fflush(stdout)
            semaphore.signal()
            return
        }

        reminder.isCompleted = true
        reminder.completionDate = Date()

        do {
            try store.save(reminder, commit: true)
            print("{\"success\": true}")
        } catch {
            print("{\"error\": \"\(escapeJsonString(error.localizedDescription))\"}")
        }
        fflush(stdout)
        semaphore.signal()

    case "update-reminder":
        guard args.count >= 4 else {
            print("{\"error\": \"Usage: update-reminder <reminderId> <updatesJson>\"}")
            fflush(stdout)
            semaphore.signal()
            return
        }
        let reminderId = args[2]
        let updatesJson = args[3]

        guard let reminder = store.calendarItem(withIdentifier: reminderId) as? EKReminder else {
            print("{\"error\": \"Reminder not found\"}")
            fflush(stdout)
            semaphore.signal()
            return
        }

        guard let jsonData = updatesJson.data(using: .utf8),
              let updates = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            print("{\"error\": \"Invalid updates JSON\"}")
            fflush(stdout)
            semaphore.signal()
            return
        }

        if let title = updates["title"] as? String { reminder.title = title }
        if let dueDateStr = updates["dueDate"] as? String, let dueDate = parseDate(dueDateStr) {
            reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
        }
        if let notes = updates["notes"] as? String { reminder.notes = notes }
        if let priority = updates["priority"] as? Int { reminder.priority = priority }

        do {
            try store.save(reminder, commit: true)
            print("{\"success\": true}")
        } catch {
            print("{\"error\": \"\(escapeJsonString(error.localizedDescription))\"}")
        }
        fflush(stdout)
        semaphore.signal()

    case "delete-reminder":
        guard args.count >= 3 else {
            print("{\"error\": \"Usage: delete-reminder <reminderId>\"}")
            fflush(stdout)
            semaphore.signal()
            return
        }
        let reminderId = args[2]

        guard let reminder = store.calendarItem(withIdentifier: reminderId) as? EKReminder else {
            print("{\"error\": \"Reminder not found\"}")
            fflush(stdout)
            semaphore.signal()
            return
        }

        do {
            try store.remove(reminder, commit: true)
            print("{\"success\": true}")
        } catch {
            print("{\"error\": \"\(escapeJsonString(error.localizedDescription))\"}")
        }
        fflush(stdout)
        semaphore.signal()

    default:
        print("{\"error\": \"Unknown command: \(command)\"}")
        fflush(stdout)
        semaphore.signal()
    }
}

_ = semaphore.wait(timeout: .now() + 30)
