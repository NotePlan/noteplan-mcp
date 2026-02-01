// Calendar/daily note operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';
import {
  parseFlexibleDate,
  formatDateForDisplay,
  formatDateString,
  getDateRange,
  getDatesInRange,
  getISOWeek,
  getWeekRespectingPreference,
} from '../utils/date-utils.js';

export const getTodaySchema = z.object({
  space: z.string().optional().describe('Space ID to get today from'),
});

export const addToTodaySchema = z.object({
  content: z.string().describe('Content to add to today\'s note'),
  position: z
    .enum(['start', 'end'])
    .optional()
    .default('end')
    .describe('Where to add the content'),
  space: z.string().optional().describe('Space ID'),
});

export const getCalendarNoteSchema = z.object({
  date: z
    .string()
    .describe('Date in YYYYMMDD, YYYY-MM-DD format, or "today", "tomorrow", "yesterday"'),
  space: z.string().optional().describe('Space ID'),
});

export function getToday(params: z.infer<typeof getTodaySchema>) {
  const note = store.getTodayNote(params.space);

  if (!note) {
    // Try to create it
    try {
      const createdNote = store.ensureCalendarNote('today', params.space);
      return {
        success: true,
        note: {
          title: createdNote.title,
          filename: createdNote.filename,
          content: createdNote.content,
          type: createdNote.type,
          source: createdNote.source,
          date: createdNote.date,
          displayDate: createdNote.date ? formatDateForDisplay(createdNote.date) : undefined,
        },
        created: true,
      };
    } catch (error) {
      return {
        success: false,
        error: 'Today\'s note not found and could not be created',
      };
    }
  }

  return {
    success: true,
    note: {
      title: note.title,
      filename: note.filename,
      content: note.content,
      type: note.type,
      source: note.source,
      date: note.date,
      displayDate: note.date ? formatDateForDisplay(note.date) : undefined,
    },
  };
}

export function addToToday(params: z.infer<typeof addToTodaySchema>) {
  try {
    const note = store.addToToday(
      params.content,
      params.position as 'start' | 'end',
      params.space
    );

    return {
      success: true,
      message: `Content added to today's note`,
      note: {
        filename: note.filename,
        date: note.date,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add content to today',
    };
  }
}

export function getCalendarNote(params: z.infer<typeof getCalendarNoteSchema>) {
  const dateStr = parseFlexibleDate(params.date);
  const note = store.getCalendarNote(dateStr, params.space);

  if (!note) {
    return {
      success: false,
      error: `Calendar note not found for date: ${params.date}`,
      parsedDate: dateStr,
      displayDate: formatDateForDisplay(dateStr),
    };
  }

  return {
    success: true,
    note: {
      title: note.title,
      filename: note.filename,
      content: note.content,
      type: note.type,
      source: note.source,
      date: note.date,
      displayDate: note.date ? formatDateForDisplay(note.date) : undefined,
    },
  };
}

// Periodic note schemas
export const getPeriodicNoteSchema = z.object({
  type: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).describe('Type of periodic note'),
  date: z.string().optional().describe('Reference date (defaults to current). Use YYYY-MM-DD format.'),
  week: z.number().optional().describe('For weekly notes: specific week number (1-53). Use with year parameter.'),
  year: z.number().optional().describe('For weekly/yearly notes: specific year (e.g., 2025)'),
  month: z.number().optional().describe('For monthly notes: specific month (1-12). Use with year parameter.'),
  quarter: z.number().optional().describe('For quarterly notes: specific quarter (1-4). Use with year parameter.'),
  space: z.string().optional().describe('Space ID'),
});

export const getNotesInRangeSchema = z.object({
  period: z
    .enum(['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month', 'custom'])
    .describe('Predefined period or "custom" for date range'),
  startDate: z.string().optional().describe('Start date for custom range (YYYY-MM-DD)'),
  endDate: z.string().optional().describe('End date for custom range (YYYY-MM-DD)'),
  includeContent: z.boolean().optional().describe('Include full note content (default: false for summaries only)'),
  space: z.string().optional().describe('Space ID'),
});

export const getNotesInFolderSchema = z.object({
  folder: z.string().describe('Folder path (e.g., "Projects", "10 - Projects")'),
  includeContent: z.boolean().optional().describe('Include full note content (default: false)'),
  limit: z.number().optional().describe('Maximum number of notes to return (default: 50)'),
});

/**
 * Get a periodic note (weekly, monthly, quarterly, yearly)
 * Tries multiple paths with both .md and .txt extensions
 */
