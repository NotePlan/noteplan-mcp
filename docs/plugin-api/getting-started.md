# Getting Started with NotePlan Plugins

This guide will help you create your first NotePlan plugin, whether you're a developer or using AI assistants like Claude Code or Cursor.

## Table of Contents

1. [What are NotePlan Plugins?](#what-are-noteplan-plugins)
2. [Plugin Structure](#plugin-structure)
3. [Installation & Setup](#installation--setup)
4. [Creating Your First Plugin](#creating-your-first-plugin)
5. [Using AI Assistants (Claude Code / Cursor)](#using-ai-assistants-claude-code--cursor)
6. [Testing Your Plugin](#testing-your-plugin)
7. [HTML Plugins (Persistent Views)](#html-plugins-persistent-views)
8. [API Documentation](#api-documentation)
9. [Next Steps](#next-steps)

---

## What are NotePlan Plugins?

NotePlan plugins extend the functionality of NotePlan by adding custom commands and views. They are written in JavaScript and can:

- Manipulate notes and paragraphs using the Editor API
- Access calendar events and reminders using the Calendar API
- Create HTML-based user interfaces
- Integrate with NotePlan's core functionality

### Types of Plugins

1. **Command-based Plugins**: Functions that run when called from NotePlan's command palette
2. **HTML Plugins**: Persistent views that appear in the main window, perfect for dashboards and widgets

---

## Plugin Structure

A NotePlan plugin consists of two essential files:

```
np.myplugin/
  ├── plugin.json    # Plugin configuration and metadata
  └── script.js      # JavaScript code with plugin functions
```

### plugin.json

The configuration file that defines:

- Plugin metadata (name, version, author, description)
- Minimum NotePlan version requirements
- Available commands and their JavaScript function mappings

### script.js

The main plugin script containing:

- JavaScript functions that become NotePlan commands
- Each function in `plugin.json` maps to a function in `script.js` via `"jsFunction"`

---

## Installation & Setup

### Step 1: Find Your Plugin Folder

1. Open **NotePlan Settings**
2. Click the **"Open plugin folder"** button
3. This opens the `Plugins` directory in your NotePlan sync folder

### Step 2: Create Your Plugin Folder

1. In the `Plugins` directory, create a new folder for your plugin
2. Use a descriptive name starting with `np.` (e.g., `np.myplugin`, `np.calendar-widget`)
3. This folder will contain your `plugin.json` and `script.js` files

### Step 3: Copy the Boilerplate

1. Copy `plugin.json` and `script.js` from this API Docs folder
2. Paste them into your new plugin folder
3. Rename and customize as needed

**Example structure:**

```
NotePlan Sync Folder/
  Plugins/
    np.myplugin/
      ├── plugin.json
      └── script.js
```

---

## Creating Your First Plugin

### Step 1: Update plugin.json

Edit `plugin.json` with your plugin details:

```json
{
  "plugin.id": "np.myplugin",
  "plugin.name": "My Plugin",
  "plugin.description": "What my plugin does",
  "plugin.author": "@yourusername",
  "plugin.version": "1.0.0",
  "plugin.commands": [
    {
      "name": "myCommand",
      "description": "What this command does",
      "jsFunction": "myCommand"
    }
  ]
}
```

**Important fields:**

- `plugin.id`: Unique identifier (must start with `np.`)
- `plugin.name`: Display name in NotePlan
- `plugin.commands`: Array of commands your plugin provides
  - `name`: Command name shown in NotePlan
  - `jsFunction`: Function name in `script.js` that runs when command is executed

### Step 2: Write Your Function

In `script.js`, create a function matching the `jsFunction` name:

```javascript
async function myCommand() {
  try {
    // Check if API is available
    if (typeof Editor === "undefined") {
      console.log("❌ Editor API not available")
      return
    }

    // Your plugin logic here
    const filename = Editor.filename
    console.log(`Current note: ${filename}`)

    console.log("✅ Command executed successfully")
  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
  }
}
```

### Step 3: Test Your Plugin

1. Save your files
2. In NotePlan, open the command palette (⌘⇧P or Cmd+Shift+P)
3. Type your command name
4. Run it and check the console for output

---

## Using AI Assistants (Claude Code / Cursor)

AI assistants can help you build NotePlan plugins more efficiently. Here's how to get the best results:

### For Claude Code / Cursor

1. **Open the API Docs folder** in your workspace

   - The AI can reference the `.md` files for API documentation
   - Files like `Calendar.md`, `Editor.md`, `HTMLView.md` contain complete API references

2. **Provide context about your plugin**

   - Tell the AI what you want to build
   - Mention if it's a command-based plugin or HTML plugin
   - Specify which APIs you need (Editor, Calendar, HTMLView, etc.)

3. **Reference the boilerplate**

   - Point the AI to `script.js` and `plugin.json` for structure
   - The boilerplate includes examples for common use cases

4. **Ask for specific functionality**
   - "Create a command that lists all headings in the current note"
   - "Build an HTML view that shows today's calendar events"
   - "Add a function that creates a new note with a template"

### Example AI Prompts

**For a command plugin:**

```
I want to create a NotePlan plugin command that:
- Gets all headings from the current note
- Creates a table of contents at the cursor position
- Uses the Editor API

Use the boilerplate in script.js as a reference.
```

**For an HTML plugin:**

```
Create an HTML plugin that:
- Shows today's calendar events in a nice UI
- Uses the Calendar API (only API available in HTML views)
- Has a reload button for testing
- Follows the HTML plugin example in script.js
```

### Important Notes for AI Assistants

- **API Availability**: HTML views can directly use the Calendar API. Other APIs (Editor, NotePlan) must be accessed via the JavaScript bridge (`window.webkit.messageHandlers.jsBridge.postMessage()`)
- **Bridge Pattern**: When coding HTML views that need Editor/NotePlan APIs, use the bridge pattern shown in the examples above
- **Plugin Location**: Plugins must be in the NotePlan sync folder's `Plugins` directory
- **Testing**: Use the reload button in HTML views or re-run commands to test changes
- **Documentation**: All API docs are in `.md` files in the same directory as the boilerplate

---

## Testing Your Plugin

### Testing Native Plugin Functions

1. Edit `script.js` in your plugin folder
2. Save the file
3. In NotePlan, run the command again
4. NotePlan automatically reloads the plugin script when commands are executed
5. Check the console (View → Show Console) for `console.log()` output

### Testing HTML Views

1. Edit `script.js` to update the HTML content
2. Save the file
3. **Option 1**: Click the reload button in the HTML view's navigation bar (if `showReloadButton: true`)
4. **Option 2**: Run the command again to reload the view
5. Changes appear immediately without restarting NotePlan

### Debugging Tips

- Use `console.log()` for debugging (visible in NotePlan's console)
- Check API availability before using: `if (typeof Editor === "undefined")`
- Wrap code in try/catch blocks to handle errors gracefully
- Test with different note types (daily notes, regular notes, etc.)

---

## HTML Plugins (Persistent Views)

HTML plugins create persistent views that appear in NotePlan's main window. They're perfect for dashboards, widgets, and calendar-based UIs.

### Key Characteristics

1. **Main View Integration**: Loaded into the main view using `HTMLView.showInMainWindow()`
2. **Persistent Access**: Users can access them without running commands every time
3. **Session Persistence**: Views persist across NotePlan sessions (when using `customId`)

### API Availability in HTML Views

⚠️ **IMPORTANT**: HTML views can ONLY directly access the Calendar API.

- ✅ **Calendar API**: Available directly (Calendar.availableCalendars, Calendar.eventsToday, etc.)
- ❌ **Editor API**: NOT directly available
- ❌ **NotePlan API**: NOT directly available
- ❌ **Other APIs**: NOT directly available

### Accessing Other APIs from HTML Views (JavaScript Bridge)

While only the Calendar API is directly available in HTML views, you can access other NotePlan APIs (Editor, NotePlan, etc.) through the **JavaScript Bridge**. This allows HTML views to call back to NotePlan's JavaScript Core API.

#### How It Works

1. **In your plugin function**: Create the HTML with embedded JavaScript that uses `window.webkit.messageHandlers.jsBridge.postMessage()`
2. **Stringify the API call**: Wrap your NotePlan API call in a JSON stringified function
3. **Send via bridge**: Post the message with the code and a callback handler name
4. **Handle response**: Define a callback function in your HTML to process the result

#### Example: Opening a Note from HTML View

```javascript
async function showHTMLWithEditorAPI() {
  // Stringify the NotePlan API call
  const openNoteCode = JSON.stringify(`
    (function() {
      Editor.openNoteByFilename("10 - Projects/HTML View.md");
    })()
  `)

  const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, sans-serif; padding: 20px; }
          button { padding: 10px 20px; background: #007AFF; color: white; border: none; border-radius: 6px; cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>HTML View with Editor API</h1>
        <p id="result">Ready</p>
        <button onclick="openNote()">Open Note</button>
        
        <script>
          // Function to call NotePlan API via bridge
          function openNote() {
            window.webkit.messageHandlers.jsBridge.postMessage({
              code: ${openNoteCode},
              onHandle: "onHandleOpenNote",  // Callback function name
              id: "1"  // Optional: ID for tracking multiple calls
            });
          }
          
          // Callback function to handle the response
          function onHandleOpenNote(result, id) {
            document.getElementById("result").innerHTML = "Note opened successfully!";
            console.log("Result:", result);
            console.log("Call ID:", id);
          }
        </script>
      </body>
    </html>
  `

  await HTMLView.showInMainWindow(html, "Editor API Example", {
    icon: "file",
    customId: "editor-api-example",
    showReloadButton: true,
  })
}
```

#### Key Points for AI Assistants

When coding HTML views that need to access non-Calendar APIs:

1. **Stringify the API call**: Wrap your NotePlan API code in `JSON.stringify()` with a function wrapper
2. **Use the bridge**: Call `window.webkit.messageHandlers.jsBridge.postMessage()` with:
   - `code`: The stringified API call
   - `onHandle`: Name of the callback function in your HTML
   - `id`: Optional identifier for tracking
3. **Handle callbacks**: Define the callback function in your HTML's `<script>` tag
4. **Template literals**: Use template literals (backticks) for the HTML string to embed the stringified code

#### More Examples

**Getting current note filename:**

```javascript
const getFilenameCode = JSON.stringify(`
  (function() {
    return Editor.filename || Editor.resolvedFilename;
  })()
`)

// In HTML:
window.webkit.messageHandlers.jsBridge.postMessage({
  code: ${getFilenameCode},
  onHandle: "onHandleFilename",
  id: "2"
});

function onHandleFilename(filename, id) {
  document.getElementById("result").textContent = \`Current note: \${filename}\`;
}
```

**Inserting text at cursor:**

```javascript
const insertTextCode = JSON.stringify(`
  (function() {
    Editor.insertTextAtCursor("Hello from HTML view!\\n");
    return "Text inserted";
  })()
`)
```

### Creating an HTML Plugin

```javascript
async function showMyHTMLView() {
  const html = `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, sans-serif; padding: 20px; }
        </style>
      </head>
      <body>
        <h1>My HTML View</h1>
        <button onclick="testCalendar()">Test Calendar API</button>
        <div id="result"></div>
        <script>
          async function testCalendar() {
            const events = await Calendar.eventsToday('');
            document.getElementById('result').textContent = 
              \`Found \${events.length} events today\`;
          }
        </script>
      </body>
    </html>
  `

  await HTMLView.showInMainWindow(html, "My View", {
    icon: "star",
    iconColor: "blue-500",
    customId: "my-view",
    showReloadButton: true, // Useful for testing
  })
}
```

### Communication Patterns

- **Calendar API**: Exposed directly in HTML views (no bridge needed)
- **Other APIs**: Must use the JavaScript bridge (`window.webkit.messageHandlers.jsBridge.postMessage()`)
- The bridge allows HTML views to execute NotePlan JavaScript Core API calls
- Responses are handled via callback functions defined in your HTML

---

## API Documentation

All API documentation is available in `.md` files in this directory:

- **Calendar.md** - Calendar and Reminder APIs
- **CalendarItem.md** - CalendarItem object structure
- **Editor.md** - Editor APIs for note manipulation
- **HTMLView.md** - HTML view APIs for creating UI
- **NotePlan.md** - Core NotePlan APIs
- **NoteObject.md** - Note object structure
- **ParagraphObject.md** - Paragraph object structure
- **RangeObject.md** - Range object structure
- And more...

### Quick API Reference

**Editor API** (Native functions only):

```javascript
Editor.filename // Current note filename
Editor.paragraphs // Array of paragraph objects
Editor.insertTextAtCursor() // Insert text at cursor
Editor.replaceSelection() // Replace selected text
```

**Calendar API** (Available in both native and HTML views):

```javascript
Calendar.availableCalendars() // Get all calendars
Calendar.eventsToday(filter) // Get today's events
Calendar.eventsBetween(start, end, filter) // Get events in range
Calendar.add(calendarItem) // Create event/reminder
Calendar.update(calendarItem) // Update event/reminder
Calendar.remove(calendarItem) // Delete event/reminder
```

**HTMLView API** (Native functions only):

```javascript
HTMLView.showInMainWindow(html, title, options) // Show in main view
HTMLView.showWindow(html, title, width, height) // Show in window
HTMLView.showSheet(html, width, height) // Show as sheet
```

---

## Next Steps

1. **Explore the Examples**: Check `script.js` for working examples of:

   - Basic command functions
   - HTML view creation
   - Calendar API usage
   - Editor API usage
   - Error handling patterns

2. **Read the API Docs**: Browse the `.md` files to understand available APIs

3. **Start Building**: Create your first plugin command or HTML view

4. **Test Iteratively**: Use the reload button or re-run commands to test changes quickly

5. **Share Your Plugin**: Once ready, consider sharing it with the NotePlan community

### Common Use Cases

- **Note Manipulation**: Templates, formatting, text processing
- **Calendar Integration**: Event creation, reminders, calendar views
- **Dashboards**: HTML views showing calendar data, statistics, widgets
- **Automation**: Batch operations, note organization, data extraction

---

## Troubleshooting

### Plugin Not Appearing

- Check that files are in the correct `Plugins` folder
- Verify `plugin.json` has valid JSON syntax
- Ensure `plugin.id` starts with `np.`
- Restart NotePlan if needed

### Command Not Working

- Check console for error messages
- Verify function name matches `jsFunction` in `plugin.json`
- Ensure API is available before using it
- Wrap code in try/catch to see errors

### HTML View Not Loading

- Verify Calendar API is available (only API in HTML views)
- Check browser console for JavaScript errors
- Ensure `waitForBridge()` is called before using Calendar API
- Use `showReloadButton: true` for easier testing

---

**Happy Plugin Development! 🚀**
