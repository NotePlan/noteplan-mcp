//
//  script.js
//  NotePlan Plugin Boilerplate
//
//  This is a boilerplate template for creating NotePlan plugins.
//  Copy this file and plugin.json to create a new plugin.
//
//  📖 GETTING STARTED:
//  For complete setup instructions, installation guide, and usage with AI assistants,
//  see getting-started.md in this directory.
//
//  📚 API DOCUMENTATION:
//  All API documentation is available in .md files in this directory:
//    - Calendar.md - Calendar and Reminder APIs
//    - CalendarItem.md - CalendarItem object structure
//    - Editor.md - Editor APIs for note manipulation
//    - HTMLView.md - HTML view APIs for creating UI
//    - NotePlan.md - Core NotePlan APIs
//    - NoteObject.md - Note object structure
//    - ParagraphObject.md - Paragraph object structure
//    - And more...
//
//  ⚠️ IMPORTANT NOTES:
//
//  API AVAILABILITY:
//    - Native plugin functions: Can use ALL APIs (Editor, Calendar, NotePlan, HTMLView, etc.)
//    - HTML views:
//      - Calendar API: ✅ Available directly
//      - Editor/NotePlan/Other APIs: ⚠️ Available via JavaScript bridge
//        Use window.webkit.messageHandlers.jsBridge.postMessage() to access
//        See showHTMLWithEditorAPI() example for the pattern
//
//  PLUGIN LOCATION:
//    Plugins must be installed in: NotePlan Sync Folder/Plugins/your-plugin-name/
//    Find the location via: NotePlan Settings → "Open plugin folder"
//
//  TESTING:
//    - Native functions: Edit script.js, then run command again in NotePlan
//    - HTML views: Edit script.js, then click reload button in the view (if showReloadButton: true)
//

/**
 * Example Command Function
 *
 * This is a simple example command that demonstrates:
 * - Basic plugin function structure
 * - Accessing Editor API
 * - Using console.log for debugging
 *
 * To use: Add this function name to plugin.json "jsFunction" field
 */
async function exampleCommand() {
  try {
    // Check if Editor is available
    if (typeof Editor === "undefined") {
      console.log("❌ Editor API not available")
      return
    }

    // Get current note information
    const filename = Editor.filename || Editor.resolvedFilename
    const paragraphs = Editor.paragraphs || []

    console.log(`Current note: ${filename}`)
    console.log(`Paragraphs: ${paragraphs.length}`)

    // Example: Get first paragraph
    if (paragraphs.length > 0) {
      const firstParagraph = paragraphs[0]
      console.log(`First paragraph type: ${firstParagraph.type}`)
      console.log(`First paragraph content: ${firstParagraph.content}`)
    }

    // Your plugin logic here...
    console.log("✅ Example command executed successfully")
  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
    console.log(`Stack: ${error.stack || "N/A"}`)
  }
}

/**
 * Example: HTML View Command (Persistent Main View)
 *
 * Creates a persistent HTML view in the main window.
 *
 * ⚠️ IMPORTANT: HTML views can ONLY access the Calendar API.
 * Other APIs (Editor, NotePlan, etc.) are NOT available in HTML views.
 *
 * Testing: Use the reload button in the navigation bar to test changes.
 *
 * See HTMLView.md for API documentation and getting-started.md for setup guide.
 */
