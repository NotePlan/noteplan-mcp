# NotePlan Plugin API — Condensed Reference

Complete API reference for building NotePlan plugins. All signatures, types, and essential patterns in one document.

---

## 1. Plugin Structure & Quick Start

A plugin = folder in `Plugins/` with two files:

```
np.myplugin/
  ├── plugin.json    # Manifest: metadata + command mappings
  └── script.js      # JavaScript functions
```

### plugin.json format

```json
{
  "plugin.id": "np.myplugin",
  "plugin.name": "My Plugin",
  "plugin.description": "What it does",
  "plugin.author": "@you",
  "plugin.version": "1.0.0",
  "plugin.script": "script.js",
  "plugin.icon": "puzzle-piece",
  "plugin.commands": [
    {
      "name": "myCommand",
      "description": "What this command does",
      "jsFunction": "myCommand",
      "sidebarView": {
        "title": "My View",
        "icon": "calendar",
        "iconColor": "blue-500"
      }
    }
  ]
}
```

### script.js pattern

```javascript
// Functions are assigned to globalThis for MCP-generated plugins,
// or defined at top level for manually-created plugins.
globalThis.myCommand = async function() {
  const html = `<html>...</html>`;
  await HTMLView.showInMainWindow(html, "My View", { id: "main:np.myplugin:My View" });
};
```

### API Availability Matrix

| API | Native (script.js) | HTML WebView |
|-----|:------------------:|:------------:|
| Editor | Yes | Via jsBridge only |
| DataStore | Yes | Via jsBridge only |
| Calendar | Yes | **Yes** (direct) |
| CommandBar | Yes | Via jsBridge only |
| NotePlan | Yes | Via jsBridge only |
| HTMLView | Yes | No |
| Clipboard | Yes | Via jsBridge only |
| fetch() | No | **Yes** (native, no CORS) |

---

## 2. HTMLView

### Methods

- `.showInMainWindow(html, title, options?)` → `Promise` — Show in main content area (preferred). Options: `{ splitView, id/customId, icon, iconColor, autoTopPadding, showReloadButton, reloadPluginID, reloadCommandName, reloadCommandArgs }`
- `.showWindow(html, title, width?, height?)` → `Promise(Window)` — Non-modal floating window
- `.showWindowWithOptions(html, title, options?)` → `Promise(Window)` — Window with `{ x, y, width, height, customId, shouldFocus }`
- `.showSheet(html, width?, height?)` — Modal sheet
- `.runJavaScript(code, customId?)` → `Promise` — Execute JS in an open HTML window
- `.windowRect` `{get/set}` `{x, y, width, height}` — Window position/size (macOS)

### JS Bridge (HTML → Plugin API)

Call non-Calendar APIs from HTML views:

```javascript
// In script.js — stringify the API call:
const apiCode = JSON.stringify(`(function() { return Editor.filename; })()`);

// In HTML <script>:
window.webkit.messageHandlers.jsBridge.postMessage({
  code: apiCode,        // Stringified JS to run in plugin context
  onHandle: "callback", // Name of callback function in HTML
  id: "1"               // Optional tracking ID
});

function callback(result, id) {
  // result = return value from the code
}
```

### fetch() in HTML WebViews

```javascript
const response = await fetch('https://api.example.com/data');
const data = await response.json();
// Standard Fetch API — response.ok, response.status, response.text(), etc.
// HTTPS only. 30s timeout. No CORS restrictions.
```

### Calendar API in HTML (direct access)

```javascript
// Check availability, then use:
if (typeof Calendar !== 'undefined') {
  const events = await Calendar.eventsToday('');
} else {
  window.addEventListener('notePlanBridgeReady', loadEvents);
}
```

---

## 3. Editor

### Window Management

- `.id` `{get}` `String` — Unique editor ID
- `.customId` `{get/set}` `String` — Developer-assigned ID
- `.windowType` `{get}` `"main"|"split"|"floating"|"unsupported"` — Editor context
- `.focus()` — Bring window to front
- `.close()` — Close split/window
- `.windowRect` `{get/set}` `{x, y, width, height}` — Window frame (macOS, v3.9.1)

