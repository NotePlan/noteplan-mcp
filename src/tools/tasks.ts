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
import { TaskStatus } from '../noteplan/types.js';

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  filename: z.string().describe('Filename/path of the note'),
  status: z
    .enum(['open', 'done', 'cancelled', 'scheduled'])
    .optional()
    .describe('Filter by task status'),
  query: z.string().optional().describe('Filter tasks by content substring'),
  limit: z.number().min(1).max(500).optional().default(100).describe('Maximum tasks to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const searchTasksSchema = z.object({
  id: z.string().optional().describe('Note ID (preferred for space notes)'),
  title: z.string().optional().describe('Note title to search for'),
  filename: z.string().optional().describe('Direct filename/path to the note'),
  date: z.string().optional().describe('Date for calendar notes (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)'),
  space: z.string().optional().describe('Space ID to search in'),
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
  space: z.string().optional().describe('Space ID when targeting daily notes'),
});

export const completeTaskSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  lineIndex: z.number().describe('Line index of the task (0-based)'),
});

export const updateTaskSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  lineIndex: z.number().describe('Line index of the task (0-based)'),
  content: z.string().optional().describe('New task content'),
  allowEmptyContent: z
    .boolean()
    .optional()
    .describe('Allow replacing task content with empty/blank text (default: false)'),
  status: z
    .enum(['open', 'done', 'cancelled', 'scheduled'])
    .optional()
    .describe('New task status'),
});

export function getTasks(params: z.infer<typeof getTasksSchema>) {
  const note = store.getNote({ filename: params.filename });

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
      title: note.title,
      filename: note.filename,
    },
    taskCount: page.length,
    totalCount: tasks.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    tasks: page.map((task) => ({
      lineIndex: task.lineIndex,
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

export function addTaskToNote(params: z.infer<typeof addTaskSchema>) {
  try {
    let note;

    // Check if target is a date (daily note) or a filename (project note)
    if (isDateTarget(params.target)) {
      // Target is a date - get or create the daily note for that date
      note = store.ensureCalendarNote(params.target, params.space);
    } else {
      // Target is a filename - get the project note
      note = store.getNote({ filename: params.target });
    }

    if (!note) {
      return {
        success: false,
        error: 'Note not found',
      };
    }

    const newContent = addTask(
      note.content,
      params.content,
      params.position as 'start' | 'end' | 'after-heading',
      params.heading
    );

    store.updateNote(note.filename, newContent);

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
    const note = store.getNote({ filename: params.filename });

    if (!note) {
      return {
        success: false,
        error: 'Note not found',
      };
    }

    const lines = note.content.split('\n');
    const originalLine = lines[params.lineIndex] || '';

    const newContent = updateTaskStatus(note.content, params.lineIndex, 'done');
    const updatedNote = store.updateNote(note.filename, newContent);

    const newLines = updatedNote.content.split('\n');
    const updatedLine = newLines[params.lineIndex] || '';

    return {
      success: true,
      message: `Task on line ${params.lineIndex} marked as done`,
      filename: updatedNote.filename,
      originalLine,
      updatedLine,
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

    const note = store.getNote({ filename: params.filename });

    if (!note) {
      return {
        success: false,
        error: 'Note not found',
      };
    }

    let newContent = note.content;

    if (params.status) {
      newContent = updateTaskStatus(newContent, params.lineIndex, params.status as TaskStatus);
    }

    if (params.content !== undefined) {
      newContent = updateTaskContent(newContent, params.lineIndex, params.content);
    }

    store.updateNote(note.filename, newContent);

    return {
      success: true,
      message: `Task on line ${params.lineIndex} updated`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update task',
    };
  }
}