async function showExampleHTMLView() {
  try {
    const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
            padding: 20px;
            background-color: #ffffff;
            color: #000000;
          }
          @media (prefers-color-scheme: dark) {
            body {
              background-color: #1c1c1e;
              color: #ffffff;
            }
          }
          h1 {
            font-size: 24px;
            margin-bottom: 16px;
          }
          button {
            padding: 10px 20px;
            margin: 5px;
            font-size: 14px;
            background: #007AFF;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
          }
          button:hover {
            background: #0051D5;
          }
          #result {
            margin-top: 20px;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 6px;
            white-space: pre-wrap;
            font-size: 12px;
          }
          @media (prefers-color-scheme: dark) {
            #result {
              background: #2c2c2e;
            }
          }
        </style>
      </head>
      <body>
        <h1>Example HTML View</h1>
        <p>This is a persistent HTML view that appears in the sidebar.</p>
        <p><strong>Note:</strong> Only Calendar API is available in HTML views.</p>
        
        <button onclick="testCalendarAPI()">Test Calendar API</button>
        <div id="result">Click the button to test Calendar API...</div>
        
        <script>
          // Wait for NotePlan bridge to be ready
          function waitForBridge() {
            return new Promise((resolve) => {
              if (window.__notePlanBridgeReady && typeof Calendar !== 'undefined') {
                resolve();
              } else {
                window.addEventListener('notePlanBridgeReady', () => resolve(), { once: true });
                setTimeout(() => resolve(), 2000);
              }
            });
          }
          
          async function testCalendarAPI() {
            const result = document.getElementById('result');
            result.textContent = 'Testing Calendar API...';
            
            try {
              await waitForBridge();
              
              if (typeof Calendar === 'undefined') {
                result.textContent = '❌ Calendar API not available in HTML view';
                return;
              }
              
              // Test Calendar API (this is the ONLY API available in HTML views)
              const calendars = await Calendar.availableCalendars({});
              const eventsToday = await Calendar.eventsToday('');
              
              result.textContent = \`✅ Calendar API is working!
              
Found \${calendars.length} calendars
Found \${eventsToday.length} events today

Note: Editor, NotePlan, and other APIs are NOT available in HTML views.
Only Calendar API can be used directly in HTML views.\`;
            } catch (error) {
              result.textContent = \`❌ Error: \${error.message}\`;
              console.error('Calendar API test error:', error);
            }
          }
          
          // Initialize on load
          window.addEventListener('load', async () => {
            await waitForBridge();
            console.log('HTML view loaded and bridge ready');
            console.log('Available APIs in HTML view:', typeof Calendar !== 'undefined' ? 'Calendar ✅' : 'None');
          });
        </script>
      </body>
    </html>
    `

    // Show in main window
    // This makes it accessible without running the command again
    // Use the reload button in the navigation bar to test changes quickly
    await HTMLView.showInMainWindow(html, "Example View", {
      icon: "star", // Font Awesome icon name (without "fa-")
      iconColor: "blue-500", // Tailwind color or hex
      customId: "example-view", // Allows reusing/updating the same view
      showReloadButton: true, // Show reload button in navigation (useful for testing)
    })
  } catch (error) {
    console.log(`❌ Error showing HTML view: ${error.message}`)
    console.log(`Stack: ${error.stack || "N/A"}`)
  }
}

/**
 * Example: HTML View with JavaScript Bridge (Accessing Editor API)
 *
 * Demonstrates how to access NotePlan APIs (Editor, NotePlan, etc.) from HTML views
 * using the JavaScript bridge. This is the workaround for accessing non-Calendar APIs.
 *
 * IMPORTANT: Only Calendar API is directly available in HTML views.
 * To access Editor, NotePlan, or other APIs, you must use the JavaScript bridge:
 * window.webkit.messageHandlers.jsBridge.postMessage()
 *
 * See getting-started.md for detailed explanation and more examples.
 */
async function showHTMLWithEditorAPI() {
  try {
    // Stringify the NotePlan API call that will be executed via bridge
    const openNoteCode = JSON.stringify(`
      (function() {
        Editor.openNoteByFilename("10 - Projects/HTML View.md");
        return "Note opened successfully";
      })()
    `)

    const getFilenameCode = JSON.stringify(`
      (function() {
        return Editor.filename || Editor.resolvedFilename || "No note open";
      })()
    `)

    const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
            padding: 20px;
            background-color: #ffffff;
            color: #000000;
          }
          @media (prefers-color-scheme: dark) {
            body {
              background-color: #1c1c1e;
              color: #ffffff;
            }
          }
          h1 {
            font-size: 24px;
            margin-bottom: 16px;
          }
          button {
            padding: 10px 20px;
            margin: 5px;
            font-size: 14px;
            background: #007AFF;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
          }
          button:hover {
            background: #0051D5;
          }
          #result {
            margin-top: 20px;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 6px;
            white-space: pre-wrap;
            font-size: 12px;
          }
          @media (prefers-color-scheme: dark) {
            #result {
              background: #2c2c2e;
            }
          }
        </style>
      </head>
      <body>
        <h1>HTML View with Editor API</h1>
        <p>This example shows how to access Editor API from HTML using the JavaScript bridge.</p>
        
        <button onclick="openNote()">Open Note via Bridge</button>
        <button onclick="getFilename()">Get Current Filename</button>
        
        <div id="result">Click a button to test the JavaScript bridge...</div>
        
        <script>
          // Function to open a note via JavaScript bridge
          function openNote() {
            const result = document.getElementById('result');
            result.textContent = 'Calling Editor API via bridge...';
            
            window.webkit.messageHandlers.jsBridge.postMessage({
              code: ${openNoteCode},
              onHandle: "onHandleOpenNote",  // Callback function name
              id: "1"  // Optional: ID for tracking
            });
          }
          
          // Function to get current filename via JavaScript bridge
          function getFilename() {
            const result = document.getElementById('result');
            result.textContent = 'Getting filename via bridge...';
            
            window.webkit.messageHandlers.jsBridge.postMessage({
              code: ${getFilenameCode},
              onHandle: "onHandleFilename",
              id: "2"
            });
          }
          
          // Callback function to handle the open note response
          function onHandleOpenNote(result, id) {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = \`✅ Note opened successfully!
            
Result: \${result}
Call ID: \${id}

This demonstrates accessing Editor API from HTML view via JavaScript bridge.\`;
            console.log('Open note result:', result, 'ID:', id);
          }
          
          // Callback function to handle the filename response
          function onHandleFilename(filename, id) {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = \`✅ Filename retrieved!
            
Current note: \${filename}
Call ID: \${id}

This demonstrates accessing Editor API from HTML view via JavaScript bridge.\`;
            console.log('Filename result:', filename, 'ID:', id);
          }
        </script>
      </body>
    </html>
    `

    await HTMLView.showInMainWindow(html, "Editor API via Bridge", {
      icon: "code",
      iconColor: "green-500",
      customId: "editor-api-bridge-example",
      showReloadButton: true,
    })
  } catch (error) {
    console.log(`❌ Error showing HTML view with Editor API: ${error.message}`)
    console.log(`Stack: ${error.stack || "N/A"}`)
  }
}

