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
import * as spaceTools from './tools/spaces.js';
import * as eventTools from './tools/events.js';
import * as reminderTools from './tools/reminders.js';

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  outputSchema?: Record<string, unknown>;
};

type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

const TOOLS_LIST_PAGE_SIZE = 20;

function outputSchemaWithErrors(properties: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      durationMs: { type: 'number' },
      stageTimings: {
        type: 'object',
        additionalProperties: { type: 'number' },
      },
      performanceHints: {
        type: 'array',
        items: { type: 'string' },
      },
      ...properties,
      error: { type: 'string' },
      code: { type: 'string' },
      hint: { type: 'string' },
      suggestedTool: { type: 'string' },
      retryable: { type: 'boolean' },
    },
    required: ['success'],
  };
}

const GENERIC_TOOL_OUTPUT_SCHEMA = outputSchemaWithErrors();
const MESSAGE_OUTPUT_SCHEMA = outputSchemaWithErrors({ message: { type: 'string' } });
const NOTE_OUTPUT_SCHEMA = outputSchemaWithErrors({ note: { type: 'object' }, created: { type: 'boolean' } });
const NOTES_LIST_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  notes: { type: 'array', items: { type: 'object' } },
});
const RESOLVE_NOTE_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  count: { type: 'number' },
  exactMatch: { type: 'boolean' },
  ambiguous: { type: 'boolean' },
  confidence: { type: 'number' },
  confidenceDelta: { type: 'number' },
  resolved: { type: ['object', 'null'] },
  suggestedGetNoteArgs: { type: ['object', 'null'] },
  candidates: { type: 'array', items: { type: 'object' } },
});
const CREATE_NOTE_OUTPUT_SCHEMA = outputSchemaWithErrors({
  note: { type: 'object' },
  folderResolution: { type: 'object' },
});
const PARAGRAPHS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  note: { type: 'object' },
  lineCount: { type: 'number' },
  lines: { type: 'array', items: { type: 'object' } },
});
const SEARCH_NOTES_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  count: { type: 'number' },
  results: { type: 'array', items: { type: 'object' } },
});
const TASKS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  note: { type: 'object' },
  taskCount: { type: 'number' },
  tasks: { type: 'array', items: { type: 'object' } },
});
const RANGE_NOTES_OUTPUT_SCHEMA = outputSchemaWithErrors({
  period: { type: 'string' },
  startDate: { type: 'string' },
  endDate: { type: 'string' },
  noteCount: { type: 'number' },
  totalDays: { type: 'number' },
  scannedDays: { type: 'number' },
  truncatedByMaxDays: { type: 'boolean' },
  maxDays: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  notes: { type: 'array', items: { type: 'object' } },
});
const FOLDER_NOTES_OUTPUT_SCHEMA = outputSchemaWithErrors({
  folder: { type: 'string' },
  noteCount: { type: 'number' },
  totalInFolder: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  notes: { type: 'array', items: { type: 'object' } },
});
const SPACES_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  spaces: { type: 'array', items: { type: 'object' } },
});
const TAGS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  tags: { type: 'array', items: { type: 'string' } },
});
const LIST_FOLDERS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  maxDepth: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  folders: { type: 'array', items: { type: 'object' } },
});
const FIND_FOLDERS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  maxDepth: { type: 'number' },
  count: { type: 'number' },
  matches: { type: 'array', items: { type: 'object' } },
});
const RESOLVE_FOLDER_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  count: { type: 'number' },
  exactMatch: { type: 'boolean' },
  ambiguous: { type: 'boolean' },
  confidence: { type: 'number' },
  confidenceDelta: { type: 'number' },
  resolved: { type: ['object', 'null'] },
  suggestedToolArgs: { type: ['object', 'null'] },
  candidates: { type: 'array', items: { type: 'object' } },
});
const EVENTS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  startDate: { type: 'string' },
  endDate: { type: 'string' },
  eventCount: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  events: { type: 'array', items: { type: 'object' } },
});
const CALENDARS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  calendars: { type: 'array', items: { type: 'object' } },
});
const REMINDERS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  reminderCount: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  reminders: { type: 'array', items: { type: 'object' } },
});
const REMINDER_LISTS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  lists: { type: 'array', items: { type: 'string' } },
});
const SEARCH_TOOLS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  count: { type: 'number' },
  tools: { type: 'array', items: { type: 'object' } },
});
const GET_TOOL_DETAILS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  missing: { type: 'array', items: { type: 'string' } },
  tools: { type: 'array', items: { type: 'object' } },
});

