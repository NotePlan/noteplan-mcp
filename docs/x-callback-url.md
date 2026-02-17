# NotePlan x-callback-url Reference

NotePlan supports the `noteplan://x-callback-url/` URL scheme for automation, deep linking, and integration with other apps. These URLs work on both macOS and iOS.

## Base URL Format

```
noteplan://x-callback-url/<action>?<param1>=<value1>&<param2>=<value2>
```

All parameter values must be **percent-encoded** (URL-encoded). Use `%20` for spaces, `%0A` for newlines, `%23` for `#`, etc.

## x-callback-url Support

All actions support the standard [x-callback-url](http://x-callback-url.com) parameters:
- **x-success** — URL to open when the action completes successfully. For `noteInfo`, the callback receives `?path=<path>&name=<name>`.

---

## Note Targeting Parameters

Many actions need to identify which note to act on. Use **one** of these parameters:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `noteDate` | Date of a calendar note. Accepts `YYYYMMDD`, `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday` | `noteDate=20250217` |
| `noteTitle` | Title of a project note (case-sensitive by default) | `noteTitle=My%20Note` |
| `fileName` | Filename/path of a note (with extension) | `fileName=Projects/todo.md` |
| `id` | Supabase note ID | `id=abc123` |

Additional targeting options:
- **caseSensitive** — `true` (default) or `false`, applies to `noteTitle` lookups
- **heading** / **subheading** — Jump to a specific heading within the note

---

## Actions

### openNote

Open an existing note. If the note doesn't exist, it creates one (using `noteTitle` as the title).

```
noteplan://x-callback-url/openNote?noteTitle=Meeting%20Notes
noteplan://x-callback-url/openNote?noteDate=today
noteplan://x-callback-url/openNote?fileName=Projects/roadmap.md
```

| Parameter | Description |
|-----------|-------------|
| `noteDate` / `noteTitle` / `fileName` | Which note to open (see Note Targeting) |
| `heading` | Scroll to and highlight this heading |
| `subWindow` | `yes` to open in a new window (macOS) |
| `splitView` | `yes` to open in split view (macOS) |
| `reuseSplitView` | `yes` to reuse an existing split view |
| `useExistingSubWindow` | `yes` to reuse an existing sub window (macOS) |
| `view` | `daily` or `week` — override the view for calendar notes (macOS) |
| `timeframe` | `day`, `week`, `month`, `quarter`, `year` |
| `parent` | Teamspace/space parent identifier |
| `stayInSpace` | `yes` to stay in the current teamspace context |
| `highlightStart` | Character offset to highlight |
| `highlightLength` | Length of highlight range |
| `editorID` | Target a specific editor pane |
| `showEventsOnly` | `yes` to show only calendar events (iOS) |
| `shouldOpenTrashedNotes` | `yes` to allow opening trashed notes |

---

### addText

Append or prepend text to an existing note.

```
noteplan://x-callback-url/addText?noteDate=today&text=*%20Buy%20groceries&mode=append&openNote=no
noteplan://x-callback-url/addText?noteTitle=Journal&text=Had%20a%20great%20day&mode=append
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `noteDate` / `noteTitle` / `fileName` | Yes | Which note to modify |
| `text` | Yes | The text to add (percent-encoded) |
| `mode` | No | `append` (default) or `prepend` |
| `openNote` | No | `yes` to open the note after adding text, `no` (default) to stay in current app |

**Tips:**
- Use `%0A` for newlines in the text parameter
- Prefix tasks with `*%20` for bullet/task format (e.g., `text=*%20My%20task`)
- Use `mode=prepend` to add at the top of the note (after the heading for calendar notes)

---

### addNote

Create a new project note.

```
noteplan://x-callback-url/addNote?noteTitle=Weekly%20Review&text=##%20Wins&openNote=yes
noteplan://x-callback-url/addNote?noteTitle=Meeting&text=Attendees&folder=Work
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `noteTitle` | Yes | Title for the new note (a `#` heading is auto-prepended if missing) |
| `text` | No | Body content of the note |
| `folder` | No | Folder to create the note in (e.g., `Projects`, `Work/Active`) |
| `openNote` | No | `yes` to open after creation |
| `subWindow` | No | `yes` to open in a new window (macOS) |
| `splitView` | No | `yes` to open in split view (macOS) |

---

### addQuickTask (iOS only)

Opens the quick-add task editor, optionally pre-targeted to a specific note.

```
noteplan://x-callback-url/addQuickTask?destination=today
noteplan://x-callback-url/addQuickTask?destination=tomorrow&heading=Tasks&position=beginning
noteplan://x-callback-url/addQuickTask?destination=customnote&noteTitle=Inbox
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `destination` | No | `today` (default), `tomorrow`, `yesterday`, `thisWeek`, `nextWeek`, `thisMonth`, `nextMonth`, `thisQuarter`, `nextQuarter`, `thisYear`, `nextYear`, or `customnote` |
| `timeframe` | No | `day` (default), `week`, `month`, `quarter`, `year` — sets the note timeframe |
| `noteTitle` | No | Required when `destination=customnote` — the project note title |
| `heading` | No | Target heading section in the note |
| `position` | No | `beginning` (default) or `end` |
| `content` | No | Pre-fill the task content |
| `input` | No | `text` (default), `voice`, or `drawing` |
| `lineType` | No | `task` (default), `bullet`, `quote`, `empty`, `checklist` |
| `skipPostProcessing` | No | `true` (default) or `false` — skip AI post-processing for voice |
| `postProcessing` | No | Pre-selected post-processing mode for voice |
| `fast` | No | `true` to skip cache loading (used by widgets) |

---

### deleteNote

Move a note to trash (project notes) or clear content (calendar notes).

```
noteplan://x-callback-url/deleteNote?noteTitle=Old%20Note
noteplan://x-callback-url/deleteNote?noteDate=20250101
noteplan://x-callback-url/deleteNote?fileName=Projects/archive.md
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `noteDate` / `noteTitle` / `fileName` | Yes | Which note to delete |

---

### search

Open the search view with a keyword or open a saved filter.

```
noteplan://x-callback-url/search?text=meeting%20notes&view=calendar
noteplan://x-callback-url/search?filter=Overdue%20Tasks
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `text` | No* | Search keyword |
| `filter` | No* | Name of a saved filter/review to open |
| `view` | No | `calendar` or `notes` — which view to search in |

*One of `text` or `filter` is required.

---

### selectTag

Filter notes by a tag (hashtag or mention).

```
noteplan://x-callback-url/selectTag?name=%23project
noteplan://x-callback-url/selectTag?name=%40waiting
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | The tag to filter by, including the `#` or `@` prefix |

---

### runPlugin

Execute a plugin command.

```
noteplan://x-callback-url/runPlugin?pluginID=jgclark.NoteHelpers&command=jump%20to%20heading
noteplan://x-callback-url/runPlugin?pluginID=my.plugin&command=doThing&arg0=hello&arg1=world
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `pluginID` | Yes | The plugin identifier |
| `command` | Yes | The command name to execute |
| `arg0`, `arg1`, ... | No | Positional arguments passed to the plugin command |

---

### installPlugin

Install or update a plugin from the online repository.

```
noteplan://x-callback-url/installPlugin?plugin_id=jgclark.NoteHelpers
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `plugin_id` | Yes | Plugin ID to install (also accepts `pluginID`, `pluginId`, `id`) |

---

### openView

Open a named view in NotePlan.

```
noteplan://x-callback-url/openView?name=review
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | The view name to open |

---

### toggleSidebar

Toggle sidebar visibility.

```
noteplan://x-callback-url/toggleSidebar
noteplan://x-callback-url/toggleSidebar?forceCollapse=yes
noteplan://x-callback-url/toggleSidebar?forceOpen=yes
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `forceCollapse` | No | `yes` to force the sidebar closed |
| `forceOpen` | No | `yes` to force the sidebar open |
| `animated` | No | `no` to skip animation |

---

### setTheme

Set the active theme.

```
noteplan://x-callback-url/setTheme?name=Nord&mode=dark
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Theme filename |
| `mode` | No | `light`, `dark`, or `auto` (default) |

---

### closePluginWindow (macOS only)

Close plugin HTML windows.

```
noteplan://x-callback-url/closePluginWindow?windowID=my-window
noteplan://x-callback-url/closePluginWindow?title=Dashboard
noteplan://x-callback-url/closePluginWindow
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `windowID` | No | Specific window ID to close |
| `title` | No | Close window matching this title |

If no parameters are given, **all** plugin windows are closed.

---

### noteInfo

Returns information about the currently open note via the `x-success` callback.

```
noteplan://x-callback-url/noteInfo?x-success=myapp://callback
```

The `x-success` URL receives `?path=<encoded_path>&name=<encoded_name>`.

---

## Encoding Examples

| Content | Encoded |
|---------|---------|
| `Buy groceries` | `Buy%20groceries` |
| `# Heading` | `%23%20Heading` |
| Newline | `%0A` |
| `Task & notes` | `Task%20%26%20notes` |
| `[Link](url)` | `%5BLink%5D(url)` |

### Multi-line text example

```
noteplan://x-callback-url/addText?noteDate=today&text=%23%23%20Morning%0A-%20Coffee%0A-%20Read%20news&mode=prepend&openNote=no
```

This prepends to today's note:
```
## Morning
- Coffee
- Read news
```