/**
 * Example: Calendar API Usage
 *
 * Demonstrates how to use Calendar API
 *
 * NOTE: Calendar API is available BOTH in:
 * - Native plugin functions (this file) ✅
 * - HTML views (directly, no bridge needed) ✅
 *
 * See Calendar.md and CalendarItem.md for full API documentation
 */
async function exampleCalendarUsage() {
  try {
    // Check if Calendar API is available
    if (typeof Calendar === "undefined") {
      console.log("❌ Calendar API not available")
      return
    }

    // Get available calendars
    const calendars = Calendar.availableCalendars()
    console.log(`Found ${calendars.length} calendars`)

    // Get events for today
    const eventsToday = await Calendar.eventsToday("")
    console.log(`Found ${eventsToday.length} events today`)

    // Example: Get events between dates
    const startDate = new Date()
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + 7) // Next 7 days

    const events = await Calendar.eventsBetween(startDate, endDate, "")
    console.log(`Found ${events.length} events in next 7 days`)

    // Your calendar logic here...
  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
    console.log(`Stack: ${error.stack || "N/A"}`)
  }
}

/**
 * Example: Editor API Usage
 *
 * Demonstrates how to manipulate notes using Editor API
 *
 * NOTE: Editor API is ONLY available in:
 * - Native plugin functions (this file) ✅
 * - HTML views ❌ NOT available
 *
 * See Editor.md for full API documentation
 */
async function exampleEditorUsage() {
  try {
    if (typeof Editor === "undefined") {
      console.log("❌ Editor API not available")
      return
    }

    // Get current note information
    const filename = Editor.filename || Editor.resolvedFilename
    const paragraphs = Editor.paragraphs || []

    console.log(`Current note: ${filename}`)
    console.log(`Total paragraphs: ${paragraphs.length}`)

    // Example: Find headings
    const headings = paragraphs.filter(
      (p) => (p.headingLevel && p.headingLevel > 0) || p.type === "title"
    )
    console.log(`Found ${headings.length} headings`)

    // Example: Insert text at cursor
    // Editor.insertTextAtCursor("Hello from plugin!\n")

    // Example: Replace selected text
    // Editor.replaceSelection("Replaced text")

    // Your editor logic here...
  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
    console.log(`Stack: ${error.stack || "N/A"}`)
  }
}

/**
 * Example: NotePlan API Usage
 *
 * Demonstrates how to use core NotePlan APIs
 *
 * NOTE: NotePlan API is ONLY available in:
 * - Native plugin functions (this file) ✅
 * - HTML views ❌ NOT available
 *
 * See NotePlan.md for full API documentation
 */
async function exampleNotePlanUsage() {
  try {
    if (typeof NotePlan === "undefined") {
      console.log("❌ NotePlan API not available")
      return
    }

    // Get environment information
    const env = NotePlan.environment
    console.log(`Platform: ${env.platform}`)
    console.log(`Version: ${env.version}`)
    console.log(`Language: ${env.languageCode}`)

    // Example: Get all notes
    // const notes = NotePlan.allNotes
    // console.log(`Total notes: ${notes.length}`)

    // Example: Get calendar notes
    // const calendarNotes = NotePlan.calendarNotes
    // console.log(`Calendar notes: ${calendarNotes.length}`)

    // Your NotePlan logic here...
  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
    console.log(`Stack: ${error.stack || "N/A"}`)
  }
}

/**
 * Helper: Wait for API to be available
 *
 * Useful when working with HTML views that need to wait for bridge initialization
 */
function waitForAPI(apiName, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window[apiName]) {
      resolve()
      return
    }

    const startTime = Date.now()
    const checkInterval = setInterval(() => {
      if (typeof window !== "undefined" && window[apiName]) {
        clearInterval(checkInterval)
        resolve()
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval)
        reject(new Error(`Timeout waiting for ${apiName}`))
      }
    }, 100)
  })
}

/**
 * Helper: Log formatted message
 *
 * Utility function for consistent logging
 */
function log(message, type = "info") {
  const prefix =
    {
      info: "ℹ️",
      success: "✅",
      error: "❌",
      warning: "⚠️",
    }[type] || ""

  console.log(`${prefix} ${message}`)
}

// Export functions if needed (for module systems, though NotePlan uses global scope)
// In NotePlan plugins, functions are typically global, so exports are optional
