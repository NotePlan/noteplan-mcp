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
  teamspace: z.string().optional().describe('Teamspace ID when targeting daily notes'),
});

export const completeTaskSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  lineIndex: z.number().describe('Line index of the task (0-based)'),
});

export const updateTaskSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  lineIndex: z.number().describe('Line index of the task (0-based)'),
  content: z.string().optional().describe('New task content'),
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

  return {
    success: true,
    note: {
      title: note.title,
      filename: note.filename,
    },
    taskCount: tasks.length,
    tasks: tasks.map((task) => ({
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
}

export function addTaskToNote(params: z.infer<typeof addTaskSchema>) {
  try {
    let note;

    // Check if target is a date (daily note) or a filename (project note)
    if (isDateTarget(params.target)) {
      // Target is a date - get or create the daily note for that date
      note = store.ensureCalendarNote(params.target, params.teamspace);
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
