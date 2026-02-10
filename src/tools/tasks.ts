// Task operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';
import {
  parseTasks,
  filterTasksByStatus,
  updateTaskStatus,
  updateTaskContent,
  addTask,
} from '../noteplan/markdown-parser.js';
import { TaskStatus, NoteType } from '../noteplan/types.js';

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeType(value: unknown): NoteType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'note' || normalized === 'calendar' || normalized === 'trash') {
    return normalized as NoteType;
  }
  return null;
}

function normalizeTypeList(values: unknown): NoteType[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const unique = new Set<NoteType>();
  for (const entry of values) {
    const normalized = normalizeType(entry);
    if (normalized) unique.add(normalized);
  }
  return unique.size > 0 ? Array.from(unique) : undefined;
}

function isPeriodicCalendarNote(note: { type: NoteType; date?: string }): boolean {
  if (note.type !== 'calendar' || !note.date) return false;
  return note.date.includes('-');
}

function resolveTaskLineIndex(input: {
  lineIndex?: number;
  line?: number;
}): { ok: true; lineIndex: number } | { ok: false; error: string } {
  const hasLineIndex = typeof input.lineIndex === 'number' && Number.isFinite(input.lineIndex);
  const hasLine = typeof input.line === 'number' && Number.isFinite(input.line);

  if (!hasLineIndex && !hasLine) {
    return {
      ok: false,
      error: 'Provide lineIndex (0-based) or line (1-based)',
    };
  }

  const resolvedFromLine = hasLine ? Math.floor(input.line as number) - 1 : undefined;
  const resolvedFromIndex = hasLineIndex ? Math.floor(input.lineIndex as number) : undefined;

  if (resolvedFromLine !== undefined && resolvedFromLine < 0) {
    return {
      ok: false,
      error: 'line must be >= 1',
    };
  }
  if (resolvedFromIndex !== undefined && resolvedFromIndex < 0) {
    return {
      ok: false,
      error: 'lineIndex must be >= 0',
    };
  }

  if (
    resolvedFromLine !== undefined &&
    resolvedFromIndex !== undefined &&
    resolvedFromLine !== resolvedFromIndex
  ) {
    return {
      ok: false,
      error: 'line and lineIndex reference different task lines',
    };
  }

  return {
    ok: true,
    lineIndex: resolvedFromIndex ?? (resolvedFromLine as number),
  };
}

/**
 * Check if a string looks like a date target (not a filename)
 * Matches: today, tomorrow, yesterday, YYYYMMDD, YYYY-MM-DD
 */
function isDateTarget(target: string): boolean {
  const lower = target.toLowerCase().trim();

  // Special keywords
  if (['today', 'tomorrow', 'yesterday'].includes(lower)) {
    return true;
  }

  // YYYYMMDD format
  if (/^\d{8}$/.test(target)) {
    return true;
  }

  // YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(target)) {
    return true;
  }

  return false;
}

export const getTasksSchema = z.object({
  id: z.string().optional().describe('Note ID (preferred for space notes)'),
  title: z.string().optional().describe('Note title to search for'),
  filename: z.string().optional().describe('Direct filename/path to the note'),
  date: z
    .string()
    .optional()
    .describe('Date for calendar notes (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)'),
  space: z.string().optional().describe('Space name or ID to search in'),
  status: z
    .enum(['open', 'done', 'cancelled', 'scheduled'])
    .optional()
    .describe('Filter by task status'),
  query: z.string().optional().describe('Filter tasks by content substring'),
  limit: z.number().min(1).max(500).optional().default(100).describe('Maximum tasks to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
}).superRefine((input, ctx) => {
  if (!input.id && !input.title && !input.filename && !input.date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one note reference: id, title, filename, or date',
      path: ['id'],
    });
  }
});

