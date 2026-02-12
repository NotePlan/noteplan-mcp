# NotePlan MCP Server

An MCP (Model Context Protocol) server that exposes NotePlan's note, task, calendar, reminders, and plugin management to AI assistants like Claude.

Works with **Claude Desktop** and **Claude Code**. Claude Desktop is great for conversational workflows — planning your day, reviewing tasks, asking questions about your notes. Claude Code is ideal for batch operations and automation — bulk edits, plugin development, or scripting complex workflows across many notes.

## What You Can Do

Once installed, just talk to Claude naturally. Here are some examples:

**Notes & Tasks**
- "What's on my schedule today?"
- "Show me all open tasks tagged #urgent"
- "Add a task to my Daily Note: call the dentist at 3pm"
- "Summarize my meeting notes from last week"
- "Move all tasks from 'Inbox' to '20 - Areas/Work'"
- "What did I write about the product launch?"

**Calendar & Reminders**
- "What meetings do I have tomorrow?"
- "Create a calendar event for Friday at 2pm: Design Review"
- "Remind me to submit the report by end of day"
- "Show me all reminders due this week"

**Organization**
- "List all notes in my Projects folder"
- "Create a new note called 'Q1 Planning' in my Work folder"
- "Rename the 'Old Ideas' folder to 'Archive'"
- "Which tags am I using the most?"

**Plugins & Themes**
- "What plugins do I have installed?"
- "Create a plugin that adds word counts to my daily notes"
- "Switch to dark mode"
- "Show me available plugins I can install"

## Installation

