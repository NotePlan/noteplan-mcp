// MCP Server with tool registration

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import tool implementations
import * as noteTools from './tools/notes.js';
import * as searchTools from './tools/search.js';
import * as taskTools from './tools/tasks.js';
import * as calendarTools from './tools/calendar.js';
import * as teamspaceTools from './tools/teamspaces.js';
import * as eventTools from './tools/events.js';
import * as reminderTools from './tools/reminders.js';

// Create the server
export function createServer(): Server {
  const server = new Server(
    {
      name: 'noteplan-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // Note operations
        {
          name: 'noteplan_get_note',
          description: 'Get a note by title, filename, or date. Returns the note content and metadata.',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Note title to search for',
              },
              filename: {
                type: 'string',
                description: 'Direct filename/path to the note',
              },
              date: {
                type: 'string',
                description: 'Date for calendar notes (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)',
              },
              teamspace: {
                type: 'string',
                description: 'Teamspace ID to search in',
              },
            },
          },
        },
        {
          name: 'noteplan_list_notes',
          description: 'List all project notes, optionally filtered by folder or teamspace.',
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description: 'Filter by folder path',
              },
              teamspace: {
                type: 'string',
                description: 'Teamspace ID to list from',
              },
            },
          },
        },
        {
          name: 'noteplan_create_note',
          description: `Create a new project note.

FOLDER MATCHING: If the user specifies a vague folder name (like "projects" or "inbox"), first call noteplan_list_folders to see available folders. If multiple folders could match, ASK THE USER to clarify which one they mean before creating the note.

FRONTMATTER/PROPERTIES: NotePlan notes support YAML frontmatter for styling and metadata. You are ENCOURAGED to add properties when creating notes to make them visually distinctive. Start the content with frontmatter between --- delimiters, BEFORE the title heading.

Available frontmatter properties:
- icon: FontAwesome icon name (e.g., "seedling", "rocket", "star", "lightbulb", "book", "code", "heart")
- icon-color: Tailwind color for the icon. Use 500 shades for best visibility (e.g., "red-500", "blue-500", "green-500", "purple-500")
- icon-style: "regular" (default), "solid", or "light"
- bg-color: Light mode background. Use light shades 50-200 (e.g., "red-50", "blue-100")
- bg-color-dark: Dark mode background. Use dark shades 800-950 (e.g., "red-950", "blue-900")
- bg-pattern: Background pattern - "dotted", "lined", "squared", or "mini-squared"
- status: "To-Do", "Doing", or "Done"
- priority: "High", "Medium", or "Low"
- summary: Brief description of the note's purpose
- type: Note category (e.g., "Strategy", "Meeting", "Project", "Idea")
- domain: Context/area (e.g., "work", "personal", "noteplan")
- order: Number for manual ordering

Tailwind colors: slate, gray, zinc, neutral, stone, red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose

Example note content with frontmatter:
---
icon: rocket
icon-color: blue-500
bg-color: blue-50
bg-color-dark: blue-950
status: To-Do
type: Project
summary: Launch the new feature
---
# Project Launch Plan

Content here...

If the user explicitly requests a "plain note" or "note without properties", omit the frontmatter.`,
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Title for the new note',
              },
              content: {
                type: 'string',
                description: 'Initial content for the note. Can include YAML frontmatter between --- delimiters at the start for styling (icon, colors, etc.)',
              },
              folder: {
                type: 'string',
                description: 'Folder path to create the note in. Use the exact path from noteplan_list_folders for best results. Supports smart matching but may be ambiguous if multiple folders have similar names.',
              },
              create_new_folder: {
                type: 'boolean',
                description: 'Set to true to bypass smart matching and create a new folder with the exact name provided',
              },
              teamspace: {
                type: 'string',
                description: 'Teamspace ID to create in',
              },
            },
            required: ['title'],
          },
        },
        {
          name: 'noteplan_update_note',
          description: `Update the content of an existing note. When updating, preserve or modify the YAML frontmatter (properties) at the start of the note.

If the user asks to "change the icon", "add properties", "change the background color", etc., modify the frontmatter section between --- delimiters. See noteplan_create_note for available frontmatter properties.

Example: To change just the icon of a note, read it first, then update with modified frontmatter while preserving the rest of the content.`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note to update',
              },
              content: {
                type: 'string',
                description: 'New content for the note. Include frontmatter between --- delimiters at the start if the note has or should have properties.',
              },
            },
            required: ['filename', 'content'],
          },
        },
        {
          name: 'noteplan_delete_note',
          description: 'Delete a note (moves to trash).',
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note to delete',
              },
            },
            required: ['filename'],
          },
        },

        // Note structure
        {
          name: 'noteplan_get_paragraphs',
          description: `Get a note's content with line numbers.

Returns each line with:
- line: 1-indexed line number (for display/user communication)
- lineIndex: 0-indexed line number (use this for API calls like complete_task, delete_lines)
- content: the text content of that line

Use this when you need to:
- See exactly which line contains what content
- Find the correct lineIndex for task operations
- Determine line numbers for insert_content or delete_lines`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
            },
            required: ['filename'],
          },
        },

        // Granular note operations
        {
          name: 'noteplan_set_property',
          description: `Set or update a single frontmatter property without rewriting the entire note.

Use this when the user wants to:
- Change the icon: set_property(filename, "icon", "rocket")
- Change background color: set_property(filename, "bg-color", "blue-50")
- Set status: set_property(filename, "status", "Doing")
- Add any frontmatter property

This is SAFER and MORE EFFICIENT than reading and rewriting the whole note.
The server handles parsing, updating, and writing back the content.
If the note has no frontmatter, it will be created.`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              key: {
                type: 'string',
                description: 'Property key (e.g., "icon", "bg-color", "status", "priority")',
              },
              value: {
                type: 'string',
                description: 'Property value',
              },
            },
            required: ['filename', 'key', 'value'],
          },
        },
        {
          name: 'noteplan_remove_property',
          description: `Remove a frontmatter property from a note.

Use this when the user wants to:
- Remove the background pattern
- Clear the icon
- Remove any property from the frontmatter

This is SAFER than reading and rewriting the whole note.`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              key: {
                type: 'string',
                description: 'Property key to remove',
              },
            },
            required: ['filename', 'key'],
          },
        },
        {
          name: 'noteplan_insert_content',
          description: `Insert content at a specific position in a note without rewriting the entire note.

Positions:
- "start": After frontmatter (if present), at beginning of body
- "end": At the end of the note
- "after-heading": After a specific heading (requires heading parameter)
- "at-line": At a specific line number (requires line parameter, 1-indexed)

Use this when the user wants to:
- Add a paragraph under a heading
- Insert content at a specific location
- Add content at the start without touching frontmatter

This is SAFER than reading and rewriting the whole note.`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              content: {
                type: 'string',
                description: 'Content to insert',
              },
              position: {
                type: 'string',
                enum: ['start', 'end', 'after-heading', 'at-line'],
                description: 'Where to insert the content',
              },
              heading: {
                type: 'string',
                description: 'Heading name (required for after-heading position)',
              },
              line: {
                type: 'number',
                description: 'Line number, 1-indexed (required for at-line position)',
              },
            },
            required: ['filename', 'content', 'position'],
          },
        },
        {
          name: 'noteplan_append_content',
          description: `Append content to the end of any note.

Use this when the user wants to add content to the end of a note.
This is a shorthand for insert_content with position="end".

This is SAFER than reading and rewriting the whole note.`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              content: {
                type: 'string',
                description: 'Content to append',
              },
            },
            required: ['filename', 'content'],
          },
        },
        {
          name: 'noteplan_delete_lines',
          description: `Delete specific lines from a note.

Lines are 1-indexed and inclusive. For example, deleteLines(10, 12) removes lines 10, 11, and 12.

Use this when the user wants to:
- Remove specific lines from a note
- Delete a section of content

This is SAFER than reading and rewriting the whole note.`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              startLine: {
                type: 'number',
                description: 'First line to delete (1-indexed, inclusive)',
              },
              endLine: {
                type: 'number',
                description: 'Last line to delete (1-indexed, inclusive)',
              },
            },
            required: ['filename', 'startLine', 'endLine'],
          },
        },
        {
          name: 'noteplan_edit_line',
          description: `Edit a specific line in a note without rewriting the entire note.

Use this when the user wants to:
- Cross out / strikethrough text: wrap with ~~text~~
- Change formatting on a specific line
- Modify a bullet point or paragraph
- Add or remove markdown formatting

FIRST call noteplan_get_paragraphs to see the line numbers, then call this tool.

Example: To cross out "Buy milk" on line 5:
1. Get current line content via noteplan_get_paragraphs
2. Call noteplan_edit_line with line=5, content="~~Buy milk~~"

This is SAFER than noteplan_update_note which replaces the entire note.`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              line: {
                type: 'number',
                description: 'Line number to edit (1-indexed)',
              },
              content: {
                type: 'string',
                description: 'New content for the line (include any markdown formatting)',
              },
            },
            required: ['filename', 'line', 'content'],
          },
        },

        // Search
        {
          name: 'noteplan_search',
          description: 'Full-text search across all notes (local and teamspace).',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query string',
              },
              types: {
                type: 'array',
                items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
                description: 'Filter by note types',
              },
              folders: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by folders',
              },
              teamspace: {
                type: 'string',
                description: 'Teamspace ID to search in',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results (default: 20)',
              },
            },
            required: ['query'],
          },
        },

        // Task operations
        {
          name: 'noteplan_get_tasks',
          description: 'Get all tasks from a specific note, optionally filtered by status.',
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              status: {
                type: 'string',
                enum: ['open', 'done', 'cancelled', 'scheduled'],
                description: 'Filter by task status',
              },
            },
            required: ['filename'],
          },
        },
        {
          name: 'noteplan_add_task',
          description: `Add a new task to a note. This tool WILL CREATE the daily note if it doesn't exist yet.

IMPORTANT - SMART TASK PLACEMENT:
Before adding a task, FIRST check the note's structure using noteplan_get_paragraphs or noteplan_get_note to see its headings. Then:
1. Look for task-related headings like "Tasks", "To-Do", "Todo", "Action Items", "Today", or similar
2. If found, use position="after-heading" with that heading name
3. If no task heading exists but there are other headings, consider the context (e.g., add work tasks under "Work", personal under "Personal")
4. Only use position="end" if the note has no headings or no suitable section

Example workflow:
1. Call noteplan_get_paragraphs to see the note structure
2. Identify heading like "## Tasks" or "## Today"
3. Call noteplan_add_task with position="after-heading" and heading="Tasks"

SCHEDULING TASKS: When the user wants to schedule a task for a specific date (e.g., "add this task to next Monday", "schedule this for February 7th"), the PREFERRED approach is to add the task directly to that date's daily note. The daily note will be created automatically if it doesn't exist.

Target can be:
- A date: "today", "tomorrow", "yesterday", "YYYY-MM-DD", "YYYYMMDD" → adds to that daily note (creates it if needed)
- A filename: "Notes/Projects/MyProject.md" → adds to that project note

DO NOT use the >YYYY-MM-DD scheduling syntax unless the user explicitly wants the task stored in a project note. The preferred approach is always to add directly to the target date's daily note.`,
          inputSchema: {
            type: 'object',
            properties: {
              target: {
                type: 'string',
                description: 'Target: a date (today, tomorrow, YYYY-MM-DD, YYYYMMDD) for daily notes (will be created if needed), OR a filename for project notes',
              },
              content: {
                type: 'string',
                description: 'Task content (without the checkbox marker)',
              },
              position: {
                type: 'string',
                enum: ['start', 'end', 'after-heading'],
                description: 'Where to add the task (default: end)',
              },
              heading: {
                type: 'string',
                description: 'Heading to add task under (when position is after-heading)',
              },
              teamspace: {
                type: 'string',
                description: 'Teamspace ID when targeting daily notes',
              },
            },
            required: ['target', 'content'],
          },
        },
        {
          name: 'noteplan_complete_task',
          description: 'Mark a task as done.',
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              lineIndex: {
                type: 'number',
                description: 'Line index of the task (0-based)',
              },
            },
            required: ['filename', 'lineIndex'],
          },
        },
        {
          name: 'noteplan_update_task',
          description: `Update a task's content or status.

Use status="cancelled" to cross out/strikethrough a task (changes [ ] to [-]).
Use status="done" to mark complete (changes [ ] to [x]).
Use status="open" to uncheck a task.

For crossing out NON-TASK text (regular bullets or paragraphs), use noteplan_edit_line instead with ~~strikethrough~~ markdown.`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              lineIndex: {
                type: 'number',
                description: 'Line index of the task (0-based)',
              },
              content: {
                type: 'string',
                description: 'New task content',
              },
              status: {
                type: 'string',
                enum: ['open', 'done', 'cancelled', 'scheduled'],
                description: 'New task status',
              },
            },
            required: ['filename', 'lineIndex'],
          },
        },

        // Calendar operations
        {
          name: 'noteplan_get_today',
          description: 'Get today\'s daily note. Creates it if it doesn\'t exist.',
          inputSchema: {
            type: 'object',
            properties: {
              teamspace: {
                type: 'string',
                description: 'Teamspace ID to get today from',
              },
            },
          },
        },
        {
          name: 'noteplan_add_to_today',
          description: 'Add content to today\'s daily note.',
          inputSchema: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'Content to add to today\'s note',
              },
              position: {
                type: 'string',
                enum: ['start', 'end'],
                description: 'Where to add the content (default: end)',
              },
              teamspace: {
                type: 'string',
                description: 'Teamspace ID',
              },
            },
            required: ['content'],
          },
        },
        {
          name: 'noteplan_get_calendar_note',
          description: 'Get the daily note for a specific date.',
          inputSchema: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description: 'Date in YYYYMMDD, YYYY-MM-DD format, or "today", "tomorrow", "yesterday"',
              },
              teamspace: {
                type: 'string',
                description: 'Teamspace ID',
              },
            },
            required: ['date'],
          },
        },
        {
          name: 'noteplan_get_periodic_note',
          description: `Get a weekly, monthly, quarterly, or yearly note.

IMPORTANT: NotePlan users plan and review at different time scales. When the user asks about plans, goals, reviews, or summaries for a specific period, CHECK THE CORRESPONDING PERIODIC NOTE.

HOW TO SPECIFY THE PERIOD:
- For "this week/month/quarter/year" → just set type, no other params needed (uses current date)
- For "last week" → set type=weekly, date=(today minus 7 days in YYYY-MM-DD format)
- For "last month" → set type=monthly, date=(first day of previous month)
- For specific week → set type=weekly, week=NUMBER, year=CURRENT_YEAR
- For specific month → set type=monthly, month=NUMBER, year=CURRENT_YEAR

CRITICAL: Always use the CURRENT year unless user explicitly mentions a different year. "Last week" and "last month" are still in the CURRENT year (unless it's January and last month was December of previous year).

Examples (assuming current date):
- "this week" → type=weekly
- "last week" → type=weekly, date=(7 days ago)
- "week 4" → type=weekly, week=4, year=(current year)
- "this month" → type=monthly
- "last month" → type=monthly, date=(any date from previous month)
- "Q1 goals" → type=quarterly, quarter=1, year=(current year)

File formats: YYYY-Www.txt (weekly), YYYY-MM.txt (monthly), YYYY-Qq.txt (quarterly), YYYY.txt (yearly)`,
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['weekly', 'monthly', 'quarterly', 'yearly'],
                description: 'Type of periodic note',
              },
              date: {
                type: 'string',
                description: 'Reference date (YYYY-MM-DD). Use direct params (week, month, etc.) instead when possible.',
              },
              week: {
                type: 'number',
                description: 'For weekly: week number 1-53 (use with year)',
              },
              month: {
                type: 'number',
                description: 'For monthly: month number 1-12 (use with year)',
              },
              quarter: {
                type: 'number',
                description: 'For quarterly: quarter 1-4 (use with year)',
              },
              year: {
                type: 'number',
                description: 'Year (e.g., 2025). Defaults to current year.',
              },
              teamspace: {
                type: 'string',
                description: 'Teamspace ID',
              },
            },
            required: ['type'],
          },
        },
        {
          name: 'noteplan_get_notes_in_range',
          description: `Get multiple DAILY notes in a date range.

NOTE: This returns the collection of daily notes, NOT the periodic planning note.
- For "what did I DO this week" → use this tool (gets all daily notes)
- For "what did I PLAN for this week" → use noteplan_get_periodic_note instead

Use this to summarize what actually happened:
- "What did I accomplish this week?" → get daily notes with includeContent=true
- "Summarize my activities last month" → get daily notes for last-month
- "What tasks did I complete this week?" → get daily notes

Periods:
- "this-week": All daily notes from current week
- "last-week": All daily notes from previous week
- "this-month": All daily notes from current month
- "last-month": All daily notes from previous month
- "custom": Specify startDate and endDate

Set includeContent=true to get full content for AI summarization.`,
          inputSchema: {
            type: 'object',
            properties: {
              period: {
                type: 'string',
                enum: ['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month', 'custom'],
                description: 'Predefined period or "custom"',
              },
              startDate: {
                type: 'string',
                description: 'Start date for custom range (YYYY-MM-DD)',
              },
              endDate: {
                type: 'string',
                description: 'End date for custom range (YYYY-MM-DD)',
              },
              includeContent: {
                type: 'boolean',
                description: 'Include full note content (default: false)',
              },
              teamspace: {
                type: 'string',
                description: 'Teamspace ID',
              },
            },
            required: ['period'],
          },
        },
        {
          name: 'noteplan_get_notes_in_folder',
          description: `Get all notes in a folder with optional content.

Use this to summarize or review project notes:
- Get all notes in a folder
- Optionally include full content for summarization
- Limited to 50 notes by default

Set includeContent=true for full content (use with smaller folders or for summarization tasks).`,
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description: 'Folder path (e.g., "Projects", "10 - Projects")',
              },
              includeContent: {
                type: 'boolean',
                description: 'Include full note content (default: false)',
              },
              limit: {
                type: 'number',
                description: 'Max notes to return (default: 50)',
              },
            },
            required: ['folder'],
          },
        },

        // Teamspace & metadata operations
        {
          name: 'noteplan_list_teamspaces',
          description: 'List all available teamspaces.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'noteplan_list_tags',
          description: 'List all hashtags used across notes.',
          inputSchema: {
            type: 'object',
            properties: {
              teamspace: {
                type: 'string',
                description: 'Teamspace ID to list tags from',
              },
            },
          },
        },
        {
          name: 'noteplan_list_folders',
          description: 'List all folders in the notes directory. IMPORTANT: Call this BEFORE creating a note if the user mentions a folder by a partial or informal name (like "projects", "inbox", "resources"). This lets you see the actual folder structure and ask the user to clarify if multiple folders could match.',
          inputSchema: {
            type: 'object',
            properties: {
              teamspace: {
                type: 'string',
                description: 'Teamspace ID to list folders from',
              },
            },
          },
        },

        // macOS Calendar events
        {
          name: 'calendar_get_events',
          description: `Get calendar events from macOS Calendar app.

Use this to see events for today, tomorrow, or a date range.
For "this week", use days=7.`,
          inputSchema: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description: 'Date to get events for (YYYY-MM-DD, "today", "tomorrow"). Defaults to today.',
              },
              days: {
                type: 'number',
                description: 'Number of days to fetch (default: 1, use 7 for this week)',
              },
              calendar: {
                type: 'string',
                description: 'Filter by calendar name',
              },
            },
          },
        },
        {
          name: 'calendar_create_event',
          description: `Create a new event in macOS Calendar.

For all-day events, just provide a date without time (YYYY-MM-DD).
For timed events, include time (YYYY-MM-DD HH:MM).`,
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Event title',
              },
              startDate: {
                type: 'string',
                description: 'Start date/time (YYYY-MM-DD HH:MM or YYYY-MM-DD for all-day)',
              },
              endDate: {
                type: 'string',
                description: 'End date/time (defaults to 1 hour after start)',
              },
              calendar: {
                type: 'string',
                description: 'Calendar name (defaults to default calendar)',
              },
              location: {
                type: 'string',
                description: 'Event location',
              },
              notes: {
                type: 'string',
                description: 'Event notes',
              },
              allDay: {
                type: 'boolean',
                description: 'Whether this is an all-day event',
              },
            },
            required: ['title', 'startDate'],
          },
        },
        {
          name: 'calendar_update_event',
          description: 'Update an existing calendar event. Get the eventId from calendar_get_events.',
          inputSchema: {
            type: 'object',
            properties: {
              eventId: {
                type: 'string',
                description: 'Event ID (from calendar_get_events)',
              },
              title: {
                type: 'string',
                description: 'New event title',
              },
              startDate: {
                type: 'string',
                description: 'New start date/time',
              },
              endDate: {
                type: 'string',
                description: 'New end date/time',
              },
              location: {
                type: 'string',
                description: 'New location',
              },
              notes: {
                type: 'string',
                description: 'New notes',
              },
            },
            required: ['eventId'],
          },
        },
        {
          name: 'calendar_delete_event',
          description: 'Delete a calendar event. Get the eventId from calendar_get_events.',
          inputSchema: {
            type: 'object',
            properties: {
              eventId: {
                type: 'string',
                description: 'Event ID to delete',
              },
            },
            required: ['eventId'],
          },
        },
        {
          name: 'calendar_list_calendars',
          description: 'List all calendars in macOS Calendar app.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },

        // macOS Reminders
        {
          name: 'reminders_get',
          description: `Get reminders from macOS Reminders app.

By default, returns only incomplete reminders. Set includeCompleted=true to see all.`,
          inputSchema: {
            type: 'object',
            properties: {
              list: {
                type: 'string',
                description: 'Filter by reminder list name',
              },
              includeCompleted: {
                type: 'boolean',
                description: 'Include completed reminders (default: false)',
              },
            },
          },
        },
        {
          name: 'reminders_create',
          description: `Create a new reminder in macOS Reminders app.

Priority levels: 0 (none), 1 (high), 5 (medium), 9 (low).`,
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Reminder title',
              },
              list: {
                type: 'string',
                description: 'Reminder list name (defaults to default list)',
              },
              dueDate: {
                type: 'string',
                description: 'Due date (YYYY-MM-DD or YYYY-MM-DD HH:MM)',
              },
              notes: {
                type: 'string',
                description: 'Reminder notes',
              },
              priority: {
                type: 'number',
                description: 'Priority: 0 (none), 1 (high), 5 (medium), 9 (low)',
              },
            },
            required: ['title'],
          },
        },
        {
          name: 'reminders_complete',
          description: 'Mark a reminder as complete. Get the reminderId from reminders_get.',
          inputSchema: {
            type: 'object',
            properties: {
              reminderId: {
                type: 'string',
                description: 'Reminder ID to mark as complete',
              },
            },
            required: ['reminderId'],
          },
        },
        {
          name: 'reminders_update',
          description: 'Update an existing reminder. Get the reminderId from reminders_get.',
          inputSchema: {
            type: 'object',
            properties: {
              reminderId: {
                type: 'string',
                description: 'Reminder ID (from reminders_get)',
              },
              title: {
                type: 'string',
                description: 'New title',
              },
              dueDate: {
                type: 'string',
                description: 'New due date',
              },
              notes: {
                type: 'string',
                description: 'New notes',
              },
              priority: {
                type: 'number',
                description: 'New priority',
              },
            },
            required: ['reminderId'],
          },
        },
        {
          name: 'reminders_delete',
          description: 'Delete a reminder. Get the reminderId from reminders_get.',
          inputSchema: {
            type: 'object',
            properties: {
              reminderId: {
                type: 'string',
                description: 'Reminder ID to delete',
              },
            },
            required: ['reminderId'],
          },
        },
        {
          name: 'reminders_list_lists',
          description: 'List all reminder lists in macOS Reminders app.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        // Note operations
        case 'noteplan_get_note':
          result = noteTools.getNote(args as any);
          break;
        case 'noteplan_list_notes':
          result = noteTools.listNotes(args as any);
          break;
        case 'noteplan_create_note':
          result = noteTools.createNote(args as any);
          break;
        case 'noteplan_update_note':
          result = noteTools.updateNote(args as any);
          break;
        case 'noteplan_delete_note':
          result = noteTools.deleteNote(args as any);
          break;

        // Note structure
        case 'noteplan_get_paragraphs':
          result = noteTools.getParagraphs(args as any);
          break;

        // Granular note operations
        case 'noteplan_set_property':
          result = noteTools.setProperty(args as any);
          break;
        case 'noteplan_remove_property':
          result = noteTools.removeProperty(args as any);
          break;
        case 'noteplan_insert_content':
          result = noteTools.insertContent(args as any);
          break;
        case 'noteplan_append_content':
          result = noteTools.appendContent(args as any);
          break;
        case 'noteplan_delete_lines':
          result = noteTools.deleteLines(args as any);
          break;
        case 'noteplan_edit_line':
          result = noteTools.editLine(args as any);
          break;

        // Search
        case 'noteplan_search':
          result = searchTools.searchNotes(args as any);
          break;

        // Task operations
        case 'noteplan_get_tasks':
          result = taskTools.getTasks(args as any);
          break;
        case 'noteplan_add_task':
          result = taskTools.addTaskToNote(args as any);
          break;
        case 'noteplan_complete_task':
          result = taskTools.completeTask(args as any);
          break;
        case 'noteplan_update_task':
          result = taskTools.updateTask(args as any);
          break;

        // Calendar operations
        case 'noteplan_get_today':
          result = calendarTools.getToday(args as any);
          break;
        case 'noteplan_add_to_today':
          result = calendarTools.addToToday(args as any);
          break;
        case 'noteplan_get_calendar_note':
          result = calendarTools.getCalendarNote(args as any);
          break;
        case 'noteplan_get_periodic_note':
          result = calendarTools.getPeriodicNote(args as any);
          break;
        case 'noteplan_get_notes_in_range':
          result = calendarTools.getNotesInRange(args as any);
          break;
        case 'noteplan_get_notes_in_folder':
          result = calendarTools.getNotesInFolder(args as any);
          break;

        // Teamspace & metadata operations
        case 'noteplan_list_teamspaces':
          result = teamspaceTools.listTeamspaces(args as any);
          break;
        case 'noteplan_list_tags':
          result = teamspaceTools.listTags(args as any);
          break;
        case 'noteplan_list_folders':
          result = teamspaceTools.listFolders(args as any);
          break;

        // macOS Calendar events
        case 'calendar_get_events':
          result = eventTools.getEvents(args as any);
          break;
        case 'calendar_create_event':
          result = eventTools.createEvent(args as any);
          break;
        case 'calendar_update_event':
          result = eventTools.updateEvent(args as any);
          break;
        case 'calendar_delete_event':
          result = eventTools.deleteEvent(args as any);
          break;
        case 'calendar_list_calendars':
          result = eventTools.listCalendars(args as any);
          break;

        // macOS Reminders
        case 'reminders_get':
          result = reminderTools.getReminders(args as any);
          break;
        case 'reminders_create':
          result = reminderTools.createReminder(args as any);
          break;
        case 'reminders_complete':
          result = reminderTools.completeReminder(args as any);
          break;
        case 'reminders_update':
          result = reminderTools.updateReminder(args as any);
          break;
        case 'reminders_delete':
          result = reminderTools.deleteReminder(args as any);
          break;
        case 'reminders_list_lists':
          result = reminderTools.listReminderLists(args as any);
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// Start the server with stdio transport
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('NotePlan MCP server running on stdio');
}
