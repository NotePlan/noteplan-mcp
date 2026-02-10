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

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

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
  maxDays: z.number().min(1).max(366).optional().default(90).describe('Maximum number of days to scan'),
  limit: z.number().min(1).max(200).optional().default(50).describe('Maximum number of days to return in this page'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset within scanned days'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const getRecentPeriodicNotesSchema = z.object({
  type: z
    .enum(['weekly', 'monthly', 'quarterly', 'yearly'])
    .optional()
    .default('weekly')
    .describe('Type of periodic note'),
  count: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(6)
    .describe('How many matching periodic notes to return'),
  fromDate: z
    .string()
    .optional()
    .describe('Reference date (YYYY-MM-DD). Defaults to today'),
  includeContent: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include full note content (default: false)'),
  includeMissing: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include entries for missing periods (default: false)'),
  maxLookback: z
    .number()
    .min(1)
    .max(260)
    .optional()
    .default(52)
    .describe('Max period slots to inspect while collecting matches'),
  space: z.string().optional().describe('Space ID'),
});

export const getNotesInFolderSchema = z.object({
  folder: z.string().describe('Folder path (e.g., "Projects", "10 - Projects")'),
  includeContent: z.boolean().optional().describe('Include full note content (default: false)'),
  limit: z.number().min(1).max(200).optional().describe('Maximum number of notes to return (default: 50)'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

function shiftDateBackByPeriod(date: Date, type: 'weekly' | 'monthly' | 'quarterly' | 'yearly'): Date {
  const shifted = new Date(date);
  switch (type) {
    case 'weekly':
      shifted.setDate(shifted.getDate() - 7);
      return shifted;
    case 'monthly':
      shifted.setMonth(shifted.getMonth() - 1);
      return shifted;
    case 'quarterly':
      shifted.setMonth(shifted.getMonth() - 3);
      return shifted;
    case 'yearly':
      shifted.setFullYear(shifted.getFullYear() - 1);
      return shifted;
  }
}

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

export function getRecentPeriodicNotes(params: z.infer<typeof getRecentPeriodicNotesSchema>) {
  try {
    const type = (params.type ?? 'weekly') as 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    const count = toBoundedInt(params.count, 6, 1, 50);
    const maxLookback = toBoundedInt(params.maxLookback, 52, 1, 260);
    const includeContent = params.includeContent === true;
    const includeMissing = params.includeMissing === true;
    const parsedFromDate = params.fromDate ? new Date(params.fromDate) : new Date();
    if (Number.isNaN(parsedFromDate.getTime())) {
      return {
        success: false,
        error: `Invalid fromDate: ${params.fromDate}`,
      };
    }

    const notes: Array<Record<string, unknown>> = [];
    const missing: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    let cursor = parsedFromDate;
    let inspectedSlots = 0;

    while (inspectedSlots < maxLookback && notes.length < count) {
      const dateToken = formatDateString(cursor);
      const periodic = getPeriodicNote({
        type,
        date: dateToken,
        space: params.space,
      });

      if (periodic.success && periodic.note) {
        const note = periodic.note as {
          title: string;
          filename: string;
          content: string;
          type: string;
          displayName?: string;
        };
        if (!seen.has(note.filename)) {
          seen.add(note.filename);
          notes.push({
            title: note.title,
            filename: note.filename,
            type: note.type,
            displayName: note.displayName,
            referenceDate: dateToken,
            content: includeContent ? note.content : undefined,
            preview: includeContent
              ? undefined
              : `${note.content.slice(0, 200)}${note.content.length > 200 ? '...' : ''}`,
          });
        }
      } else if (includeMissing) {
        missing.push({
          referenceDate: dateToken,
          error: periodic.error ?? 'Periodic note not found',
          triedPaths: periodic.triedPaths,
          displayName: periodic.displayName,
        });
      }

      cursor = shiftDateBackByPeriod(cursor, type);
      inspectedSlots += 1;
    }

    const response: Record<string, unknown> = {
      success: true,
      type,
      fromDate: formatDateString(parsedFromDate),
      count: notes.length,
      requestedCount: count,
      inspectedSlots,
      maxLookback,
      notes,
    };
    if (includeMissing) {
      response.missing = missing;
    }
    if (inspectedSlots >= maxLookback && notes.length < count) {
      response.performanceHints = [
        `Reached maxLookback=${maxLookback} before collecting requestedCount=${count}. Increase maxLookback or relax filters.`,
      ];
    }

    return response;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get recent periodic notes',
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
    const includeContent = params.includeContent === true;
    const maxDays = toBoundedInt(params.maxDays, 90, 1, 366);
    const scannedDates = dates.slice(0, maxDays);
    const truncatedByMaxDays = dates.length > scannedDates.length;
    const offset = toBoundedInt(params.cursor ?? params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = toBoundedInt(params.limit, 50, 1, 200);
    const pageDates = scannedDates.slice(offset, offset + limit);
    const hasMore = offset + pageDates.length < scannedDates.length;
    const nextCursor = hasMore ? String(offset + pageDates.length) : null;

    const notes: Array<{
      date: string;
      displayDate: string;
      filename: string;
      title: string;
      content?: string;
      preview?: string;
      exists: boolean;
    }> = [];

    for (const date of pageDates) {
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
      scannedDays: scannedDates.length,
      truncatedByMaxDays,
      maxDays,
      offset,
      limit,
      hasMore,
      nextCursor,
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
    const limit = toBoundedInt(params.limit, 50, 1, 200);
    const offset = toBoundedInt(params.cursor ?? params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const includeContent = params.includeContent === true;

    const allNotes = store.listNotes({ folder: params.folder });
    const pagedNotes = allNotes.slice(offset, offset + limit);

    const notes = pagedNotes.map((note) => {
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

    const hasMore = offset + notes.length < allNotes.length;
    const nextCursor = hasMore ? String(offset + notes.length) : null;

    return {
      success: true,
      folder: params.folder,
      noteCount: notes.length,
      totalInFolder: allNotes.length,
      offset,
      limit,
      hasMore,
      nextCursor,
      notes,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get notes in folder',
    };
  }
}