Requires **Node.js 18+**. Check with `node -v`, or install via [Homebrew](https://brew.sh) (`brew install node`) or [nodejs.org](https://nodejs.org).

### Claude Code

```bash
claude mcp add noteplan -- npx -y @noteplanco/noteplan-mcp
```

### Claude Desktop

Open **Settings > Developer > Edit Config** and add:

```json
{
  "mcpServers": {
    "noteplan": {
      "command": "npx",
      "args": ["-y", "@noteplanco/noteplan-mcp"]
    }
  }
}
```

Save and restart Claude Desktop.

### Optional: Semantic Embeddings

To enable semantic search, add environment variables to the config:

```json
{
  "mcpServers": {
    "noteplan": {
      "command": "npx",
      "args": ["-y", "@noteplanco/noteplan-mcp"],
      "env": {
        "NOTEPLAN_EMBEDDINGS_ENABLED": "true",
        "NOTEPLAN_EMBEDDINGS_PROVIDER": "openai",
        "NOTEPLAN_EMBEDDINGS_API_KEY": "YOUR_API_KEY",
        "NOTEPLAN_EMBEDDINGS_MODEL": "text-embedding-3-small",
        "NOTEPLAN_EMBEDDINGS_BASE_URL": "https://api.openai.com"
      }
    }
  }
}
```

- `NOTEPLAN_EMBEDDINGS_PROVIDER`: `openai` (default), `mistral`, or `custom`.
- `NOTEPLAN_EMBEDDINGS_BASE_URL`: for `custom`, assumes OpenAI-compatible `/v1/embeddings`.
- `NOTEPLAN_EMBEDDINGS_ENABLED`: defaults to `false`; when false, embeddings tools are not listed.

<details>
<summary><strong>Build from Source</strong> (for contributors and development)</summary>

#### Prerequisites

- **Node.js 18+** (`node -v`)
- **Xcode Command Line Tools** — needed to compile the Swift calendar/reminders helpers (`xcode-select --install`)

#### Build

```bash
git clone https://github.com/NotePlan/noteplan-mcp.git
cd noteplan-mcp
npm install
npm run build
```

The `build` step compiles the TypeScript source and two Swift helper binaries (`calendar-helper` and `reminders-helper`) for native Calendar and Reminders access.

#### Verify

```bash
npm run smoke:workflow
```

#### Development

```bash
npm run dev   # watch mode — recompiles TypeScript on save
```

Then configure Claude Desktop or Claude Code to point at the local `dist/index.js` as shown above.

</details>

## Features

- **Unified Access**: Search and manage both local notes (file system) and teamspace notes (SQLite)
- **Full CRUD**: Create, read, update, and delete notes with flexible note targeting (id, filename, title, date, or query)
- **Task Management**: Add, complete, and update tasks with auto-formatted markers matching user settings
- **Calendar Events & Reminders**: Native macOS Calendar and Reminders integration via Swift helpers (`noteplan_eventkit`)
- **Plugin Management**: List, create, install, delete, and run NotePlan plugins; read source/logs; capture screenshots
- **Theme Management**: List, create, and activate themes
- **Filter Management**: Create, save, and execute task filters
- **UI Control**: Open notes, toggle sidebar, run plugin commands via AppleScript
- **Memory**: Persistent user preference memory for storing formatting/style preferences across sessions
- **Search**: Full-text search across all notes with frontmatter property filters, plus tag listing
- **Auto-Create Calendar Notes**: Editing a date that doesn't exist yet auto-creates the daily note (matches NotePlan native behavior)
- **Smart Folder Resolution**: Exact path matching with `Notes/` prefix support; fuzzy matching only as fallback
- **Structured Errors**: Tool failures include machine-readable `code` plus `hint`/`suggestedTool`
- **Fast Repeated Lookups**: Short-lived in-memory caching for expensive list/resolve paths
- **Opt-in Timing Telemetry**: `debugTimings=true` adds `durationMs` and `stageTimings`
- **Safer TeamSpace Deletes**: TeamSpace deletes move notes into `@Trash`; list/search excludes trash by default
- **Optional Semantic Index**: Local embeddings index + semantic search (disabled by default; explicit opt-in)

## Available Tools (12)

All tools use action-based dispatch — one tool per domain, with an `action` parameter to select the operation.

### `noteplan_get_notes`
Unified note retrieval: get a single note, list notes, resolve references, fetch today/calendar/periodic notes, date ranges, or folder contents.
- Single note by `id`, `title`, `filename`, or `date`
- `resolve=true` — resolve a fuzzy reference to a canonical note
- `period` + `count` — recent periodic notes (e.g., last 6 weekly notes)
- `rangePeriod` or `startDate`/`endDate` — daily notes in date range
- `folder` — notes in a folder
- Fallback: list notes with optional filters

### `noteplan_manage_note`
Note lifecycle: `create`, `update`, `delete`, `move`, `restore`, `rename`, `set_property`, `remove_property`.

### `noteplan_edit_content`
Edit note content: `insert`, `append`, `delete_lines`, `edit_line`, `replace_lines`. All actions target notes via `id`, `filename`, `title`, `date`, or `query`. Calendar notes are auto-created when targeted by date.

### `noteplan_paragraphs`
Paragraph and task operations: `get` (line metadata), `search` (find lines in a note), `search_global` (tasks across all notes), `add` (task with auto-formatted marker), `complete`, `update`.

### `noteplan_search`
Search across notes or list tags.
- `action: "search"` (default) — full-text or metadata search with `searchField`, `queryMode`, `propertyFilters`
- `action: "list_tags"` — list all tags/hashtags with optional filtering

### `noteplan_folders`
Folder and space operations: `list`, `find`, `resolve`, `create`, `move`, `rename`, `delete`, `list_spaces`.

### `noteplan_filters`
Saved filter operations: `list`, `get`, `get_tasks`, `list_parameters`, `save`, `rename`.

### `noteplan_eventkit`
macOS Calendar and Reminders via `source` parameter.
- `source: "calendar"` — `get_events`, `list_calendars`, `create_event`, `update_event`, `delete_event`
- `source: "reminders"` — `get`, `list_lists`, `create`, `complete`, `update`, `delete`

### `noteplan_memory`
User preference memory: `list`, `save`, `update`, `delete`.

### `noteplan_ui`
NotePlan UI control: `open_note`, `open_today`, `search`, `run_plugin`, `open_view`, `toggle_sidebar`, `close_plugin_window`, `list_plugin_windows`.

### `noteplan_plugins`
Plugin management: `list`, `list_available`, `create`, `delete`, `install`, `log`, `source`, `update_html`, `screenshot`.

### `noteplan_themes`
Theme management: `list`, `get`, `save`, `set_active`.

### `noteplan_embeddings` (opt-in)
Embeddings/vector search: `status`, `search`, `sync`, `reset`. Only available when `NOTEPLAN_EMBEDDINGS_ENABLED=true`.

## Preferred Usage Flow

Prefer granular edits to avoid large context payloads and accidental full-note rewrites.

1. Find the note: `noteplan_get_notes` (by id/title/filename/date) or `noteplan_search`
2. Inspect content:
   - `noteplan_paragraphs(action: get)` for line metadata
   - `noteplan_paragraphs(action: search)` for text lookup inside a note
3. Apply targeted mutation:
   - `noteplan_edit_content(action: edit_line)` for one-line changes
   - `noteplan_edit_content(action: insert/append)` for adding content
   - `noteplan_edit_content(action: delete_lines)` for removals
   - All edit actions accept `id`, `filename`, `title`, `date`, or `query` to target the note
4. Use `noteplan_manage_note(action: update)` only for intentional full-note rewrites (`fullReplace=true`)
5. Destructive operations (delete, move, rename, restore) use a 2-step flow:
   - Step 1: call with `dryRun=true` to preview impact and get `confirmationToken`
   - Step 2: call again with that `confirmationToken` to execute
6. Calendar notes are auto-created when targeted by `date` — no need to create them first

Task flow:
1. Find tasks: `noteplan_paragraphs(action: search)` in one note, or `noteplan_paragraphs(action: search_global)` across notes
2. Mutate: `noteplan_paragraphs(action: complete)` or `noteplan_paragraphs(action: update)`

Property-filtered search:
- `noteplan_search` with `query` + `propertyFilters`, e.g. `query: "campaign", propertyFilters: {"category":"marketing"}`
- Folder filters accept canonical paths (e.g. `20 - Areas` or `Notes/20 - Areas`)

## Data Locations

The server automatically detects NotePlan's storage location. Supported paths (in order of preference):

**iCloud paths (preferred):**
- `~/Library/Mobile Documents/iCloud~co~noteplan~Today/Documents/`
- `~/Library/Mobile Documents/iCloud~co~noteplan~NotePlan3/Documents/`
- `~/Library/Mobile Documents/iCloud~co~noteplan~NotePlan/Documents/`
- `~/Library/Mobile Documents/iCloud~co~noteplan~NotePlan-setapp/Documents/`

**Local paths:**
- `~/Library/Containers/co.noteplan.NotePlan3/Data/Library/Application Support/co.noteplan.NotePlan3`
- `~/Library/Containers/co.noteplan.NotePlan-setapp/Data/Library/Application Support/co.noteplan.NotePlan-setapp`

**Teamspace Database:** `~/Library/Caches/teamspace.db`

## How It Works

- **Local notes**: Direct file system read/write. NotePlan auto-detects changes via FolderMonitor (~300ms delay)
- **Teamspace notes**: SQLite queries/updates. NotePlan sees changes on next sync cycle or app restart
- **Calendar & Reminders**: Native macOS access via compiled Swift helpers using EventKit
- **UI control & Plugins**: AppleScript bridge to the running NotePlan app

## License

MIT