### Properties

- `.note` `{get}` `NoteObject` — Current note object
- `.content` `{get/set}` `String` — Raw markdown (includes frontmatter)
- `.title` `{get}` `String` — First line
- `.type` `{get}` `"Notes"|"Calendar"` — Note type
- `.filename` `{get}` `String` — Relative path including folder
- `.paragraphs` `{get/set}` `[ParagraphObject]` — All paragraphs (includes frontmatter)
- `.selectedLinesText` `{get}` `[String]` — Selected lines (ignores frontmatter)
- `.selectedParagraphs` `{get}` `[ParagraphObject]` — Selected paragraphs
- `.selection` `{get}` `RangeObject` — Raw selection range
- `.renderedSelection` `{get}` `RangeObject` — Rendered selection (hides markdown)
- `.selectedText` `{get}` `String` — Selected text
- `.frontmatterAttributes` `{get/set}` `{[key]: string}` — Frontmatter key-value pairs (v3.16.3)
- `.frontmatterTypes` `{get}` `[String]` — Note types from frontmatter (v3.16.3)
- `.availableThemes` `{get}` `[{name, mode, filename, values}]` — All themes (v3.6.2)
- `.currentTheme` `{get}` `{name, mode, filename, values}` — Active theme (v3.6.2)
- `.currentSystemMode` `{get}` `"dark"|"light"` — System appearance (v3.6.2)
- `.skipNextRepeatDeletionCheck` `{set}` `Boolean` — Skip @repeat deletion dialog

### Text & Selection Functions

- `.selectAll()`
- `.copySelection()`
- `.pasteClipboard()`
- `.insertTextAtCharacterIndex(text, index)`
- `.replaceTextInCharacterRange(text, location, length)`
- `.insertTextAtCursor(text)`
- `.replaceSelectionWithText(text)`
- `.select(start, length)` — Raw select
- `.renderedSelect(start, length)` — Rendered select
- `.highlight(paragraph)` — Scroll to paragraph
- `.highlightByRange(range, ignoreFrontmatter?)` — Scroll to range (v3.18)
- `.highlightByIndex(index, length, ignoreFrontmatter?)` — Scroll to index (v3.0.23)
- `.printNote(withBacklinksAndEvents)` — Print dialog (macOS, v3.4)

### Frontmatter Functions

- `.setFrontmatterAttribute(key, value)` — Set single attribute (v3.17)
- `.updateFrontmatterAttributes([{key, value}])` — Batch update (v3.18.1)

### Open Note Functions (all return `Promise(Note?)`)

- `.openNoteByFilename(filename, newWindow?, highlightStart?, highlightEnd?, splitView?, createIfNeeded?, content?)`
- `.openNoteByTitle(title, newWindow?, highlightStart?, highlightEnd?, splitView?)`
- `.openNoteByTitleCaseInsensitive(title, newWindow?, caseSensitive?, highlightStart?, highlightEnd?, splitView?)`
- `.openNoteByDate(date, newWindow?, highlightStart?, highlightEnd?, splitView?, timeframe?, parent?)`
- `.openNoteByDateString(dateString, newWindow?, highlightStart?, highlightEnd?, splitView?)`
- `.openWeeklyNote(year, weeknumber, newWindow?, highlightStart?, highlightEnd?, splitView?)`

### Paragraph Functions

Note: After insert/remove operations that change line indices, re-fetch paragraphs.