function getToolOutputSchema(toolName: string): Record<string, unknown> {
  switch (toolName) {
    case 'noteplan_get_note':
    case 'noteplan_get_today':
    case 'noteplan_get_calendar_note':
    case 'noteplan_get_periodic_note':
      return NOTE_OUTPUT_SCHEMA;
    case 'noteplan_list_notes':
      return NOTES_LIST_OUTPUT_SCHEMA;
    case 'noteplan_resolve_note':
      return RESOLVE_NOTE_OUTPUT_SCHEMA;
    case 'noteplan_create_note':
      return CREATE_NOTE_OUTPUT_SCHEMA;
    case 'noteplan_get_paragraphs':
      return PARAGRAPHS_OUTPUT_SCHEMA;
    case 'noteplan_search':
      return SEARCH_NOTES_OUTPUT_SCHEMA;
    case 'noteplan_get_tasks':
      return TASKS_OUTPUT_SCHEMA;
    case 'noteplan_add_task':
    case 'noteplan_complete_task':
    case 'noteplan_update_task':
    case 'noteplan_update_note':
    case 'noteplan_delete_note':
    case 'noteplan_set_property':
    case 'noteplan_remove_property':
    case 'noteplan_insert_content':
    case 'noteplan_append_content':
    case 'noteplan_delete_lines':
    case 'noteplan_edit_line':
    case 'noteplan_add_to_today':
    case 'calendar_create_event':
    case 'calendar_update_event':
    case 'calendar_delete_event':
    case 'reminders_create':
    case 'reminders_complete':
    case 'reminders_update':
    case 'reminders_delete':
      return MESSAGE_OUTPUT_SCHEMA;
    case 'noteplan_get_notes_in_range':
      return RANGE_NOTES_OUTPUT_SCHEMA;
    case 'noteplan_get_notes_in_folder':
      return FOLDER_NOTES_OUTPUT_SCHEMA;
    case 'noteplan_list_spaces':
      return SPACES_OUTPUT_SCHEMA;
    case 'noteplan_list_tags':
      return TAGS_OUTPUT_SCHEMA;
    case 'noteplan_list_folders':
      return LIST_FOLDERS_OUTPUT_SCHEMA;
    case 'noteplan_find_folders':
      return FIND_FOLDERS_OUTPUT_SCHEMA;
    case 'noteplan_resolve_folder':
      return RESOLVE_FOLDER_OUTPUT_SCHEMA;
    case 'calendar_get_events':
      return EVENTS_OUTPUT_SCHEMA;
    case 'calendar_list_calendars':
      return CALENDARS_OUTPUT_SCHEMA;
    case 'reminders_get':
      return REMINDERS_OUTPUT_SCHEMA;
    case 'reminders_list_lists':
      return REMINDER_LISTS_OUTPUT_SCHEMA;
    case 'noteplan_search_tools':
      return SEARCH_TOOLS_OUTPUT_SCHEMA;
    case 'noteplan_get_tool_details':
      return GET_TOOL_DETAILS_OUTPUT_SCHEMA;
    default:
      return GENERIC_TOOL_OUTPUT_SCHEMA;
  }
}

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function isDebugTimingsEnabled(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const rawValue = (args as Record<string, unknown>).debugTimings;
  if (typeof rawValue === 'boolean') return rawValue;
  if (typeof rawValue === 'string') {
    const normalized = rawValue.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

function withDebugTimingsInputSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
  const schema = { ...inputSchema };
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? { ...(schema.properties as Record<string, unknown>) }
      : {};
  if (!('debugTimings' in properties)) {
    properties.debugTimings = {
      type: 'boolean',
      description: 'Include durationMs timing metadata in response (default: false)',
    };
  }
  schema.properties = properties;
  return schema;
}

function compactDescription(description: string, maxLength = 120): string {
  const firstLine = description
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, Math.max(0, maxLength - 3))}...`;
}

function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripDescriptions(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    if (key === 'description') continue;
    output[key] = stripDescriptions(nested);
  }
  return output;
}

function compactToolDefinition(tool: ToolDefinition): ToolDefinition {
  return {
    name: tool.name,
    description: compactDescription(tool.description),
    inputSchema: stripDescriptions(tool.inputSchema) as Record<string, unknown>,
    annotations: tool.annotations,
    outputSchema: tool.outputSchema,
  };
}

function getToolAnnotations(toolName: string): ToolAnnotations {
  const readOnlyTools = new Set([
    'noteplan_get_note',
    'noteplan_list_notes',
    'noteplan_resolve_note',
    'noteplan_get_paragraphs',
    'noteplan_search',
    'noteplan_get_tasks',
    'noteplan_get_calendar_note',
    'noteplan_get_periodic_note',
    'noteplan_get_notes_in_range',
    'noteplan_get_notes_in_folder',
    'noteplan_list_spaces',
    'noteplan_list_tags',
    'noteplan_list_folders',
    'noteplan_find_folders',
    'noteplan_resolve_folder',
    'noteplan_search_tools',
    'noteplan_get_tool_details',
    'calendar_get_events',
    'calendar_list_calendars',
    'reminders_get',
    'reminders_list_lists',
  ]);

  const destructiveTools = new Set([
    'noteplan_delete_note',
    'noteplan_delete_lines',
    'noteplan_remove_property',
    'noteplan_update_note',
    'noteplan_edit_line',
    'noteplan_update_task',
    'calendar_delete_event',
    'reminders_delete',
  ]);

  const nonIdempotentTools = new Set([
    'noteplan_create_note',
    'noteplan_insert_content',
    'noteplan_append_content',
    'noteplan_delete_note',
    'noteplan_delete_lines',
    'noteplan_add_task',
    'noteplan_add_to_today',
    'calendar_create_event',
    'calendar_delete_event',
    'reminders_create',
    'reminders_delete',
  ]);

  const openWorldTools = new Set([
    'calendar_get_events',
    'calendar_create_event',
    'calendar_update_event',
    'calendar_delete_event',
    'calendar_list_calendars',
    'reminders_get',
    'reminders_create',
    'reminders_complete',
    'reminders_update',
    'reminders_delete',
    'reminders_list_lists',
  ]);

  return {
    readOnlyHint: readOnlyTools.has(toolName),
    destructiveHint: destructiveTools.has(toolName),
    idempotentHint: !nonIdempotentTools.has(toolName),
    openWorldHint: openWorldTools.has(toolName),
  };
}

const QUERY_SYNONYMS: Record<string, string[]> = {
  todo: ['task', 'tasks', 'reminder', 'reminders', 'checklist'],
  tasks: ['task', 'todo', 'reminder'],
  meeting: ['calendar', 'event', 'schedule', 'appointment'],
  events: ['event', 'calendar', 'schedule', 'meeting'],
  workspace: ['space', 'spaces', 'teamspace'],
  teamspace: ['space', 'workspace', 'spaces'],
  folder: ['folders', 'directory', 'path', 'project'],
  projects: ['project', 'folder'],
  resolve: ['disambiguate', 'canonical', 'match'],
  disambiguate: ['resolve', 'canonical', 'match'],
  edit: ['update', 'modify', 'change'],
  delete: ['remove', 'erase', 'clear'],
  create: ['add', 'new', 'make'],
};

function getToolSearchAliases(toolName: string): string[] {
  const aliases: string[] = [];

  if (toolName.startsWith('calendar_')) {
    aliases.push('calendar', 'event', 'events', 'schedule', 'meeting', 'appointment');
  }

  if (toolName.startsWith('reminders_')) {
    aliases.push('reminder', 'reminders', 'todo', 'task', 'checklist');
  }

  if (toolName.includes('resolve_folder')) {
    aliases.push('resolve folder', 'canonical folder', 'disambiguate folder', 'choose folder path');
  }
  if (toolName.includes('resolve_note')) {
    aliases.push('resolve note', 'canonical note', 'disambiguate note', 'choose note target');
  }
  if (toolName.includes('find_folders')) {
    aliases.push('find folder', 'search folder', 'folder lookup');
  }
  if (toolName.includes('list_folders')) {
    aliases.push('list folders', 'browse folders', 'folder tree');
  }
  if (toolName.includes('list_spaces')) {
    aliases.push('list spaces', 'workspaces', 'teamspaces');
  }
  if (toolName.includes('search_tools')) {
    aliases.push('find tool', 'discover tools', 'tool lookup');
  }
  if (toolName.includes('get_tool_details')) {
    aliases.push('tool schema', 'tool details', 'tool arguments');
  }
  if (toolName.includes('get_tasks') || toolName.includes('add_task') || toolName.includes('update_task') || toolName.includes('complete_task')) {
    aliases.push('tasks', 'todos', 'checklist', 'task management');
  }
  if (toolName.includes('get_note') || toolName.includes('list_notes') || toolName.includes('create_note') || toolName.includes('update_note')) {
    aliases.push('notes', 'documents', 'markdown');
  }

  return aliases;
}

function expandQueryTokens(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const expanded = new Set(tokens);
  for (const token of tokens) {
    const synonyms = QUERY_SYNONYMS[token];
    if (!synonyms) continue;
    synonyms.forEach((synonym) => expanded.add(synonym));
  }

  return Array.from(expanded);
}

function scoreToolMatch(tool: ToolDefinition, query: string): number {
  const q = query.toLowerCase();
  const name = tool.name.toLowerCase();
  const description = tool.description.toLowerCase();
  const aliases = getToolSearchAliases(tool.name);
  const aliasText = aliases.join(' ').toLowerCase();
  const searchable = `${name} ${description} ${aliasText}`;
  const queryTokens = expandQueryTokens(q);

  if (name === q) return 1.0;
  if (name.startsWith(q)) return 0.95;
  if (name.includes(q)) return 0.9;
  if (aliases.some((alias) => alias.toLowerCase() === q)) return 0.88;
  if (description.includes(q)) return 0.75;
  if (aliasText.includes(q)) return 0.74;

  if (queryTokens.length === 0) return 0;
  const tokenHits = queryTokens.filter((token) => searchable.includes(token)).length;
  return tokenHits > 0 ? tokenHits / queryTokens.length * 0.62 : 0;
}

function searchToolDefinitions(
  tools: ToolDefinition[],
  query: string,
  limit: number
): Array<{ tool: ToolDefinition; score: number }> {
  return tools
    .map((tool) => ({ tool, score: scoreToolMatch(tool, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
      return a.tool.name.localeCompare(b.tool.name);
    })
    .slice(0, limit);
}

type ToolErrorMeta = {
  code: string;
  hint?: string;
  suggestedTool?: string;
  retryable?: boolean;
};

function inferToolErrorMeta(toolName: string, errorMessage: string): ToolErrorMeta {
  const message = errorMessage.toLowerCase();

  if (message.includes('unknown tool')) {
    return {
      code: 'ERR_UNKNOWN_TOOL',
      hint: 'Use noteplan_search_tools to find the right tool name first.',
      suggestedTool: 'noteplan_search_tools',
    };
  }

  if (message.includes('query is required')) {
    return {
      code: 'ERR_QUERY_REQUIRED',
      hint: 'Provide a non-empty query string to run this operation.',
    };
  }

  if (message.includes('names must include at least one tool name')) {
    return {
      code: 'ERR_INVALID_ARGUMENT',
      hint: 'Pass at least one valid tool name in names[].',
      suggestedTool: 'noteplan_search_tools',
    };
  }

  if (message.includes('too many tool names requested')) {
    return {
      code: 'ERR_LIMIT_EXCEEDED',
      hint: 'Split requests into chunks of up to 10 tool names.',
      suggestedTool: 'noteplan_get_tool_details',
    };
  }

  if (message.includes('empty content is blocked') || message.includes('empty line content is blocked') || message.includes('empty task content is blocked')) {
    return {
      code: 'ERR_EMPTY_CONTENT_BLOCKED',
      hint: 'Use allowEmptyContent=true for intentional clears, or use a delete-oriented tool.',
      suggestedTool: 'noteplan_delete_lines',
    };
  }

  if (message.includes('line') && (message.includes('does not exist') || message.includes('invalid line index'))) {
    return {
      code: 'ERR_INVALID_LINE_REFERENCE',
      hint: 'Fetch valid line numbers first with noteplan_get_paragraphs or noteplan_get_tasks.',
      suggestedTool: 'noteplan_get_paragraphs',
    };
  }

  if (message.includes('ambiguous')) {
    return {
      code: 'ERR_AMBIGUOUS_TARGET',
      hint: 'Resolve the target first, then retry with the canonical identifier.',
      suggestedTool: toolName.includes('folder') ? 'noteplan_resolve_folder' : 'noteplan_resolve_note',
    };
  }

  if (message.includes('not found')) {
    if (toolName.includes('folder')) {
      return {
        code: 'ERR_NOT_FOUND',
        hint: 'Resolve the folder first to a canonical path, then retry.',
        suggestedTool: 'noteplan_resolve_folder',
      };
    }
    return {
      code: 'ERR_NOT_FOUND',
      hint: 'Resolve the note first to a canonical ID/filename, then retry.',
      suggestedTool: 'noteplan_resolve_note',
    };
  }

  if (message.includes('timed out') || message.includes('timeout')) {
    return {
      code: 'ERR_TIMEOUT',
      hint: 'Try a narrower query or smaller range and retry.',
      retryable: true,
    };
  }

  return {
    code: 'ERR_TOOL_EXECUTION',
  };
}

function enrichErrorResult(result: unknown, toolName: string): unknown {
  if (!result || typeof result !== 'object') return result;
  const typed = result as Record<string, unknown>;
  if (typed.success !== false) return result;
  if (typeof typed.error !== 'string') return result;

  const meta = inferToolErrorMeta(toolName, typed.error);
  return {
    ...typed,
    code: typeof typed.code === 'string' ? typed.code : meta.code,
    hint: typeof typed.hint === 'string' ? typed.hint : meta.hint,
    suggestedTool: typeof typed.suggestedTool === 'string' ? typed.suggestedTool : meta.suggestedTool,
    retryable: typeof typed.retryable === 'boolean' ? typed.retryable : meta.retryable,
  };
}

function withDuration(result: unknown, durationMs: number, includeTiming: boolean): unknown {
  if (!includeTiming) return result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return {
      ...(result as Record<string, unknown>),
      durationMs,
    };
  }
  return {
    success: true,
    data: result,
    durationMs,
  };
}

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

  const toolDefinitions: ToolDefinition[] = [
        // Note operations
        {
          name: 'noteplan_get_note',
          description: 'Get a note by ID, title, filename, or date. Prefer ID from noteplan_search for space notes.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID (BEST for space notes - get this from search results)',
              },
              title: {
                type: 'string',
                description: 'Note title to search for',
              },
              filename: {
                type: 'string',
                description: 'Direct filename/path (for local notes only)',
              },
              date: {
                type: 'string',
                description: 'Date for calendar notes (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)',
              },
              space: {
                type: 'string',
                description: 'Space ID to search in',
              },
            },
          },
        },
        {
          name: 'noteplan_list_notes',
          description: 'List notes with filtering and pagination.',
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description: 'Filter by folder path',
              },
              space: {
                type: 'string',
                description: 'Space ID to list from',
              },
              types: {
                type: 'array',
                items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
                description: 'Filter by note types',
              },
              query: {
                type: 'string',
                description: 'Filter by title/filename/folder substring',
              },
              limit: {
                type: 'number',
                description: 'Maximum notes to return (default: 50)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
            },
          },
        },
        {
          name: 'noteplan_resolve_note',
          description:
            'Resolve a note reference (ID/title/filename/date token) to a canonical note target with confidence and ambiguity details.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Note reference to resolve (ID, title, filename, or date token)',
              },
              space: {
                type: 'string',
                description: 'Restrict to a specific space ID',
              },
              folder: {
                type: 'string',
                description: 'Restrict to a folder path',
              },
              types: {
                type: 'array',
                items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
                description: 'Restrict to note types',
              },
              limit: {
                type: 'number',
                description: 'Candidate matches to return (default: 5)',
              },
              minScore: {
                type: 'number',
                description: 'Minimum score for auto-resolution (default: 0.88)',
              },
              ambiguityDelta: {
                type: 'number',
                description: 'If top scores are within this delta, treat as ambiguous (default: 0.06)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'noteplan_create_note',
          description:
            'Create a project note. Supports smart folder matching and optional YAML frontmatter in content. Recommended flow: resolve folder first when ambiguous.',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Title for the new note',
              },
              content: {
                type: 'string',
                description:
                  'Initial content. Can include YAML frontmatter between --- delimiters at the start.',
              },
              folder: {
                type: 'string',
                description:
                  'Folder path. Smart matching is built in; use folder listing/search only when ambiguous.',
              },
              create_new_folder: {
                type: 'boolean',
                description: 'Set to true to bypass smart matching and create a new folder with the exact name provided',
              },
              space: {
                type: 'string',
                description: 'Space ID to create in',
              },
            },
            required: ['title'],
          },
        },
        {
          name: 'noteplan_update_note',
          description:
            'Replace all note content. Include YAML frontmatter in content when changing note properties. Empty content is blocked unless allowEmptyContent=true. Recommended flow: resolve note -> get note -> update.',
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
              allowEmptyContent: {
                type: 'boolean',
                description: 'Allow replacing note content with empty/blank text (default: false)',
              },
            },
            required: ['filename', 'content'],
          },
        },
        {
          name: 'noteplan_delete_note',
          description: 'Delete a note (moves to trash). Recommended flow: resolve note first, then delete canonical target.',
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

This is SAFER than reading and rewriting the whole note.

Recommended flow:
1. noteplan_resolve_note
2. noteplan_get_paragraphs
3. noteplan_delete_lines`,
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

