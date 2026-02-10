<details>
<summary>API</summary>
<p>

```javascript
Calendar

/**
* Get all available date units: "year", "month", "day", "hour", "minute", "second"
* @type {[String]}
*/
.dateUnits

/**
* Adds an event or reminder based on the given CalendarItem. Use `CalendarItem.create(...)` to create the event or reminder first.
* Returns the created CalendarItem with the assigned id, so you can reference it later. If it failed, undefined is returned.
* @param {CalendarItem} 
* @return {CalendarItem}
*/
.add(calendarItem) 
    
/**
* Note: Available from v3.0.26
* Updates an event or reminder based on the given CalendarItem, which needs to have an ID. A CalendarItem has an ID, when you have used `.add(...)` and saved the return value or when you query the event using `eventsBetween(...)`, `remindersBetween(...)`, `eventByID(...)`, `reminderByID(...)`, etc.
* Returns a promise, because it needs to fetch the original event objects first in the background, then updates it. Use it with `await`.
* @param {CalendarItem} 
* @return {Promise}
*/
.update(calendarItem) 
    
/**
* Note: Available from v3.0.26
* Removes an event or reminder based on the given CalendarItem, which needs to have an ID. A CalendarItem has an ID, when you have used `.add(...)` and saved the return value or when you query the event using `eventsBetween(...)`, `remindersBetween(...)`, `eventByID(...)`, `reminderByID(...)`, etc.
* Returns a promise, because it needs to fetch the original event objects first in the background, then updates it. Use it with `await`.
* @param {CalendarItem} 
* @return {Promise}
*/
.remove(calendarItem) 
    
/**
* Note: Available from v3.0.25
* Returns all events between the `startDate` and `endDate`. Use `filter` to search for specific events (keyword in the title).
* This function fetches events asynchronously, so use async/await.
* @param {Date} 
* @param {Date} 
* @param {String?} 
* @return {Promise([CalendarItem])}
*/
.eventsBetween(startDate, endDate, filter) 
    
/**
* Note: Available from v3.0.25
* Returns all reminders between the `startDate` and `endDate`. Use `filter` to search for specific reminders (keyword in the title). 
* This function fetches reminders asynchronously, so use async/await.
* @param {Date} 
* @param {Date} 
* @param {String?}  
* @return {Promise([CalendarItem])}
*/
.remindersBetween(startDate, endDate, filter) 
    
/**
* Note: Available from v3.0.26
* Returns the event by the given ID. You can get the ID from a CalendarItem, which you got from using `.add(...)` (the return value is a CalendarItem with ID) or when you query the event using `eventsBetween(...)`, `eventByID(...)`, etc.
* This function fetches the event asynchronously, so use async/await.
* @param {String} 
* @return {Promise(CalendarItem)}
*/
.eventByID(id) 
    
/**
* Note: Available from v3.0.26
* Returns the reminder by the given ID. You can get the ID from a CalendarItem, which you got from using `.add(...)` (the return value is a CalendarItem with ID) or when you query the event using `remindersBetween(...)`, `reminderByID(...)`, etc.
* This function fetches reminders asynchronously, so use async/await.
* @param {String} 
* @return {Promise(CalendarItem)}
*/
.reminderByID(id) 
    
/**
* Note: Available from v3.0.25
* Returns all events for today. Use `filter` to search for specific events (keyword in the title). 
* This function fetches events asynchronously, so use async/await. The returned promise contains an array of events.
* @param {String?} 
* @return {Promise}
*/
.eventsToday(filter) 
    
/**
* Note: Available from v3.0.25
* Returns all reminders between for today. Use `filter` to search for specific reminders (keyword in the title). 
* This function fetches reminders asynchronously, so use async/await.
* @param {String?} 
* @return {Promise}
*/
.remindersToday(filter) 
    
/**
* Note: Available from v3.5.2
* Returns all reminders (completed and incompleted) for the given lists (array of strings). 
* If you keep the lists variable empty, NotePlan will return all reminders from all lists. You can get all Reminders lists calling `Calendar.availableReminderListTitles()`
* This function fetches reminders asynchronously, so use async/await.
* @param {[String]?} 
* @return {Promise}
*/
.remindersByLists(lists) 
    
/**
* Parses a text describing a text as natural language input into a date. Such as "today", "next week", "1st May", "at 5pm to 6pm", etc.
* Returns and array of objects with possible results (usually one), the most likely at the top. 
* Access the dates in this array using ".start" and ".end". And access information of the matched date text using ".text" and ".index". You can see the full info by looking up "DateRangeObject" further below.
* @param {String} 
* @return {[DateRangeObject]}
*/
.parseDateText(text) 

/**
* Create a date object from parts. Like year could be 2021 as a number.
* The month parameter starts with 1 = January, 2 = February...
* @param {Int} 
* @param {Int}
* @param {Int}
* @param {Int}
* @param {Int}
* @param {Int} 
* @return {Date}
*/
.dateFrom(year, month, day, hour, minute, second) 

/**
* Add a unit to an existing date. Look up all unit types using `dateUnits`.  
* For example, to add 10 days, use num = 10 and type = "day"
* @param {Date} 
* @param {String}
* @param {Int}
* @return {Date}
*/
.addUnitToDate(date, type, num) 

/**
* Returns the integer of a unit like "year" (should be this year's number). Look up all unit types using `dateUnits`. 
* @param {Date} 
* @param {String}
* @return {Int}
*/
.unitOf(date, type) 

/**
* Returns a description of how much time has past between the date and today = now.
* @param {Date} 
* @return {String}
*/
.timeAgoSinceNow(date) 

/**
* Returns the amount of units between the given date and now. Look up all unit types using `dateUnits`.
* @param {Date} 
* @param {String} 
* @return {Int}
*/
.unitsUntilNow(date, type) 

/**
* Returns the amount of units from now and the given date. Look up all unit types using `dateUnits`.
* @param {Date} 
* @param {String} 
* @return {Int}
*/
.unitsAgoFromNow(date, type) 

/**
* Returns the amount of units between the first and second date. Look up all unit types using `dateUnits`.
* @param {Date} 
* @param {Date} 
* @param {String} 
* @return {Int}
*/
.unitsBetween(date1, date2, type) 
    
/**
* Returns the week number of the given date adjusted by the start of the week configured by the user in the preferences.
* @param {Date} 
* @return {Int}
*/
.weekNumber(date) 
    
/**
* Note: Available from v3.7
* Returns the year number of the given date adjusted by the start of the week configured by the user in the preferences.
* @param {Date} 
* @return {Int}
*/
.weekYear(date) 
    
/**
* Note: Available from v3.7
* Returns the first day of the given date's week adjusted by the start of the week configured by the user in the preferences (means the returned date will always be the configured first day of the week).
* @param {Date} 
* @return {Date}
*/
.startOfWeek(date)
    
/**
* Note: Available from v3.7
* Returns the last day of the given date's week adjusted by the start of the week configured by the user in the preferences (means the returned endOfWeek date will always be the day before the first day of the week specified in Preferences).
* @param {Date} 
* @return {Date}
*/
.endOfWeek(date)
    
/**
 * Note: Available from v3.1
 * Get the titles of all calendars the user has access to. 
 * 
 * @param {Boolean} [writeOnly=false] - If true, returns only calendars the user has write access to (some calendars, like holidays, are not writable). If false or omitted, returns all calendars (writable and read-only).
 * @param {Boolean} [enabledOnly=false] - If true, returns only calendars that are enabled in NotePlan's settings. If false or omitted, returns all calendars the user has access to (including disabled ones).
 * @return {[String]} Array of calendar titles
 * 
 * @example
 * // Get all calendars (writable and read-only, including disabled)
 * Calendar.availableCalendarTitles()
 * 
 * @example
 * // Get only writable calendars (including disabled)
 * Calendar.availableCalendarTitles(true)
 * 
 * @example
 * // Get all calendars, but only enabled ones
 * Calendar.availableCalendarTitles(false, true)
 * 
 * @example
 * // Get only writable AND enabled calendars
 * Calendar.availableCalendarTitles(true, true)
 */
.availableCalendarTitles(writeOnly, enabledOnly)
    
    
/**
* Note: Available from v3.1
* Get the titles of all reminders the user has access to.
* @return {[String]}
*/
.availableReminderListTitles()
    
/**
 * Note: Available from v3.20
 * Get all calendars the user has access to, returning full calendar objects with detailed information (title, color, source, etc.) instead of just titles.
 * 
 * @param {Object} [options] - Optional filter options
 * @param {Boolean} [options.writeOnly=false] - If true, returns only calendars the user has write access to (some calendars, like holidays, are not writable). If false or omitted, returns all calendars (writable and read-only).
 * @param {Boolean} [options.enabledOnly=false] - If true, returns only calendars that are enabled in NotePlan's settings. If false or omitted, returns all calendars the user has access to (including disabled ones). Also accepts `filterEnabled` as an alias.
 * @return {[Object]} Array of calendar objects, each containing:
 *   - {String} title - Calendar title
 *   - {String} id - Calendar identifier
 *   - {String} color - Calendar color as hex string (e.g., "#5A9FD4")
 *   - {String} source - Source title (e.g., "iCloud", "Google")
 *   - {String} sourceType - Source type (e.g., "calDAV", "local", "exchange", "subscribed", "birthdays")
 *   - {Boolean} isWritable - Whether calendar allows content modifications
 *   - {Boolean} isEnabled - Whether calendar is enabled (not blacklisted) in NotePlan's settings
 *   - {[String]} allowedEntityTypes - Entity types supported by this calendar (e.g., ["event"], ["reminder"], or ["event", "reminder"])
 * 
 * @example
 * // Get all calendars (writable and read-only, including disabled)
 * const calendars = Calendar.availableCalendars()
 * 
 * @example
 * // Get only writable calendars (including disabled)
 * const calendars = Calendar.availableCalendars({ writeOnly: true })
 * 
 * @example
 * // Get all calendars, but only enabled ones
 * const calendars = Calendar.availableCalendars({ enabledOnly: true })
 * 
 * @example
 * // Get only writable AND enabled calendars
 * const calendars = Calendar.availableCalendars({ writeOnly: true, enabledOnly: true })
 * 
 * @example
 * // Access calendar properties
 * const calendars = Calendar.availableCalendars()
 * calendars.forEach(cal => {
 *   console.log(`${cal.title} (${cal.source}) - Color: ${cal.color}, Writable: ${cal.isWritable}, Enabled: ${cal.isEnabled}`)
 * })
 */
.availableCalendars(options)
    
/**
 * Note: Available from v3.20
 * Get all reminder lists the user has access to, returning full reminder list objects with detailed information (title, color, source, etc.) instead of just titles.
 * 
 * @param {Object} [options] - Optional filter options
 * @param {Boolean} [options.enabledOnly=false] - If true, returns only reminder lists that are enabled in NotePlan's settings. If false or omitted, returns all reminder lists the user has access to (including disabled ones). Also accepts `filterEnabled` as an alias.
 * @return {[Object]} Array of reminder list objects, each containing:
 *   - {String} title - Reminder list title
 *   - {String} id - Reminder list identifier
 *   - {String} color - Reminder list color as hex string (e.g., "#5A9FD4")
 *   - {String} source - Source title (e.g., "iCloud", "Google")
 *   - {String} sourceType - Source type (e.g., "calDAV", "local", "exchange", "subscribed")
 *   - {Boolean} isWritable - Whether reminder list allows content modifications (typically true for reminder lists)
 *   - {Boolean} isEnabled - Whether reminder list is enabled (not blacklisted) in NotePlan's settings
 *   - {[String]} allowedEntityTypes - Entity types supported by this reminder list (typically ["reminder"])
 * 
 * @example
 * // Get all reminder lists (including disabled)
 * const reminderLists = Calendar.availableReminderLists()
 * 
 * @example
 * // Get only enabled reminder lists
 * const reminderLists = Calendar.availableReminderLists({ enabledOnly: true })
 * 
 * @example
 * // Access reminder list properties
 * const reminderLists = Calendar.availableReminderLists()
 * reminderLists.forEach(list => {
 *   console.log(`${list.title} (${list.source}) - Color: ${list.color}, Enabled: ${list.isEnabled}`)
 * })
 */
.availableReminderLists(options)

---

DateRangeObject

/**
* The start date of the parsed date text.
* @type {Date}
*/
.start

/**
* The end date of the parsed date text. This might not be defined in the date text. Then the end date = start date.
* If two time or dates are mentioned in the input string of `Calendar.parseDateText(...)`, then the start and end dates will have the respective times and dates set.
* @type {Date}
*/
.end
    
/**
* The detected date text. You can use this to remove the date from the original string
* @type {String}
*/
.text
    
/**
* The index where the date text was found in the given string. Use this so you know where the date text started and get the length from `.text` to cut it out of the original string if needed.
* @type {Intege}
*/
.index

```