- `.paragraphRangeAtCharacterIndex(pos)` → `RangeObject`
- `.insertParagraph(content, lineIndex, type)` — Types: `"open"|"done"|"scheduled"|"cancelled"|"quote"|"title"|"list"|"text"|"empty"`
- `.insertParagraphAtCursor(content, type, indents)`
- `.insertTodo(content, lineIndex)`
- `.insertCompletedTodo(content, lineIndex)`
- `.insertCancelledTodo(content, lineIndex)`
- `.insertScheduledTodo(content, lineIndex, date?)`
- `.insertQuote(content, lineIndex)`
- `.insertList(content, lineIndex)`
- `.insertHeading(content, lineIndex, level)`
- `.appendTodo(content)` / `.prependTodo(content)`
- `.appendParagraph(content, type)` / `.prependParagraph(content, type)`
- `.addTodoBelowHeadingTitle(content, headingTitle, shouldAppend, shouldCreate)`
- `.addParagraphBelowHeadingTitle(content, paragraphType, headingTitle, shouldAppend, shouldCreate)`
- `.appendTodoBelowHeadingLineIndex(content, headingLineIndex)`
- `.appendParagraphBelowHeadingLineIndex(content, paragraphType, headingLineIndex)`
- `.insertTodoAfterParagraph(content, paragraph)` / `.insertTodoBeforeParagraph(content, paragraph)`
- `.insertParagraphAfterParagraph(content, paragraph, type)` / `.insertParagraphBeforeParagraph(content, paragraph, type)`
- `.removeParagraphAtIndex(lineIndex)` / `.removeParagraph(paragraph)` / `.removeParagraphs([paragraph])`
- `.updateParagraph(paragraph)` / `.updateParagraphs([paragraph])`
- `.addBlockID(paragraph)` — Generate + assign unique block ID

### Theme Functions

- `.setTheme(filename)` — Apply theme temporarily (v3.6.2)
- `.saveDefaultTheme(filename, mode)` — Save default for mode (v3.6.2)
- `.addTheme(stringifiedJSON, filename)` → `Boolean` — Add custom theme (v3.1)
- `.save(timeout?)` → `Promise` — Flush editor to file (v3.9.3)

---

## 4. DataStore

### Properties

- `.defaultFileExtension` `{get}` `String` — e.g. "txt" or "md"
- `.folders` `{get}` `[String]` — All folders including "/" root
- `.calendarNotes` `{get}` `[NoteObject]` — All calendar notes
- `.projectNotes` `{get}` `[NoteObject]` — All project notes (excl. trash)
- `.teamspaces` `{get}` `[NoteObject]` — Teamspaces as note objects
- `.hashtags` `{get}` `[String]` — All cached #hashtags
- `.mentions` `{get}` `[String]` — All cached @mentions
- `.filters` `{get}` `[String]` — Filter names (v3.6)
- `.settings` `{get/set}` `Object?` — Plugin settings from settings.json (v3.3.2)

### Note Lookup

- `.calendarNoteByDate(date, timeframe?, parent?)` → `NoteObject` — timeframe: "day"|"week"|"month"|"quarter"|"year"
- `.calendarNoteByDateString(dateString, parent?)` → `NoteObject` — Formats: "YYYYMMDD", "YYYY-Wwn", "YYYY-Qq", "YYYY-MM", "YYYY"
- `.projectNoteByTitle(title, caseInsensitive?, searchAllFolders?)` → `[NoteObject]`
- `.projectNoteByTitleCaseInsensitive(title)` → `[NoteObject]`
- `.projectNoteByFilename(filename)` → `NoteObject`
- `.noteByFilename(filename, type, parent?)` → `NoteObject` — type: "Notes"|"Calendar"
- `.referencedBlocks(paragraph?)` → `[ParagraphObject]` — Synced lines (v3.5.2)

### Note Operations

- `.newNote(title, folder)` → `String` (filename)
- `.newNoteWithContent(content, folder, filename?)` → `String` (filename, v3.5)
- `.moveNote(filename, folder, type?)` → `String` (filename)
- `.trashNote(filename)` → `Boolean` (v3.18.2)
- `.createFolder(folderPath)` → `Boolean` (v3.8)
- `.updateCache(note, shouldUpdateTags)` → `NoteObject` (v3.7.1)

### Preferences

- `.preference(key)` → `String?` — Keys: themeLight, themeDark, fontDelta, firstDayOfWeek, isAsteriskTodo, isDashTodo, defaultTodoCharacter, fontSize, fontFamily, isRenderingMarkdown, etc.
- `.setPreference(key, value)` — Save preference (v3.1)

