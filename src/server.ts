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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_API_DOCS_DIR = path.join(__dirname, '../../Shared/Supporting Files/np.myplugin');

const PLUGIN_API_RESOURCES = [
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
const CREATE_NOTE_OUTPUT_SCHEMA = outputSchemaWithErrors({
  note: { type: 'object' },
  folderResolution: { type: 'object' },
});
const PARAGRAPHS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  note: { type: 'object' },
  lineCount: { type: 'number' },
  rangeStartLine: { type: 'number' },
  rangeEndLine: { type: 'number' },
  rangeLineCount: { type: 'number' },
  returnedLineCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  content: { type: 'string' },
  lines: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        line: { type: 'number' },
        lineIndex: { type: 'number' },
        content: { type: 'string' },
        type: { type: 'string', enum: ['title', 'heading', 'task', 'checklist', 'bullet', 'quote', 'separator', 'empty', 'text'] },
        indentLevel: { type: 'number' },
        headingLevel: { type: 'number' },
        taskStatus: { type: 'string', enum: ['open', 'done', 'cancelled', 'scheduled'] },
        priority: { type: 'number' },
        marker: { type: 'string', enum: ['*', '-', '+'] },
        hasCheckbox: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        mentions: { type: 'array', items: { type: 'string' } },
        scheduledDate: { type: 'string' },
      },
    },
  },
});
const SEARCH_PARAGRAPHS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  rangeStartLine: { type: 'number' },
  rangeEndLine: { type: 'number' },
  searchedLineCount: { type: 'number' },
  note: { type: 'object' },
  matches: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        line: { type: 'number' },
        lineIndex: { type: 'number' },
        content: { type: 'string' },
        type: { type: 'string', enum: ['title', 'heading', 'task', 'checklist', 'bullet', 'quote', 'separator', 'empty', 'text'] },
        indentLevel: { type: 'number' },
        headingLevel: { type: 'number' },
        taskStatus: { type: 'string', enum: ['open', 'done', 'cancelled', 'scheduled'] },
        priority: { type: 'number' },
        marker: { type: 'string', enum: ['*', '-', '+'] },
        hasCheckbox: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        mentions: { type: 'array', items: { type: 'string' } },
        scheduledDate: { type: 'string' },
        paragraphStartLine: { type: 'number' },
        paragraphEndLine: { type: 'number' },
        paragraph: { type: 'string' },
        paragraphTruncated: { type: 'boolean' },
        contextBefore: { type: 'array', items: { type: 'string' } },
        contextAfter: { type: 'array', items: { type: 'string' } },
      },
    },
  },
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
const TASKS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  note: { type: 'object' },
  taskCount: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  tasks: { type: 'array', items: { type: 'object' } },
});
const SEARCH_TASKS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  note: { type: 'object' },
  matches: { type: 'array', items: { type: 'object' } },
});
const SEARCH_TASKS_GLOBAL_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  scannedNoteCount: { type: 'number' },
  totalNotes: { type: 'number' },
  truncatedByMaxNotes: { type: 'boolean' },
  maxNotes: { type: 'number' },
  noteTypes: { type: 'array', items: { type: 'string' } },
  preferCalendar: { type: 'boolean' },
  periodicOnly: { type: 'boolean' },
  matches: { type: 'array', items: { type: 'object' } },
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
const FILTERS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  filters: { type: 'array', items: { type: 'object' } },
});
const FILTER_OUTPUT_SCHEMA = outputSchemaWithErrors({
  filter: { type: 'object' },
  mappedQuery: { type: 'object' },
  unsupportedRules: { type: 'array', items: { type: 'string' } },
  matches: { type: 'array', items: { type: 'object' } },
});
const FILTER_PARAMS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  parameters: { type: 'array', items: { type: 'object' } },
  timeframeValues: { type: 'array', items: { type: 'string' } },
});
const LIST_FOLDERS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  maxDepth: { type: 'number' },
  parentPath: { type: ['string', 'null'] },
  recursive: { type: 'boolean' },
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
const EMBEDDINGS_STATUS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  enabled: { type: 'boolean' },
  configured: { type: 'boolean' },
  provider: { type: 'string' },
  model: { type: 'string' },
  baseUrl: { type: 'string' },
  dbPath: { type: 'string' },
  hasApiKey: { type: 'boolean' },
  chunkChars: { type: 'number' },
  chunkOverlap: { type: 'number' },
  previewChars: { type: 'number' },
  noteCount: { type: 'number' },
  chunkCount: { type: 'number' },
  lastSyncAt: { type: ['string', 'null'] },
  lastIndexedUpdateAt: { type: ['string', 'null'] },
  warning: { type: 'string' },
});
const EMBEDDINGS_SYNC_OUTPUT_SCHEMA = outputSchemaWithErrors({
  provider: { type: 'string' },
  model: { type: 'string' },
  scope: { type: 'object' },
  totalCandidates: { type: 'number' },
  scannedNotes: { type: 'number' },
  indexedNotes: { type: 'number' },
  unchangedNotes: { type: 'number' },
  addedNotes: { type: 'number' },
  updatedNotes: { type: 'number' },
  indexedChunks: { type: 'number' },
  prunedNotes: { type: 'number' },
  prunedChunks: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  nextCursor: { type: ['string', 'null'] },
  warnings: { type: 'array', items: { type: 'string' } },
});
const EMBEDDINGS_SEARCH_OUTPUT_SCHEMA = outputSchemaWithErrors({
  query: { type: 'string' },
  provider: { type: 'string' },
  model: { type: 'string' },
  includeText: { type: 'boolean' },
  minScore: { type: 'number' },
  scannedChunks: { type: 'number' },
  count: { type: 'number' },
  matches: { type: 'array', items: { type: 'object' } },
});
const MEMORY_OUTPUT_SCHEMA = outputSchemaWithErrors({
  memory: { type: 'object' },
  totalMemories: { type: 'number' },
  message: { type: 'string' },
});
const MEMORY_DELETE_OUTPUT_SCHEMA = outputSchemaWithErrors({
  deletedId: { type: 'string' },
  remainingCount: { type: 'number' },
  message: { type: 'string' },
});
const MEMORY_LIST_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  totalCount: { type: 'number' },
  offset: { type: 'number' },
  limit: { type: 'number' },
  hasMore: { type: 'boolean' },
  memories: { type: 'array', items: { type: 'object' } },
});

const PLUGINS_LIST_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  plugins: { type: 'array', items: { type: 'object' } },
});

const AVAILABLE_PLUGINS_OUTPUT_SCHEMA = outputSchemaWithErrors({
  count: { type: 'number' },
  plugins: { type: 'array', items: { type: 'object' } },
});

