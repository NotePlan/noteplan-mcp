<details>
<summary>API</summary>
<p>

```javascript
CalendarItem

/**
* The ID of the event or reminder after it has been created by `Calendar.add(calendarItem)`. 
* The ID is not set in the original CalendarItem, you need to use the return value of `Calendar.add(calendarItem)` to get it.
* Use the ID later to refer to this event (to modify or delete).
* @type {String}
*/
.id

/**
* The title of the event or reminder.
* @type {String}
*/
.title

/**
* The date (with time) of the event or reminder.
* @type {Date}
*/
.date

/**
* The endDate (with time) of the event (reminders have no endDate). So, this can be optional.
* @type {Date}
*/
.endDate

/**
* The type of the calendar item, either "event" or "reminder".
* @type {String}
*/
.type

/**
* If the calendar item is all-day, means it has no specific time.
* @type {Boolean}
*/
.isAllDay
    
/**
* If the calendar item is completed. This applies only to reminders.
* Note: Available from v3.0.15
* @type {Boolean}
*/
.isCompleted
    
/**
* All the dates the event or reminder occurs (if it's a multi-day event for example)
* Note: Available from v3.0.15
* @type {[Date]}
*/
.occurences
    
/**
* The calendar or reminders list where this event or reminder is (or should be) saved. If you set nothing, the event or reminder will be added to the default and this field will be set after adding.
* Note: Available from v3.0.15
* @type {String}
*/
.calendar
    
/**
* The color of the calendar or reminders list where this event or reminder belongs, as a hex color string (e.g., "#5A9FD4").
* This is a read-only property that reflects the actual color assigned to the calendar in the system calendar app.
* Note: Available from v3.20
* @type {String}
*/
.color
    
/**
* Text saved in the "Notes" field of the event or reminder.
* Note: Available from v3.0.26
* @type {String}
*/
.notes
    
/**
* URL saved with the event or reminder.
* Note: Available from v3.0.26
* @type {String}
*/
.url
    
/**
* If supported, shows the availability. The default is 0 = busy.
* notSupported = -1
* busy = 0
* free = 1
* tentative = 2
* unavailable = 3
* Note: Available from v3.3
* @type {Int}
*/
.availability

/**
* List of attendee names or emails as links.
* Note: Available from v3.5
* @type {[String]}
*/
.attendees
    
/**
* List of attendee names or emails as plain text.
* Note: Available from v3.5.2
* @type {[String]}
*/
.attendeeNames
    
/**
* Markdown link for the given event. If you add this link to a note, NotePlan will link the event with the note and show the note in the dropdown when you click on the note icon of the event in the sidebar.
* Note: Available from v3.5, only events, reminders are not supported yet
* @type {String}
*/
.calendarItemLink
    
/**
* Note: Available in 3.9.1
* Searches and returns all filenames it's linked to (meeting notes). Use with await. Returns an array of filenames.
* @type {Promise([String])}
*/
.findLinkedFilenames()

/**
* Creates a CalendarItem. The .endDate is optional, but recommended for events. Reminders don't use this field.
* The type can be "event" or "reminder". And isAllDay can be used if you don't want to define a specific time, like holidays.
* Use the calendar variable, if you want to add the event or reminder to another calendar or reminders list other than the default. This is optional, if you set nothing, it will use the default.
* Use isCompleted only for reminders, by default it's false if you set nothing.
* @param {String} 
* @param {Date} 
* @param {Date}
* @param {String}  
* @param {Boolean?}  
* @param {String?} - Available from v3.0.15
* @param {Boolean?} - Available from v3.0.15
* @param {String?} - Available from v3.0.26
* @param {String?} - Available from v3.0.26
* @param {Int?} - Available from v3.3
* @return {CalendarItem}
*/
.create(title, date, endDate, type, isAllDay, calendar, isCompleted, notes, url, availability)
```

</p>
</details>  

<details>
<summary>Examples</summary>
<p>
    
```javascript
async function createEvent() {
    try {
        let title = await CommandBar.showInput("Enter the title of the event", "Submit title '%@', then...")

        // To make this work you need to enter '2021/04/12 09:00' for example
        let dateText = await CommandBar.showInput("Enter date", "Create event '" + title + "' with date '%@'")

        console.log("dateText: " + dateText)

        // Parses date and time text such as 'today at 5pm - 7pm'
        let dates = Calendar.parseDateText(dateText)

        if(dates.length >= 0) {
            let parsed = dates[0]
            let start = parsed.start
            let end = parsed.start

            if(parsed.end !== undefined) {
                end = parsed.end
            }

            console.log("parsed start: '" + start + ", end: '" + end + "' from text: '" + dateText + "'")

            // CalendarItem.create(title, start date, optional end date, "event" or "reminder", isAllDay)
            var event = CalendarItem.create(title, start, end, "event", false, "", false, "hello world", "https://noteplan.co")
            var createdEvent = Calendar.add(event)

            if(createdEvent != undefined) {
                console.log("Event created with id: " + createdEvent.id)
            } else {
                console.log("Failed to create event")
            }
        }
    } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}
```
  
</p>
</details>  