### Data Storage

- `.saveJSON(object, filename?)` → `Boolean` — Save to `Plugins/data/[plugin-id]/`
- `.loadJSON(filename?)` → `Object?` — Load from data folder
- `.saveData(data, filename, saveAsString)` → `Boolean` (v3.2)
- `.loadData(filename, loadAsString)` → `String?` (v3.2)
- `.fileExists(filename)` → `Boolean` (v3.8.1)

### Search

- `.search(keyword, types?, inFolders?, notInFolders?, shouldLoadDatedTodos?)` → `Promise([ParagraphObject])` — Full search (v3.6)
- `.searchProjectNotes(keyword, inFolders?, notInFolders?)` → `Promise([ParagraphObject])`
- `.searchCalendarNotes(keyword, shouldLoadDatedTodos?)` → `Promise([ParagraphObject])`
- `.listOverdueTasks(keyword?)` → `Promise([ParagraphObject])` (v3.8.1)

### Plugin Management

- `.listPlugins(showLoading, showHidden, skipMatchingLocalPlugins)` → `Promise` (v3.5.2)
- `.installedPlugins()` → `[PluginObject]` (v3.5.2)
- `.isPluginInstalledByID(pluginID)` → `Boolean` (v3.6)
- `.installPlugin(pluginObject, showLoading)` → `Promise` (v3.5.2)
- `.installOrUpdatePluginsByID([pluginID], showPrompt?, showProgress?, showFailed?)` → `Promise` (v3.6)
- `.invokePluginCommand(command, arguments)` → `Promise` (v3.5.2)
- `.invokePluginCommandByName(command, pluginId, arguments)` → `Promise` (v3.5.2)

---

## 5. NoteObject

### Properties

- `.filename` `{get/set}` `String` — Relative path (set renames file, v3.6)
- `.resolvedFilename` `{get}` `String` — Human-readable path (teamspace-safe)
- `.isTeamspaceNote` `{get}` `Boolean`
- `.teamspaceTitle` `{get}` `String`
- `.teamspaceID` `{get}` `String`
- `.type` `{get}` `"Notes"|"Calendar"`
- `.title` `{get}` `String` — First line
- `.date` `{get}` `Date` — Calendar note date
- `.changedDate` `{get}` `Date`
- `.createdDate` `{get}` `Date`
- `.hashtags` `{get}` `[String]`
- `.mentions` `{get}` `[String]`
- `.content` `{get/set}` `String` — Raw text (writes to file immediately)
- `.contentWithAbsoluteAttachmentPaths` `{get}` `String`
- `.paragraphs` `{get/set}` `[ParagraphObject]`
- `.linkedItems` `{get}` `[ParagraphObject]` — Paragraphs linking to notes (v3.2)
- `.datedTodos` `{get}` `[ParagraphObject]` — Paragraphs linking to daily notes (v3.2)
- `.backlinks` `{get}` `[ParagraphObject]` — Notes linking to this note (v3.2)
- `.versions` `{get}` `[{content, date}]` — Version history (v3.7.2)
- `.frontmatterTypes` `{get}` `[String]` (v3.5)
- `.frontmatterAttributes` `{get}` `{[key]: string}`
- `.frontmatterAttributesArray` `{get}` `[{key, value}]` — Ordered
- `.publicRecordID` `{get}` `String?` — CloudKit ID (v3.9.1)
- `.conflictedVersion` `{get}` `{filename, url, content}?` (v3.9.3)

### Methods

- `.rename(newFilename)` → `String` (v3.6.1)
- `.insertTextInCharacterIndex(text, index)`
- `.replaceTextAtCharacterRange(text, location, length)`
- `.setFrontmatterAttribute(key, value)` (v3.18.1)
- `.updateFrontmatterAttributes([{key, value}])` (v3.18.1)
- `.printNote(withBacklinksAndEvents)` (macOS, v3.4)
- `.publish()` → `Promise` / `.unpublish()` → `Promise` (v3.9.1)
- `.resolveConflictWithCurrentVersion()` / `.resolveConflictWithOtherVersion()` (v3.9.3)

