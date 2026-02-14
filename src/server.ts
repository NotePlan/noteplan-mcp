// MCP Server with tool registration

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import tool implementations
import * as noteTools from './tools/notes.js';
import * as searchTools from './tools/search.js';
import * as taskTools from './tools/tasks.js';
import * as calendarTools from './tools/calendar.js';
import * as spaceTools from './tools/spaces.js';
import * as filterTools from './tools/filters.js';
import * as eventTools from './tools/events.js';
import * as reminderTools from './tools/reminders.js';
import * as embeddingsTools from './tools/embeddings.js';
import * as memoryTools from './tools/memory.js';
import * as uiTools from './tools/ui.js';
import * as pluginTools from './tools/plugins.js';
import * as themeTools from './tools/themes.js';
import * as templateTools from './tools/templates.js';
import * as attachmentTools from './tools/attachments.js';
import { parseFlexibleDate } from './utils/date-utils.js';
import { upgradeMessage, getNotePlanVersion, getMcpServerVersion, MIN_BUILD_ADVANCED_FEATURES, MIN_BUILD_CREATE_BACKUP } from './utils/version.js';
import { initSqlite } from './noteplan/sqlite-loader.js';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_API_DOCS_DIR = path.join(__dirname, '../docs/plugin-api');

const PLUGIN_API_RESOURCES = [
  { file: 'plugin-api-condensed.md', name: 'Plugin API Reference (Condensed)', desc: 'Complete NotePlan plugin API — all signatures, types, and patterns in one reference. Read this first.' },
  { file: 'getting-started.md', name: 'Getting Started Guide', desc: 'How to create NotePlan plugins — structure, setup, first plugin, testing, HTML views' },
  { file: 'Editor.md',          name: 'Editor API',            desc: 'Note manipulation — insertText, paragraphs, selection, themes, openNoteByTitle' },
  { file: 'DataStore.md',       name: 'DataStore API',         desc: 'Data access — folders, notes, preferences, teamspaces, hashtags' },
  { file: 'NoteObject.md',      name: 'Note Object',           desc: 'Note properties/methods — content, paragraphs, frontmatter, dates' },
  { file: 'Calendar.md',        name: 'Calendar API',          desc: 'Calendar events and reminders — add, update, query' },
  { file: 'NotePlan.md',        name: 'NotePlan API',          desc: 'Core globals — environment, AI, themes, settings' },
  { file: 'CommandBar.md',      name: 'CommandBar API',        desc: 'User interaction — showOptions, showInput, showLoading, textPrompt' },
  { file: 'HTMLView.md',        name: 'HTMLView API',          desc: 'HTML views — showWindow, showInMainWindow, showInSplitView, JS bridge' },
  { file: 'CalendarItem.md',    name: 'CalendarItem Object',   desc: 'Calendar event/reminder structure and properties' },
  { file: 'ParagraphObject.md', name: 'Paragraph Object',      desc: 'Paragraph structure — type, content, heading level, indents, links' },
  { file: 'Clipboard.md',       name: 'Clipboard API',         desc: 'Read/write system clipboard' },
  { file: 'RangeObject.md',     name: 'Range Object',          desc: 'Text range — start, end, length for selections' },
  { file: 'plugin.json',        name: 'Demo plugin.json',      desc: 'Example plugin manifest — ID, name, commands, settings, dependencies' },
  { file: 'script.js',          name: 'Demo script.js',        desc: 'Example plugin implementation with multiple API usage examples' },
];

