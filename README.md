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
- **Safer TeamSpace Deletes**: TeamSpace deletes now move notes into TeamSpace `@Trash` and normal list/search excludes trash by default
- **Optional Semantic Index**: Local embeddings index + semantic search tools (disabled by default; explicit opt-in)

## Installation

```bash
cd noteplan-mcp
npm install
npm run build
npm run smoke:workflow
```

## Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "noteplan": {
      "command": "node",
      "args": ["/path/to/noteplan-mcp/dist/index.js"],
      "env": {
        "NOTEPLAN_EMBEDDINGS_ENABLED": "false"
      }
    }
  }
}
```

Optional embeddings configuration (only when you explicitly want semantic search):

```json
{
  "mcpServers": {
    "noteplan": {
      "command": "node",
      "args": ["/path/to/noteplan-mcp/dist/index.js"],
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

Embeddings env notes:
- `NOTEPLAN_EMBEDDINGS_PROVIDER`: `openai` (default), `mistral`, or `custom`.
- `NOTEPLAN_EMBEDDINGS_BASE_URL`: for `custom`, assumes OpenAI-compatible `/v1/embeddings`.
- `NOTEPLAN_EMBEDDINGS_ENABLED`: defaults to `false`; when false, embeddings tools are not listed.

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

### Task Operations
- `noteplan_get_tasks` - Get tasks from one note (id/title/filename/date) with filtering/pagination
- `noteplan_search_tasks` - Find matching task lines in one note for targeted updates
- `noteplan_search_tasks_global` - Search task lines across notes and return note+line references
- `noteplan_add_task` - Add task to a note
- `noteplan_complete_task` - Mark task as done (accepts `lineIndex` 0-based or `line` 1-based)
- `noteplan_update_task` - Update task content/status (accepts `lineIndex` 0-based or `line` 1-based)

### Calendar Operations
- `noteplan_get_today` - Get today's daily note
- `noteplan_add_to_today` - Add content to today
- `noteplan_get_calendar_note` - Get note for specific date

### Metadata
- `noteplan_search` - Search by content, title, filename, or title_or_filename via `searchField`, with optional frontmatter property filters (for example `{"category":"marketing"}`); `query: "*"` runs browse mode (metadata listing, no text matching)
- `noteplan_embeddings_status` - Show embeddings configuration and index counts (only when embeddings are enabled)
- `noteplan_embeddings_sync` - Build/refresh local embeddings index from notes (only when embeddings are enabled)
- `noteplan_embeddings_search` - Semantic similarity search over indexed chunks; returns preview payload by default, full chunk text only with `includeText=true`
- `noteplan_embeddings_reset` - Clear embeddings index data (dryRun + confirmation token)
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

## License

MIT