function getToolOutputSchema(toolName: string): Record<string, unknown> {
  switch (toolName) {
    case 'noteplan_get_note':
    case 'noteplan_get_today':
    case 'noteplan_get_calendar_note':
    case 'noteplan_get_periodic_note':
      return NOTE_OUTPUT_SCHEMA;
    case 'noteplan_get_recent_periodic_notes':
      return RANGE_NOTES_OUTPUT_SCHEMA;
    case 'noteplan_list_notes':
      return NOTES_LIST_OUTPUT_SCHEMA;
    case 'noteplan_resolve_note':
      return RESOLVE_NOTE_OUTPUT_SCHEMA;
    case 'noteplan_create_note':
      return CREATE_NOTE_OUTPUT_SCHEMA;
    case 'noteplan_get_paragraphs':
      return PARAGRAPHS_OUTPUT_SCHEMA;
    case 'noteplan_search_paragraphs':
      return SEARCH_PARAGRAPHS_OUTPUT_SCHEMA;
    case 'noteplan_search':
      return SEARCH_NOTES_OUTPUT_SCHEMA;
    case 'noteplan_get_tasks':
      return TASKS_OUTPUT_SCHEMA;
    case 'noteplan_search_tasks':
      return SEARCH_TASKS_OUTPUT_SCHEMA;
    case 'noteplan_search_tasks_global':
      return SEARCH_TASKS_GLOBAL_OUTPUT_SCHEMA;
    case 'noteplan_add_task':
    case 'noteplan_complete_task':
    case 'noteplan_update_task':
    case 'noteplan_create_folder':
    case 'noteplan_move_folder':
    case 'noteplan_rename_folder':
    case 'noteplan_save_filter':
    case 'noteplan_rename_filter':
    case 'noteplan_update_note':
    case 'noteplan_delete_note':
    case 'noteplan_move_note':
    case 'noteplan_rename_note_file':
    case 'noteplan_restore_note':
    case 'noteplan_set_property':
    case 'noteplan_remove_property':
    case 'noteplan_insert_content':
    case 'noteplan_append_content':
    case 'noteplan_delete_lines':
    case 'noteplan_replace_lines':
    case 'noteplan_edit_line':
    case 'noteplan_add_to_today':
    case 'calendar_create_event':
    case 'calendar_update_event':
    case 'calendar_delete_event':
    case 'reminders_create':
    case 'reminders_complete':
    case 'reminders_update':
    case 'reminders_delete':
    case 'noteplan_embeddings_reset':
    case 'noteplan_ui_open_note':
    case 'noteplan_ui_open_today':
    case 'noteplan_ui_search':
    case 'noteplan_ui_run_plugin_command':
    case 'noteplan_ui_open_view':
    case 'noteplan_ui_toggle_sidebar':
    case 'noteplan_ui_close_plugin_window':
    case 'noteplan_create_plugin':
    case 'noteplan_delete_plugin':
    case 'noteplan_install_plugin':
      return MESSAGE_OUTPUT_SCHEMA;
    case 'noteplan_list_plugins':
      return PLUGINS_LIST_OUTPUT_SCHEMA;
    case 'noteplan_get_plugin_log':
    case 'noteplan_get_plugin_source':
      return MESSAGE_OUTPUT_SCHEMA;
    case 'noteplan_list_available_plugins':
      return AVAILABLE_PLUGINS_OUTPUT_SCHEMA;
    case 'noteplan_list_themes':
    case 'noteplan_get_theme':
    case 'noteplan_save_theme':
    case 'noteplan_set_theme':
      return MESSAGE_OUTPUT_SCHEMA;
    case 'noteplan_get_notes_in_range':
      return RANGE_NOTES_OUTPUT_SCHEMA;
    case 'noteplan_get_notes_in_folder':
      return FOLDER_NOTES_OUTPUT_SCHEMA;
    case 'noteplan_list_spaces':
      return SPACES_OUTPUT_SCHEMA;
    case 'noteplan_list_tags':
      return TAGS_OUTPUT_SCHEMA;
    case 'noteplan_list_filters':
      return FILTERS_OUTPUT_SCHEMA;
    case 'noteplan_get_filter':
    case 'noteplan_get_filter_tasks':
      return FILTER_OUTPUT_SCHEMA;
    case 'noteplan_list_filter_parameters':
      return FILTER_PARAMS_OUTPUT_SCHEMA;
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
    case 'noteplan_embeddings_status':
      return EMBEDDINGS_STATUS_OUTPUT_SCHEMA;
    case 'noteplan_embeddings_sync':
      return EMBEDDINGS_SYNC_OUTPUT_SCHEMA;
    case 'noteplan_embeddings_search':
      return EMBEDDINGS_SEARCH_OUTPUT_SCHEMA;
    case 'noteplan_memory_save':
    case 'noteplan_memory_update':
      return MEMORY_OUTPUT_SCHEMA;
    case 'noteplan_memory_delete':
      return MEMORY_DELETE_OUTPUT_SCHEMA;
    case 'noteplan_memory_list':
      return MEMORY_LIST_OUTPUT_SCHEMA;
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
    'noteplan_search_paragraphs',
    'noteplan_search',
    'noteplan_get_tasks',
    'noteplan_search_tasks',
    'noteplan_search_tasks_global',
    'noteplan_get_calendar_note',
    'noteplan_get_periodic_note',
    'noteplan_get_recent_periodic_notes',
    'noteplan_get_notes_in_range',
    'noteplan_get_notes_in_folder',
    'noteplan_list_spaces',
    'noteplan_list_tags',
    'noteplan_list_filters',
    'noteplan_get_filter',
    'noteplan_get_filter_tasks',
    'noteplan_list_filter_parameters',
    'noteplan_list_folders',
    'noteplan_find_folders',
    'noteplan_resolve_folder',
    'noteplan_embeddings_status',
    'noteplan_embeddings_search',
    'noteplan_search_tools',
    'noteplan_get_tool_details',
    'calendar_get_events',
    'calendar_list_calendars',
    'reminders_get',
    'reminders_list_lists',
    'noteplan_memory_list',
    'noteplan_list_themes',
    'noteplan_get_theme',
    'noteplan_list_plugins',
    'noteplan_get_plugin_log',
    'noteplan_get_plugin_source',
    'noteplan_list_available_plugins',
  ]);

  const destructiveTools = new Set([
    'noteplan_delete_note',
    'noteplan_move_note',
    'noteplan_rename_note_file',
    'noteplan_move_folder',
    'noteplan_rename_folder',
    'noteplan_delete_lines',
    'noteplan_replace_lines',
    'noteplan_remove_property',
    'noteplan_update_note',
    'noteplan_edit_line',
    'noteplan_update_task',
    'noteplan_rename_filter',
    'noteplan_embeddings_reset',
    'calendar_delete_event',
    'reminders_delete',
    'noteplan_memory_delete',
    'noteplan_memory_update',
    'noteplan_delete_plugin',
  ]);

  const nonIdempotentTools = new Set([
    'noteplan_create_note',
    'noteplan_insert_content',
    'noteplan_append_content',
    'noteplan_delete_note',
    'noteplan_move_note',
    'noteplan_rename_note_file',
    'noteplan_restore_note',
    'noteplan_create_folder',
    'noteplan_move_folder',
    'noteplan_rename_folder',
    'noteplan_save_filter',
    'noteplan_rename_filter',
    'noteplan_delete_lines',
    'noteplan_replace_lines',
    'noteplan_add_task',
    'noteplan_add_to_today',
    'noteplan_embeddings_sync',
    'noteplan_embeddings_reset',
    'calendar_create_event',
    'calendar_delete_event',
    'reminders_create',
    'reminders_delete',
    'noteplan_memory_save',
    'noteplan_memory_delete',
    'noteplan_create_plugin',
    'noteplan_delete_plugin',
    'noteplan_install_plugin',
    'noteplan_ui_run_plugin_command',
    'noteplan_ui_toggle_sidebar',
    'noteplan_save_theme',
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
    'noteplan_embeddings_sync',
    'noteplan_embeddings_search',
    'noteplan_list_available_plugins',
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

  if (toolName.startsWith('calendar_')) {
    aliases.push('calendar', 'event', 'events', 'schedule', 'meeting', 'appointment');
  }

  if (toolName.startsWith('reminders_')) {
    aliases.push('reminder', 'reminders', 'todo', 'task', 'checklist');
  }
  if (toolName.includes('embeddings_')) {
    aliases.push('embeddings', 'semantic search', 'vector search', 'similarity');
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
  if (toolName.includes('get_recent_periodic_notes')) {
    aliases.push('recent weekly notes', 'recent periodic notes', 'weekly notes', 'monthly notes');
  }
  if (toolName.includes('list_filters') || toolName.includes('get_filter') || toolName.includes('save_filter') || toolName.includes('rename_filter')) {
    aliases.push('filters', 'saved filters', 'task filters', 'noteplan filters');
  }
  if (toolName.includes('get_filter_tasks')) {
    aliases.push('filter tasks', 'tasks from filter', 'run filter');
  }
  if (toolName.includes('list_filter_parameters')) {
    aliases.push('filter parameters', 'filter keys', 'filter schema');
  }
  if (toolName.includes('search_paragraphs')) {
    aliases.push('search paragraph', 'find paragraph', 'find matching lines', 'paragraph lookup');
  }
  if (toolName.includes('replace_lines')) {
    aliases.push('replace lines', 'batch line edit', 'atomic range edit', 'multi-line replace');
  }
  if (toolName.includes('search_tasks')) {
    aliases.push('search tasks', 'find task', 'task lookup', 'task line index');
  }
  if (toolName.includes('search_tasks_global')) {
    aliases.push('global tasks', 'all tasks', 'tasks across notes', 'open tasks');
  }
  if (toolName.includes('move_note')) {
    aliases.push('move note', 'move file', 'relocate note', 'reorganize folder');
  }
  if (toolName.includes('rename_note_file')) {
    aliases.push('rename note file', 'rename filename', 'sync filename with title');
  }
  if (toolName.includes('create_folder')) {
    aliases.push('create folder', 'new folder', 'make folder');
  }
  if (toolName.includes('move_folder')) {
    aliases.push('move folder', 'reorganize folder', 'relocate folder');
  }
  if (toolName.includes('rename_folder')) {
    aliases.push('rename folder', 'rename directory');
  }
  if (toolName.includes('restore_note')) {
    aliases.push('restore note', 'undo delete note', 'recover note from trash');
  }
  if (toolName.includes('get_note') || toolName.includes('list_notes') || toolName.includes('create_note') || toolName.includes('update_note')) {
    aliases.push('notes', 'documents', 'markdown');
  }
  if (toolName.includes('memory_')) {
    aliases.push('memory', 'memories', 'preference', 'preferences', 'remember', 'correction');
  }
  if (toolName.includes('plugin')) {
    aliases.push('plugin', 'plugins', 'extension', 'command', 'addon');
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

  if (message.includes('embeddings are disabled')) {
    return {
      code: 'ERR_EMBEDDINGS_DISABLED',
      hint: 'Enable embeddings in MCP env: NOTEPLAN_EMBEDDINGS_ENABLED=true.',
      suggestedTool: 'noteplan_embeddings_status',
    };
  }

  if (message.includes('embeddings api key is missing')) {
    return {
      code: 'ERR_EMBEDDINGS_NOT_CONFIGURED',
      hint: 'Set NOTEPLAN_EMBEDDINGS_API_KEY (and optionally provider/model/base URL), then retry sync/search.',
      suggestedTool: 'noteplan_embeddings_status',
    };
  }

  if (message.includes('provide one note reference')) {
    return {
      code: 'ERR_INVALID_ARGUMENT',
      hint: 'Pass one of: id, filename, title, or date to identify the note target.',
      suggestedTool: 'noteplan_resolve_note',
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
      suggestedTool: 'noteplan_get_tasks',
    };
  }
  if (message.includes('provide at least one field to update')) {
    return {
      code: 'ERR_INVALID_ARGUMENT',
      hint: 'For noteplan_update_task, pass content, status, or both.',
      suggestedTool: 'noteplan_update_task',
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
  if (message.includes('empty replacement content is blocked')) {
    return {
      code: 'ERR_EMPTY_CONTENT_BLOCKED',
      hint: 'Use noteplan_delete_lines for deletion, or set allowEmptyContent=true for intentional empty replacement.',
      suggestedTool: 'noteplan_delete_lines',
    };
  }

  if (message.includes('supported for local notes only') || message.includes('supported for project notes only')) {
    return {
      code: 'ERR_UNSUPPORTED_TARGET',
      hint: 'These tools currently operate on local project notes under Notes/.',
      suggestedTool: 'noteplan_get_note',
    };
  }

  if (message.includes('not in teamspace @trash') || message.includes('local note is not in @trash')) {
    return {
      code: 'ERR_NOT_IN_TRASH',
      hint: 'Restore only works for notes currently in trash.',
      suggestedTool: 'noteplan_delete_note',
    };
  }

  if (message.includes('note is in trash')) {
    return {
      code: 'ERR_NOTE_IN_TRASH',
      hint: 'Use noteplan_restore_note to recover this note, then retry the operation.',
      suggestedTool: 'noteplan_restore_note',
    };
  }

  if (message.includes('full note replacement is blocked')) {
    return {
      code: 'ERR_FULL_REPLACE_CONFIRMATION_REQUIRED',
      hint: 'Set fullReplace=true only for intentional whole-note rewrites; otherwise use granular edit tools.',
      suggestedTool: 'noteplan_search_paragraphs',
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

  if (message.includes('not found') && toolName.includes('filter')) {
    return {
      code: 'ERR_NOT_FOUND',
      hint: 'List filters first, then retry with an exact filter name.',
      suggestedTool: 'noteplan_list_filters',
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

function withSuggestedNextTools(result: unknown, toolName: string): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const typed = result as Record<string, unknown>;
  if (typed.success !== true) return result;
  if (Array.isArray(typed.suggestedNextTools) && typed.suggestedNextTools.length > 0) return result;

  let suggestedNextTools: string[] = [];
  switch (toolName) {
    case 'noteplan_resolve_note':
      suggestedNextTools = ['noteplan_get_note', 'noteplan_search_paragraphs', 'noteplan_get_paragraphs'];
      break;
    case 'noteplan_get_note':
      suggestedNextTools = ['noteplan_search_paragraphs', 'noteplan_get_paragraphs'];
      break;
    case 'noteplan_get_paragraphs':
    case 'noteplan_search_paragraphs':
    case 'noteplan_replace_lines':
      suggestedNextTools = ['noteplan_edit_line', 'noteplan_insert_content', 'noteplan_delete_lines'];
      break;
    case 'noteplan_get_tasks':
    case 'noteplan_search_tasks':
    case 'noteplan_search_tasks_global':
      suggestedNextTools = ['noteplan_update_task', 'noteplan_complete_task'];
      break;
    case 'noteplan_search':
      suggestedNextTools = ['noteplan_get_note', 'noteplan_resolve_note'];
      break;
    case 'noteplan_get_recent_periodic_notes':
      suggestedNextTools = ['noteplan_get_note', 'noteplan_search_tasks_global'];
      break;
    case 'noteplan_list_filters':
      suggestedNextTools = ['noteplan_get_filter', 'noteplan_get_filter_tasks'];
      break;
    case 'noteplan_get_filter':
      suggestedNextTools = ['noteplan_get_filter_tasks', 'noteplan_save_filter'];
      break;
    case 'noteplan_get_filter_tasks':
      suggestedNextTools = ['noteplan_complete_task', 'noteplan_update_task'];
      break;
    case 'noteplan_list_filter_parameters':
      suggestedNextTools = ['noteplan_save_filter', 'noteplan_get_filter'];
      break;
    case 'noteplan_delete_note':
      suggestedNextTools = ['noteplan_restore_note', 'noteplan_list_notes'];
      break;
    case 'noteplan_move_note':
    case 'noteplan_rename_note_file':
      suggestedNextTools = ['noteplan_get_note', 'noteplan_list_notes'];
      break;
    case 'noteplan_restore_note':
      suggestedNextTools = ['noteplan_get_note', 'noteplan_list_notes'];
      break;
    case 'noteplan_search_tools':
      suggestedNextTools = ['noteplan_get_tool_details'];
      break;
    case 'noteplan_embeddings_status':
      suggestedNextTools = ['noteplan_embeddings_sync', 'noteplan_embeddings_search'];
      break;
    case 'noteplan_embeddings_sync':
      suggestedNextTools = ['noteplan_embeddings_search', 'noteplan_embeddings_status'];
      break;
    case 'noteplan_embeddings_search':
      suggestedNextTools = ['noteplan_get_note', 'noteplan_resolve_note'];
      break;
    case 'noteplan_embeddings_reset':
      suggestedNextTools = ['noteplan_embeddings_sync', 'noteplan_embeddings_status'];
      break;
    case 'noteplan_resolve_folder':
      suggestedNextTools = ['noteplan_create_note', 'noteplan_list_notes'];
      break;
    case 'noteplan_create_folder':
      suggestedNextTools = ['noteplan_list_folders', 'noteplan_create_note'];
      break;
    case 'noteplan_move_folder':
    case 'noteplan_rename_folder':
      suggestedNextTools = ['noteplan_list_folders', 'noteplan_resolve_folder'];
      break;
    case 'noteplan_save_filter':
    case 'noteplan_rename_filter':
      suggestedNextTools = ['noteplan_get_filter', 'noteplan_get_filter_tasks'];
      break;
    case 'noteplan_memory_save':
    case 'noteplan_memory_update':
      suggestedNextTools = ['noteplan_memory_list'];
      break;
    case 'noteplan_memory_list':
      suggestedNextTools = ['noteplan_memory_update', 'noteplan_memory_delete'];
      break;
    case 'noteplan_memory_delete':
      suggestedNextTools = ['noteplan_memory_list'];
      break;
    case 'noteplan_list_plugins':
      suggestedNextTools = ['noteplan_ui_run_plugin_command', 'noteplan_create_plugin', 'noteplan_get_plugin_source', 'noteplan_list_available_plugins'];
      break;
    case 'noteplan_create_plugin':
    case 'noteplan_delete_plugin':
      suggestedNextTools = ['noteplan_list_plugins'];
      break;
    case 'noteplan_get_plugin_source':
      suggestedNextTools = ['noteplan_create_plugin', 'noteplan_ui_run_plugin_command'];
      break;
    case 'noteplan_list_available_plugins':
      suggestedNextTools = ['noteplan_install_plugin'];
      break;
    case 'noteplan_install_plugin':
      suggestedNextTools = ['noteplan_list_plugins', 'noteplan_ui_run_plugin_command'];
      break;
    case 'noteplan_get_plugin_log':
      suggestedNextTools = ['noteplan_ui_run_plugin_command', 'noteplan_create_plugin'];
      break;
    default:
      suggestedNextTools = [];
  }

  if (suggestedNextTools.length === 0) return result;
  return {
    ...typed,
    suggestedNextTools,
  };
}

const MEMORY_HINT_TOOLS = new Set([
  'noteplan_insert_content',
  'noteplan_append_content',
  'noteplan_edit_line',
  'noteplan_replace_lines',
  'noteplan_delete_lines',
  'noteplan_add_task',
  'noteplan_add_to_today',
  'noteplan_complete_task',
  'noteplan_update_task',
  'noteplan_set_property',
  'noteplan_create_note',
  'noteplan_update_note',
]);

function withMemoryHints(result: unknown, toolName: string): unknown {
  if (!MEMORY_HINT_TOOLS.has(toolName)) return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const typed = result as Record<string, unknown>;
  if (typed.success !== true) return result;

  try {
    const count = memoryTools.getMemoryCount();
    const tip =
      count > 0
        ? `You have ${count} stored memory/memories. Consider checking noteplan_memory_list before making formatting or style decisions.`
        : 'No memories stored yet. If the user states a preference or corrects your formatting, save it with noteplan_memory_save.';
    return {
      ...typed,
      memoryHints: { storedMemories: count, tip },
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
      name: 'noteplan-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );
  const embeddingsToolsEnabled = embeddingsTools.areEmbeddingsToolsEnabled();

  const toolDefinitions: ToolDefinition[] = [
        // Note operations
        {
          name: 'noteplan_get_note',
          description:
            'Get a note by ID, title, filename, or date. Default is metadata/preview only; set includeContent=true for paged line content. For targeted edits, prefer noteplan_search_paragraphs/noteplan_get_paragraphs plus line-level mutation tools. Prefer ID from noteplan_search for space notes.',
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
              includeContent: {
                type: 'boolean',
                description: 'Include note body content and line payload (default: false)',
              },
              startLine: {
                type: 'number',
                description: 'First line to include when includeContent=true (1-indexed)',
              },
              endLine: {
                type: 'number',
                description: 'Last line to include when includeContent=true (1-indexed)',
              },
              limit: {
                type: 'number',
                description: 'Maximum lines to return when includeContent=true (default: 500, max: 1000)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset within selected range (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
              previewChars: {
                type: 'number',
                description: 'Preview length when includeContent=false (default: 280)',
              },
            },
          },
        },
        {
          name: 'noteplan_list_notes',
          description:
            'List notes with filtering and pagination. Folder filters target project-note folders under Notes/ (e.g., "20 - Areas" or "Notes/20 - Areas").',
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description:
                  'Project folder path filter (e.g., "20 - Areas" or "Notes/20 - Areas")',
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
            'Replace all note content. Use only when rewriting the full note is intentional. Requires fullReplace=true plus dryRun-issued confirmationToken. Prefer noteplan_search_paragraphs + noteplan_edit_line / noteplan_insert_content / noteplan_delete_lines for targeted updates. Empty content is blocked unless allowEmptyContent=true.',
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
              fullReplace: {
                type: 'boolean',
                description: 'Required safety confirmation for whole-note rewrite. Must be true to proceed.',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview full-rewrite impact and get confirmationToken without modifying the note',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for full note rewrite',
              },
              allowEmptyContent: {
                type: 'boolean',
                description: 'Allow replacing note content with empty/blank text (default: false)',
              },
            },
            required: ['filename', 'content', 'fullReplace'],
          },
        },
        {
          name: 'noteplan_delete_note',
          description: 'Delete a note by moving it to trash. Local notes move to local @Trash; TeamSpace notes move to TeamSpace @Trash. Requires dryRun-issued confirmationToken.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID (preferred for TeamSpace notes)',
              },
              filename: {
                type: 'string',
                description: 'Filename/path of the note to delete',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview deletion impact without deleting (default: false)',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for delete execution',
              },
            },
            anyOf: [
              { required: ['id'] },
              { required: ['filename'] },
            ],
          },
        },
        {
          name: 'noteplan_move_note',
          description:
            'Move a note to another folder. Local notes move within Notes; TeamSpace notes move by parent folder in the same space. Requires dryRun-issued confirmationToken.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID (preferred for TeamSpace notes)',
              },
              filename: {
                type: 'string',
                description: 'Filename/path of the note to move',
              },
              destinationFolder: {
                type: 'string',
                description: 'Destination folder. Local: path in Notes (if full path is passed, basename must match current file). TeamSpace: folder ID/path/name or "root"',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview move impact and get confirmationToken without modifying the note',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for move execution',
              },
            },
            required: ['destinationFolder'],
            anyOf: [
              { required: ['id'] },
              { required: ['filename'] },
            ],
          },
        },
        {
          name: 'noteplan_rename_note_file',
          description:
            'Rename the filename of a local project note (file path only, does not edit title/content). Requires dryRun-issued confirmationToken before execution. Useful for aligning filenames with note titles.',
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the local project note to rename',
              },
              newFilename: {
                type: 'string',
                description: 'New filename. Can be bare filename or full path in the same folder; current extension is preserved by default',
              },
              keepExtension: {
                type: 'boolean',
                description: 'Keep current extension (.md/.txt) even if newFilename includes another extension (default: true)',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview rename impact and get confirmationToken without modifying the note',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for rename execution',
              },
            },
            required: ['filename', 'newFilename'],
          },
        },
        {
          name: 'noteplan_restore_note',
          description:
            'Restore a trashed note. Use the id/filename returned by noteplan_delete_note. Local notes restore from local @Trash into Notes. TeamSpace notes restore from TeamSpace @Trash into space root (or destination folder). Requires dryRun-issued confirmationToken.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID (preferred for TeamSpace notes)',
              },
              filename: {
                type: 'string',
                description: 'Filename/path of the trashed note to restore',
              },
              destinationFolder: {
                type: 'string',
                description: 'Restore destination. Local: path in Notes. TeamSpace: folder ID/path/name or "root"',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview restore impact and get confirmationToken without modifying the note',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for restore execution',
              },
            },
            anyOf: [
              { required: ['id'] },
              { required: ['filename'] },
            ],
          },
        },

        // Note structure
        {
          name: 'noteplan_get_paragraphs',
          description: `Get note content with line numbers, paragraph type metadata, optional line-range filters, and pagination.

Returns each line with:
- line: 1-indexed line number (for display/user communication)
- lineIndex: 0-indexed line number (use this for API calls like complete_task/update_task)
- content: the text content of that line
- type: paragraph type (title, heading, task, checklist, bullet, quote, separator, empty, text)
- indentLevel: tab indentation depth (0 = no indent)
- headingLevel: 1-6 (only for title/heading types)
- taskStatus: open/done/cancelled/scheduled (only for task/checklist types)
- priority: 1-3 (only when !/!!/!!! present)
- marker: */- /+ (only for task/checklist/bullet types)
- hasCheckbox: whether line uses [ ] checkbox syntax (only for task/checklist)
- tags: array of #hashtags found in the line (only when present)
- mentions: array of @mentions found in the line (only when present)
- scheduledDate: YYYY-MM-DD (only when >date present)

Use this when you need to:
- See exactly which line contains what content
- Find the correct lineIndex for task updates/completion
- Determine 1-indexed line values for insert_content, edit_line, or delete_lines
- Understand the structure of a note (which lines are tasks, headings, etc.)

For large notes, use startLine/endLine and cursor pagination to fetch progressively.`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              startLine: {
                type: 'number',
                description: 'First line to include (1-indexed, inclusive)',
              },
              endLine: {
                type: 'number',
                description: 'Last line to include (1-indexed, inclusive)',
              },
              limit: {
                type: 'number',
                description: 'Maximum lines to return (default: 200, max: 1000)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset within selected range (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
            },
            required: ['filename'],
          },
        },
        {
          name: 'noteplan_search_paragraphs',
          description: `Find matching lines/paragraph blocks inside one note, with pagination, line references, and paragraph type metadata for targeted edits.

Each match includes type metadata: type (title/heading/task/checklist/bullet/quote/separator/empty/text), indentLevel, and conditional fields headingLevel, taskStatus, priority, marker, hasCheckbox, tags, mentions, scheduledDate.

At least one note reference is required: id, title, filename, or date. If none is provided, this returns an error.

Recommended flow:
1. noteplan_resolve_note
2. noteplan_search_paragraphs (or noteplan_get_paragraphs)
3. noteplan_edit_line / noteplan_insert_content / noteplan_delete_lines

Prefer this over full note rewrites when only part of a note should change.`,
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID (preferred for space notes)',
              },
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
              space: {
                type: 'string',
                description: 'Space ID to search in',
              },
              query: {
                type: 'string',
                description: 'Text to find in note lines/paragraphs',
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Case-sensitive match (default: false)',
              },
              wholeWord: {
                type: 'boolean',
                description: 'Require whole-word matches (default: false)',
              },
              startLine: {
                type: 'number',
                description: 'First line to search (1-indexed, inclusive)',
              },
              endLine: {
                type: 'number',
                description: 'Last line to search (1-indexed, inclusive)',
              },
              contextLines: {
                type: 'number',
                description: 'Context lines before/after each match (default: 1, max: 5)',
              },
              paragraphMaxChars: {
                type: 'number',
                description: 'Maximum paragraph text chars per match (default: 600, max: 5000)',
              },
              limit: {
                type: 'number',
                description: 'Maximum matches to return (default: 20, max: 200)',
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
            required: ['query'],
            anyOf: [
              { required: ['id'] },
              { required: ['filename'] },
              { required: ['title'] },
              { required: ['date'] },
            ],
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
- "at-line": At a specific line number (requires line parameter, 1-indexed). Content is inserted BEFORE the target line.

Use this when the user wants to:
- Add a paragraph under a heading
- Insert content at a specific location
- Add content at the start without touching frontmatter

Inserting empty/blank lines:
- To insert ONE empty line before line N: use position="at-line", line=N, content="" (empty string).
- To insert an empty line with type metadata, use type="empty" with content="".

Newline handling: A single trailing newline is automatically stripped from content before insertion. This means content="A\\nB\\n" inserts exactly 2 lines (A and B), not 2 lines plus a blank. To add a blank line after your content, use a separate insert_content call with content="".

Structured typing: set "type" to auto-format content with correct markdown markers. For example, type="task" with taskStatus="open" generates the correct task prefix from user preferences. Available types: title, heading, task, checklist, bullet, quote, separator, empty, text.

IMPORTANT: Always use tab characters (\\t) for indentation. NotePlan does not use spaces for indentation.

This is SAFER than reading and rewriting the whole note.
List/task lines are normalized to tab indentation by default (indentationStyle="tabs").

Tip: you can target the note via id, filename, title, date, or query.`,
          inputSchema: {
            type: 'object',
            properties: {
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
                description: 'Note title target (resolved if unique)',
              },
              date: {
                type: 'string',
                description: 'Calendar note date target (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)',
              },
              query: {
                type: 'string',
                description: 'Resolvable note query (fuzzy note lookup before insert)',
              },
              space: {
                type: 'string',
                description: 'Space ID scope for title/date/query resolution',
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
                description: 'Heading text (required for after-heading; pass with or without leading # marks)',
              },
              line: {
                type: 'number',
                description: 'Line number, 1-indexed (required for at-line position)',
              },
              indentationStyle: {
                type: 'string',
                enum: ['tabs', 'preserve'],
                description: 'Indentation normalization for inserted list/task lines. Default: tabs',
              },
              type: {
                type: 'string',
                enum: ['title', 'heading', 'task', 'checklist', 'bullet', 'quote', 'separator', 'empty', 'text'],
                description: 'Paragraph type — auto-formats content with correct markdown markers when set',
              },
              taskStatus: {
                type: 'string',
                enum: ['open', 'done', 'cancelled', 'scheduled'],
                description: 'Task/checklist status (default: open). Only used when type is task or checklist',
              },
              headingLevel: {
                type: 'number',
                description: 'Heading level 1-6 (only used when type is heading or title)',
              },
              priority: {
                type: 'number',
                description: 'Priority 1-3 (! / !! / !!!) appended to task/checklist lines',
              },
              indentLevel: {
                type: 'number',
                description: 'Tab indentation level for task/checklist/bullet lines (0-10)',
              },
            },
            required: ['content', 'position'],
            anyOf: [
              { required: ['id'] },
              { required: ['filename'] },
              { required: ['title'] },
              { required: ['date'] },
              { required: ['query'] },
            ],
          },
        },
        {
          name: 'noteplan_append_content',
          description: `Append content to the end of any note.

Use this when the user wants to add content to the end of a note.
This is a shorthand for insert_content with position="end".

This is SAFER than reading and rewriting the whole note.
Prefer this only for explicit append intent; otherwise use noteplan_insert_content for positional control.
List/task lines are normalized to tab indentation by default (indentationStyle="tabs").

Tip: you can target the note via id, filename, title, date, or query.`,
          inputSchema: {
            type: 'object',
            properties: {
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
                description: 'Note title target (resolved if unique)',
              },
              date: {
                type: 'string',
                description: 'Calendar note date target (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)',
              },
              query: {
                type: 'string',
                description: 'Resolvable note query (fuzzy note lookup before append)',
              },
              space: {
                type: 'string',
                description: 'Space ID scope for title/date/query resolution',
              },
              content: {
                type: 'string',
                description: 'Content to append',
              },
              indentationStyle: {
                type: 'string',
                enum: ['tabs', 'preserve'],
                description: 'Indentation normalization for appended list/task lines. Default: tabs',
              },
            },
            required: ['content'],
            anyOf: [
              { required: ['id'] },
              { required: ['filename'] },
              { required: ['title'] },
              { required: ['date'] },
              { required: ['query'] },
            ],
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
Execution requires a dryRun-issued confirmationToken.
⚠️ If deleted lines contain attachment references like ![file](...) or ![image](...), NotePlan may auto-trash the referenced attachment files.

Recommended flow:
1. noteplan_resolve_note
2. noteplan_search_paragraphs or noteplan_get_paragraphs
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
              dryRun: {
                type: 'boolean',
                description: 'Preview lines that would be deleted without modifying the note (default: false)',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for delete execution',
              },
            },
            required: ['filename', 'startLine', 'endLine'],
          },
        },
        {
          name: 'noteplan_replace_lines',
          description: `Atomically replace a contiguous range of lines in one operation.

Use this for multi-line rewrites to avoid line-number drift across repeated edit_line calls.
Execution requires a dryRun-issued confirmationToken.
⚠️ If replaced lines remove attachment references like ![file](...) or ![image](...), NotePlan may auto-trash referenced attachment files.
List/task lines are normalized to tab indentation by default (indentationStyle="tabs").

Recommended flow:
1. noteplan_resolve_note
2. noteplan_search_paragraphs or noteplan_get_paragraphs
3. noteplan_replace_lines`,
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              startLine: {
                type: 'number',
                description: 'First line to replace (1-indexed, inclusive)',
              },
              endLine: {
                type: 'number',
                description: 'Last line to replace (1-indexed, inclusive)',
              },
              content: {
                type: 'string',
                description: 'Replacement content for the selected line range',
              },
              indentationStyle: {
                type: 'string',
                enum: ['tabs', 'preserve'],
                description: 'Indentation normalization for replacement list/task lines. Default: tabs',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview replacement impact and get confirmationToken without modifying the note',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for replace execution',
              },
              allowEmptyContent: {
                type: 'boolean',
                description: 'Allow replacing selected lines with empty/blank text (default: false). Prefer noteplan_delete_lines for pure deletion.',
              },
            },
            required: ['filename', 'startLine', 'endLine', 'content'],
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

IMPORTANT: Always use tab characters (\\t) for indentation. NotePlan does not use spaces for indentation.
Paragraph types: title, heading, task, checklist, bullet, quote, separator, empty, text.
Task states: open (* [ ]), done (* [x]), cancelled (* [-]), scheduled (* [>]). The marker (*/- ) depends on user preferences.

This is SAFER than noteplan_update_note which replaces the entire note.
If content contains newline characters, this becomes a multi-line replacement and line numbers can shift.
⚠️ If the edit removes attachment references like ![file](...) or ![image](...), NotePlan may auto-trash referenced attachment files.
List/task lines are normalized to tab indentation by default (indentationStyle="tabs").

To insert a blank line BEFORE a line, use noteplan_insert_content with position="at-line", content="" instead of embedding \\n in edit_line content.

Recommended flow:
1. noteplan_resolve_note
2. noteplan_search_paragraphs or noteplan_get_paragraphs
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
              indentationStyle: {
                type: 'string',
                enum: ['tabs', 'preserve'],
                description: 'Indentation normalization for edited list/task lines. Default: tabs',
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
            'Search across notes by content (full-text) or metadata (title/filename) via searchField. Use this to discover notes by content/keywords/phrases and optional frontmatter property filters (e.g. {"category":"marketing"}). Use queryMode=smart/any/all for multi-word token matching (instead of strict phrase-only search), and query="*" for browse mode (metadata listing, no text match scoring). Folder filters accept canonical paths from noteplan_list_folders/noteplan_resolve_folder, with or without "Notes/" prefix.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query. Supports OR patterns like "meeting|standup"',
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
            required: ['query'],
          },
        },

        // Task operations
        {
          name: 'noteplan_get_tasks',
          description:
            'Get tasks from one note with optional status/query filtering and pagination. Requires one note reference (id, filename, title, or date). For cross-note task lookup use noteplan_search_tasks_global.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID (preferred for space notes)',
              },
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
              space: {
                type: 'string',
                description: 'Space ID to search in',
              },
              status: {
                type: 'string',
                enum: ['open', 'done', 'cancelled', 'scheduled'],
                description: 'Filter by task status',
              },
              query: {
                type: 'string',
                description: 'Filter tasks by content substring',
              },
              limit: {
                type: 'number',
                description: 'Maximum tasks to return (default: 100, max: 500)',
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
            anyOf: [
              { required: ['id'] },
              { required: ['filename'] },
              { required: ['title'] },
              { required: ['date'] },
            ],
          },
        },
        {
          name: 'noteplan_search_tasks',
          description:
            'Search task lines inside one note and return matching task line indexes for targeted task updates. Requires one note reference (id, filename, title, or date); if none is provided, this returns an error. For cross-note task lookup use noteplan_search_tasks_global.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID (preferred for space notes)',
              },
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
              space: {
                type: 'string',
                description: 'Space ID to search in',
              },
              query: {
                type: 'string',
                description: 'Task query text',
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Case-sensitive task text search (default: false)',
              },
              wholeWord: {
                type: 'boolean',
                description: 'Whole-word task text match (default: false)',
              },
              status: {
                type: 'string',
                enum: ['open', 'done', 'cancelled', 'scheduled'],
                description: 'Filter by task status before query match',
              },
              limit: {
                type: 'number',
                description: 'Maximum matches to return (default: 20, max: 200)',
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
            required: ['query'],
            anyOf: [
              { required: ['id'] },
              { required: ['filename'] },
              { required: ['title'] },
              { required: ['date'] },
            ],
          },
        },
        {
          name: 'noteplan_search_tasks_global',
          description:
            'Search tasks across multiple notes and return note+line references for targeted updates/completions. Supports query="*" wildcard to list tasks without keyword filtering. Use noteTypes/preferCalendar/periodicOnly to prioritize weekly/daily note workflows.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Task query text across notes. Use "*" to match all tasks.',
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Case-sensitive task text search (default: false)',
              },
              wholeWord: {
                type: 'boolean',
                description: 'Whole-word task text match (default: false)',
              },
              status: {
                type: 'string',
                enum: ['open', 'done', 'cancelled', 'scheduled'],
                description: 'Filter by task status before query match',
              },
              folder: {
                type: 'string',
                description: 'Restrict to a specific folder path',
              },
              space: {
                type: 'string',
                description: 'Restrict to a specific space ID',
              },
              noteQuery: {
                type: 'string',
                description: 'Filter candidate notes by title/filename/folder substring',
              },
              noteTypes: {
                type: 'array',
                items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
                description: 'Restrict scanned notes by type',
              },
              preferCalendar: {
                type: 'boolean',
                description: 'Prioritize calendar notes before maxNotes truncation (default: false)',
              },
              periodicOnly: {
                type: 'boolean',
                description: 'Only scan periodic calendar notes (weekly/monthly/quarterly/yearly)',
              },
              maxNotes: {
                type: 'number',
                description: 'Maximum notes to scan (default: 500, max: 2000)',
              },
              limit: {
                type: 'number',
                description: 'Maximum matches to return (default: 30, max: 300)',
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
            required: ['query'],
          },
        },
        {
          name: 'noteplan_add_task',
          description:
            'Add a task to a daily note date or project note file. Daily note target dates are auto-created if missing. The task marker (*/- with or without checkbox) is determined by the user\'s NotePlan preferences — do not include a marker in content. Use tab characters (\\t) for indentation, never spaces.',
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
              status: {
                type: 'string',
                enum: ['open', 'done', 'cancelled', 'scheduled'],
                description: 'Task status (default: open)',
              },
              priority: {
                type: 'number',
                description: 'Priority 1-3 (! / !! / !!!) appended to the task',
              },
              indentLevel: {
                type: 'number',
                description: 'Tab indentation level (default: 0, max: 10)',
              },
            },
            required: ['target', 'content'],
          },
        },
        {
          name: 'noteplan_complete_task',
          description:
            'Mark a task as done. Accepts lineIndex (0-based) or line (1-based). lineIndex is 0-based: use lineIndex from noteplan_get_tasks or noteplan_get_paragraphs, not the 1-indexed line value. Prefer this over noteplan_update_task when only marking done.',
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              lineIndex: {
                type: 'number',
                description: 'Line index of the task (0-based, from noteplan_get_tasks or noteplan_get_paragraphs lineIndex)',
              },
              line: {
                type: 'number',
                description: 'Line number of the task (1-based, not interchangeable with lineIndex)',
              },
            },
            required: ['filename'],
            anyOf: [{ required: ['lineIndex'] }, { required: ['line'] }],
          },
        },
        {
          name: 'noteplan_update_task',
          description:
            'Update a task content or status (open, done, cancelled, scheduled). Accepts lineIndex (0-based) or line (1-based). lineIndex is 0-based: use lineIndex from noteplan_get_tasks or noteplan_get_paragraphs, not the 1-indexed line value. For simply marking done, prefer noteplan_complete_task.',
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Filename/path of the note',
              },
              lineIndex: {
                type: 'number',
                description: 'Line index of the task (0-based, from noteplan_get_tasks or noteplan_get_paragraphs lineIndex)',
              },
              line: {
                type: 'number',
                description: 'Line number of the task (1-based, not interchangeable with lineIndex)',
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
            required: ['filename'],
            allOf: [
              { anyOf: [{ required: ['lineIndex'] }, { required: ['line'] }] },
              { anyOf: [{ required: ['content'] }, { required: ['status'] }] },
            ],
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
          name: 'noteplan_get_recent_periodic_notes',
          description:
            'Get a recent sequence of periodic notes (weekly/monthly/quarterly/yearly) from a reference date, ideal for quickly scanning the latest weekly notes.',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['weekly', 'monthly', 'quarterly', 'yearly'],
                description: 'Type of periodic note (default: weekly)',
              },
              count: {
                type: 'number',
                description: 'How many notes to return (default: 6, max: 50)',
              },
              fromDate: {
                type: 'string',
                description: 'Reference date (YYYY-MM-DD). Defaults to today.',
              },
              includeContent: {
                type: 'boolean',
                description: 'Include full note content (default: false)',
              },
              includeMissing: {
                type: 'boolean',
                description: 'Include missing period slots in response (default: false)',
              },
              maxLookback: {
                type: 'number',
                description: 'Maximum period slots to inspect (default: 52, max: 260)',
              },
              space: {
                type: 'string',
                description: 'Space ID',
              },
            },
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
          name: 'noteplan_list_filters',
          description: 'List saved NotePlan Filters with pagination.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Filter names by substring',
              },
              limit: {
                type: 'number',
                description: 'Maximum filters to return (default: 50)',
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
          name: 'noteplan_get_filter',
          description: 'Get one saved Filter with parsed parameter values.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Filter name',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'noteplan_save_filter',
          description: 'Create or update a saved Filter by writing filter items (param/value/display).',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Filter name',
              },
              overwrite: {
                type: 'boolean',
                description: 'Overwrite existing filter if true (default: true)',
              },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    param: {
                      type: 'string',
                      description: 'Filter parameter key (e.g., fp_open, fp_keyword)',
                    },
                    value: {
                      oneOf: [
                        { type: 'string' },
                        { type: 'boolean' },
                        { type: 'number' },
                        { type: 'array', items: { type: 'string' } },
                      ],
                      description: 'Filter parameter value',
                    },
                    display: {
                      type: 'boolean',
                      description: 'UI display flag (default: true)',
                    },
                  },
                  required: ['param', 'value'],
                },
                description: 'Filter item list',
              },
            },
            required: ['name', 'items'],
          },
        },
        {
          name: 'noteplan_rename_filter',
          description: 'Rename a saved Filter.',
          inputSchema: {
            type: 'object',
            properties: {
              oldName: {
                type: 'string',
                description: 'Existing filter name',
              },
              newName: {
                type: 'string',
                description: 'New filter name',
              },
              overwrite: {
                type: 'boolean',
                description: 'Allow replacing existing target name',
              },
            },
            required: ['oldName', 'newName'],
          },
        },
        {
          name: 'noteplan_get_filter_tasks',
          description: 'Execute a saved Filter against note tasks and return task matches with note+line references.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Filter name to run',
              },
              maxNotes: {
                type: 'number',
                description: 'Maximum notes to scan (default: 500)',
              },
              limit: {
                type: 'number',
                description: 'Maximum task matches to return (default: 30)',
              },
              offset: {
                type: 'number',
                description: 'Pagination offset (default: 0)',
              },
              cursor: {
                type: 'string',
                description: 'Cursor token from previous page (preferred over offset)',
              },
              space: {
                type: 'string',
                description: 'Optional space ID scope',
              },
              folder: {
                type: 'string',
                description: 'Optional folder scope',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'noteplan_list_filter_parameters',
          description: 'List supported Filter parameter keys and timeframe values for constructing saved filters.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'noteplan_list_folders',
          description:
            'List folders with pagination and optional filtering. Defaults to local folders only. Use parentPath + recursive=false to list direct subfolders.',
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
              parentPath: {
                type: 'string',
                description:
                  'Optional parent folder path (e.g., "20 - Areas" or "Notes/20 - Areas")',
              },
              recursive: {
                type: 'boolean',
                description:
                  'When parentPath is set: true = include all descendants, false = only direct children (default: true)',
              },
              maxDepth: {
                type: 'number',
                description:
                  'Max local folder depth (1 = top level, default: 1). If parentPath is provided and maxDepth is omitted, depth auto-expands to include that branch.',
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
            'Find likely folder matches for browsing/exploration. Use when user wants multiple options, not a single canonical folder. Use noteplan_resolve_folder when you need one canonical folder for create/list/update operations.',
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
            'Resolve a folder query to one canonical folder path with confidence and ambiguity details. Use before create/list/update operations that need one folder target.',
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
        {
          name: 'noteplan_create_folder',
          description:
            'Create a folder. Local mode: provide path under Notes. TeamSpace mode: provide space + name and optional parent (ID/path/name or "root").',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Local folder path under Notes (e.g., "20 - Areas/Marketing")',
              },
              space: {
                type: 'string',
                description: 'Space ID for TeamSpace folder creation',
              },
              name: {
                type: 'string',
                description: 'Folder name for TeamSpace folder creation',
              },
              parent: {
                type: 'string',
                description: 'TeamSpace parent folder reference (ID/path/name or "root")',
              },
            },
          },
        },
        {
          name: 'noteplan_move_folder',
          description:
            'Move a folder. Local mode: sourcePath + destinationFolder. TeamSpace mode: space + source + destination. Requires dryRun-issued confirmationToken.',
          inputSchema: {
            type: 'object',
            properties: {
              sourcePath: {
                type: 'string',
                description: 'Local source folder path under Notes',
              },
              destinationFolder: {
                type: 'string',
                description: 'Local destination folder under Notes (or "Notes" for root)',
              },
              space: {
                type: 'string',
                description: 'Space ID for TeamSpace folder move',
              },
              source: {
                type: 'string',
                description: 'TeamSpace source folder reference (ID/path/name)',
              },
              destination: {
                type: 'string',
                description: 'TeamSpace destination folder reference (ID/path/name or "root")',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview move impact and get confirmationToken without mutating folders',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for move execution',
              },
            },
          },
        },
        {
          name: 'noteplan_rename_folder',
          description:
            'Rename a folder in place. Local mode: sourcePath + newName. TeamSpace mode: space + source + newName. Requires dryRun-issued confirmationToken.',
          inputSchema: {
            type: 'object',
            properties: {
              sourcePath: {
                type: 'string',
                description: 'Local source folder path under Notes',
              },
              newName: {
                type: 'string',
                description: 'New folder name',
              },
              space: {
                type: 'string',
                description: 'Space ID for TeamSpace folder rename',
              },
              source: {
                type: 'string',
                description: 'TeamSpace source folder reference (ID/path/name)',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview rename impact and get confirmationToken without mutating folders',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for rename execution',
              },
            },
            required: ['newName'],
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
          description: 'Delete a calendar event. Requires dryRun-issued confirmationToken. Recommended flow: calendar_get_events first, dryRun, then delete using eventId.',
          inputSchema: {
            type: 'object',
            properties: {
              eventId: {
                type: 'string',
                description: 'Event ID to delete',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview deletion impact without deleting (default: false)',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for delete execution',
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
          description: 'Delete a reminder. Requires dryRun-issued confirmationToken. Recommended flow: reminders_get first, dryRun, then delete using reminderId.',
          inputSchema: {
            type: 'object',
            properties: {
              reminderId: {
                type: 'string',
                description: 'Reminder ID to delete',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview deletion impact without deleting (default: false)',
              },
              confirmationToken: {
                type: 'string',
                description: 'Confirmation token issued by dryRun for delete execution',
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
  if (embeddingsToolsEnabled) {
    toolDefinitions.push(
      {
        name: 'noteplan_embeddings_status',
        description:
          'Get embeddings configuration/index status. Returns provider/model, index counts, and whether embeddings are configured.',
        inputSchema: {
          type: 'object',
          properties: {
            space: {
              type: 'string',
              description: 'Optional TeamSpace ID scope for status counts',
            },
          },
        },
      },
      {
        name: 'noteplan_embeddings_sync',
        description:
          'Build or refresh the local embeddings index from NotePlan notes. Optional scope filters and pagination allow incremental sync.',
        inputSchema: {
          type: 'object',
          properties: {
            space: {
              type: 'string',
              description: 'Optional TeamSpace ID scope',
            },
            types: {
              type: 'array',
              items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
              description: 'Optional note type filter for sync scope',
            },
            noteQuery: {
              type: 'string',
              description: 'Optional title/filename/folder substring filter for sync scope',
            },
            limit: {
              type: 'number',
              description: 'Maximum notes to scan per sync run (default: 500, max: 5000)',
            },
            offset: {
              type: 'number',
              description: 'Pagination offset in note candidate set (default: 0)',
            },
            forceReembed: {
              type: 'boolean',
              description: 'Recompute embeddings even if note content hash has not changed',
            },
            pruneMissing: {
              type: 'boolean',
              description:
                'When true, remove stale index rows for missing notes (applies only for full-scope sync runs)',
            },
            batchSize: {
              type: 'number',
              description: 'Embedding API batch size (default from config, max: 64)',
            },
            maxChunksPerNote: {
              type: 'number',
              description: 'Maximum chunks indexed per note (default from config)',
            },
          },
        },
      },
      {
        name: 'noteplan_embeddings_search',
        description:
          'Semantic search over the local embeddings index. Returns preview payload by default; set includeText=true for full chunk text.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Semantic query text',
            },
            space: {
              type: 'string',
              description: 'Optional TeamSpace ID scope',
            },
            source: {
              type: 'string',
              enum: ['local', 'space'],
              description: 'Optional source filter',
            },
            types: {
              type: 'array',
              items: { type: 'string', enum: ['calendar', 'note', 'trash'] },
              description: 'Optional note type filter',
            },
            limit: {
              type: 'number',
              description: 'Maximum matches to return (default: 10, max: 100)',
            },
            minScore: {
              type: 'number',
              description: 'Minimum cosine similarity threshold (0-1, default: 0.2)',
            },
            includeText: {
              type: 'boolean',
              description:
                'Include full chunk text in response. Default false returns preview-only payload to keep context small.',
            },
            previewChars: {
              type: 'number',
              description: 'Preview length per result when includeText=false',
            },
            maxChunks: {
              type: 'number',
              description: 'Maximum indexed chunks to scan before ranking (default: 8000)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'noteplan_embeddings_reset',
        description:
          'Delete embeddings index rows (all or one TeamSpace scope). Requires dryRun-issued confirmationToken.',
        inputSchema: {
          type: 'object',
          properties: {
            space: {
              type: 'string',
              description: 'Optional TeamSpace ID scope for reset',
            },
            dryRun: {
              type: 'boolean',
              description: 'Preview reset impact and get confirmationToken',
            },
            confirmationToken: {
              type: 'string',
              description: 'Confirmation token issued by dryRun for reset execution',
            },
          },
        },
      }
    );
  }

  // Memory tools — always available
  toolDefinitions.push(
    {
      name: 'noteplan_memory_save',
      description:
        'Save a memory about user preferences, corrections, or patterns. Use when:\n' +
        '- User corrects your formatting or style ("No, use ## not ###")\n' +
        '- User states a preference ("always use bullet lists for action items")\n' +
        '- User teaches a naming convention or workflow pattern\n' +
        '- You notice a repeated pattern worth remembering\n' +
        'Suggested tags: style, formatting, workflow, correction, naming, structure, preference',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The memory content to save (1-2000 characters)',
            minLength: 1,
            maxLength: 2000,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 10,
            description: 'Optional tags for categorizing the memory (max 10). Suggested: style, formatting, workflow, correction, naming, structure, preference',
          },
        },
        required: ['content'],
      },
    },
    {
      name: 'noteplan_memory_list',
      description:
        'List or search stored memories about user preferences and corrections. Check memories:\n' +
        '- Before making formatting or style decisions\n' +
        '- When the user says "remember" or "like I said before"\n' +
        '- At the start of complex editing sessions\n' +
        '- When unsure about a convention the user may have stated previously',
      inputSchema: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            description: 'Filter by exact tag (case-insensitive)',
          },
          query: {
            type: 'string',
            description: 'Search content by substring (case-insensitive)',
          },
          limit: {
            type: 'number',
            description: 'Maximum memories to return (default: 50, max: 200)',
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default: 0)',
          },
        },
      },
    },
    {
      name: 'noteplan_memory_update',
      description: 'Update content or tags of an existing memory.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The memory ID to update',
          },
          content: {
            type: 'string',
            description: 'New content for the memory (1-2000 characters)',
            minLength: 1,
            maxLength: 2000,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 10,
            description: 'New tags for the memory',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'noteplan_memory_delete',
      description: 'Delete a stored memory by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The memory ID to delete',
          },
        },
        required: ['id'],
      },
    },

    // UI control tools (AppleScript)
    {
      name: 'noteplan_ui_open_note',
      description:
        'Open a note in the NotePlan UI by title or filename (at least one required). Optionally open in a new window or split view.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the note to open',
          },
          filename: {
            type: 'string',
            description: 'Filename of the note to open',
          },
          inNewWindow: {
            type: 'boolean',
            description: 'Open in a new window (default: false)',
          },
          inSplitView: {
            type: 'boolean',
            description: 'Open in split view (default: false)',
          },
        },
      },
    },
    {
      name: 'noteplan_ui_open_today',
      description: "Open today's daily note in the NotePlan UI.",
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'noteplan_ui_search',
      description: 'Search notes in the NotePlan UI by keyword.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search text',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'noteplan_ui_run_plugin_command',
      description:
        'Run a specific plugin command in NotePlan via AppleScript. Use noteplan_list_plugins first to discover available plugins and their commands, then call this with the correct pluginId and command name.',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: {
            type: 'string',
            description: 'Plugin ID (e.g., "np.MeetingNotes"). Use noteplan_list_plugins to find valid IDs.',
          },
          command: {
            type: 'string',
            description: 'Command name to execute (must match a command name from the plugin\'s command list)',
          },
          arguments: {
            type: 'string',
            description: 'Optional JSON arguments string to pass to the command',
          },
        },
        required: ['pluginId', 'command'],
      },
    },
    {
      name: 'noteplan_ui_open_view',
      description: 'Open a named view in the NotePlan UI (e.g., a plugin sidebar view).',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the view to open',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'noteplan_ui_toggle_sidebar',
      description: 'Toggle the sidebar visibility in NotePlan.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'noteplan_ui_close_plugin_window',
      description:
        'Close a floating plugin HTML window by window ID or title. Only works for plugins opened with displayMode "window" (HTMLView.showWindow). For plugins shown in the main editor (displayMode "main") or split view, use noteplan_ui_open_today or noteplan_ui_open_note to navigate away instead. Omit both parameters to close all floating plugin windows.',
      inputSchema: {
        type: 'object',
        properties: {
          windowID: {
            type: 'string',
            description: 'Window ID to close (exact match)',
          },
          title: {
            type: 'string',
            description: 'Window title to close (case-insensitive). Omit both to close all.',
          },
        },
      },
    },

    // Plugin tools
    {
      name: 'noteplan_list_plugins',
      description:
        'List all installed NotePlan plugins with their IDs, names, versions, and available commands. Use this to discover which plugins are available and what commands they offer before calling noteplan_ui_run_plugin_command.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional filter — matches plugin name or ID (case-insensitive substring)',
          },
        },
      },
    },
    {
      name: 'noteplan_create_plugin',
      description:
        'Create a NotePlan plugin with an HTML view. Writes plugin.json and script.js to the Plugins folder, optionally reloads and launches it. If a plugin with the same ID already exists, it will be overwritten. Use noteplan_get_plugin_source to read existing source before modifying. The plugin opens in the main editor area by default — this is the preferred display mode. It also gets pinned to the sidebar for easy access. Read the plugin API resources (e.g. noteplan://plugin-api/HTMLView.md) for API reference when building complex plugins.',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: {
            type: 'string',
            description: 'Plugin ID (e.g., "mcp.dashboard")',
          },
          pluginName: {
            type: 'string',
            description: 'Display name of the plugin',
          },
          commandName: {
            type: 'string',
            description: 'The command name',
          },
          html: {
            type: 'string',
            description: 'Full HTML content for the plugin view',
          },
          icon: {
            type: 'string',
            description: 'Font Awesome icon name (e.g., "chart-bar")',
          },
          iconColor: {
            type: 'string',
            description: 'Tailwind color like "blue-500"',
          },
          displayMode: {
            type: 'string',
            enum: ['main', 'split', 'window'],
            default: 'main',
            description: 'Where to display the HTML view. "main" (default, preferred) shows it in the main editor area with sidebar pinning; "split" shows it in a split view; "window" opens a separate floating window.',
          },
          autoLaunch: {
            type: 'boolean',
            description: 'Reload plugins and run after creation (default: true)',
          },
        },
        required: ['pluginId', 'pluginName', 'commandName', 'html'],
      },
    },
    {
      name: 'noteplan_delete_plugin',
      description:
        'Delete a NotePlan plugin by ID. Requires confirmation — call once without token to receive one, then call again with the token to confirm.',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: {
            type: 'string',
            description: 'Plugin ID to delete',
          },
          confirmationToken: {
            type: 'string',
            description: 'Confirmation token (call without to receive one)',
          },
        },
        required: ['pluginId'],
      },
    },
    {
      name: 'noteplan_list_available_plugins',
      description:
        'List plugins available from the NotePlan online repository. Shows install/update status by comparing with locally installed plugins. By default only stable releases are shown; set includeBeta to also see beta/pre-release plugins. Use this to discover new plugins or check for updates before calling noteplan_install_plugin.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional filter — matches plugin name or ID (case-insensitive substring)',
          },
          includeBeta: {
            type: 'boolean',
            description: 'Include beta/pre-release plugins (default: false)',
          },
        },
      },
    },
    {
      name: 'noteplan_install_plugin',
      description:
        'Install or update a plugin from the NotePlan online repository. Uses NotePlan\'s built-in installer — handles downloading, dependency resolution, and reload. The installation happens asynchronously. Use noteplan_list_available_plugins first to find valid plugin IDs.',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: {
            type: 'string',
            description: 'Plugin ID to install or update (e.g., "jgclark.DashboardReact")',
          },
        },
        required: ['pluginId'],
      },
    },

    {
      name: 'noteplan_get_plugin_log',
      description:
        'Read the console log captured during the last execution of a plugin. Returns console.log, console.warn, console.error, and JS exception output. Use this after noteplan_ui_run_plugin_command to inspect plugin behavior, debug errors, or enable self-repair workflows.',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: {
            type: 'string',
            description: 'Plugin ID whose log to read (e.g., "jgclark.Dashboard")',
          },
        },
        required: ['pluginId'],
      },
    },
    {
      name: 'noteplan_get_plugin_source',
      description:
        'Read the source files (plugin.json and script.js) of an installed NotePlan plugin. Use this to inspect or modify existing plugins — read the source, make changes, then use noteplan_create_plugin to overwrite.',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: {
            type: 'string',
            description: 'Plugin ID (e.g., "mcp.dashboard"). Use noteplan_list_plugins to find valid IDs.',
          },
        },
        required: ['pluginId'],
      },
    },

    // Theme management tools
    {
      name: 'noteplan_list_themes',
      description:
        'List all available NotePlan themes (custom + system) and the currently active light/dark theme names.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'noteplan_get_theme',
      description:
        'Read the JSON content of a custom theme file from the Themes folder. System themes cannot be read directly.',
      inputSchema: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Theme filename (e.g., "my-blue-theme.json")',
          },
        },
        required: ['filename'],
      },
    },
    {
      name: 'noteplan_save_theme',
      description:
        'Create or update a custom theme JSON file and optionally activate it. Validates and strips unknown keys.\n\n' +
        'Valid editor keys: backgroundColor, altBackgroundColor, tintColor, tintColor2, textColor, toolbarBackgroundColor, toolbarIconColor, menuItemColor, timeBlockColor, shouldOverwriteFont, sidebarStyleOverride, sidebarIconColorOverride, sidebarFolderColorOverride.\n\n' +
        'Valid style keys: body, title1, title2, title3, title4, title-mark1..4, bold, bold-left-mark, bold-right-mark, italic, italic-left-mark, italic-right-mark, boldItalic, boldItalic-left-mark, boldItalic-right-mark, code, code-left-backtick, code-right-backtick, code-fence, checked, checked-canceled, checked-scheduled, todo, checked-todo-characters, tabbed, quote-mark, quote-content, link, schedule-to-date-link, done-date, schedule-from-date-link, note-title-link, hashtag, attag, phonenumber, highlighted, highlighted-left-marker, highlighted-right-marker, strikethrough, strikethrough-left-tilde, strikethrough-right-tilde, underline, underline-left-tilde, underline-right-tilde, working-on, flagged-1, flagged-2, flagged-3, file-attachment.\n\n' +
        'Valid style properties: font, size, color, foregroundColor, backgroundColor, type, kern, headIndent, firstLineHeadIndent, lineSpacing, paragraphSpacing, paragraphSpacingBefore, underlineStyle, underlineColor, strikethroughStyle, strikethroughColor, leadingBorder, borderRadius, horizontalMargin, leftBorderPadding, rightBorderPadding, isFullWidthBorder, inlineBorder, regex, matchPosition.\n\n' +
        'Colors use hex format: #RRGGBB or #AARRGGBB.',
      inputSchema: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Theme filename, must end in .json (e.g., "mcp-blue-light.json")',
          },
          theme: {
            type: 'object',
            description: 'The theme object',
            properties: {
              name: { type: 'string', description: 'Display name' },
              style: { type: 'string', enum: ['Light', 'Dark'], description: 'Theme style' },
              author: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                },
              },
              editor: { type: 'object', description: 'Editor color settings' },
              styles: { type: 'object', description: 'Text formatting styles' },
            },
            required: ['name', 'style', 'editor', 'styles'],
          },
          setActive: {
            type: 'boolean',
            description: 'Immediately apply the theme (default: true)',
          },
          mode: {
            type: 'string',
            enum: ['light', 'dark', 'auto'],
            description: 'Mode to apply for (default: based on theme style)',
          },
        },
        required: ['filename', 'theme'],
      },
    },
    {
      name: 'noteplan_set_theme',
      description:
        'Activate an existing theme (custom or system) via AppleScript. Use noteplan_save_theme to create new themes.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Theme filename or system theme name',
          },
          mode: {
            type: 'string',
            enum: ['light', 'dark', 'auto'],
            description: 'Mode to set: light, dark, or auto (default: auto)',
          },
        },
        required: ['name'],
      },
    }
  );

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
    const rawCursor = request.params?.cursor;
    if (rawCursor === undefined || rawCursor === null || rawCursor === '') {
      // Compatibility mode: some MCP clients currently do not follow `nextCursor`.
      // Returning the full list on the initial request keeps all tools callable.
      return { tools: compactToolDefinitions };
    }

    const offset = toBoundedInt(rawCursor, 0, 0, Number.MAX_SAFE_INTEGER);
    const tools = compactToolDefinitions.slice(offset, offset + TOOLS_LIST_PAGE_SIZE);
    const nextOffset = offset + tools.length;
    const hasMore = nextOffset < compactToolDefinitions.length;

    return {
      tools,
      ...(hasMore ? { nextCursor: String(nextOffset) } : {}),
    };
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
        case 'noteplan_move_note':
          result = noteTools.moveNote(args as any);
          break;
        case 'noteplan_rename_note_file':
          result = noteTools.renameNoteFile(args as any);
          break;
        case 'noteplan_restore_note':
          result = noteTools.restoreNote(args as any);
          break;

        // Note structure
        case 'noteplan_get_paragraphs':
          result = noteTools.getParagraphs(args as any);
          break;
        case 'noteplan_search_paragraphs':
          result = noteTools.searchParagraphs(args as any);
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
        case 'noteplan_replace_lines':
          result = noteTools.replaceLines(args as any);
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
        case 'noteplan_search_tasks':
          result = taskTools.searchTasks(args as any);
          break;
        case 'noteplan_search_tasks_global':
          result = taskTools.searchTasksGlobal(args as any);
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
        case 'noteplan_get_recent_periodic_notes':
          result = calendarTools.getRecentPeriodicNotes(args as any);
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
        case 'noteplan_list_filters':
          result = filterTools.listFilters(args as any);
          break;
        case 'noteplan_get_filter':
          result = filterTools.getFilter(args as any);
          break;
        case 'noteplan_save_filter':
          result = filterTools.saveFilter(args as any);
          break;
        case 'noteplan_rename_filter':
          result = filterTools.renameFilter(args as any);
          break;
        case 'noteplan_get_filter_tasks':
          result = filterTools.getFilterTasks(args as any);
          break;
        case 'noteplan_list_filter_parameters':
          result = filterTools.listFilterParameters();
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
        case 'noteplan_create_folder':
          result = spaceTools.createFolder(args as any);
          break;
        case 'noteplan_move_folder':
          result = spaceTools.moveFolder(args as any);
          break;
        case 'noteplan_rename_folder':
          result = spaceTools.renameFolder(args as any);
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
        case 'noteplan_embeddings_status':
          result = embeddingsTools.embeddingsStatus(args as any);
          break;
        case 'noteplan_embeddings_sync':
          result = await embeddingsTools.embeddingsSync(args as any);
          break;
        case 'noteplan_embeddings_search':
          result = await embeddingsTools.embeddingsSearch(args as any);
          break;
        case 'noteplan_embeddings_reset':
          result = embeddingsTools.embeddingsReset(args as any);
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
            ? input.names
                .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
                .map((toolName) => normalizeToolName(toolName))
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

        case 'noteplan_memory_save':
          result = memoryTools.saveMemory(args as any);
          break;
        case 'noteplan_memory_list':
          result = memoryTools.listMemories(args as any);
          break;
        case 'noteplan_memory_update':
          result = memoryTools.updateMemory(args as any);
          break;
        case 'noteplan_memory_delete':
          result = memoryTools.deleteMemory(args as any);
          break;

        // UI control tools (AppleScript)
        case 'noteplan_ui_open_note':
          result = uiTools.openNote(args as any);
          break;
        case 'noteplan_ui_open_today':
          result = uiTools.openToday(args as any);
          break;
        case 'noteplan_ui_search':
          result = uiTools.searchNotes(args as any);
          break;
        case 'noteplan_ui_run_plugin_command':
          result = uiTools.runPlugin(args as any);
          break;
        case 'noteplan_ui_open_view':
          result = uiTools.openView(args as any);
          break;
        case 'noteplan_ui_toggle_sidebar':
          result = uiTools.toggleSidebar(args as any);
          break;
        case 'noteplan_ui_close_plugin_window':
          result = uiTools.closePluginWindow(args as any);
          break;

        // Plugin tools
        case 'noteplan_list_plugins':
          result = pluginTools.listPlugins(args as any);
          break;
        case 'noteplan_create_plugin':
          result = pluginTools.createPlugin(args as any);
          break;
        case 'noteplan_delete_plugin':
          result = pluginTools.deletePlugin(args as any);
          break;
        case 'noteplan_list_available_plugins':
          result = pluginTools.listAvailablePlugins(args as any);
          break;
        case 'noteplan_install_plugin':
          result = pluginTools.installPlugin(args as any);
          break;
        case 'noteplan_get_plugin_log':
          result = pluginTools.getPluginLog(args as any);
          break;
        case 'noteplan_get_plugin_source':
          result = pluginTools.getPluginSource(args as any);
          break;

        // Theme management tools
        case 'noteplan_list_themes':
          result = themeTools.listThemes(args as any);
          break;
        case 'noteplan_get_theme':
          result = themeTools.getTheme(args as any);
          break;
        case 'noteplan_save_theme':
          result = themeTools.saveTheme(args as any);
          break;
        case 'noteplan_set_theme':
          result = themeTools.setTheme(args as any);
          break;

        default:
          throw new Error(`Unknown tool: ${name} (normalized: ${normalizedName})`);
      }

      const enrichedResult = enrichErrorResult(result, normalizedName);
      const resultWithSuggestions = withSuggestedNextTools(enrichedResult, normalizedName);
      const resultWithMemory = withMemoryHints(resultWithSuggestions, normalizedName);
      const resultWithDuration = withDuration(resultWithMemory, Date.now() - startTime, includeTiming);
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
      const meta = inferToolErrorMeta(normalizedName, errorMessage);
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