</p>
</details>  

<details>
<summary>Examples</summary>
<p>

    
```javascript

function dateExample() {
    console.log(Calendar.dateUnits)

    let date = Calendar.dateFrom(2021, 5, 14, 15, 0, 0)
    console.log(Calendar.timeAgoSinceNow(date))
}

async function createEvent() {
    try {
        let title = await CommandBar.showInput("Enter the title of the event", "Submit title '%@', then...")

        // To make this work you need to enter '1st May', 'tomorrow', etc. for example
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
    
async function updateEventByID() {
    try {
      let id = await CommandBar.showInput("Enter the id of the event to update", "Submit id title '%@'.")
      let newtitle = await CommandBar.showInput("Enter the new title of the event", "Submit new title '%@'.")

      let event = await Calendar.eventByID(id)
      console.log("Found event with title: " + event.title)

      event.title = newtitle
      Calendar.update(event)
    } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}
    
async function removeEventByID() {
    try {
      let id = await CommandBar.showInput("Enter the id of the event to update", "Submit id '%@'.")

      let event = await Calendar.eventByID(id)
      console.log("Found event with title to delete: " + event.title)
      Calendar.remove(event)
    } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}  

    
async function fetchReminders() {
  try {
    let reminders = await Calendar.remindersByLists(["Reminders"])
    reminders.forEach((item, i) => {
      console.log(item.title + " isCompleted: " + item.isCompleted)
    });
  } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
  }
}
```
  
</p>
</details>  

