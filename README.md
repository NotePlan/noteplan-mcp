# NotePlan MCP Server

An MCP (Model Context Protocol) server that exposes NotePlan's note and task management functionality to Claude Desktop.

## Features

- **Unified Access**: Search and manage both local notes (file system) and teamspace notes (SQLite)
- **Full CRUD**: Create, read, update, and delete notes
- **Task Management**: Add, complete, and update tasks
- **Calendar Notes**: Access daily notes by date
- **Search**: Full-text search across all notes
- **Progressive Tool Discovery**: `tools/list` is paginated and detailed schemas are fetched on demand
- **Structured Errors**: Tool failures include machine-readable `code` plus `hint`/`suggestedTool`
- **Fast Repeated Lookups**: Short-lived in-memory caching for expensive list/resolve paths
- **Opt-in Timing Telemetry**: `debugTimings=true` adds `durationMs`; heavy discovery tools also add `stageTimings`
- **Adaptive Performance Hints**: Slow discovery/search responses include `performanceHints` with narrowing suggestions

## Installation

```bash
cd noteplan-mcp
npm install
npm run build
```

## Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "noteplan": {
      "command": "node",
      "args": ["/path/to/noteplan-mcp/dist/index.js"]
    }
  }
}
```

## Available Tools

### Note Operations
- `noteplan_get_note` - Get note metadata by title/filename/date, with optional paged content retrieval
- `noteplan_list_notes` - List notes with filtering/pagination
- `noteplan_create_note` - Create a new note
- `noteplan_update_note` - Replace full note content (prefer targeted paragraph/line tools when possible)
- `noteplan_delete_note` - Delete a note

### Note Structure and Granular Edits
- `noteplan_get_paragraphs` - Get paged line/paragraph content with line references
- `noteplan_search_paragraphs` - Find matching lines/paragraph blocks inside a note
- `noteplan_edit_line` - Update one specific line
- `noteplan_insert_content` - Insert content at start/end/heading/line
- `noteplan_delete_lines` - Delete a line range

### Task Operations
- `noteplan_get_tasks` - Get tasks from a note
- `noteplan_add_task` - Add task to a note
- `noteplan_complete_task` - Mark task as done
- `noteplan_update_task` - Update task content/status

### Calendar Operations
- `noteplan_get_today` - Get today's daily note
- `noteplan_add_to_today` - Add content to today
- `noteplan_get_calendar_note` - Get note for specific date

### Metadata
- `noteplan_search` - Full-text search
- `noteplan_list_spaces` - List spaces with filtering/pagination
- `noteplan_list_tags` - List tags with filtering/pagination
- `noteplan_list_folders` - List folders with pagination/filtering (default local depth: 1)
- `noteplan_find_folders` - Find likely folder matches by query
- `noteplan_resolve_folder` - Resolve one canonical folder path with confidence/ambiguity output
- `noteplan_resolve_note` - Resolve one canonical note target with confidence/ambiguity output
- `noteplan_search_tools` - Search tool catalog by keyword and return small ranked matches
- `noteplan_get_tool_details` - Fetch full descriptions/input schemas on demand for selected tools (max 10 names/call)

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
4. Use `noteplan_update_note` only when a full rewrite is intentional

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

## License

MIT
