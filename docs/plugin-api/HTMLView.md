<details>
<summary>API</summary>
<p>

```javascript
HTMLView

/**
* Available in v3.6.2
* Open a modal sheet above the main window with the given html code
* @param { String }
* @param { Integer } (optional)
* @param { Integer } (optional)
*/
.showSheet(html, width, height)

/**
* Available in v3.7
* Open a non-modal window above the main window with the given html code and window title. It returns a promise with the created window object. Assign optionally the width and height.
* Run it with await window = showWindow(...), so you can adjust the window position and height later.
* @param { String }
* @param { String }
* @param { Integer } (optional)
* @param { Integer } (optional)
* @return { Promise(Window) }
*/
.showWindow(html, title, width, height)

/**
* Available in v3.9.1
* Open a non-modal window above the main window with the given html code and window title. It returns a promise with the created window object. Optionally, supply an object as the 3rd parameter to set window options:
* { width, height, x, y, customId, shouldFocus }
* By default, it will focus and bring to front the window on first launch
* If you are re-loading an existing HTML window's content, by default the window will not change z-order or focus (if it is in the back, it will stay in the back)
* you can override this by setting { shouldFocus: true } to bring to front on reload.
* If you are setting the customId in the options it will be assigned as the `customId` to the returning window.
* Assigning a customId will allow you to open multiple windows (one per customId). If you call `runJavaScript`, make sure to pass the same customID as the second variable.
* Run it with window = await showWindowWithOptions(...), so you can adjust the window position and height later.
* @param { String }
* @param { String }
* @param { Object({ x: Float, y: Float, width: Float, height: Float, customId: String, shouldFocus: Bool}) }
* @return { Promise(Window) }
*/
.showWindowWithOptions(html, title, options)
    
/**
* Available in v3.20
* Shows HTML content in the main application window, either in the main content area or as a split view (a sidebar entry will be added, so the user can open it also with opt+click as split view).
* @param { String } html - The HTML content to display
* @param { String } title - The title for the view
* @param { Object } options - (optional) Configuration options:
*   - splitView: Boolean - Show as split view (true) or in main content area (false, default)
*   - id/customId/customID: String - (optional) Unique identifier for reusing the same view
*   - icon: String - Font Awesome icon string for the navigation bar and sidebar (without "fa-")
*   - iconColor: String - Tailwind color name (e.g., "blue-500") or hex color (e.g., "#3b82f6")
*   - autoTopPadding: Boolean - Auto-add top padding for navigation bar (default: true)
*   - showReloadButton: Boolean - Show the reload button in the navigation bar (default: true)
*   - reloadPluginID: String - (optional) Plugin ID to use for reload (overrides auto-captured value)
*   - reloadCommandName: String - (optional) Command/function name to call on reload (overrides auto-captured value)
*   - reloadCommandArgs: Array - (optional) Arguments to pass to the reload command
* @returns { Promise } Returns a promise that resolves with { success: true, windowID: String }
*
* @example
* // Show HTML in main content area with icon
* await HTMLView.showInMainWindow(
*   '<h1>Hello World</h1><p>This is displayed in the main view.</p>',
*   'My View',
*   { icon: 'star', iconColor: 'blue-500' }
* )
* 
* @example
* // Show HTML as split view with custom icon and color
* await HTMLView.showInMainWindow(
*   '<div>Split view content</div>',
*   'Split View',
*   { 
*     splitView: true, 
*     icon: 'chart-line',
*     iconColor: '#3b82f6'
*   }
* )
* 
* @example
* // Reuse a view by ID
* await HTMLView.showInMainWindow(
*   '<div>Updated content</div>',
*   'Updated View',
*   { splitView: true }
* )
*/
.showInMainWindow(html, title, options)
    
/**
* Available in v3.8
* After opening an html window, make changes to the contents of the window by running JS code directly inside the opened window. Make sure to pass the customId as the second argument if you have opened the window with a customId.
* Returns a promise you can wait for with the return value, if any (depends if you added one to the JS code that is supposed to be executed).
* @param { String }
* @param { String? }
* @return { Promise }
*/
.runJavaScript(code, customId)

/**
 * To get the window, use NotePlan.htmlWindows or the return value of HTMLView.showWindow. 
 * Set / get the position and size of the window that contains the editor. Returns an object with x, y, width, height values.
 * If you want to change the coordinates or size, save the rect in a variable, modify the variable, then assign it to windowRect. 
 * The position of the window might not be very intuitive, because the coordinate system of the screen works differently (starts at the bottom left for example). Recommended is to adjust the size and position of the window relatively to it's values or other windows.
 *
 * Note this is available with v3.9.1 and works only on Mac
 * Example:
 *
 * const rect = Editor.windowRect
 * rect.height -= 50
 * Editor.windowRect = rect
 *
 * @type { x: Integer, y: Integer, width: Integer, height: Integer }
 */
.windowRect
```

</p>
</details>  