This is SAFER than noteplan_update_note which replaces the entire note.

Recommended flow:
1. noteplan_resolve_note
2. noteplan_get_paragraphs
3. noteplan_edit_line`,
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
              allowEmptyContent: {
                type: 'boolean',
                description: 'Allow replacing line content with empty/blank text (default: false)',
              },
            },
            required: ['filename', 'line', 'content'],
          },
        },

        // Search
        {
          name: 'noteplan_search',
          description:
            'Full-text search across notes. Returns IDs to retrieve full notes with noteplan_get_note.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query. Supports OR patterns like "meeting|standup"',
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
              space: {
                type: 'string',
                description: 'Space ID to search in',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results (default: 20, max: 200)',
              },
              fuzzy: {
                type: 'boolean',
                description: 'Enable fuzzy/typo-tolerant matching (default: false)',
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Case-sensitive search (default: false)',
              },
              contextLines: {
                type: 'number',
                description: 'Lines of context around matches (0-5, default: 0)',
              },
              modifiedAfter: {
                type: 'string',
                description: 'Filter notes modified after date (ISO date or "today", "yesterday", "this week", "this month")',
              },
              modifiedBefore: {
                type: 'string',
                description: 'Filter notes modified before date',
              },
              createdAfter: {
                type: 'string',
                description: 'Filter notes created after date',
              },
              createdBefore: {
                type: 'string',
                description: 'Filter notes created before date',
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
          description:
            'Add a task to a daily note date or project note file. Daily note target dates are auto-created if missing.',
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
              space: {
                type: 'string',
                description: 'Space ID when targeting daily notes',
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
          description: 'Update a task content or status (open, done, cancelled, scheduled). Recommended flow: resolve note -> get tasks -> update task by lineIndex.',
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
              allowEmptyContent: {
                type: 'boolean',
                description: 'Allow replacing task content with empty/blank text (default: false)',
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
              space: {
                type: 'string',
                description: 'Space ID to get today from',
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
              space: {
                type: 'string',
                description: 'Space ID',
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
              space: {
                type: 'string',
                description: 'Space ID',
              },
            },
            required: ['date'],
          },
        },
        {
          name: 'noteplan_get_periodic_note',
          description:
            'Get weekly, monthly, quarterly, or yearly periodic notes by type and optional date/week/month/quarter/year.',
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
              space: {
                type: 'string',
                description: 'Space ID',
              },
            },
            required: ['type'],
          },
        },
        {
          name: 'noteplan_get_notes_in_range',
          description:
            'Get daily notes for a predefined period or custom date range, with optional full content.',
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
              maxDays: {
                type: 'number',
                description: 'Maximum days to scan (default: 90, max: 366)',
              },
              limit: {
                type: 'number',
                description: 'Maximum days to return in this page (default: 50)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset within scanned days (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
              space: {
                type: 'string',
                description: 'Space ID',
              },
            },
            required: ['period'],
          },
        },
        {
          name: 'noteplan_get_notes_in_folder',
          description:
            'Get notes in a folder with optional content. Results are limited (default 50).',
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
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
            },
            required: ['folder'],
          },
        },

        // Space & metadata operations
        {
          name: 'noteplan_list_spaces',
          description: 'List spaces with optional filtering and pagination.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Filter by space name/id substring',
              },
              limit: {
                type: 'number',
                description: 'Maximum spaces to return (default: 50)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
            },
          },
        },
        {
          name: 'noteplan_list_tags',
          description: 'List tags with optional filtering and pagination.',
          inputSchema: {
            type: 'object',
            properties: {
              space: {
                type: 'string',
                description: 'Space ID to list tags from',
              },
              query: {
                type: 'string',
                description: 'Filter tags by substring',
              },
              limit: {
                type: 'number',
                description: 'Maximum tags to return (default: 100)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
            },
          },
        },
        {
          name: 'noteplan_list_folders',
          description:
            'List folders with pagination and optional filtering. Defaults to local folders only.',
          inputSchema: {
            type: 'object',
            properties: {
              space: {
                type: 'string',
                description: 'Space ID to list folders from',
              },
              includeLocal: {
                type: 'boolean',
                description: 'Include local filesystem folders',
              },
              includeSpaces: {
                type: 'boolean',
                description: 'Include space folders',
              },
              query: {
                type: 'string',
                description: 'Filter by folder name/path substring',
              },
              maxDepth: {
                type: 'number',
                description: 'Max local folder depth (1 = top level, default: 1)',
              },
              limit: {
                type: 'number',
                description: 'Maximum folders to return (default: 50)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
            },
          },
        },
        {
          name: 'noteplan_find_folders',
          description:
            'Find likely folder matches for a query and return a small ranked result set.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Folder query, e.g. "project" or "inbox"',
              },
              space: {
                type: 'string',
                description: 'Restrict to a specific space ID',
              },
              includeLocal: {
                type: 'boolean',
                description: 'Include local filesystem folders',
              },
              includeSpaces: {
                type: 'boolean',
                description: 'Include space folders',
              },
              maxDepth: {
                type: 'number',
                description: 'Max local folder depth (1 = top level, default: 2)',
              },
              limit: {
                type: 'number',
                description: 'Maximum matches to return (default: 10)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'noteplan_resolve_folder',
          description:
            'Resolve a folder query to one canonical folder path with confidence and ambiguity details.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Folder text to resolve, e.g. "projects" or "inbox"',
              },
              space: {
                type: 'string',
                description: 'Restrict to a specific space ID',
              },
              includeLocal: {
                type: 'boolean',
                description: 'Include local filesystem folders',
              },
              includeSpaces: {
                type: 'boolean',
                description: 'Include space folders',
              },
              maxDepth: {
                type: 'number',
                description: 'Max local folder depth (default: 2)',
              },
              limit: {
                type: 'number',
                description: 'Candidate matches to return (default: 5)',
              },
              minScore: {
                type: 'number',
                description: 'Minimum score for auto-resolution (default: 0.88)',
              },
              ambiguityDelta: {
                type: 'number',
                description: 'If top scores are within this delta, treat as ambiguous (default: 0.06)',
              },
            },
            required: ['query'],
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
                description: 'Number of days to fetch (default: 1, max: 365)',
              },
              calendar: {
                type: 'string',
                description: 'Filter by calendar name',
              },
              limit: {
                type: 'number',
                description: 'Maximum events to return (default: 100)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
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
          description: 'Update an existing calendar event. Recommended flow: calendar_get_events first, then update using eventId.',
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
          description: 'Delete a calendar event. Recommended flow: calendar_get_events first, then delete using eventId.',
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
              query: {
                type: 'string',
                description: 'Filter reminders by title/notes/list substring',
              },
              limit: {
                type: 'number',
                description: 'Maximum reminders to return (default: 100)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
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
          description: 'Update an existing reminder. Recommended flow: reminders_get first, then update using reminderId.',
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
          description: 'Delete a reminder. Recommended flow: reminders_get first, then delete using reminderId.',
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
            properties: {
              query: {
                type: 'string',
                description: 'Filter reminder lists by name substring',
              },
              limit: {
                type: 'number',
                description: 'Maximum reminder lists to return (default: 100)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
            },
          },
        },
        {
          name: 'noteplan_search_tools',
          description: 'Search tool names and descriptions and return a small ranked set of matches.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Tool query keywords, e.g. "folder list" or "reminder update"',
              },
              limit: {
                type: 'number',
                description: 'Maximum matches to return (default: 8, max: 25)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'noteplan_get_tool_details',
          description: 'Get detailed tool descriptions and full input schemas for selected tool names.',
          inputSchema: {
            type: 'object',
            properties: {
              names: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tool names to fetch details for (max: 10 per call)',
              },
            },
            required: ['names'],
          },
        },
      ];
  const annotatedToolDefinitions: ToolDefinition[] = toolDefinitions.map((tool): ToolDefinition => ({
    ...tool,
    inputSchema: withDebugTimingsInputSchema(tool.inputSchema),
    annotations: getToolAnnotations(tool.name),
    outputSchema: getToolOutputSchema(tool.name),
  }));
  const toolDefinitionByName = new Map(annotatedToolDefinitions.map((tool) => [tool.name, tool]));
  const discoveryToolNames = ['noteplan_search_tools', 'noteplan_get_tool_details'];
  const prioritizedTools = discoveryToolNames
    .map((name) => toolDefinitionByName.get(name))
    .filter((tool): tool is ToolDefinition => Boolean(tool));
  const orderedToolDefinitions = [
    ...prioritizedTools,
    ...annotatedToolDefinitions.filter((tool) => !discoveryToolNames.includes(tool.name)),
  ];
  const compactToolDefinitions = orderedToolDefinitions.map((tool) => compactToolDefinition(tool));

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const offset = toBoundedInt(request.params?.cursor, 0, 0, Number.MAX_SAFE_INTEGER);
    const tools = compactToolDefinitions.slice(offset, offset + TOOLS_LIST_PAGE_SIZE);
    const nextOffset = offset + tools.length;
    const hasMore = nextOffset < compactToolDefinitions.length;

    return {
      tools,
      ...(hasMore ? { nextCursor: String(nextOffset) } : {}),
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const includeTiming = isDebugTimingsEnabled(args);
    const startTime = Date.now();

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
        case 'noteplan_resolve_note':
          result = noteTools.resolveNote(args as any);
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
          result = await searchTools.searchNotes(args as any);
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

        // Space & metadata operations
        case 'noteplan_list_spaces':
          result = spaceTools.listSpaces(args as any);
          break;
        case 'noteplan_list_tags':
          result = spaceTools.listTags(args as any);
          break;
        case 'noteplan_list_folders':
          result = spaceTools.listFolders(args as any);
          break;
        case 'noteplan_find_folders':
          result = spaceTools.findFolders(args as any);
          break;
        case 'noteplan_resolve_folder':
          result = spaceTools.resolveFolder(args as any);
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
        case 'noteplan_search_tools': {
          const input = (args ?? {}) as { query?: unknown; limit?: unknown };
          const query = typeof input.query === 'string' ? input.query.trim() : '';
          if (!query) {
            result = {
              success: false,
              error: 'query is required',
            };
            break;
          }

          const limit = toBoundedInt(input.limit, 8, 1, 25);
          const matches = searchToolDefinitions(toolDefinitions, query, limit);
          result = {
            success: true,
            query,
            count: matches.length,
            tools: matches.map((entry) => ({
              name: entry.tool.name,
              score: Number(entry.score.toFixed(3)),
              description: compactDescription(entry.tool.description, 180),
            })),
          };
          break;
        }
        case 'noteplan_get_tool_details': {
          const input = (args ?? {}) as { names?: unknown };
          const names = Array.isArray(input.names)
            ? input.names.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
            : [];
          const uniqueNames = Array.from(new Set(names));
          if (uniqueNames.length === 0) {
            result = {
              success: false,
              error: 'names must include at least one tool name',
            };
            break;
          }
          if (uniqueNames.length > 10) {
            result = {
              success: false,
              error: 'Too many tool names requested. Provide up to 10 names per call.',
            };
            break;
          }

          const tools = uniqueNames
            .map((name) => toolDefinitionByName.get(name))
            .filter((tool): tool is ToolDefinition => Boolean(tool));
          const missing = uniqueNames.filter((name) => !toolDefinitionByName.has(name));
          result = {
            success: missing.length === 0,
            count: tools.length,
            missing,
            tools,
          };
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const enrichedResult = enrichErrorResult(result, name);
      const resultWithDuration = withDuration(enrichedResult, Date.now() - startTime, includeTiming);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(resultWithDuration),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const meta = inferToolErrorMeta(name, errorMessage);
      const errorResult: Record<string, unknown> = {
        success: false,
        error: errorMessage,
        code: meta.code,
        hint: meta.hint,
        suggestedTool: meta.suggestedTool,
        retryable: meta.retryable,
      };
      const errorWithDuration = withDuration(errorResult, Date.now() - startTime, includeTiming);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(errorWithDuration),
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