function normalizeToolName(name: string): string {
  const separatorIndex = name.lastIndexOf(':');
  if (separatorIndex === -1) return name;
  const normalized = name.slice(separatorIndex + 1).trim();
  return normalized || name;
}

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
      suggestedNextTools: {
        type: 'array',
        items: { type: 'string' },
      },
      memoryHints: {
        type: 'object',
        properties: {
          storedMemories: { type: 'number' },
          tip: { type: 'string' },
        },
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
const NOTE_OUTPUT_SCHEMA = outputSchemaWithErrors({
  note: { type: 'object' },
  created: { type: 'boolean' },
  contentIncluded: { type: 'boolean' },
  contentLength: { type: 'number' },
  lineCount: { type: 'number' },
  preview: { type: 'string' },
  previewTruncated: { type: 'boolean' },
  rangeStartLine: { type: 'number' },
  rangeEndLine: { type: 'number' },
  rangeLineCount: { type: 'number' },
  returnedLineCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  content: { type: 'string' },
  lines: { type: 'array', items: { type: 'object' } },
});
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
const SEARCH_NOTES_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  searchField: { type: 'string' },
  queryMode: { type: 'string' },
  effectiveQuery: { type: 'string' },
  tokenTerms: { type: 'array', items: { type: 'string' } },
  minTokenMatches: { type: 'number' },
  count: { type: 'number' },
  propertyFilters: { type: 'object', additionalProperties: { type: 'string' } },
  propertyCaseSensitive: { type: 'boolean' },
  partialResults: { type: 'boolean' },
  searchBackend: { type: 'string' },
  warnings: { type: 'array', items: { type: 'string' } },
  results: { type: 'array', items: { type: 'object' } },
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
function getToolOutputSchema(toolName: string): Record<string, unknown> {
  switch (toolName) {
    case 'noteplan_search':
      return SEARCH_NOTES_OUTPUT_SCHEMA;
    // Consolidated tools — use GENERIC since return shape varies by action/route
    case 'noteplan_get_notes':
    case 'noteplan_manage_note':
    case 'noteplan_edit_content':
    case 'noteplan_paragraphs':
    case 'noteplan_folders':
    case 'noteplan_filters':
    case 'noteplan_eventkit':
    case 'noteplan_memory':
    case 'noteplan_ui':
    case 'noteplan_plugins':
    case 'noteplan_themes':
    case 'noteplan_embeddings':
    case 'noteplan_templates':
    case 'noteplan_attachments':
      return GENERIC_TOOL_OUTPUT_SCHEMA;
    default:
      return GENERIC_TOOL_OUTPUT_SCHEMA;
  }
}

function resolveScheduleDate(dateInput: string): string {
  const compact = parseFlexibleDate(dateInput); // returns YYYYMMDD
  // Convert YYYYMMDD → YYYY-MM-DD for NotePlan scheduling syntax
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return dateInput; // fallback: use as-is
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function appendScheduleDate(content: string, scheduleDate?: string): string {
  if (!scheduleDate) return content;
  const formatted = resolveScheduleDate(scheduleDate);
  return `${content} >${formatted}`;
}

const PERIOD_TYPE_MAP: Record<string, string> = {
  week: 'weekly',
  month: 'monthly',
  quarter: 'quarterly',
  year: 'yearly',
};

function dispatchGetNotes(args: Record<string, unknown>): unknown {
  const {
    resolve, resolveQuery, id, title, filename, date, period, count,
    rangePeriod, startDate, endDate, folder, space, types, query,
    limit, offset, cursor, minScore, ambiguityDelta,
    // periodic note params
    week, month, quarter, year, fromDate, includeContent, includeMissing, maxLookback,
    // range params
    maxDays,
  } = args as any;

  // 0. version info
  if ((args as any).version) {
    const npVersion = getNotePlanVersion(true);
    return {
      success: true,
      mcpServerVersion: getMcpServerVersion(),
      notePlanVersion: npVersion.version,
      notePlanBuild: npVersion.build,
      notePlanSource: npVersion.source,
    };
  }

  // 1. resolve mode
  if (resolve) {
    return noteTools.resolveNote({
      query: resolveQuery ?? query,
      space, folder, types, limit, minScore, ambiguityDelta,
    } as any);
  }

  // 2. single note by identifier
  if (id || title || filename) {
    return noteTools.getNote(args as any);
  }

  // 3. recent periodic notes (period + count)
  if (period && count) {
    const periodicType = PERIOD_TYPE_MAP[period] ?? period;
    return calendarTools.getRecentPeriodicNotes({
      type: periodicType, count, fromDate, includeContent, includeMissing, maxLookback, space,
    } as any);
  }

  // 4. single periodic note (period, no count)
  if (period && !count) {
    const periodicType = PERIOD_TYPE_MAP[period] ?? period;
    return calendarTools.getPeriodicNote({
      type: periodicType, date, week, month, quarter, year, space,
    } as any);
  }

  // 5. date range
  if (rangePeriod || (startDate && endDate)) {
    return calendarTools.getNotesInRange({
      period: rangePeriod ?? 'custom', startDate, endDate, includeContent, maxDays, limit, offset, cursor, space,
    } as any);
  }

  // 6. folder listing (no id/title/filename/date)
  if (folder && !date) {
    return calendarTools.getNotesInFolder({
      folder, includeContent, limit, offset, cursor, space,
    } as any);
  }

  // 7. calendar note by date
  if (date) {
    return calendarTools.getCalendarNote({ date, space } as any);
  }

  // 8. fallback: list notes
  return noteTools.listNotes({
    folder, space, types, query, limit, offset, cursor,
  } as any);
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

function compactToolDefinition(tool: ToolDefinition, maxDescLength = 120): ToolDefinition {
  return {
    name: tool.name,
    description: compactDescription(tool.description, maxDescLength),
    inputSchema: stripDescriptions(tool.inputSchema) as Record<string, unknown>,
    annotations: tool.annotations,
  };
}

function getToolAnnotations(toolName: string): ToolAnnotations {
  // Read-only tools
  const readOnlyTools = new Set([
    'noteplan_get_notes',
    'noteplan_search',
  ]);

  // Consolidated tools with mixed read+write actions get pessimistic annotations
  const destructiveTools = new Set([
    'noteplan_manage_note',
    'noteplan_edit_content',
    'noteplan_paragraphs',
    'noteplan_folders',
    'noteplan_filters',
    'noteplan_eventkit',
    'noteplan_memory',
    'noteplan_plugins',
    'noteplan_themes',
    'noteplan_embeddings',
    'noteplan_attachments',
  ]);

  const nonIdempotentTools = new Set([
    'noteplan_manage_note',
    'noteplan_edit_content',
    'noteplan_paragraphs',
    'noteplan_folders',
    'noteplan_filters',
    'noteplan_eventkit',
    'noteplan_memory',
    'noteplan_ui',
    'noteplan_plugins',
    'noteplan_themes',
    'noteplan_embeddings',
    'noteplan_templates',
    'noteplan_attachments',
  ]);

  const openWorldTools = new Set([
    'noteplan_eventkit',
    'noteplan_embeddings',
    'noteplan_plugins',
    'noteplan_templates',
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
  restore: ['recover', 'undo', 'undelete'],
  create: ['add', 'new', 'make'],
  paragraph: ['line', 'block', 'section', 'text'],
  lines: ['line', 'paragraph', 'content'],
  embeddings: ['semantic', 'vector', 'similarity', 'meaning'],
  semantic: ['embeddings', 'vector', 'similarity'],
};

function getToolSearchAliases(toolName: string): string[] {
  const aliases: string[] = [];

  switch (toolName) {
    case 'noteplan_get_notes':
      aliases.push(
        'notes', 'documents', 'markdown',
        'resolve note', 'canonical note', 'disambiguate note',
        'today', 'daily note', 'journal',
        'calendar note', 'date note',
        'weekly notes', 'monthly notes', 'periodic notes', 'quarterly',
        'date range', 'this week', 'last week',
        'folder notes', 'browse folder',
        'list notes',
      );
      break;
    case 'noteplan_search':
      aliases.push('search notes', 'find notes', 'full-text search', 'tags', 'hashtags');
      break;
    case 'noteplan_manage_note':
      aliases.push('create note', 'update note', 'delete note', 'move note', 'rename note', 'restore note', 'frontmatter', 'property', 'set property');
      break;
    case 'noteplan_edit_content':
      aliases.push('insert', 'append', 'edit line', 'delete lines', 'replace lines', 'edit content', 'today', 'daily note');
      break;
    case 'noteplan_paragraphs':
      aliases.push(
        'paragraphs', 'lines', 'line numbers', 'search paragraph', 'find paragraph',
        'tasks', 'todos', 'checklist', 'add task', 'complete task', 'update task', 'search tasks', 'global tasks',
      );
      break;
    case 'noteplan_folders':
      aliases.push('folders', 'directory', 'create folder', 'move folder', 'rename folder', 'delete folder', 'resolve folder', 'find folder', 'spaces', 'workspaces', 'teamspaces');
      break;
    case 'noteplan_filters':
      aliases.push('filters', 'saved filters', 'task filters', 'filter parameters', 'run filter');
      break;
    case 'noteplan_eventkit':
      aliases.push('calendar', 'event', 'events', 'schedule', 'meeting', 'appointment', 'create event', 'delete event', 'reminder', 'reminders', 'todo', 'checklist', 'create reminder', 'complete reminder');
      break;
    case 'noteplan_memory':
      aliases.push('memory', 'memories', 'preference', 'preferences', 'remember', 'correction');
      break;
    case 'noteplan_ui':
      aliases.push('ui', 'open note', 'open today', 'search ui', 'run plugin', 'sidebar', 'toggle sidebar');
      break;
    case 'noteplan_plugins':
      aliases.push('plugin', 'plugins', 'extension', 'command', 'addon', 'create plugin', 'install plugin', 'plugin log', 'plugin source', 'screenshot');
      break;
    case 'noteplan_themes':
      aliases.push('theme', 'themes', 'colors', 'dark mode', 'light mode', 'appearance');
      break;
    case 'noteplan_embeddings':
      aliases.push('embeddings', 'semantic search', 'vector search', 'similarity');
      break;
    case 'noteplan_templates':
      aliases.push('template', 'templates', 'render template', 'list templates', 'template types', 'meeting template', 'project template', 'debug template', 'test template');
      break;
    case 'noteplan_attachments':
      aliases.push('attachment', 'attachments', 'image', 'file', 'upload', 'add image', 'add file', 'add attachment', 'list attachments', 'get attachment', 'base64', 'photo', 'screenshot');
      break;
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

function inferToolErrorMeta(toolName: string, errorMessage: string, registeredToolNames?: string[]): ToolErrorMeta {
  const message = errorMessage.toLowerCase();

  if (message.includes('unknown tool')) {
    const toolList = registeredToolNames?.join(', ') ?? 'noteplan_get_notes, noteplan_search, noteplan_manage_note, noteplan_edit_content, noteplan_paragraphs, noteplan_folders, noteplan_filters, noteplan_eventkit, noteplan_memory, noteplan_templates, noteplan_attachments';
    return {
      code: 'ERR_UNKNOWN_TOOL',
      hint: `Check tool name spelling. Available tools: ${toolList}.`,
    };
  }

  if (message.includes('query is required')) {
    return {
      code: 'ERR_QUERY_REQUIRED',
      hint: 'Provide a non-empty query string to run this operation.',
    };
  }

  if (message.includes('requires a newer version of noteplan')) {
    return {
      code: 'ERR_VERSION_GATE',
      hint: 'Update NotePlan to the latest version, then retry.',
    };
  }

  if (message.includes('embeddings are disabled')) {
    return {
      code: 'ERR_EMBEDDINGS_DISABLED',
      hint: 'Enable embeddings in MCP env: NOTEPLAN_EMBEDDINGS_ENABLED=true.',
      suggestedTool: 'noteplan_embeddings',
    };
  }

  if (message.includes('embeddings api key is missing')) {
    return {
      code: 'ERR_EMBEDDINGS_NOT_CONFIGURED',
      hint: 'Set NOTEPLAN_EMBEDDINGS_API_KEY (and optionally provider/model/base URL), then retry sync/search.',
      suggestedTool: 'noteplan_embeddings',
    };
  }

  if (message.includes('provide one note reference')) {
    return {
      code: 'ERR_INVALID_ARGUMENT',
      hint: 'Pass one of: id, filename, title, or date to identify the note target.',
      suggestedTool: 'noteplan_get_notes',
    };
  }

  if (
    message.includes('provide lineindex') ||
    message.includes('lineindex must be') ||
    message.includes('line must be') ||
    message.includes('line and lineindex reference different')
  ) {
    return {
      code: 'ERR_INVALID_ARGUMENT',
      hint: 'For task updates, pass either lineIndex (0-based) or line (1-based).',
      suggestedTool: 'noteplan_paragraphs',
    };
  }
  if (message.includes('provide at least one field to update')) {
    return {
      code: 'ERR_INVALID_ARGUMENT',
      hint: 'For noteplan_paragraphs(action=update), pass content, status, or both.',
      suggestedTool: 'noteplan_paragraphs',
    };
  }


  if (message.includes('empty content is blocked') || message.includes('empty line content is blocked') || message.includes('empty task content is blocked')) {
    return {
      code: 'ERR_EMPTY_CONTENT_BLOCKED',
      hint: 'Use allowEmptyContent=true for intentional clears, or use noteplan_edit_content(action=delete_lines).',
      suggestedTool: 'noteplan_edit_content',
    };
  }
  if (message.includes('empty replacement content is blocked')) {
    return {
      code: 'ERR_EMPTY_CONTENT_BLOCKED',
      hint: 'Use noteplan_edit_content(action=delete_lines) for deletion, or set allowEmptyContent=true.',
      suggestedTool: 'noteplan_edit_content',
    };
  }

  if (message.includes('supported for local notes only') || message.includes('supported for project notes only')) {
    return {
      code: 'ERR_UNSUPPORTED_TARGET',
      hint: 'These tools currently operate on local project notes under Notes/.',
      suggestedTool: 'noteplan_get_notes',
    };
  }

  if (message.includes('not in teamspace @trash') || message.includes('local note is not in @trash')) {
    return {
      code: 'ERR_NOT_IN_TRASH',
      hint: 'Restore only works for notes currently in trash.',
      suggestedTool: 'noteplan_manage_note',
    };
  }

  if (message.includes('note is in trash')) {
    return {
      code: 'ERR_NOTE_IN_TRASH',
      hint: 'Use noteplan_manage_note(action=restore) to recover this note, then retry.',
      suggestedTool: 'noteplan_manage_note',
    };
  }

  if (message.includes('full note replacement is blocked')) {
    return {
      code: 'ERR_FULL_REPLACE_CONFIRMATION_REQUIRED',
      hint: 'Set fullReplace=true only for intentional whole-note rewrites; otherwise use noteplan_edit_content.',
      suggestedTool: 'noteplan_paragraphs',
    };
  }

  if (message.includes('confirmation token is required')) {
    return {
      code: 'ERR_CONFIRMATION_REQUIRED',
      hint: 'Run the same destructive tool with dryRun=true to get a confirmationToken, then retry with that token.',
      suggestedTool: toolName,
    };
  }

  if (message.includes('confirmation token is invalid') || message.includes('confirmation token is expired')) {
    return {
      code: 'ERR_CONFIRMATION_INVALID',
      hint: 'Regenerate the token by rerunning the same tool with dryRun=true, then retry promptly.',
      suggestedTool: toolName,
    };
  }

  if (message.includes('line') && (message.includes('does not exist') || message.includes('invalid line index'))) {
    return {
      code: 'ERR_INVALID_LINE_REFERENCE',
      hint: 'Fetch valid line numbers first with noteplan_paragraphs.',
      suggestedTool: 'noteplan_paragraphs',
    };
  }

  if (message.includes('ambiguous')) {
    return {
      code: 'ERR_AMBIGUOUS_TARGET',
      hint: 'Resolve the target first, then retry with the canonical identifier.',
      suggestedTool: toolName.includes('folder') ? 'noteplan_folders' : 'noteplan_get_notes',
    };
  }

  if (message.includes('not found') && toolName.includes('filter')) {
    return {
      code: 'ERR_NOT_FOUND',
      hint: 'List filters first, then retry with an exact filter name.',
      suggestedTool: 'noteplan_filters',
    };
  }

  if (message.includes('not found')) {
    if (toolName.includes('folder')) {
      return {
        code: 'ERR_NOT_FOUND',
        hint: 'Resolve the folder first to a canonical path, then retry.',
        suggestedTool: 'noteplan_folders',
      };
    }
    return {
      code: 'ERR_NOT_FOUND',
      hint: 'Resolve the note first to a canonical ID/filename, then retry.',
      suggestedTool: 'noteplan_get_notes',
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

function enrichErrorResult(result: unknown, toolName: string, registeredToolNames?: string[]): unknown {
  if (!result || typeof result !== 'object') return result;
  const typed = result as Record<string, unknown>;
  if (typed.success !== false) return result;
  if (typeof typed.error !== 'string') return result;

  const meta = inferToolErrorMeta(toolName, typed.error, registeredToolNames);
  return {
    ...typed,
    code: typeof typed.code === 'string' ? typed.code : meta.code,
    hint: typeof typed.hint === 'string' ? typed.hint : meta.hint,
    suggestedTool: typeof typed.suggestedTool === 'string' ? typed.suggestedTool : meta.suggestedTool,
    retryable: typeof typed.retryable === 'boolean' ? typed.retryable : meta.retryable,
  };
}

function withSuggestedNextTools(result: unknown, toolName: string, availableToolNames?: Set<string>): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const typed = result as Record<string, unknown>;
  if (typed.success !== true) return result;
  if (Array.isArray(typed.suggestedNextTools) && typed.suggestedNextTools.length > 0) return result;

  let suggestedNextTools: string[] = [];
  switch (toolName) {
    case 'noteplan_get_notes':
      suggestedNextTools = ['noteplan_paragraphs', 'noteplan_edit_content'];
      break;
    case 'noteplan_paragraphs':
      suggestedNextTools = ['noteplan_edit_content', 'noteplan_get_notes'];
      break;
    case 'noteplan_edit_content':
      suggestedNextTools = ['noteplan_paragraphs', 'noteplan_get_notes'];
      break;
    case 'noteplan_search':
      suggestedNextTools = ['noteplan_get_notes', 'noteplan_paragraphs'];
      break;
    case 'noteplan_manage_note':
      suggestedNextTools = ['noteplan_get_notes'];
      break;
    case 'noteplan_folders':
      suggestedNextTools = ['noteplan_manage_note', 'noteplan_get_notes'];
      break;
    case 'noteplan_filters':
      suggestedNextTools = ['noteplan_paragraphs', 'noteplan_filters'];
      break;
    case 'noteplan_eventkit':
      suggestedNextTools = ['noteplan_eventkit'];
      break;
    case 'noteplan_memory':
      suggestedNextTools = ['noteplan_memory'];
      break;
    case 'noteplan_embeddings':
      suggestedNextTools = ['noteplan_get_notes', 'noteplan_embeddings'];
      break;
    case 'noteplan_plugins':
      suggestedNextTools = ['noteplan_plugins', 'noteplan_ui'];
      break;
    case 'noteplan_themes':
      suggestedNextTools = ['noteplan_themes'];
      break;
    case 'noteplan_templates':
      suggestedNextTools = ['noteplan_templates', 'noteplan_manage_note', 'noteplan_edit_content'];
      break;
    case 'noteplan_attachments':
      suggestedNextTools = ['noteplan_attachments', 'noteplan_edit_content', 'noteplan_get_notes'];
      break;
    default:
      suggestedNextTools = [];
  }

  const filtered = availableToolNames
    ? suggestedNextTools.filter((t) => availableToolNames.has(t))
    : suggestedNextTools;
  if (filtered.length === 0) return result;
  return {
    ...typed,
    suggestedNextTools: filtered.slice(0, 3),
  };
}

const MEMORY_HINT_TOOLS = new Set([
  'noteplan_edit_content',
  'noteplan_paragraphs',
  'noteplan_manage_note',
]);

function withMemoryHints(result: unknown, toolName: string): unknown {
  if (!MEMORY_HINT_TOOLS.has(toolName)) return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const typed = result as Record<string, unknown>;
  if (typed.success !== true) return result;

  try {
    const count = memoryTools.getMemoryCount();
    if (count === 0) return result; // Skip hint noise when no memories stored
    return {
      ...typed,
      memoryHints: {
        storedMemories: count,
        tip: `You have ${count} stored memory/memories. Consider checking noteplan_memory (action: list) before making formatting or style decisions.`,
      },
    };
  } catch {
    return result;
  }
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
      name: 'NotePlan',
      version: '1.1.4',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );
  let embeddingsToolsEnabled = false;
  try {
    embeddingsToolsEnabled = embeddingsTools.areEmbeddingsToolsEnabled();
  } catch (err) {
    console.error('[noteplan-mcp] Failed to check embeddings config:', err);
  }
  let versionInfo: { version: string; build: number; source: string } = { version: '0.0.0', build: 0, source: 'unknown' };
  let advancedFeaturesEnabled = false;
  try {
    versionInfo = getNotePlanVersion();
    advancedFeaturesEnabled = versionInfo.build >= MIN_BUILD_ADVANCED_FEATURES;
  } catch (err) {
    console.error('[noteplan-mcp] Failed to detect NotePlan version:', err);
  }
  console.error(`[noteplan-mcp] Detected NotePlan ${versionInfo.version} (build ${versionInfo.build}, source: ${versionInfo.source}). Advanced features: ${advancedFeaturesEnabled ? 'enabled' : 'disabled'}.`);

  const toolDefinitions: ToolDefinition[] = [
        // ── Consolidated tools (16 — action/param-based dispatch) ──
        {
          name: 'noteplan_get_notes',
          description:
            'Unified note retrieval: get a single note, list notes, resolve references, fetch today/calendar/periodic notes, date ranges, or folder contents.\n\nRouting:\n- version=true → MCP server version + NotePlan app version\n- resolve=true + resolveQuery → resolve a note reference to canonical target\n- id/title/filename → get single note (metadata + optional content)\n- period + count → recent periodic notes (e.g., last 6 weekly notes)\n- period (no count) → single periodic note (week/month/quarter/year)\n- rangePeriod or startDate+endDate → daily notes in date range\n- folder (no id/title/filename/date) → notes in folder\n- date → calendar note for that date (use "today" for today\'s note)\n- fallback (no params) → list notes with optional filters',
          inputSchema: {
            type: 'object',
            properties: {
              // Single note params
              id: {
                type: 'string',
                description: 'Note ID (BEST for space notes — get from search results)',
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
                description: 'Space name or ID scope',
              },
              includeContent: {
                type: 'boolean',
                description: 'Include note body content (default: false)',
              },
              startLine: {
                type: 'number',
                description: 'First line when includeContent=true (1-indexed)',
              },
              endLine: {
                type: 'number',
                description: 'Last line when includeContent=true (1-indexed)',
              },
              previewChars: {
                type: 'number',
                description: 'Preview length when includeContent=false (default: 280)',
              },
              // Resolve params
              resolve: {
                type: 'boolean',
                description: 'Enable resolve mode: find canonical note from a fuzzy reference',
              },
              resolveQuery: {
                type: 'string',
                description: 'Note reference to resolve (ID, title, filename, or date token)',
              },
              minScore: {
                type: 'number',
                description: 'Minimum score for auto-resolution (default: 0.88)',
              },
              ambiguityDelta: {
                type: 'number',
                description: 'If top scores are within this delta, treat as ambiguous (default: 0.06)',
              },
              // Periodic note params
              period: {
                type: 'string',
                enum: ['week', 'month', 'quarter', 'year'],
                description: 'Periodic note type. With count → recent sequence; without → single period',
              },
              count: {
                type: 'number',
                description: 'Number of recent periodic notes to return (triggers multi-note mode)',
              },
              fromDate: {
                type: 'string',
                description: 'Reference date for periodic notes (YYYY-MM-DD, default: today)',
              },
              includeMissing: {
                type: 'boolean',
                description: 'Include missing period slots in response (default: false)',
              },
              maxLookback: {
                type: 'number',
                description: 'Maximum period slots to inspect (default: 52, max: 260)',
              },
              week: {
                type: 'number',
                description: 'Week number 1-53 (for single periodic note with period=week)',
              },
              month: {
                type: 'number',
                description: 'Month number 1-12 (for single periodic note with period=month)',
              },
              quarter: {
                type: 'number',
                description: 'Quarter 1-4 (for single periodic note with period=quarter)',
              },
              year: {
                type: 'number',
                description: 'Year (e.g., 2025). Defaults to current year.',
              },
              // Date range params
              rangePeriod: {
                type: 'string',
                enum: ['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month', 'custom'],
                description: 'Predefined date range period or "custom" with startDate/endDate',
              },
              startDate: {
                type: 'string',
                description: 'Start date for custom range (YYYY-MM-DD)',
              },
              endDate: {
                type: 'string',
                description: 'End date for custom range (YYYY-MM-DD)',
              },
              maxDays: {
                type: 'number',
                description: 'Maximum days to scan for date range (default: 90, max: 366)',
              },
              // List/folder params
              folder: {
                type: 'string',
                description: 'Folder path filter (e.g., "20 - Areas" or "Notes/20 - Areas")',
              },
              types: {
                type: 'array',
                items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
                description: 'Filter by note types',
              },
              query: {
                type: 'string',
                description: 'Filter by title/filename/folder substring (list mode) or resolve query',
              },
              // Pagination
              limit: {
                type: 'number',
                description: 'Maximum results to return',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
              // Version info
              version: {
                type: 'boolean',
                description: 'Set to true to get MCP server version and NotePlan app version',
              },
            },
          },
        },
        {
          name: 'noteplan_manage_note',
          description:
            'Manage notes: create, update, delete, move, restore, rename, or manage frontmatter properties.\n\nActions:\n- create: Create a project note (requires title). Set noteType="template" to create in @Templates with proper frontmatter. After creating a template, verify it with noteplan_templates(action: "render").\n- update: Replace note content (requires filename, content, fullReplace + confirmationToken)\n- delete/move/restore: Lifecycle ops (requires id or filename + dryRun/confirmationToken)\n- rename: Rename a note (accepts id, filename, title, or query to find the note + newTitle for the new name + dryRun/confirmationToken)\n- set_property/remove_property: Frontmatter (requires filename + key)',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['create', 'update', 'delete', 'move', 'restore', 'rename', 'set_property', 'remove_property'],
                description: 'Action: create | update | delete | move | restore | rename | set_property | remove_property',
              },
              id: {
                type: 'string',
                description: 'Note ID — used by delete, move, rename, restore (preferred for TeamSpace notes)',
              },
              filename: {
                type: 'string',
                description: 'Filename/path — used by update, delete, move, rename, restore, set_property, remove_property',
              },
              title: {
                type: 'string',
                description: 'Note title — required for create. Also used by rename to find the note by title (fuzzy matched).',
              },
              query: {
                type: 'string',
                description: 'Fuzzy search query to find the note — used by rename',
              },
              content: {
                type: 'string',
                description: 'Note content — used by create (initial content) and update (replacement content)',
              },
              folder: {
                type: 'string',
                description: 'Folder path — used by create (smart matching built in)',
              },
              create_new_folder: {
                type: 'boolean',
                description: 'Bypass smart matching and create exact folder name — used by create',
              },
              noteType: {
                type: 'string',
                enum: ['note', 'template'],
                description: 'Type of note to create. Use "template" to create in @Templates with proper frontmatter — used by create',
              },
              templateTypes: {
                type: 'array',
                items: { type: 'string', enum: ['empty-note', 'meeting-note', 'project-note', 'calendar-note'] },
                description: 'Template type tags — used by create with noteType="template"',
              },
              space: {
                type: 'string',
                description: 'Space name or ID scope',
              },
              fullReplace: {
                type: 'boolean',
                description: 'Required safety confirmation for whole-note rewrite — used by update',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview impact and get confirmationToken — used by update, delete, move, rename, restore',
              },
              confirmationToken: {
                type: 'string',
                description: 'Token from dryRun for execution — used by update, delete, move, rename, restore',
              },
              allowEmptyContent: {
                type: 'boolean',
                description: 'Allow empty content — used by update',
              },
              destinationFolder: {
                type: 'string',
                description: 'Target folder — used by move, restore',
              },
              newFilename: {
                type: 'string',
                description: 'New filename for local notes — used by rename. Prefer newTitle instead.',
              },
              newTitle: {
                type: 'string',
                description: 'New title for the note — used by rename. Works for both local and TeamSpace notes. For local notes this renames the file and updates the # heading.',
              },
              keepExtension: {
                type: 'boolean',
                description: 'Keep current extension on rename (default: true) — used by rename',
              },
              key: {
                type: 'string',
                description: 'Property key — used by set_property, remove_property',
              },
              value: {
                type: 'string',
                description: 'Property value — used by set_property',
              },
            },
            required: ['action'],
          },
        },
        {
          name: 'noteplan_edit_content',
          description:
            'Edit note content. IMPORTANT: action values use snake_case.\n\nValid actions (exactly these strings):\n- "insert": Insert at position. Combine any position with heading="Section Name" to scope insertion to that section. position="start" + heading inserts right after the heading. position="end" + heading appends at end of the heading\'s section. position="after-heading" inserts right after a heading. position="in-section" appends at end of a heading\'s section. position="start" (no heading) inserts after frontmatter. position="at-line" inserts at a specific line number. position="end" (no heading) appends to note.\n- "append": Shorthand for insert at end. Supports heading="Section Name" to append at end of that section. Use date="today" to append to today\'s daily note.\n- "delete_lines": Delete a line range. Requires startLine + endLine (1-indexed). Use dryRun=true first, then confirmationToken to execute.\n- "edit_line": Edit a single line. Requires line (1-indexed) + content. Set content="" to clear a line.\n- "replace_lines": Replace a line range. Requires startLine + endLine + content. Use dryRun=true first, then confirmationToken to execute.\n\nTarget note via id, filename, title, date, or query. Calendar notes (date param) are auto-created if they don\'t exist yet. Always use tab characters for indentation.\n\nAdding tasks: When inserting a task, set type="task" and pass only the task text as content (e.g. content="Buy groceries", type="task"). Do NOT include raw markers like "* [ ]" or "- [ ]" in content — the type parameter handles formatting to match the user\'s configured style. For checklists use type="checklist". For task lifecycle (complete, update, search), use noteplan_paragraphs instead.\n\nSchedule tasks with >YYYY-MM-DD. Link to notes with [[Note Name]]. Never add block IDs (^id).\n\nUse scheduleDate to auto-append >YYYY-MM-DD to content.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['insert', 'append', 'delete_lines', 'edit_line', 'replace_lines'],
                description: 'Action: insert | append | delete_lines | edit_line | replace_lines',
              },
              id: {
                type: 'string',
                description: 'Note ID (preferred for space notes)',
              },
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              title: {
                type: 'string',
                description: 'Note title target',
              },
              date: {
                type: 'string',
                description: 'Calendar note date (auto-creates if missing)',
              },
              query: {
                type: 'string',
                description: 'Fuzzy note query',
              },
              space: {
                type: 'string',
                description: 'Space name or ID scope',
              },
              content: {
                type: 'string',
                description: 'Content to insert/append/replace, or new line content for edit_line. NEVER include task markers like "- [ ]", "* [ ]", or "* " — instead set type="task" and pass only the task text (e.g. content="Buy groceries", NOT content="- [ ] Buy groceries").',
              },
              position: {
                type: 'string',
                enum: ['start', 'end', 'after-heading', 'at-line', 'in-section'],
                description: 'Where to insert. With heading: start=right after heading, end/in-section=end of section. Without heading: start=after frontmatter, end=bottom of note. at-line=specific line number — used by insert',
              },
              heading: {
                type: 'string',
                description: 'Heading or section marker text (required for after-heading and in-section; matches both ## headings and **bold:** section markers) — used by insert, append',
              },
              line: {
                type: 'number',
                description: 'Line number (1-indexed) — used by insert (at-line) and edit_line',
              },
              startLine: {
                type: 'number',
                description: 'First line (1-indexed) — used by delete_lines, replace_lines',
              },
              endLine: {
                type: 'number',
                description: 'Last line (1-indexed) — used by delete_lines, replace_lines',
              },
              indentationStyle: {
                type: 'string',
                enum: ['tabs', 'preserve'],
                description: 'Indentation normalization (default: tabs) — used by insert, append, edit_line, replace_lines',
              },
              type: {
                type: 'string',
                enum: ['title', 'heading', 'task', 'checklist', 'bullet', 'quote', 'separator', 'empty', 'text'],
                description: 'Paragraph type for auto-formatting — used by insert',
              },
              taskStatus: {
                type: 'string',
                enum: ['open', 'done', 'cancelled', 'scheduled'],
                description: 'Task status (default: open) — used by insert with type=task/checklist',
              },
              headingLevel: {
                type: 'number',
                description: 'Heading level 1-6 — used by insert with type=heading/title',
              },
              priority: {
                type: 'number',
                description: 'Priority 1-3 — used by insert with type=task/checklist',
              },
              indentLevel: {
                type: 'number',
                description: 'Tab indent level — used by insert with type=task/checklist/bullet',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview impact and get confirmationToken — used by delete_lines, replace_lines',
              },
              confirmationToken: {
                type: 'string',
                description: 'Token from dryRun — used by delete_lines, replace_lines',
              },
              allowEmptyContent: {
                type: 'boolean',
                description: 'Allow empty content — used by edit_line, replace_lines',
              },
              scheduleDate: {
                type: 'string',
                description: 'Auto-append >YYYY-MM-DD scheduling date to content. Accepts: YYYY-MM-DD, YYYYMMDD, today, tomorrow, yesterday.',
              },
            },
            required: ['action'],
          },
        },
        {
          name: 'noteplan_paragraphs',
          description:
            'Task lifecycle and paragraph inspection.\n\nParagraph actions:\n- get: Get note lines with metadata (requires filename). Returns line, lineIndex, content, type, etc.\n- search: Search for matching lines in a note (requires query + note ref via id/filename/title/date)\n\nTask actions:\n- search_global: Search tasks across all notes (requires query, supports "*" wildcard)\n- add: Add a task (requires target + content). Target is a date ("today", "tomorrow", "YYYY-MM-DD") for daily notes or a filename for project notes. Pass only the task text as content — formatting auto-matches user settings. Position+heading combos: position="start"+heading inserts right after the heading, position="end"+heading appends at end of that section, position="after-heading" inserts right after heading, position="in-section" appends at end of section. Default position is "end" (bottom of note). Use scheduleDate for >YYYY-MM-DD, [[Note Name]] to link, #tag for tags, @person for mentions.\n- complete: Mark task done (requires filename + lineIndex or line)\n- update: Update task content/status (requires filename + lineIndex or line)',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['get', 'search', 'search_global', 'add', 'complete', 'update'],
                description: 'Action: get | search | search_global | add | complete | update',
              },
              id: {
                type: 'string',
                description: 'Note ID — used by search',
              },
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              title: {
                type: 'string',
                description: 'Note title — used by search',
              },
              date: {
                type: 'string',
                description: 'Calendar date — used by search',
              },
              space: {
                type: 'string',
                description: 'Space name or ID scope',
              },
              query: {
                type: 'string',
                description: 'Search text — required for search, search_global. Use "*" for wildcard in search_global.',
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Case-sensitive match — used by search, search_global',
              },
              wholeWord: {
                type: 'boolean',
                description: 'Whole-word match — used by search, search_global',
              },
              startLine: {
                type: 'number',
                description: 'First line (1-indexed) — used by get',
              },
              endLine: {
                type: 'number',
                description: 'Last line (1-indexed) — used by get',
              },
              contextLines: {
                type: 'number',
                description: 'Context lines around matches — used by search',
              },
              paragraphMaxChars: {
                type: 'number',
                description: 'Max paragraph chars per match — used by search',
              },
              // Task-specific params
              status: {
                type: 'string',
                enum: ['open', 'done', 'cancelled', 'scheduled'],
                description: 'Filter by or set task status — used by search_global, update',
              },
              content: {
                type: 'string',
                description: 'Task content — used by add, update (without marker prefix)',
              },
              target: {
                type: 'string',
                description: 'Target note for add: use a date string (today, tomorrow, yesterday, YYYY-MM-DD, YYYYMMDD) for daily/calendar notes, or a filename path for project notes. Daily notes are auto-created if they don\'t exist.',
              },
              position: {
                type: 'string',
                enum: ['start', 'end', 'after-heading', 'in-section'],
                description: 'Where to add task (default: end). With heading: start=right after heading, end/in-section=end of section. Without heading: start=top of note, end=bottom of note — used by add',
              },
              heading: {
                type: 'string',
                description: 'Heading or section marker text to scope insertion (matches both ## headings and **bold:** section markers). Combine with position to control placement — used by add',
              },
              lineIndex: {
                type: 'number',
                description: 'Task line index (0-based) — used by complete, update',
              },
              line: {
                type: 'number',
                description: 'Task line number (1-based) — used by complete, update',
              },
              priority: {
                type: 'number',
                description: 'Priority 1-3 — used by add',
              },
              indentLevel: {
                type: 'number',
                description: 'Tab indent level — used by add',
              },
              allowEmptyContent: {
                type: 'boolean',
                description: 'Allow empty task content — used by update',
              },
              folder: {
                type: 'string',
                description: 'Folder filter — used by search_global',
              },
              noteQuery: {
                type: 'string',
                description: 'Filter candidate notes — used by search_global',
              },
              noteTypes: {
                type: 'array',
                items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
                description: 'Note type filter — used by search_global',
              },
              preferCalendar: {
                type: 'boolean',
                description: 'Prioritize calendar notes — used by search_global',
              },
              periodicOnly: {
                type: 'boolean',
                description: 'Only periodic calendar notes — used by search_global',
              },
              maxNotes: {
                type: 'number',
                description: 'Max notes to scan — used by search_global',
              },
              scheduleDate: {
                type: 'string',
                description: 'Auto-append >YYYY-MM-DD scheduling date to content. Accepts: YYYY-MM-DD, YYYYMMDD, today, tomorrow, yesterday.',
              },
              limit: {
                type: 'number',
                description: 'Max results to return',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset',
              },
              cursor: {
                type: 'string',
                description: 'Cursor from previous page',
              },
            },
            required: ['action'],
          },
        },
        {
          name: 'noteplan_folders',
          description:
            'Folder and space operations: list, find, resolve, create, move, rename, delete folders, or list spaces.\n\nActions:\n- list: List folders with optional filtering\n- find: Find folder matches for exploration\n- resolve: Resolve to one canonical folder path\n- create: Create a folder (local: path, TeamSpace: space + name)\n- move: Move a folder (requires dryRun/confirmationToken)\n- rename: Rename a folder (requires dryRun/confirmationToken)\n- delete: Delete folder to trash (requires dryRun/confirmationToken)\n- list_spaces: List spaces/workspaces with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'find', 'resolve', 'create', 'move', 'rename', 'delete', 'list_spaces'],
                description: 'Action: list | find | resolve | create | move | rename | delete | list_spaces',
              },
              path: {
                type: 'string',
                description: 'Local folder path — used by create, delete',
              },
              query: {
                type: 'string',
                description: 'Search query — used by list, find, resolve',
              },
              space: {
                type: 'string',
                description: 'Space name or ID scope',
              },
              name: {
                type: 'string',
                description: 'Folder name — used by create (TeamSpace)',
              },
              parent: {
                type: 'string',
                description: 'Parent folder ref — used by create (TeamSpace)',
              },
              parentPath: {
                type: 'string',
                description: 'Parent folder path — used by list',
              },
              recursive: {
                type: 'boolean',
                description: 'Include descendants — used by list',
              },
              includeLocal: {
                type: 'boolean',
                description: 'Include local folders — used by list, find, resolve',
              },
              includeSpaces: {
                type: 'boolean',
                description: 'Include space folders — used by list, find, resolve',
              },
              maxDepth: {
                type: 'number',
                description: 'Max folder depth — used by list, find, resolve',
              },
              sourcePath: {
                type: 'string',
                description: 'Local source folder path — used by move, rename',
              },
              source: {
                type: 'string',
                description: 'TeamSpace source ref — used by move, rename, delete',
              },
              destinationFolder: {
                type: 'string',
                description: 'Local destination folder — used by move',
              },
              destination: {
                type: 'string',
                description: 'TeamSpace destination ref — used by move',
              },
              newName: {
                type: 'string',
                description: 'New folder name — used by rename',
              },
              minScore: {
                type: 'number',
                description: 'Min auto-resolve score — used by resolve',
              },
              ambiguityDelta: {
                type: 'number',
                description: 'Ambiguity delta — used by resolve',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview impact — used by move, rename, delete',
              },
              confirmationToken: {
                type: 'string',
                description: 'Token from dryRun — used by move, rename, delete',
              },
              limit: {
                type: 'number',
                description: 'Max results to return',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset',
              },
              cursor: {
                type: 'string',
                description: 'Cursor from previous page',
              },
            },
            required: ['action'],
          },
        },
        {
          name: 'noteplan_filters',
          description:
            'Saved filter operations: list, get, get_tasks, list_parameters, save, rename.\n\nActions:\n- list: List saved filters\n- get: Get one filter with parsed params (requires name)\n- get_tasks: Execute a filter against tasks (requires name)\n- list_parameters: List supported filter parameter keys\n- save: Create or update a filter (requires name + items)\n- rename: Rename a filter (requires oldName + newName)',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'get', 'get_tasks', 'list_parameters', 'save', 'rename'],
                description: 'Action: list | get | get_tasks | list_parameters | save | rename',
              },
              name: {
                type: 'string',
                description: 'Filter name — used by get, get_tasks, save',
              },
              oldName: {
                type: 'string',
                description: 'Current filter name — used by rename',
              },
              newName: {
                type: 'string',
                description: 'New filter name — used by rename',
              },
              query: {
                type: 'string',
                description: 'Filter names by substring — used by list',
              },
              overwrite: {
                type: 'boolean',
                description: 'Overwrite existing — used by save, rename',
              },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    param: { type: 'string', description: 'Filter parameter key' },
                    value: {
                      oneOf: [
                        { type: 'string' },
                        { type: 'boolean' },
                        { type: 'number' },
                        { type: 'array', items: { type: 'string' } },
                      ],
                      description: 'Filter parameter value',
                    },
                    display: { type: 'boolean', description: 'UI display flag' },
                  },
                  required: ['param', 'value'],
                },
                description: 'Filter items — used by save',
              },
              maxNotes: {
                type: 'number',
                description: 'Max notes to scan — used by get_tasks',
              },
              space: {
                type: 'string',
                description: 'Space ID scope — used by get_tasks',
              },
              folder: {
                type: 'string',
                description: 'Folder scope — used by get_tasks',
              },
              limit: {
                type: 'number',
                description: 'Max results to return',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset',
              },
              cursor: {
                type: 'string',
                description: 'Cursor from previous page',
              },
            },
            required: ['action'],
          },
        },
        {
          name: 'noteplan_eventkit',
          description:
            'macOS Calendar and Reminders operations.\n\nCalendar actions (source="calendar"):\n- get_events: Get events for a date/range\n- list_calendars: List all calendars\n- create_event: Create event (requires title + startDate)\n- update_event: Update event (requires eventId)\n- delete_event: Delete event (requires eventId + dryRun/confirmationToken)\n\nReminder actions (source="reminders"):\n- get: Get reminders (optional list/query filter)\n- list_lists: List reminder lists\n- create: Create reminder (requires title)\n- complete: Mark reminder done (requires reminderId)\n- update: Update reminder (requires reminderId)\n- delete: Delete reminder (requires reminderId + dryRun/confirmationToken)',
          inputSchema: {
            type: 'object',
            properties: {
              source: {
                type: 'string',
                enum: ['calendar', 'reminders'],
                description: 'EventKit source: "calendar" for Calendar.app, "reminders" for Reminders.app',
              },
              action: {
                type: 'string',
                enum: ['get_events', 'list_calendars', 'create_event', 'update_event', 'delete_event', 'get', 'list_lists', 'create', 'complete', 'update', 'delete'],
                description: 'Action: get_events | list_calendars | create_event | update_event | delete_event | get | list_lists | create | complete | update | delete',
              },
              // Calendar params
              eventId: {
                type: 'string',
                description: 'Event ID — calendar: update_event, delete_event',
              },
              date: {
                type: 'string',
                description: 'Date (YYYY-MM-DD, "today", "tomorrow") — calendar: get_events',
              },
              days: {
                type: 'number',
                description: 'Days to fetch — calendar: get_events',
              },
              startDate: {
                type: 'string',
                description: 'Start date/time — calendar: create_event, update_event',
              },
              endDate: {
                type: 'string',
                description: 'End date/time — calendar: create_event, update_event',
              },
              calendar: {
                type: 'string',
                description: 'Calendar name — calendar: get_events, create_event',
              },
              location: {
                type: 'string',
                description: 'Event location — calendar: create_event, update_event',
              },
              allDay: {
                type: 'boolean',
                description: 'All-day event — calendar: create_event',
              },
              // Reminders params
              reminderId: {
                type: 'string',
                description: 'Reminder ID — reminders: complete, update, delete',
              },
              list: {
                type: 'string',
                description: 'Reminder list name — reminders: get, create',
              },
              dueDate: {
                type: 'string',
                description: 'Due date — reminders: create, update',
              },
              priority: {
                type: 'number',
                description: 'Priority: 0 (none), 1 (high), 5 (medium), 9 (low) — reminders: create, update',
              },
              includeCompleted: {
                type: 'boolean',
                description: 'Include completed — reminders: get',
              },
              // Shared params
              title: {
                type: 'string',
                description: 'Title — calendar: create_event, update_event; reminders: create, update',
              },
              notes: {
                type: 'string',
                description: 'Notes — calendar: create_event, update_event; reminders: create, update',
              },
              query: {
                type: 'string',
                description: 'Filter by substring — reminders: get, list_lists',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview impact — calendar: delete_event; reminders: delete',
              },
              confirmationToken: {
                type: 'string',
                description: 'Token from dryRun — calendar: delete_event; reminders: delete',
              },
              limit: {
                type: 'number',
                description: 'Max results to return',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset',
              },
              cursor: {
                type: 'string',
                description: 'Cursor from previous page',
              },
            },
            required: ['source', 'action'],
          },
        },
        {
          name: 'noteplan_memory',
          description:
            'User preference memory operations.\n\nActions:\n- list: List/search stored memories\n- save: Save a new memory (requires content)\n- update: Update memory content/tags (requires id)\n- delete: Delete a memory (requires id)',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'save', 'update', 'delete'],
                description: 'Action: list | save | update | delete',
              },
              id: {
                type: 'string',
                description: 'Memory ID — used by update, delete',
              },
              content: {
                type: 'string',
                description: 'Memory content — used by save, update',
                minLength: 1,
                maxLength: 2000,
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 10,
                description: 'Tags — used by save, update. Suggested: style, formatting, workflow, correction, naming, structure, preference',
              },
              tag: {
                type: 'string',
                description: 'Filter by tag — used by list',
              },
              query: {
                type: 'string',
                description: 'Search content — used by list',
              },
              limit: {
                type: 'number',
                description: 'Max results — used by list',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset — used by list',
              },
            },
            required: ['action'],
          },
        },
        {
          name: 'noteplan_search',
          description:
            'Search across notes or list tags.\n\nActions:\n- search (default): Full-text or metadata search across notes. Use searchField, queryMode, propertyFilters, etc.\n- list_tags: List all tags/hashtags with optional filtering.\n\nSearch: discover notes by content/keywords/phrases and optional frontmatter property filters (e.g. {"category":"marketing"}). Use queryMode=smart/any/all for multi-word token matching, and query="*" for browse mode. Folder filters accept canonical paths from noteplan_folders (action: list/resolve), with or without "Notes/" prefix.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['search', 'list_tags'],
                description: 'Action to perform (default: search)',
              },
              query: {
                type: 'string',
                description: 'Search query (required for search). Supports OR patterns like "meeting|standup". For list_tags, filters tags by substring.',
              },
              space: {
                type: 'string',
                description: 'Space name or ID — used by search, list_tags',
              },
              searchField: {
                type: 'string',
                enum: ['content', 'title', 'filename', 'title_or_filename'],
                description:
                  'Search scope. Use "title" or "title_or_filename" for fast note discovery by version/name. Default: content',
              },
              queryMode: {
                type: 'string',
                enum: ['phrase', 'smart', 'any', 'all'],
                description:
                  'Multi-word behavior for content search: phrase (exact phrase), smart (token OR + relevance threshold), any (any token), all (all tokens). Default: smart',
              },
              minTokenMatches: {
                type: 'number',
                description:
                  'When queryMode is smart/any/all, minimum token matches required per note (auto by default)',
              },
              types: {
                type: 'array',
                items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
                description: 'Filter by note types',
              },
              folders: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by folders (canonical path, e.g. "20 - Areas"; "Notes/20 - Areas" is also accepted). If multiple folders are provided, the first is used for full-text scope.',
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
              propertyFilters: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Exact frontmatter property filters (all must match), e.g. {"category":"marketing"}',
              },
              propertyCaseSensitive: {
                type: 'boolean',
                description: 'Case-sensitive frontmatter property matching (default: false)',
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
          },
        },
      ];

  if (embeddingsToolsEnabled) {
    toolDefinitions.push(
      {
        name: 'noteplan_embeddings',
        description:
          'Embeddings/vector search operations.\n\nActions:\n- status: Get embeddings config and index status\n- search: Semantic search over index (requires query)\n- sync: Build/refresh embeddings index\n- reset: Delete index rows (requires dryRun/confirmationToken)',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['status', 'search', 'sync', 'reset'],
              description: 'Action: status | search | sync | reset',
            },
            query: {
              type: 'string',
              description: 'Search query text — used by search',
            },
            space: {
              type: 'string',
              description: 'Space name or ID scope',
            },
            types: {
              type: 'array',
              items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
              description: 'Note type filter — used by search, sync',
            },
            source: {
              type: 'string',
              enum: ['local', 'space'],
              description: 'Source filter — used by search',
            },
            limit: {
              type: 'number',
              description: 'Max results — used by search, sync',
            },
            offset: {
              type: 'number',
              description: 'Pagination offset — used by sync',
            },
            minScore: {
              type: 'number',
              description: 'Min cosine similarity — used by search',
            },
            includeText: {
              type: 'boolean',
              description: 'Include full chunk text — used by search',
            },
            previewChars: {
              type: 'number',
              description: 'Preview length — used by search',
            },
            maxChunks: {
              type: 'number',
              description: 'Max chunks to scan — used by search',
            },
            noteQuery: {
              type: 'string',
              description: 'Note filter substring — used by sync',
            },
            forceReembed: {
              type: 'boolean',
              description: 'Force recompute — used by sync',
            },
            pruneMissing: {
              type: 'boolean',
              description: 'Remove stale rows — used by sync',
            },
            batchSize: {
              type: 'number',
              description: 'API batch size — used by sync',
            },
            maxChunksPerNote: {
              type: 'number',
              description: 'Max chunks per note — used by sync',
            },
            dryRun: {
              type: 'boolean',
              description: 'Preview impact — used by reset',
            },
            confirmationToken: {
              type: 'string',
              description: 'Token from dryRun — used by reset',
            },
          },
          required: ['action'],
        },
      }
    );
  }

  // noteplan_ui is always available — basic AppleScript commands work on all NotePlan versions
  toolDefinitions.push({
    name: 'noteplan_ui',
    description:
      'NotePlan UI control via AppleScript.\n\nActions:\n- open_note: Open a note (title or filename)\n- open_today: Open today\'s note\n- search: Search in UI\n- run_plugin: Run a plugin command (requires pluginId + command)\n- open_view: Open a named view\n- toggle_sidebar: Toggle sidebar visibility\n- close_plugin_window: Close plugin window (by windowID/title, or omit both to close all)\n- list_plugin_windows: List open plugin windows\n- backup: Create a full backup of all notes, calendars, themes, filters, and plugin data. Old backups are pruned automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open_note', 'open_today', 'search', 'run_plugin', 'open_view', 'toggle_sidebar', 'close_plugin_window', 'list_plugin_windows', 'backup'],
          description: 'Action: open_note | open_today | search | run_plugin | open_view | toggle_sidebar | close_plugin_window | list_plugin_windows | backup',
        },
        title: {
          type: 'string',
          description: 'Note title — used by open_note; window title — used by close_plugin_window',
        },
        filename: {
          type: 'string',
          description: 'Filename — used by open_note',
        },
        inNewWindow: {
          type: 'boolean',
          description: 'Open in new window — used by open_note',
        },
        inSplitView: {
          type: 'boolean',
          description: 'Open in split view — used by open_note',
        },
        query: {
          type: 'string',
          description: 'Search text — used by search',
        },
        pluginId: {
          type: 'string',
          description: 'Plugin ID — used by run_plugin',
        },
        command: {
          type: 'string',
          description: 'Command name — used by run_plugin',
        },
        arguments: {
          type: 'string',
          description: 'JSON arguments string — used by run_plugin',
        },
        name: {
          type: 'string',
          description: 'View name — used by open_view',
        },
        windowID: {
          type: 'string',
          description: 'Window ID — used by close_plugin_window',
        },
      },
      required: ['action'],
    },
  });

  // Always register all tools — if NotePlan is too old for a specific action,
  // the action handler returns a helpful upgrade message instead of hiding the tool entirely.
  toolDefinitions.push(
    {
      name: 'noteplan_plugins',
        description:
          'Plugin management: list, create, delete, install, read source/log, update HTML, screenshot.\n\nActions:\n- list: List installed plugins\n- list_available: List plugins from online repository\n- create: Create plugin with HTML view (requires pluginId, pluginName, commandName, html)\n- delete: Delete plugin (requires pluginId + confirmationToken)\n- install: Install from repository (requires pluginId)\n- log: Read plugin console log (requires pluginId)\n- source: Read plugin source (requires pluginId)\n- update_html: Apply find/replace patches (requires pluginId + patches)\n- screenshot: Capture plugin WebView screenshot (requires pluginId)',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'list_available', 'create', 'delete', 'install', 'log', 'source', 'update_html', 'screenshot'],
              description: 'Action: list | list_available | create | delete | install | log | source | update_html | screenshot',
            },
            pluginId: {
              type: 'string',
              description: 'Plugin ID — used by create, delete, install, log, source, update_html, screenshot',
            },
            pluginName: {
              type: 'string',
              description: 'Display name — used by create',
            },
            commandName: {
              type: 'string',
              description: 'Command name — used by create',
            },
            html: {
              type: 'string',
              description: 'HTML content — used by create',
            },
            icon: {
              type: 'string',
              description: 'Font Awesome icon name — used by create',
            },
            iconColor: {
              type: 'string',
              description: 'Tailwind color — used by create',
            },
            displayMode: {
              type: 'string',
              enum: ['main', 'split', 'window'],
              description: 'Display mode (default: main) — used by create',
            },
            autoLaunch: {
              type: 'boolean',
              description: 'Auto-reload and run — used by create, update_html',
            },
            patches: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  find: { type: 'string' },
                  replace: { type: 'string' },
                },
                required: ['find', 'replace'],
              },
              description: 'Find/replace patches — used by update_html',
            },
            query: {
              type: 'string',
              description: 'Filter/search — used by list, list_available, source',
            },
            includeBeta: {
              type: 'boolean',
              description: 'Include beta plugins — used by list_available',
            },
            tail: {
              type: 'integer',
              description: 'Return last N lines — used by log',
            },
            clear: {
              type: 'boolean',
              description: 'Clear log after reading — used by log',
            },
            startLine: {
              type: 'integer',
              description: 'Start line (1-based) — used by source',
            },
            endLine: {
              type: 'integer',
              description: 'End line (1-based) — used by source',
            },
            contextLines: {
              type: 'integer',
              description: 'Context lines around matches — used by source',
            },
            confirmationToken: {
              type: 'string',
              description: 'Token for confirmation — used by delete',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'noteplan_themes',
        description:
          'Theme management: list, get, save, set active.\n\nActions:\n- list: List all themes and active theme names\n- get: Read a custom theme JSON (requires filename)\n- save: Create/update a custom theme (requires filename + theme)\n- set_active: Activate a theme (requires name)',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'get', 'save', 'set_active'],
              description: 'Action: list | get | save | set_active',
            },
            filename: {
              type: 'string',
              description: 'Theme filename — used by get, save',
            },
            name: {
              type: 'string',
              description: 'Theme name — used by set_active',
            },
            theme: {
              type: 'object',
              description: 'Theme object — used by save',
              properties: {
                name: { type: 'string' },
                style: { type: 'string', enum: ['Light', 'Dark'] },
                author: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' } } },
                editor: { type: 'object' },
                styles: { type: 'object' },
              },
            },
            setActive: {
              type: 'boolean',
              description: 'Apply theme immediately — used by save (default: true)',
            },
            mode: {
              type: 'string',
              enum: ['light', 'dark', 'auto'],
              description: 'Mode to apply for — used by save, set_active',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'noteplan_templates',
        description:
          'Template operations: list available templates or render a template.\n\nActions:\n- list: List templates from @Templates folder with their types and preview\n- render: Render a template by title (saved template) or raw content string (for debugging). Rendering requires a recent NotePlan build.\n\nDebugging workflow: After creating or editing a template, use render with its title or raw content to verify the output. Check variables, date formatting, and logic. If rendering fails or produces unexpected output, read the plugin log via noteplan_plugins(action: "log", pluginId: "np.Templating") for error details.\n\nTemplate syntax: <%- expr %> (output), <% code %> (logic), <%= expr %> (escaped output). Common helpers: date.now("YYYY-MM-DD"), web.weather(), date.tomorrow("format").',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'render'],
              description: 'Action: list | render',
            },
            templateTitle: {
              type: 'string',
              description: 'Template title — used by render (loads a saved template by title)',
            },
            content: {
              type: 'string',
              description: 'Raw template content string — used by render (renders arbitrary template code for debugging)',
            },
            folder: {
              type: 'string',
              description: 'Template subfolder — used by list (default: @Templates)',
            },
            limit: {
              type: 'number',
              description: 'Maximum results — used by list',
            },
            offset: {
              type: 'number',
              description: 'Pagination offset — used by list',
            },
            cursor: {
              type: 'string',
              description: 'Cursor from previous page — used by list',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'noteplan_attachments',
        description:
          'Attachment operations: add files/images to notes, list attachments, get attachment data, or move between notes.\n\nActions:\n- add: Write a file to the note\'s _attachments folder. Requires data (base64) + attachmentFilename. Returns markdownLink — use noteplan_edit_content to place it in the note (insertLink defaults to false).\n- list: List all attachments for a note with filenames, sizes, and markdown links.\n- get: Get attachment metadata. Set includeData=true for base64 content. Use maxDataSize to cap large images.\n- move: Move an attachment between notes. Source note via id/filename/title/date, destination via destinationId/destinationFilename/destinationTitle/destinationDate. Moves file, removes old link from source, returns new markdownLink.\n\nAttachments are stored in {notename}_attachments/ sibling folder. Images: ![image](path), files: ![file](path). Use attachmentFilename for both add, get, and move.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['add', 'list', 'get', 'move'],
              description: 'Action: add | list | get | move',
            },
            id: { type: 'string', description: 'Source note ID — used by all actions' },
            filename: { type: 'string', description: 'Source note filename/path — used by all actions' },
            title: { type: 'string', description: 'Source note title — used by all actions' },
            date: { type: 'string', description: 'Source calendar note date (YYYYMMDD or YYYY-MM-DD) — used by all actions' },
            query: { type: 'string', description: 'Search query to find the source note' },
            space: { type: 'string', description: 'Space name or ID' },
            data: { type: 'string', description: 'Base64-encoded file data — required for add' },
            attachmentFilename: { type: 'string', description: 'Attachment filename (e.g. "photo.png") — required for add, get, and move' },
            mimeType: { type: 'string', description: 'MIME type hint (e.g. "image/png") — used by add' },
            insertLink: { type: 'boolean', description: 'Auto-insert markdown link into note — used by add (default: false). Prefer placing links yourself via noteplan_edit_content.' },
            destinationId: { type: 'string', description: 'Destination note ID — used by move' },
            destinationFilename: { type: 'string', description: 'Destination note filename — used by move' },
            destinationTitle: { type: 'string', description: 'Destination note title — used by move' },
            destinationDate: { type: 'string', description: 'Destination calendar note date — used by move' },
            includeData: { type: 'boolean', description: 'Include base64 data in response — used by get (default: false)' },
            maxDataSize: { type: 'number', description: 'Max file size in bytes for data inclusion — used by get. Files exceeding this are skipped.' },
          },
          required: ['action'],
        },
      },
  );

  const annotatedToolDefinitions: ToolDefinition[] = toolDefinitions.map((tool): ToolDefinition => ({
    ...tool,
    inputSchema: withDebugTimingsInputSchema(tool.inputSchema),
    annotations: getToolAnnotations(tool.name),
    outputSchema: getToolOutputSchema(tool.name),
  }));
  const toolDefinitionByName = new Map(annotatedToolDefinitions.map((tool) => [tool.name, tool]));
  const registeredToolNames = annotatedToolDefinitions.map((tool) => tool.name);
  const registeredToolNameSet = new Set(registeredToolNames);
  const compactToolDefinitions = annotatedToolDefinitions.map((tool) => compactToolDefinition(tool));

  // Register tool listing handler — all 12 tools returned directly (no pagination needed)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: compactToolDefinitions };
  });

  // Register resource listing handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: PLUGIN_API_RESOURCES.map((r) => ({
        uri: `noteplan://plugin-api/${r.file}`,
        name: r.name,
        description: r.desc,
        mimeType: r.file.endsWith('.md') ? 'text/markdown' : r.file.endsWith('.json') ? 'application/json' : 'text/javascript',
      })),
    };
  });

  // Register resource read handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const prefix = 'noteplan://plugin-api/';
    if (!uri.startsWith(prefix)) {
      throw new Error(`Unknown resource URI: ${uri}`);
    }
    const filename = uri.slice(prefix.length);
    const entry = PLUGIN_API_RESOURCES.find((r) => r.file === filename);
    if (!entry) {
      throw new Error(`Unknown resource: ${filename}. Available: ${PLUGIN_API_RESOURCES.map((r) => r.file).join(', ')}`);
    }
    const filePath = path.join(PLUGIN_API_DOCS_DIR, entry.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Resource file not found on disk: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      contents: [
        {
          uri,
          mimeType: entry.file.endsWith('.md') ? 'text/markdown' : entry.file.endsWith('.json') ? 'application/json' : 'text/javascript',
          text: content,
        },
      ],
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const normalizedName = normalizeToolName(name);
    const includeTiming = isDebugTimingsEnabled(args);
    const startTime = Date.now();

    try {
      let result;

      switch (normalizedName) {
        // ── Primary consolidated tools ──
        case 'noteplan_get_notes':
          result = dispatchGetNotes((args ?? {}) as Record<string, unknown>);
          break;
        case 'noteplan_search': {
          const searchAction = (args as any)?.action;
          if (searchAction === 'list_tags') {
            result = spaceTools.listTags(args as any);
          } else {
            result = await searchTools.searchNotes(args as any);
          }
          break;
        }
        case 'noteplan_manage_note': {
          const action = (args as any)?.action;
          const spaceWriteActions = new Set(['create', 'update', 'delete', 'move']);
          if ((args as any)?.space && spaceWriteActions.has(action) && !advancedFeaturesEnabled) {
            result = { success: false, error: upgradeMessage(`space write (${action})`), code: 'ERR_VERSION_GATE' };
            break;
          }
          switch (action) {
            case 'create': result = noteTools.createNote(args as any); break;
            case 'update': result = noteTools.updateNote(args as any); break;
            case 'delete': result = noteTools.deleteNote(args as any); break;
            case 'move': result = noteTools.moveNote(args as any); break;
            case 'restore': result = noteTools.restoreNote(args as any); break;
            case 'rename': result = noteTools.renameNoteFile(args as any); break;
            case 'set_property': result = noteTools.setProperty(args as any); break;
            case 'remove_property': result = noteTools.removeProperty(args as any); break;
            default: throw new Error(`Unknown action: "${action}". Valid actions: create, update, delete, move, restore, rename, set_property, remove_property`);
          }
          break;
        }
        case 'noteplan_edit_content': {
          const a = args as any;
          if (a.space && !advancedFeaturesEnabled) {
            const editAction = a?.action ?? 'edit';
            result = { success: false, error: upgradeMessage(`space write (${editAction})`), code: 'ERR_VERSION_GATE' };
            break;
          }
          if (a.scheduleDate && a.content) {
            a.content = appendScheduleDate(a.content, a.scheduleDate);
          }
          const action = a?.action;
          switch (action) {
            case 'insert': result = noteTools.insertContent(a); break;
            case 'append': result = noteTools.appendContent(a); break;
            case 'delete_lines': result = noteTools.deleteLines(a); break;
            case 'edit_line': result = noteTools.editLine(a); break;
            case 'replace_lines': result = noteTools.replaceLines(a); break;
            default: throw new Error(`Unknown action: "${action}". Valid actions: insert, append, delete_lines, edit_line, replace_lines (snake_case required)`);
          }
          break;
        }
        case 'noteplan_paragraphs': {
          const a = args as any;
          const paragraphWriteActions = new Set(['add', 'complete', 'update']);
          if (a.space && paragraphWriteActions.has(a.action) && !advancedFeaturesEnabled) {
            result = { success: false, error: upgradeMessage(`space write (${a.action})`), code: 'ERR_VERSION_GATE' };
            break;
          }
          if (a.scheduleDate && a.content) {
            a.content = appendScheduleDate(a.content, a.scheduleDate);
          }
          // Derive `target` for addTaskToNote from date/filename when not provided
          if (!a.target && (a.date || a.filename)) {
            a.target = a.date || a.filename;
          }
          const action = a?.action;
          switch (action) {
            case 'get': result = noteTools.getParagraphs(a); break;
            case 'search': result = noteTools.searchParagraphs(a); break;
            case 'search_global': result = taskTools.searchTasksGlobal(a); break;
            case 'add': result = taskTools.addTaskToNote(a); break;
            case 'complete': result = taskTools.completeTask(a); break;
            case 'update': result = taskTools.updateTask(a); break;
            default: throw new Error(`Unknown action: ${action}`);
          }
          break;
        }
        case 'noteplan_folders': {
          const action = (args as any)?.action;
          const folderWriteActions = new Set(['create', 'move', 'rename', 'delete']);
          if ((args as any)?.space && folderWriteActions.has(action) && !advancedFeaturesEnabled) {
            result = { success: false, error: upgradeMessage(`space folder (${action})`), code: 'ERR_VERSION_GATE' };
            break;
          }
          switch (action) {
            case 'list': result = spaceTools.listFolders(args as any); break;
            case 'find': result = spaceTools.findFolders(args as any); break;
            case 'resolve': result = spaceTools.resolveFolder(args as any); break;
            case 'create': result = spaceTools.createFolder(args as any); break;
            case 'move': result = spaceTools.moveFolder(args as any); break;
            case 'rename': result = spaceTools.renameFolder(args as any); break;
            case 'delete': result = spaceTools.deleteFolder(args as any); break;
            case 'list_spaces': result = spaceTools.listSpaces(args as any); break;
            default: throw new Error(`Unknown action: ${action}`);
          }
          break;
        }
        case 'noteplan_filters': {
          const action = (args as any)?.action;
          switch (action) {
            case 'list': result = filterTools.listFilters(args as any); break;
            case 'get': result = filterTools.getFilter(args as any); break;
            case 'get_tasks': result = filterTools.getFilterTasks(args as any); break;
            case 'list_parameters': result = filterTools.listFilterParameters(); break;
            case 'save': result = filterTools.saveFilter(args as any); break;
            case 'rename': result = filterTools.renameFilter(args as any); break;
            default: throw new Error(`Unknown action: ${action}`);
          }
          break;
        }
        case 'noteplan_eventkit': {
          const a = args as any;
          const source = a?.source;
          const action = a?.action;
          if (source === 'reminders') {
            switch (action) {
              case 'get': result = reminderTools.getReminders(a); break;
              case 'list_lists': result = reminderTools.listReminderLists(a); break;
              case 'create': result = reminderTools.createReminder(a); break;
              case 'complete': result = reminderTools.completeReminder(a); break;
              case 'update': result = reminderTools.updateReminder(a); break;
              case 'delete': result = reminderTools.deleteReminder(a); break;
              default: throw new Error(`Unknown action: ${action}`);
            }
          } else {
            switch (action) {
              case 'get_events': result = eventTools.getEvents(a); break;
              case 'list_calendars': result = eventTools.listCalendars(a); break;
              case 'create_event': result = eventTools.createEvent(a); break;
              case 'update_event': result = eventTools.updateEvent(a); break;
              case 'delete_event': result = eventTools.deleteEvent(a); break;
              default: throw new Error(`Unknown action: ${action}`);
            }
          }
          break;
        }
        case 'noteplan_memory': {
          const action = (args as any)?.action;
          switch (action) {
            case 'list': result = memoryTools.listMemories(args as any); break;
            case 'save': result = memoryTools.saveMemory(args as any); break;
            case 'update': result = memoryTools.updateMemory(args as any); break;
            case 'delete': result = memoryTools.deleteMemory(args as any); break;
            default: throw new Error(`Unknown action: ${action}`);
          }
          break;
        }
        case 'noteplan_ui': {
          const action = (args as any)?.action;
          switch (action) {
            case 'open_note': result = uiTools.openNote(args as any); break;
            case 'open_today': result = uiTools.openToday(args as any); break;
            case 'search': result = uiTools.searchNotes(args as any); break;
            case 'run_plugin': result = uiTools.runPlugin(args as any); break;
            case 'open_view': result = uiTools.openView(args as any); break;
            case 'toggle_sidebar': result = uiTools.toggleSidebar(args as any); break;
            case 'close_plugin_window': result = uiTools.closePluginWindow(args as any); break;
            case 'list_plugin_windows': result = uiTools.listPluginWindows(args as any); break;
            case 'backup': {
              if (versionInfo.build < MIN_BUILD_CREATE_BACKUP) {
                result = { success: false, error: `Backup requires NotePlan build ${MIN_BUILD_CREATE_BACKUP}+. Current: ${versionInfo.build}.`, code: 'ERR_VERSION_GATE' };
              } else {
                result = uiTools.createBackup(args as any);
              }
              break;
            }
            default: {
              // Help the LLM recover from common mistakes (camelCase, missing underscore, etc.)
              const UI_ACTION_ALIASES: Record<string, string> = {
                open: 'open_note', opennote: 'open_note', open_notes: 'open_note',
                opentoday: 'open_today', today: 'open_today',
                openview: 'open_view', view: 'open_view',
                runplugin: 'run_plugin', plugin: 'run_plugin',
                togglesidebar: 'toggle_sidebar', sidebar: 'toggle_sidebar',
                closepluginwindow: 'close_plugin_window',
                listpluginwindows: 'list_plugin_windows',
                navigate: 'open_note', show: 'open_note', select: 'open_note',
              };
              const normalized = (action || '').toLowerCase().replace(/[\s_-]/g, '');
              const resolved = UI_ACTION_ALIASES[normalized];
              if (resolved) {
                (args as any).action = resolved;
                // Re-dispatch with corrected action
                switch (resolved) {
                  case 'open_note': result = uiTools.openNote(args as any); break;
                  case 'open_today': result = uiTools.openToday(args as any); break;
                  case 'search': result = uiTools.searchNotes(args as any); break;
                  case 'run_plugin': result = uiTools.runPlugin(args as any); break;
                  case 'open_view': result = uiTools.openView(args as any); break;
                  case 'toggle_sidebar': result = uiTools.toggleSidebar(args as any); break;
                  case 'close_plugin_window': result = uiTools.closePluginWindow(args as any); break;
                  case 'list_plugin_windows': result = uiTools.listPluginWindows(args as any); break;
                  case 'backup': result = uiTools.createBackup(args as any); break;
                  default: throw new Error(`Unknown action: ${action}. Valid actions: open_note, open_today, search, run_plugin, open_view, toggle_sidebar, close_plugin_window, list_plugin_windows, backup`);
                }
              } else {
                throw new Error(`Unknown action: "${action}". Valid actions: open_note, open_today, search, run_plugin, open_view, toggle_sidebar, close_plugin_window, list_plugin_windows, backup`);
              }
            }
          }
          break;
        }
        case 'noteplan_plugins': {
          const action = (args as any)?.action;
          switch (action) {
            case 'list': result = pluginTools.listPlugins(args as any); break;
            case 'list_available': result = pluginTools.listAvailablePlugins(args as any); break;
            case 'create': result = pluginTools.createPlugin(args as any); break;
            case 'delete': result = pluginTools.deletePlugin(args as any); break;
            case 'install': result = pluginTools.installPlugin(args as any); break;
            case 'log': result = pluginTools.getPluginLog(args as any); break;
            case 'source': result = pluginTools.getPluginSource(args as any); break;
            case 'update_html': result = pluginTools.updatePluginHtml(args as any); break;
            case 'screenshot': result = pluginTools.screenshotPlugin(args as any); break;
            default: throw new Error(`Unknown action: ${action}`);
          }
          break;
        }
        case 'noteplan_themes': {
          const action = (args as any)?.action;
          switch (action) {
            case 'list': result = themeTools.listThemes(args as any); break;
            case 'get': result = themeTools.getTheme(args as any); break;
            case 'save': result = themeTools.saveTheme(args as any); break;
            case 'set_active': result = themeTools.setTheme(args as any); break;
            default: throw new Error(`Unknown action: ${action}`);
          }
          break;
        }
        case 'noteplan_embeddings': {
          const action = (args as any)?.action;
          switch (action) {
            case 'status': result = embeddingsTools.embeddingsStatus(args as any); break;
            case 'search': result = await embeddingsTools.embeddingsSearch(args as any); break;
            case 'sync': result = await embeddingsTools.embeddingsSync(args as any); break;
            case 'reset': result = embeddingsTools.embeddingsReset(args as any); break;
            default: throw new Error(`Unknown action: ${action}`);
          }
          break;
        }
        case 'noteplan_templates': {
          const action = (args as any)?.action;
          switch (action) {
            case 'list': result = templateTools.listTemplates(args as any); break;
            case 'render': result = templateTools.renderTemplate(args as any); break;
            default: throw new Error(`Unknown action: ${action}`);
          }
          break;
        }

        case 'noteplan_attachments': {
          const action = (args as any)?.action;
          switch (action) {
            case 'add': result = attachmentTools.addAttachment(args as any); break;
            case 'list': result = attachmentTools.listAttachments(args as any); break;
            case 'get': result = attachmentTools.getAttachment(args as any); break;
            case 'move': result = attachmentTools.moveAttachment(args as any); break;
            default: throw new Error(`Unknown action: ${action}. Valid actions: add, list, get, move`);
          }
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name} (normalized: ${normalizedName})`);
      }

      const enrichedResult = enrichErrorResult(result, normalizedName, registeredToolNames);
      const resultWithSuggestions = withSuggestedNextTools(enrichedResult, normalizedName, registeredToolNameSet);
      const resultWithMemory = withMemoryHints(resultWithSuggestions, normalizedName);
      const resultWithDuration = withDuration(resultWithMemory, Date.now() - startTime, includeTiming);
      const hasOutputSchema = Boolean(toolDefinitionByName.get(normalizedName)?.outputSchema);

      // If the result contains image data, return it as an MCP image content block
      const typedResult = resultWithDuration as Record<string, unknown>;
      if (typedResult._imageData && typedResult._imageMimeType) {
        const imageData = typedResult._imageData as string;
        const imageMimeType = typedResult._imageMimeType as string;
        // Strip image data from the text response to avoid bloating it
        const { _imageData: _, _imageMimeType: __, ...textResult } = typedResult;
        return {
          content: [
            {
              type: 'image' as const,
              data: imageData,
              mimeType: imageMimeType,
            },
            {
              type: 'text' as const,
              text: JSON.stringify(textResult),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(resultWithDuration),
          },
        ],
        ...(hasOutputSchema ? { structuredContent: resultWithDuration } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const meta = inferToolErrorMeta(normalizedName, errorMessage, registeredToolNames);
      const errorResult: Record<string, unknown> = {
        success: false,
        error: errorMessage,
        code: meta.code,
        hint: meta.hint,
        suggestedTool: meta.suggestedTool,
        retryable: meta.retryable,
      };
      const errorWithDuration = withDuration(errorResult, Date.now() - startTime, includeTiming);
      const hasOutputSchema = Boolean(toolDefinitionByName.get(normalizedName)?.outputSchema);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(errorWithDuration),
          },
        ],
        ...(hasOutputSchema ? { structuredContent: errorWithDuration } : {}),
        isError: true,
      };
    }
  });

  return server;
}

// Start the server with stdio transport
export async function startServer(): Promise<void> {
  console.error(`[noteplan-mcp] Starting v${getMcpServerVersion()} (Node ${process.version}, ${process.platform} ${process.arch})`);
  await initSqlite();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[noteplan-mcp] Server running on stdio');
}