export const searchTasksSchema = z.object({
  id: z.string().optional().describe('Note ID (preferred for space notes)'),
  title: z.string().optional().describe('Note title to search for'),
  filename: z.string().optional().describe('Direct filename/path to the note'),
  date: z.string().optional().describe('Date for calendar notes (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)'),
  space: z.string().optional().describe('Space name or ID to search in'),
  query: z.string().describe('Task query text'),
  caseSensitive: z.boolean().optional().default(false).describe('Case-sensitive task text search'),
  wholeWord: z.boolean().optional().default(false).describe('Whole-word task text match'),
  status: z
    .enum(['open', 'done', 'cancelled', 'scheduled'])
    .optional()
    .describe('Filter by task status before query match'),
  limit: z.number().min(1).max(200).optional().default(20).describe('Maximum matches to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
}).superRefine((input, ctx) => {
  if (!input.id && !input.title && !input.filename && !input.date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one note reference: id, title, filename, or date',
      path: ['id'],
    });
  }
});

export const searchTasksGlobalSchema = z.object({
  query: z.string().describe('Task query text across notes'),
  caseSensitive: z.boolean().optional().default(false).describe('Case-sensitive task text search'),
  wholeWord: z.boolean().optional().default(false).describe('Whole-word task text match'),
  status: z
    .enum(['open', 'done', 'cancelled', 'scheduled'])
    .optional()
    .describe('Filter by task status before query match'),
  folder: z.string().optional().describe('Restrict to a specific folder path'),
  space: z.string().optional().describe('Restrict to a specific space name or ID'),
  noteQuery: z.string().optional().describe('Filter notes by title/filename/folder substring'),
  noteTypes: z
    .array(z.enum(['calendar', 'note', 'trash']))
    .optional()
    .describe('Restrict scanned notes by type'),
  preferCalendar: z
    .boolean()
    .optional()
    .default(false)
    .describe('Prioritize calendar notes before maxNotes truncation'),
  periodicOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, only scan periodic calendar notes (weekly/monthly/quarterly/yearly)'),
  maxNotes: z.number().min(1).max(2000).optional().default(500).describe('Maximum notes to scan'),
  limit: z.number().min(1).max(300).optional().default(30).describe('Maximum matches to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const addTaskSchema = z.object({
  target: z
    .string()
    .describe('Target: a date (today, tomorrow, yesterday, YYYY-MM-DD, YYYYMMDD) for daily notes (creates note if needed), or a filename for project notes'),
  content: z.string().describe('Task content (without the checkbox marker)'),
  position: z
    .enum(['start', 'end', 'after-heading'])
    .optional()
    .default('end')
    .describe('Where to add the task'),
  heading: z
    .string()
    .optional()
    .describe('Heading to add task under (when position is after-heading)'),
  space: z.string().optional().describe('Space name or ID when targeting daily notes'),
  status: z
    .enum(['open', 'done', 'cancelled', 'scheduled'])
    .optional()
    .describe('Task status (default: open)'),
  priority: z
    .number()
    .min(1)
    .max(3)
    .optional()
    .describe('Priority 1-3 (! / !! / !!!) appended to the task'),
  indentLevel: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe('Tab indentation level (default: 0)'),
});

export const completeTaskSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  lineIndex: z.number().optional().describe('Line index of the task (0-based)'),
  line: z.number().optional().describe('Line number of the task (1-based)'),
  space: z.string().optional().describe('Space name or ID to search in'),
}).superRefine((input, ctx) => {
  if (input.lineIndex === undefined && input.line === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide lineIndex (0-based) or line (1-based)',
      path: ['lineIndex'],
    });
  }
});

export const updateTaskSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  lineIndex: z.number().optional().describe('Line index of the task (0-based)'),
  line: z.number().optional().describe('Line number of the task (1-based)'),
  space: z.string().optional().describe('Space name or ID to search in'),
  content: z.string().optional().describe('New task content'),
  allowEmptyContent: z
    .boolean()
    .optional()
    .describe('Allow replacing task content with empty/blank text (default: false)'),
  status: z
    .enum(['open', 'done', 'cancelled', 'scheduled'])
    .optional()
    .describe('New task status'),
}).superRefine((input, ctx) => {
  if (input.lineIndex === undefined && input.line === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide lineIndex (0-based) or line (1-based)',
      path: ['lineIndex'],
    });
  }
  if (input.content === undefined && input.status === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide at least one field to update: content or status',
      path: ['content'],
    });
  }
});