<details>
<summary>API Access in HTML Views</summary>
<p>
    

    
```javascript
/**
 * ============================================================================
 * NOTEPLAN API ACCESS FROM INSIDE HTML VIEWS
 * ============================================================================
 * 
 * HTML views can access NotePlan's JavaScript APIs directly from within the
 * WebView. This enables rich interactive experiences where your HTML can
 * query calendar events, notes, and more.
 * 
 * **IMPORTANT:** All API calls return Promises and must be awaited.
 * 
 * ----------------------------------------------------------------------------
 * CURRENTLY AVAILABLE APIs (from inside HTML views):
 * ----------------------------------------------------------------------------
 * 
 * ✅ Calendar API - Full access to calendar events and reminders
 *    - Calendar.eventsToday()
 *    - Calendar.eventsBetween(startDate, endDate)
 *    - Calendar.remindersToday()
 *    - Calendar.remindersBetween(startDate, endDate)
 *    - Calendar.availableCalendars()
 *    - Calendar.availableReminderLists()
 *    - Calendar.add(calendarItem)
 *    - etc.
 * 
 *    Returns: CalendarItemObject[] with properties:
 *    - title, date, endDate, type, isAllDay, isCompleted
 *    - calendar, calendarID, notes, url, availability
 *    - location, isRecurring, color, attendees, attendeeNames
 * 
 * ----------------------------------------------------------------------------
 * NOT YET ENABLED APIs (planned for future releases):
 * ----------------------------------------------------------------------------
 * 
 * ⏳ DataStore API - Access to notes
 *    - DataStore.projectNotes
 *    - DataStore.calendarNotes
 *    - DataStore.projectNoteByTitle(title)
 *    - DataStore.calendarNoteByDate(date)
 * 
 * ⏳ Editor API - Access to current editor content
 *    - Editor.paragraphs
 *    - Editor.selectedParagraphs
 *    - Editor.paragraphsInRange(start, end)
 * 
 * ⏳ Clipboard API - Clipboard access
 * 
 * ⏳ CommandBar API - Command bar interactions
 * 
 * ⏳ NotePlan API - General NotePlan functions
 * 
 * ----------------------------------------------------------------------------
 * USAGE EXAMPLE (from inside HTML):
 * ----------------------------------------------------------------------------
 * 
 */
    
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, sans-serif; padding: 20px; }
      .event { padding: 8px; margin: 4px 0; background: #f0f0f0; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>Today's Events</h1>
    <div id="events">Loading...</div>
    
    <script>
      async function loadEvents() {
        try {
          // Simply call the Calendar API - it's already available!
          const events = await Calendar.eventsToday();
          
          const container = document.getElementById('events');
          if (events.length === 0) {
            container.innerHTML = '<p>No events today</p>';
            return;
          }
          
          container.innerHTML = events.map(event => 
            '<div class="event">' +
              '<strong>' + event.title + '</strong><br>' +
              '<small>' + new Date(event.date).toLocaleTimeString() + '</small>' +
            '</div>'
          ).join('');
        } catch (error) {
          console.error('Error:', error);
          document.getElementById('events').innerHTML = '<p>Error loading events</p>';
        }
      }
      
      // Check if Calendar API is available, otherwise wait for it
      if (typeof Calendar !== 'undefined') {
        loadEvents();
      } else {
        window.addEventListener('notePlanBridgeReady', loadEvents);
      }
    </script>
  </body>
</html>

/**
 * ----------------------------------------------------------------------------
 * COMMUNICATION BACK TO NOTEPLAN (Legacy jsBridge method):
 * ----------------------------------------------------------------------------
 * 
 * For running plugin code from inside HTML views, use the jsBridge:
 */

  const openNote = () => {
    window.webkit.messageHandlers.jsBridge.postMessage({
       code: ${openNote},
       onHandle: "onHandleUpdateNoteCount",
       id: "1"
     });
  };

  function onHandleUpdateNoteCount(result, id) {
    // result: The return value from the executed code (may be a string or JSON object)
    // id: The identifier you passed in the postMessage call
    document.getElementById("openNoteResultLabel").innerHTML = "Done! Result: " + (result || "no return value");
    console.log("Result:", result);
    console.log("Call ID:", id);
  }
```
    
</p>
</details> 

<details>
<summary>Examples</summary>
<p>

    
```javascript
const openNote = JSON.stringify(`
  (function() {
    Editor.openNoteByFilename("10 - Projects/HTML View.md");
  })()
  `)

try {

  HTMLView.showWindow(
    `<html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body>
          <p id="openNoteResultLabel">0</p>
          <button onclick=openNote()>Open Note</button>
        </body>
        <script>
          const openNote = () => {
            window.webkit.messageHandlers.jsBridge.postMessage({
               code: ${openNote},
               onHandle: "onHandleuUpdateNoteCount",
               id: "1"
             });
            };

           function onHandleuUpdateNoteCount(re, id) {
             document.getElementById("openNoteResultLabel").innerHTML = "done"
           }
        </script>
      </html>`, "Test Plugin")

} catch(error) {
  console.log(error)
}
```
  
</p>
</details>  