### Paragraph Methods (same as Editor)

- `.paragraphRangeAtCharacterIndex(pos)` → `RangeObject`
- `.insertParagraph(content, lineIndex, type)`
- `.insertTodo(content, lineIndex)` / `.insertCompletedTodo` / `.insertCancelledTodo` / `.insertScheduledTodo(content, lineIndex, date?)`
- `.insertQuote(content, lineIndex)` / `.insertList(content, lineIndex)` / `.insertHeading(content, lineIndex, level)`
- `.appendTodo(content)` / `.prependTodo(content)`
- `.appendParagraph(content, type)` / `.prependParagraph(content, type)`
- `.addTodoBelowHeadingTitle(content, headingTitle, shouldAppend, shouldCreate)`
- `.addParagraphBelowHeadingTitle(content, paragraphType, headingTitle, shouldAppend, shouldCreate)`
- `.appendTodoBelowHeadingLineIndex(content, headingLineIndex)`
- `.appendParagraphBelowHeadingLineIndex(content, paragraphType, headingLineIndex)`
- `.insertTodoAfterParagraph` / `.insertTodoBeforeParagraph` / `.insertParagraphAfterParagraph` / `.insertParagraphBeforeParagraph`
- `.removeParagraphAtIndex(lineIndex)` / `.removeParagraph(paragraph)` / `.removeParagraphs([paragraph])`
- `.updateParagraph(paragraph)` / `.updateParagraphs([paragraph])`
- `.addBlockID(paragraph)` / `.removeBlockID(paragraph)` (v3.5.2)

---

## 6. ParagraphObject

### Properties

