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

### 1. Install Node.js

The server requires **Node.js 18+** to run. Check if you already have it:

```bash
node -v
```

If not installed, the easiest way on macOS is via [Homebrew](https://brew.sh):

```bash
brew install node
```

Or download the installer from [nodejs.org](https://nodejs.org).

### 2. Download the Server

Download the latest release from the [Releases page](https://github.com/NotePlan/noteplan-mcp/releases) and extract it to a permanent location, for example:

```bash
mkdir -p ~/noteplan-mcp
cd ~/noteplan-mcp
tar -xzf ~/Downloads/noteplan-mcp-vX.X.X.tar.gz
```

The release includes everything pre-built — no compilation needed.

### 3. Configure Your AI Client

Pick the client you use and add the server config.

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "noteplan": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/noteplan-mcp/dist/index.js"]
    }
  }
}
```

**Claude Code** — add to `~/.claude/claude_code_config.json` (or project-level `.claude/settings.json`):

```json
{
  "mcpServers": {
    "noteplan": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/noteplan-mcp/dist/index.js"]
    }
  }
}
```

Replace `/Users/YOUR_USERNAME/noteplan-mcp` with the actual path where you extracted the release.

### 4. Restart Claude

Restart Claude Desktop or Claude Code. The NotePlan tools will appear automatically.

### Optional: Semantic Embeddings

To enable the optional semantic search tools, add embeddings environment variables to the server config above:

```json
{
  "mcpServers": {
    "noteplan": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/noteplan-mcp/dist/index.js"],
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
- **Full CRUD**: Create, read, update, and delete notes
- **Task Management**: Add, complete, and update tasks
- **Calendar Events & Reminders**: Native macOS Calendar and Reminders integration via Swift helpers
- **Plugin Management**: List, create, install, delete, and run NotePlan plugins
- **Theme Management**: List, create, and activate themes
- **Filter Management**: Create, save, and execute task filters
- **UI Control**: Open notes, toggle sidebar, run plugin commands via AppleScript
- **Memory**: Persistent key-value memory for storing user preferences across sessions
- **Search**: Full-text search across all notes
- **Progressive Tool Discovery**: `tools/list` is paginated and detailed schemas are fetched on demand
- **Structured Errors**: Tool failures include machine-readable `code` plus `hint`/`suggestedTool`
- **Fast Repeated Lookups**: Short-lived in-memory caching for expensive list/resolve paths
- **Opt-in Timing Telemetry**: `debugTimings=true` adds `durationMs`; heavy discovery tools also add `stageTimings`
- **Adaptive Performance Hints**: Slow discovery/search responses include `performanceHints` with narrowing suggestions
- **Safer TeamSpace Deletes**: TeamSpace deletes now move notes into TeamSpace `@Trash` and normal list/search excludes trash by default
- **Optional Semantic Index**: Local embeddings index + semantic search tools (disabled by default; explicit opt-in)

## Available Tools

### Note Operations
- `noteplan_get_note` - Get note metadata by id/title/filename/date, with optional paged content retrieval (default content window: 500 lines when includeContent=true)
- `noteplan_list_notes` - List notes with filtering/pagination
- `noteplan_create_note` - Create a new note
- `noteplan_update_note` - Replace full note content (requires `fullReplace=true` and dryRun confirmation token; prefer targeted paragraph/line tools)
- `noteplan_delete_note` - Move a note to trash (local `@Trash` or TeamSpace `@Trash`)
- `noteplan_move_note` - Move a note between folders (local Notes folders or TeamSpace parent folders; local full target paths are validated) (dryRun + confirmation token)
- `noteplan_rename_note_file` - Rename a local project note filename without changing note content/title (accepts bare filename or full same-folder path) (dryRun + confirmation token)
- `noteplan_restore_note` - Restore a trashed note (local or TeamSpace) (dryRun + confirmation token)

### Note Structure and Granular Edits
- `noteplan_get_paragraphs` - Get paged line/paragraph content with line references
- `noteplan_search_paragraphs` - Find matching lines/paragraph blocks inside a note
- `noteplan_edit_line` - Update one specific line
- `noteplan_insert_content` - Insert content at start/end/heading/line using id/filename/title/date/query targeting
- `noteplan_delete_lines` - Delete a line range
- `noteplan_append_content` - Append content using id/filename/title/date/query targeting
- `noteplan_set_property` - Set a frontmatter property on a note
- `noteplan_remove_property` - Remove a frontmatter property from a note

### Task Operations
- `noteplan_get_tasks` - Get tasks from one note (id/title/filename/date) with filtering/pagination
- `noteplan_search_tasks` - Find matching task lines in one note for targeted updates
- `noteplan_search_tasks_global` - Search task lines across notes and return note+line references
- `noteplan_add_task` - Add task to a note
- `noteplan_complete_task` - Mark task as done (accepts `lineIndex` 0-based or `line` 1-based)
- `noteplan_update_task` - Update task content/status (accepts `lineIndex` 0-based or `line` 1-based)

### Calendar Notes
- `noteplan_get_today` - Get today's daily note
- `noteplan_add_to_today` - Add content to today
- `noteplan_get_calendar_note` - Get note for specific date
- `noteplan_get_periodic_note` - Get periodic notes (weekly, monthly, quarterly, yearly)
- `noteplan_get_notes_in_range` - Get notes within a date range
- `noteplan_get_notes_in_folder` - Get notes in a specific folder

### Calendar Events
- `calendar_get_events` - Get calendar events for a date range
- `calendar_create_event` - Create a new calendar event
- `calendar_update_event` - Update an existing calendar event
- `calendar_delete_event` - Delete a calendar event (dryRun + confirmation token)
- `calendar_list_calendars` - List available calendars

### Reminders
- `reminders_get` - Get reminders with optional filtering
- `reminders_create` - Create a new reminder
- `reminders_complete` - Mark a reminder as complete
- `reminders_update` - Update an existing reminder
- `reminders_delete` - Delete a reminder (dryRun + confirmation token)
- `reminders_list_lists` - List available reminder lists

### Filters
- `noteplan_list_filters` - List saved task filters
- `noteplan_get_filter` - Get filter details
- `noteplan_save_filter` - Create or update a task filter
- `noteplan_rename_filter` - Rename a filter
- `noteplan_get_filter_tasks` - Execute a filter and return matching tasks

### UI Operations
- `noteplan_ui_open_note` - Open a note in NotePlan
- `noteplan_ui_open_today` - Open today's note in NotePlan
- `noteplan_ui_search` - Search notes in the NotePlan UI
- `noteplan_ui_run_plugin_command` - Run a specific plugin command
- `noteplan_ui_open_view` - Open a named view
- `noteplan_ui_toggle_sidebar` - Toggle the sidebar
- `noteplan_ui_close_plugin_window` - Close a plugin HTML window
- `noteplan_ui_list_plugin_windows` - List open plugin HTML windows

### Plugin Management
- `noteplan_list_plugins` - List installed plugins with IDs, names, versions, and commands
- `noteplan_create_plugin` - Create a new plugin (plugin.json + script.js)
- `noteplan_delete_plugin` - Delete an installed plugin
- `noteplan_list_available_plugins` - List plugins available from the online repository
- `noteplan_install_plugin` - Install or update a plugin from the repository
- `noteplan_get_plugin_log` - Read console log from the last plugin execution
- `noteplan_get_plugin_source` - Read source files of an installed plugin

### Theme Management
- `noteplan_list_themes` - List available themes (custom and system)
- `noteplan_get_theme` - Get theme details/content
- `noteplan_save_theme` - Create or update a custom theme
- `noteplan_set_theme` - Activate a theme via AppleScript

### Memory
- `noteplan_memory_save` - Save a key-value memory entry (user preferences, formatting rules)
- `noteplan_memory_list` - List all stored memories
- `noteplan_memory_update` - Update an existing memory entry
- `noteplan_memory_delete` - Delete a memory entry

### Search and Discovery
- `noteplan_search` - Search by content, title, filename, or title_or_filename via `searchField`, with optional frontmatter property filters (for example `{"category":"marketing"}`); `query: "*"` runs browse mode (metadata listing, no text matching)
- `noteplan_list_spaces` - List spaces with filtering/pagination
- `noteplan_list_tags` - List tags with filtering/pagination
- `noteplan_list_folders` - List folders with pagination/filtering (default local depth: 1)
- `noteplan_find_folders` - Find likely folder matches by query
- `noteplan_resolve_folder` - Resolve one canonical folder path with confidence/ambiguity output
- `noteplan_create_folder` - Create folders (local path mode, or TeamSpace `space + name + parent`)
- `noteplan_move_folder` - Move folders (local or TeamSpace references) (dryRun + confirmation token)
- `noteplan_rename_folder` - Rename folders in place (local or TeamSpace references) (dryRun + confirmation token)
- `noteplan_resolve_note` - Resolve one canonical note target with confidence/ambiguity output
- `noteplan_search_tools` - Search tool catalog by keyword and return small ranked matches
- `noteplan_get_tool_details` - Fetch full descriptions/input schemas on demand for selected tools (max 10 names/call)

### Embeddings (opt-in)
- `noteplan_embeddings_status` - Show embeddings configuration and index counts
- `noteplan_embeddings_sync` - Build/refresh local embeddings index from notes
- `noteplan_embeddings_search` - Semantic similarity search over indexed chunks; returns preview payload by default, full chunk text only with `includeText=true`
- `noteplan_embeddings_reset` - Clear embeddings index data (dryRun + confirmation token)

## Preferred Usage Flow

Prefer granular edits to avoid large context payloads and accidental full-note rewrites.

1. Resolve target note: `noteplan_resolve_note`
2. Inspect/find target content:
   - `noteplan_search_paragraphs` for text lookup inside the note
   - `noteplan_get_paragraphs` for precise line references and pagination
3. Apply targeted mutation:
   - `noteplan_edit_line` for one-line changes
   - `noteplan_insert_content` for adding content at a position
   - `noteplan_delete_lines` for removals
4. Use `noteplan_update_note` only when a full rewrite is intentional (`fullReplace=true`)
5. Run destructive operations in 2 steps:
   - Step 1: call with `dryRun=true` and collect `confirmationToken`
   - Step 2: execute with that `confirmationToken`
6. To restore deleted notes, call `noteplan_restore_note` with the `id`/`filename` returned by `noteplan_delete_note`

Delete operations (`noteplan_delete_note`, `noteplan_delete_lines`, `calendar_delete_event`, `reminders_delete`) require a dryRun-issued `confirmationToken`.
Move/rename/restore operations (`noteplan_move_note`, `noteplan_rename_note_file`, `noteplan_restore_note`) also require a dryRun-issued `confirmationToken`.

Task flow (recommended):
1. Find tasks:
  - one note: `noteplan_get_tasks` or `noteplan_search_tasks`
  - across notes: `noteplan_search_tasks_global`
2. Apply targeted mutation:
  - `noteplan_complete_task` for done status
  - `noteplan_update_task` for content/status edits

Property-filtered discovery example:
- Call `noteplan_search` with `query` plus `propertyFilters`, e.g. `query: "campaign", propertyFilters: {"category":"marketing"}`
- Property filters match frontmatter keys/values (all filters must match)
- Folder filters accept canonical paths (for example `20 - Areas`) and also accept `Notes/` prefixes.

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