export function getTasks(params: z.infer<typeof getTasksSchema>) {
  if (!params.id && !params.title && !params.filename && !params.date) {
    return {
      success: false,
      error: 'Provide one note reference: id, title, filename, or date',
    };
  }

  const note = store.getNote({
    id: params.id,
    title: params.title,
    filename: params.filename,
    date: params.date,
    space: params.space,
  });

  if (!note) {
    return {
      success: false,
      error: 'Note not found',
    };
  }

  let tasks = parseTasks(note.content);

  if (params.status) {
    tasks = filterTasksByStatus(tasks, params.status as TaskStatus);
  }
  const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : '';
  if (query) {
    tasks = tasks.filter((task) => task.content.toLowerCase().includes(query));
  }

  const offset = toBoundedInt(params.cursor ?? params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(params.limit, 100, 1, 500);
  const page = tasks.slice(offset, offset + limit);
  const hasMore = offset + page.length < tasks.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  const result: Record<string, unknown> = {
    success: true,
    note: {
      id: note.id,
      title: note.title,
      filename: note.filename,
      type: note.type,
      source: note.source,
      folder: note.folder,
      spaceId: note.spaceId,
      date: note.date,
    },
    taskCount: page.length,
    totalCount: tasks.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    tasks: page.map((task) => ({
      lineIndex: task.lineIndex,
      line: task.lineIndex + 1,
      content: task.content,
      status: task.status,
      tags: task.tags,
      mentions: task.mentions,
      scheduledDate: task.scheduledDate,
      priority: task.priority,
      indentLevel: task.indentLevel,
    })),
  };

  if (hasMore) {
    result.performanceHints = ['Continue with nextCursor to fetch the next task page.'];
  }

  return result;
}

export function searchTasks(params: z.infer<typeof searchTasksSchema>) {
  const query = typeof params?.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }
  if (!params.id && !params.title && !params.filename && !params.date) {
    return {
      success: false,
      error: 'Provide one note reference: id, title, filename, or date',
    };
  }

  const note = store.getNote({
    id: params.id,
    title: params.title,
    filename: params.filename,
    date: params.date,
    space: params.space,
  });
  if (!note) {
    return {
      success: false,
      error: 'Note not found',
    };
  }

  let tasks = parseTasks(note.content);
  if (params.status) {
    tasks = filterTasksByStatus(tasks, params.status as TaskStatus);
  }

  const caseSensitive = params.caseSensitive ?? false;
  const wholeWord = params.wholeWord ?? false;
  const normalizedQuery = caseSensitive ? query : query.toLowerCase();
  const matcher = wholeWord
    ? new RegExp(`\\b${escapeRegExp(query)}\\b`, caseSensitive ? '' : 'i')
    : null;

  const matches = tasks
    .filter((task) => {
      const haystack = caseSensitive ? task.content : task.content.toLowerCase();
      return matcher ? matcher.test(task.content) : haystack.includes(normalizedQuery);
    })
    .map((task) => ({
      lineIndex: task.lineIndex,
      line: task.lineIndex + 1,
      content: task.content,
      status: task.status,
      tags: task.tags,
      mentions: task.mentions,
      scheduledDate: task.scheduledDate,
      priority: task.priority,
      indentLevel: task.indentLevel,
    }));

  const offset = toBoundedInt(params.cursor ?? params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(params.limit, 20, 1, 200);
  const page = matches.slice(offset, offset + limit);
  const hasMore = offset + page.length < matches.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  const result: Record<string, unknown> = {
    success: true,
    query,
    count: page.length,
    totalCount: matches.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    note: {
      id: note.id,
      title: note.title,
      filename: note.filename,
      type: note.type,
      source: note.source,
      folder: note.folder,
      spaceId: note.spaceId,
      date: note.date,
    },
    matches: page,
  };

  if (hasMore) {
    result.performanceHints = ['Continue with nextCursor to fetch the next task match page.'];
  }

  return result;
}

export function searchTasksGlobal(params: z.infer<typeof searchTasksGlobalSchema>) {
  const query = typeof params?.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }

  const caseSensitive = params.caseSensitive ?? false;
  const wholeWord = params.wholeWord ?? false;
  const normalizedQuery = caseSensitive ? query : query.toLowerCase();
  const wildcardQuery = query === '*';
  const matcher = wholeWord
    ? new RegExp(`\\b${escapeRegExp(query)}\\b`, caseSensitive ? '' : 'i')
    : null;
  const maxNotes = toBoundedInt(params.maxNotes, 500, 1, 2000);
  const noteQuery = typeof params.noteQuery === 'string' ? params.noteQuery.trim().toLowerCase() : '';
  const noteTypes = normalizeTypeList((params as { noteTypes?: unknown }).noteTypes);
  const preferCalendar = params.preferCalendar === true;
  const periodicOnly = params.periodicOnly === true;
  const allNotes = store.listNotes({
    folder: params.folder,
    space: params.space,
  });
  let filteredNotes = noteQuery
    ? allNotes.filter((note) => {
        const haystack = `${note.title} ${note.filename} ${note.folder || ''}`.toLowerCase();
        return haystack.includes(noteQuery);
      })
    : allNotes;
  if (noteTypes && noteTypes.length > 0) {
    filteredNotes = filteredNotes.filter((note) => noteTypes.includes(note.type));
  }
  if (periodicOnly) {
    filteredNotes = filteredNotes.filter((note) => isPeriodicCalendarNote(note));
  }
  if (preferCalendar) {
    filteredNotes = [...filteredNotes].sort((a, b) => {
      const aCalendar = a.type === 'calendar' ? 1 : 0;
      const bCalendar = b.type === 'calendar' ? 1 : 0;
      if (aCalendar !== bCalendar) return bCalendar - aCalendar;
      const aModified = a.modifiedAt?.getTime() ?? 0;
      const bModified = b.modifiedAt?.getTime() ?? 0;
      return bModified - aModified;
    });
  }
  const scannedNotes = filteredNotes.slice(0, maxNotes);
  const truncatedByMaxNotes = filteredNotes.length > scannedNotes.length;

  const allMatches: Array<Record<string, unknown>> = [];
  for (const note of scannedNotes) {
    let tasks = parseTasks(note.content);
    if (params.status) {
      tasks = filterTasksByStatus(tasks, params.status as TaskStatus);
    }

    tasks.forEach((task) => {
      const haystack = caseSensitive ? task.content : task.content.toLowerCase();
      const isMatch = wildcardQuery
        ? true
        : matcher
          ? matcher.test(task.content)
          : haystack.includes(normalizedQuery);
      if (!isMatch) return;

      allMatches.push({
        note: {
          id: note.id,
          title: note.title,
          filename: note.filename,
          type: note.type,
          source: note.source,
          folder: note.folder,
          spaceId: note.spaceId,
          date: note.date,
        },
        lineIndex: task.lineIndex,
        line: task.lineIndex + 1,
        content: task.content,
        status: task.status,
        tags: task.tags,
        mentions: task.mentions,
        scheduledDate: task.scheduledDate,
        priority: task.priority,
        indentLevel: task.indentLevel,
      });
    });
  }

  const offset = toBoundedInt(params.cursor ?? params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(params.limit, 30, 1, 300);
  const page = allMatches.slice(offset, offset + limit);
  const hasMore = offset + page.length < allMatches.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  const result: Record<string, unknown> = {
    success: true,
    query,
    count: page.length,
    totalCount: allMatches.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    scannedNoteCount: scannedNotes.length,
    totalNotes: filteredNotes.length,
    truncatedByMaxNotes,
    maxNotes,
    noteTypes,
    preferCalendar,
    periodicOnly,
    matches: page,
  };

  if (hasMore) {
    result.performanceHints = ['Continue with nextCursor to fetch the next global task match page.'];
  }
  if (truncatedByMaxNotes) {
    result.performanceHints = [
      ...((result.performanceHints as string[] | undefined) ?? []),
      'Increase maxNotes or narrow folder/space/noteQuery to reduce truncation.',
    ];
  }

  return result;
}

export function addTaskToNote(params: z.infer<typeof addTaskSchema>) {
  try {
    let note;

    // Check if target is a date (daily note) or a filename (project note)
    if (isDateTarget(params.target)) {
      // Target is a date - get or create the daily note for that date
      note = store.ensureCalendarNote(params.target, params.space);
    } else {
      // Target is a filename - get the project note
      note = store.getNote({ filename: params.target, space: params.space });
    }

    if (!note) {
      return {
        success: false,
        error: 'Note not found',
      };
    }

    const taskOptions = (params.status !== undefined || params.priority !== undefined || params.indentLevel !== undefined)
      ? {
          status: params.status as TaskStatus | undefined,
          priority: params.priority,
          indentLevel: params.indentLevel,
        }
      : undefined;
    const newContent = addTask(
      note.content,
      params.content,
      params.position as 'start' | 'end' | 'after-heading',
      params.heading,
      taskOptions
    );

    const writeIdentifier = note.source === 'space' ? (note.id || note.filename) : note.filename;
    store.updateNote(writeIdentifier, newContent, {
      source: note.source,
    });

    return {
      success: true,
      message: `Task added to ${note.filename}`,
      task: params.content,
      targetDate: isDateTarget(params.target) ? params.target : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add task',
    };
  }
}

export function completeTask(params: z.infer<typeof completeTaskSchema>) {
  try {
    const resolved = resolveTaskLineIndex({
      lineIndex: params.lineIndex,
      line: params.line,
    });
    if (!resolved.ok) {
      return {
        success: false,
        error: resolved.error,
      };
    }
    const lineIndex = resolved.lineIndex;

    const note = store.getNote({ filename: params.filename, space: params.space });

    if (!note) {
      return {
        success: false,
        error: 'Note not found',
      };
    }

    const lines = note.content.split('\n');
    const originalLine = lines[lineIndex] || '';

    const newContent = updateTaskStatus(note.content, lineIndex, 'done');
    const writeIdentifier = note.source === 'space' ? (note.id || note.filename) : note.filename;
    const updatedNote = store.updateNote(writeIdentifier, newContent, {
      source: note.source,
    });

    const newLines = updatedNote.content.split('\n');
    const updatedLine = newLines[lineIndex] || '';

    return {
      success: true,
      message: `Task on lineIndex ${lineIndex} (line ${lineIndex + 1}) marked as done`,
      filename: updatedNote.filename,
      originalLine,
      updatedLine,
      lineIndex,
      line: lineIndex + 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to complete task',
    };
  }
}

export function updateTask(params: z.infer<typeof updateTaskSchema>) {
  try {
    const resolved = resolveTaskLineIndex({
      lineIndex: params.lineIndex,
      line: params.line,
    });
    if (!resolved.ok) {
      return {
        success: false,
        error: resolved.error,
      };
    }
    const lineIndex = resolved.lineIndex;
    if (params.content === undefined && params.status === undefined) {
      return {
        success: false,
        error: 'Provide at least one field to update: content or status',
      };
    }

    if (
      params.content !== undefined &&
      params.allowEmptyContent !== true &&
      params.content.trim().length === 0
    ) {
      return {
        success: false,
        error:
          'Empty task content is blocked for noteplan_update_task. Use noteplan_delete_lines or set allowEmptyContent=true.',
      };
    }

    const note = store.getNote({ filename: params.filename, space: params.space });

    if (!note) {
      return {
        success: false,
        error: 'Note not found',
      };
    }

    let newContent = note.content;

    if (params.status) {
      newContent = updateTaskStatus(newContent, lineIndex, params.status as TaskStatus);
    }

    if (params.content !== undefined) {
      newContent = updateTaskContent(newContent, lineIndex, params.content);
    }

    const writeIdentifier = note.source === 'space' ? (note.id || note.filename) : note.filename;
    store.updateNote(writeIdentifier, newContent, {
      source: note.source,
    });

    return {
      success: true,
      message: `Task on lineIndex ${lineIndex} (line ${lineIndex + 1}) updated`,
      lineIndex,
      line: lineIndex + 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update task',
    };
  }
}