- `.type` `{get/set}` `"open"|"done"|"scheduled"|"cancelled"|"title"|"quote"|"list"|"empty"|"text"|"checklist"|"checklistDone"|"checklistCancelled"|"checklistScheduled"`
- `.content` `{get/set}` `String` — Text without markdown prefix or indents
- `.rawContent` `{get}` `String` — Full text including prefix and indents
- `.prefix` `{get}` `String` — Markdown prefix (e.g. "* [ ]")
- `.contentRange` `{get}` `RangeObject`
- `.lineIndex` `{get}` `Int`
- `.date` `{get}` `Date` — Scheduled date if any
- `.heading` `{get}` `String` — Parent heading text
- `.headingRange` `{get}` `RangeObject`
- `.headingLevel` `{get}` `Int` — 1-based (# = 1, ## = 2)
- `.isRecurring` `{get}` `Boolean` — Has @repeat(...)
- `.indents` `{get/set}` `Int`
- `.filename` `{get}` `String` — Source note filename
- `.noteType` `{get}` `String` — Source note type
- `.linkedNoteTitles` `{get}` `[String]` — [[links]] without brackets
- `.note` `{get}` `NoteObject?` — Parent note (v3.5.2)
- `.blockId` `{get}` `String?` — Block sync ID (v3.5.2)
- `.referencedBlocks` `{get}` `[ParagraphObject]` — Synced paragraphs (v3.5.2)

### Methods

- `.duplicate()` → `ParagraphObject` — Deep copy
- `.children()` → `[ParagraphObject]?` — Indented children (v3.3)

---

## 7. CommandBar

- `.placeholder` `{get/set}` `String` — Input placeholder
- `.searchText` `{get}` `String` — Current input
- `.hide()` — Close command bar
- `.showOptions(options, placeholder, searchText?)` → `Promise(CommandBarResultObject)` — Options: `[String]` or `[{text, icon?, shortDescription?, color?, alpha?}]` (object format v3.18)
- `.showInput(placeholder, submitText, searchText?)` → `Promise(String)` — submitText supports `%@` variable
- `.showLoading(visible, text?, progress?)` — Loading indicator; progress: 0-1 for ring
- `.onAsyncThread()` → `Promise` — Switch to background thread
- `.onMainThread()` → `Promise` — Return to main thread
- `.prompt(title, message, buttons?)` → `Promise(Int)` — Button index (v3.3.2)
- `.textPrompt(title, message, defaultText?)` → `Promise(Bool|String)` — Text input dialog (v3.3.2)

### CommandBarResultObject

- `.index` `Int` — Selected index
- `.value` `String` — Selected value
- `.keyModifiers` `[String]` — `"cmd"|"opt"|"shift"|"ctrl"` (v3.7)

---

## 8. Calendar + CalendarItem

### Calendar Methods

- `.add(calendarItem)` → `CalendarItem` — Create event/reminder
- `.update(calendarItem)` → `Promise` — Update (needs ID)
- `.remove(calendarItem)` → `Promise` — Delete (needs ID)
- `.eventsBetween(startDate, endDate, filter?)` → `Promise([CalendarItem])`
- `.remindersBetween(startDate, endDate, filter?)` → `Promise([CalendarItem])`
- `.eventByID(id)` → `Promise(CalendarItem)`
- `.reminderByID(id)` → `Promise(CalendarItem)`
- `.eventsToday(filter?)` → `Promise([CalendarItem])`
- `.remindersToday(filter?)` → `Promise([CalendarItem])`
- `.remindersByLists(lists?)` → `Promise([CalendarItem])` (v3.5.2)
- `.parseDateText(text)` → `[DateRangeObject]` — Natural language dates
- `.dateFrom(year, month, day, hour, minute, second)` → `Date` — month is 1-based
- `.addUnitToDate(date, type, num)` → `Date`
- `.unitOf(date, type)` → `Int`
- `.timeAgoSinceNow(date)` → `String`
- `.unitsUntilNow(date, type)` → `Int` / `.unitsAgoFromNow(date, type)` → `Int` / `.unitsBetween(date1, date2, type)` → `Int`
- `.weekNumber(date)` → `Int` / `.weekYear(date)` → `Int` (v3.7)
- `.startOfWeek(date)` → `Date` / `.endOfWeek(date)` → `Date` (v3.7)
- `.dateUnits` `[String]` — `["year", "month", "day", "hour", "minute", "second"]`
- `.availableCalendarTitles(writeOnly?, enabledOnly?)` → `[String]` (v3.1)
- `.availableReminderListTitles()` → `[String]` (v3.1)
- `.availableCalendars(options?)` → `[{title, id, color, source, sourceType, isWritable, isEnabled, allowedEntityTypes}]` (v3.20)
- `.availableReminderLists(options?)` → `[{title, id, color, source, sourceType, isWritable, isEnabled, allowedEntityTypes}]` (v3.20)

### CalendarItem Properties

- `.id` `String` — Set after add/query
- `.title` `String` — Event/reminder title
- `.date` `Date` — Start date/time
- `.endDate` `Date` — End date (events only)
- `.type` `"event"|"reminder"`
- `.isAllDay` `Boolean`
- `.isCompleted` `Boolean` — Reminders only
- `.occurences` `[Date]` — Multi-day dates
- `.calendar` `String` — Calendar/list name
- `.color` `String` — Hex color (v3.20)
- `.notes` `String` — Notes field
- `.url` `String` — Associated URL
- `.availability` `Int` — -1=notSupported, 0=busy, 1=free, 2=tentative, 3=unavailable
- `.attendees` `[String]` — Links (v3.5) / `.attendeeNames` `[String]` — Plain text (v3.5.2)
- `.calendarItemLink` `String` — Markdown link for note linking (v3.5)
- `.findLinkedFilenames()` → `Promise([String])` — Meeting notes (v3.9.1)

### CalendarItem.create()

```javascript
CalendarItem.create(title, date, endDate, type, isAllDay?, calendar?, isCompleted?, notes?, url?, availability?)
// type: "event" or "reminder"
```

### DateRangeObject

- `.start` `Date` / `.end` `Date` / `.text` `String` / `.index` `Int`

---

## 9. NotePlan Global

### Properties

- `.environment` — `{languageCode, regionCode, is12hFormat, preferredLanguages, secondsFromGMT, localTimeZoneAbbreviation, localTimeZoneIdentifier, isDaylightSavingTime, platform ("macOS"|"iPadOS"|"iOS"), hasSettings, version, versionNumber, buildVersion, templateFolder, machineName, screenWidth, screenHeight, osVersion}`
- `.selectedSidebarFolder` `{get}` `String?` — Selected folder (macOS, v3.5)
- `.editors` `{get}` `[Editor]` — All open editors (v3.8.1)
- `.htmlWindows` `{get}` `[HTMLWindowObject]` — All HTML windows. Each has: `id, customId, type ("html"), displayType ("window"|"sheet"|"mainView"|"splitView"), windowRect, focus(), close(), runJavaScript(code)`

### Methods

- `.ai(prompt, filenames?, useStrictFilenames?, model?)` → `Promise(String)` — OpenAI integration (v3.15.1). Filenames support relative expressions ("last 7 days"), folders ("/Projects"), calendar notes ("today", "this week")
- `.showConfigurationView()` → `Promise` — Plugin settings UI (macOS, v3.3.2)
- `.resetCaches()` — Rebuild sidebar (v3.5)
- `.openURL(url)` — Open in default browser (v3.5.2)
- `.stringDiff(version1, version2)` → `[RangeObject]` — Changed ranges (v3.7.2)
- `.toggleSidebar(forceCollapse, forceOpen, animated)` — Sidebar toggle (v3.19.2)
- `.setSidebarWidth(width)` / `.getSidebarWidth()` → `Number` — macOS only (v3.19.2)
- `.isSidebarCollapsed()` → `Boolean` (v3.19.2)
- `.getWeather(units, latitude, longitude)` → `Promise(Object)` — Weather via OpenWeatherMap (v3.19.2)

---

## 10. Clipboard & Range

### Clipboard

- `.string` `{get/set}` `String` — Plain text
- `.types` `{get}` `[String]` — Available types
- `.setStringForType(string, type)` / `.stringForType(type)` → `String`
- `.setBase64DataStringForType(base64, type)` / `.base64DataStringForType(type)` → `String`
- `.dataForType(type)` → `Data` / `.setDataForType(data, type)`
- `.clearContents()`
- `.availableType(fromTypes)` → `String`

### RangeObject

- `.start` `Int` / `.end` `Int` / `.length` `Int`
- `Range.create(start, end)` → `RangeObject`

---

## 11. Essential Patterns

### console.log capture

All `console.log`, `console.warn`, `console.error` output is captured and readable via `noteplan_get_plugin_log`. Use liberally for debugging.

### Frontmatter

```javascript
// Read
const attrs = Editor.frontmatterAttributes; // {key: value, ...}
// Write single
Editor.setFrontmatterAttribute("status", "done");
// Write batch
Editor.updateFrontmatterAttributes([{key: "a", value: "1"}, {key: "b", value: "2"}]);
```

### Scheduling / Date links

Tasks with `>YYYY-MM-DD` or `>today` are scheduled. Use `Editor.insertScheduledTodo(content, lineIndex, date)` to create them.

### Paragraph type values

`"open"` = `* [ ]`, `"done"` = `* [x]`, `"scheduled"` = `* [>]`, `"cancelled"` = `* [-]`, `"quote"` = `>`, `"title"` = `#`, `"list"` = `- ` (bullet), `"text"` = plain, `"empty"` = blank line, `"checklist"` = `+ [ ]`, `"checklistDone"` = `+ [x]`

### PluginObject (from DataStore.listPlugins)

- `.id`, `.name`, `.desc`, `.author`, `.version`, `.script`, `.isOnline`, `.repoUrl`, `.releaseUrl`, `.availableUpdate`, `.commands`, `.lastUpdateInfo`, `.requiredFiles`

### PluginCommandObject

- `.name`, `.desc`, `.pluginID`, `.pluginName`, `.arguments`