export function getPeriodicNote(params: z.infer<typeof getPeriodicNoteSchema>) {
  try {
    const refDate = params.date ? new Date(params.date) : new Date();
    const currentYear = new Date().getFullYear();
    let baseFilename: string; // Without extension
    let displayName: string;
    let folderYear: number; // Year to use in folder path

    switch (params.type) {
      case 'weekly': {
        // Allow direct week/year specification, or derive from date
        let weekNum: number;
        let weekYear: number;

        if (params.week !== undefined) {
          weekNum = params.week;
          weekYear = params.year || currentYear;
        } else {
          // Use week calculation that respects NotePlan's firstDayOfWeek preference
          const weekInfo = getWeekRespectingPreference(refDate);
          weekNum = weekInfo.week;
          weekYear = weekInfo.year;
        }

        const weekStr = String(weekNum).padStart(2, '0');
        baseFilename = `${weekYear}-W${weekStr}`;
        displayName = `Week ${weekNum}, ${weekYear}`;
        folderYear = weekYear;
        break;
      }
      case 'monthly': {
        // Allow direct month/year specification
        let monthNum: number;
        let monthYear: number;

        if (params.month !== undefined) {
          monthNum = params.month;
          monthYear = params.year || currentYear;
        } else {
          monthNum = refDate.getMonth() + 1;
          monthYear = refDate.getFullYear();
        }

        const monthStr = String(monthNum).padStart(2, '0');
        baseFilename = `${monthYear}-${monthStr}`;
        const monthDate = new Date(monthYear, monthNum - 1, 1);
        displayName = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        folderYear = monthYear;
        break;
      }
      case 'quarterly': {
        // Allow direct quarter/year specification
        let quarterNum: number;
        let quarterYear: number;

        if (params.quarter !== undefined) {
          quarterNum = params.quarter;
          quarterYear = params.year || currentYear;
        } else {
          quarterNum = Math.floor(refDate.getMonth() / 3) + 1;
          quarterYear = refDate.getFullYear();
        }

        baseFilename = `${quarterYear}-Q${quarterNum}`;
        displayName = `Q${quarterNum} ${quarterYear}`;
        folderYear = quarterYear;
        break;
      }
      case 'yearly': {
        // Allow direct year specification
        const yearNum = params.year || refDate.getFullYear();
        baseFilename = `${yearNum}`;
        displayName = `${yearNum}`;
        folderYear = yearNum;
        break;
      }
    }

    // Build list of paths to try - flat structure first (more common), then year subfolder
    const pathsToTry = [
      `Calendar/${baseFilename}.txt`,
      `Calendar/${baseFilename}.md`,
      `Calendar/${folderYear}/${baseFilename}.txt`,
      `Calendar/${folderYear}/${baseFilename}.md`,
    ];

    // Try each path
    for (const notePath of pathsToTry) {
      const note = store.getNote({ filename: notePath });
      if (note) {
        return {
          success: true,
          note: {
            title: note.title,
            filename: note.filename,
            content: note.content,
            type: params.type,
            displayName,
          },
        };
      }
    }

    return {
      success: false,
      error: `${params.type} note not found`,
      triedPaths: pathsToTry,
      displayName,
      inputDate: params.date || 'today (default)',
      parsedDate: refDate.toISOString().split('T')[0],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get periodic note',
    };
  }
}

/**
 * Get multiple daily notes in a date range
 */
export function getNotesInRange(params: z.infer<typeof getNotesInRangeSchema>) {
  try {
    const { start, end } = getDateRange(params.period, params.startDate, params.endDate);
    const dates = getDatesInRange(start, end);
    const includeContent = params.includeContent ?? false;

    const notes: Array<{
      date: string;
      displayDate: string;
      filename: string;
      title: string;
      content?: string;
      preview?: string;
      exists: boolean;
    }> = [];

    for (const date of dates) {
      const dateStr = formatDateString(date);
      const note = store.getCalendarNote(dateStr, params.space);

      if (note) {
        const entry: (typeof notes)[0] = {
          date: dateStr,
          displayDate: formatDateForDisplay(dateStr),
          filename: note.filename,
          title: note.title,
          exists: true,
        };

        if (includeContent) {
          entry.content = note.content;
        } else {
          // Just include a preview (first 200 chars after frontmatter)
          const bodyStart = note.content.indexOf('---', 3);
          const body = bodyStart > 0 ? note.content.slice(bodyStart + 3).trim() : note.content;
          entry.preview = body.slice(0, 200) + (body.length > 200 ? '...' : '');
        }

        notes.push(entry);
      }
    }

    return {
      success: true,
      period: params.period,
      startDate: formatDateString(start),
      endDate: formatDateString(end),
      noteCount: notes.length,
      totalDays: dates.length,
      notes,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get notes in range',
    };
  }
}

/**
 * Get all notes in a folder with optional content
 */
export function getNotesInFolder(params: z.infer<typeof getNotesInFolderSchema>) {
  try {
    const limit = params.limit ?? 50;
    const includeContent = params.includeContent ?? false;

    const allNotes = store.listNotes({ folder: params.folder });
    const limitedNotes = allNotes.slice(0, limit);

    const notes = limitedNotes.map((note) => {
      const entry: {
        title: string;
        filename: string;
        modifiedAt?: string;
        content?: string;
        preview?: string;
      } = {
        title: note.title,
        filename: note.filename,
        modifiedAt: note.modifiedAt?.toISOString(),
      };

      if (includeContent) {
        entry.content = note.content;
      } else {
        // Preview without frontmatter
        const bodyStart = note.content.indexOf('---', 3);
        const body = bodyStart > 0 ? note.content.slice(bodyStart + 3).trim() : note.content;
        entry.preview = body.slice(0, 200) + (body.length > 200 ? '...' : '');
      }

      return entry;
    });

    return {
      success: true,
      folder: params.folder,
      noteCount: notes.length,
      totalInFolder: allNotes.length,
      hasMore: allNotes.length > limit,
      notes,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get notes in folder',
    };
  }
}
