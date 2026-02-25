// macOS Calendar events operations via Swift/EventKit
// Prefers AppleScript via NotePlan (which already has calendar permission),
// falls back to the Swift calendar-helper binary.

import { z } from 'zod';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  issueConfirmationToken,
  validateAndConsumeConfirmationToken,
} from '../utils/confirmation-tokens.js';
import { runAppleScript, escapeAppleScript, getAppName } from '../utils/applescript.js';

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMPILED_HELPER = path.join(__dirname, '../../scripts/calendar-helper');
const SWIFT_HELPER = path.join(__dirname, '../../scripts/calendar-helper.swift');

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

/**
 * Run the calendar helper (prefers compiled binary, falls back to swift interpreter)
 */
function runSwiftHelper(args: string[], timeoutMs = 15000): any {
  try {
    let result: string;
    console.error(`[noteplan-mcp] calendar-helper: args=${JSON.stringify(args)}`);

    // Use compiled binary if it exists
    if (fs.existsSync(COMPILED_HELPER)) {
      console.error(`[noteplan-mcp] calendar-helper: using compiled binary at ${COMPILED_HELPER}`);
      result = execFileSync(COMPILED_HELPER, args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      }).trim();
    } else {
      // Fall back to swift interpreter
      console.error(`[noteplan-mcp] calendar-helper: compiled binary not found, falling back to swift interpreter: ${SWIFT_HELPER}`);
      result = execFileSync('swift', [SWIFT_HELPER, ...args], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      }).trim();
    }

    if (!result) return null;
    return JSON.parse(result);
  } catch (error: any) {
    if (error.killed) {
      throw new Error('Calendar query timed out.');
    }
    // Try to parse error from output
    try {
      const parsed = JSON.parse(error.stdout || '{}');
      if (parsed.error) throw new Error(enhancePermissionError(parsed.error));
    } catch {}
    throw new Error(enhancePermissionError(error.stderr || error.message || 'Calendar helper failed'));
  }
}

const NOTEPLAN_PERMISSION_HINT =
  ' As a workaround, open NotePlan and try again — the MCP server will route through' +
  " NotePlan's own calendar permission automatically.";

/**
 * If an error message looks like a permission/access denial, append a hint
 * telling the agent that opening NotePlan is a workaround.
 */
function enhancePermissionError(errorMsg: string): string {
  if (/access denied|not authorized|permission|not determined/i.test(errorMsg)) {
    return errorMsg + NOTEPLAN_PERMISSION_HINT;
  }
  return errorMsg;
}

/**
 * Try running a calendar command via AppleScript through NotePlan.
 * Returns parsed JSON on success, or null if NotePlan isn't running or
 * the command isn't supported.
 */
function tryCalendarAppleScript(command: string): any | null {
  const appName = getAppName();
  const fullScript = `tell application "${appName}" to ${command}`;
  try {
    console.error(`[noteplan-mcp] calendar: trying AppleScript via "${appName}" — ${command}`);
    console.error(`[noteplan-mcp] calendar: full script: ${fullScript}`);
    const result = runAppleScript(fullScript);
    if (!result) {
      console.error(`[noteplan-mcp] calendar: AppleScript via "${appName}" returned empty result, falling back`);
      return null;
    }
    const parsed = JSON.parse(result);
    if (parsed?.error) {
      console.error(`[noteplan-mcp] calendar: AppleScript via "${appName}" returned error: ${parsed.error}`);
    } else {
      const count = Array.isArray(parsed) ? parsed.length : 1;
      console.error(`[noteplan-mcp] calendar: AppleScript via "${appName}" succeeded (${count} result(s))`);
    }
    return parsed;
  } catch (err) {
    console.error(`[noteplan-mcp] calendar: AppleScript failed for "${appName}": ${err instanceof Error ? err.message : err}`);
    console.error(`[noteplan-mcp] calendar: failed script was: ${fullScript}`);
    return null;
  }
}

// Schema definitions
export const getEventsSchema = z.object({
  date: z.string().optional().describe('Date to get events for (YYYY-MM-DD, "today", "tomorrow"). Defaults to today.'),
  days: z.number().min(1).max(365).optional().describe('Number of days to fetch (default: 1, max: 365)'),
  calendar: z.string().optional().describe('Filter by calendar name'),
  limit: z.number().min(1).max(500).optional().default(100).describe('Maximum events to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const createEventSchema = z.object({
  title: z.string().describe('Event title'),
  startDate: z.string().describe('Start date/time (YYYY-MM-DD HH:MM or YYYY-MM-DD for all-day)'),
  endDate: z.string().optional().describe('End date/time (defaults to 1 hour after start, or end of day for all-day)'),
  calendar: z.string().optional().describe('Calendar name (defaults to default calendar)'),
  location: z.string().optional().describe('Event location'),
  notes: z.string().optional().describe('Event notes'),
  allDay: z.boolean().optional().describe('Whether this is an all-day event'),
});

export const updateEventSchema = z.object({
  eventId: z.string().describe('Event ID (from get_events)'),
  title: z.string().optional().describe('New event title'),
  startDate: z.string().optional().describe('New start date/time'),
  endDate: z.string().optional().describe('New end date/time'),
  location: z.string().optional().describe('New location'),
  notes: z.string().optional().describe('New notes'),
});

export const deleteEventSchema = z.object({
  eventId: z.string().describe('Event ID to delete'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview deletion impact without deleting the event (default: false)'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for delete execution'),
});

export const listCalendarsSchema = z.object({});

/**
 * Parse flexible date input
 */
function parseDate(dateStr: string): Date {
  const lower = dateStr.toLowerCase();
  const now = new Date();

  if (lower === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (lower === 'tomorrow') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }
  if (lower === 'yesterday') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }

  return new Date(dateStr);
}

/**
 * Get events from Calendar app using Swift/EventKit (fast)
 */
export function getEvents(params: z.infer<typeof getEventsSchema>) {
  try {
    const input = params ?? ({} as z.infer<typeof getEventsSchema>);
    const startDate = parseDate(input.date || 'today');
    const days = toBoundedInt(input.days, 1, 1, 365);
    const offset = toBoundedInt(input.cursor ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = toBoundedInt(input.limit, 100, 1, 500);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);

    const startStr = startDate.toISOString().split('T')[0];

    // Try AppleScript first
    let allEvents: any[] = [];
    let usedAppleScript = false;
    const fromISO = startDate.toISOString();
    const toISO = endDate.toISOString();
    let asCmd = `listEvents from date "${fromISO}" to date "${toISO}"`;
    if (input.calendar) {
      asCmd += ` in calendar "${escapeAppleScript(input.calendar)}"`;
    }
    const asResult = tryCalendarAppleScript(asCmd);
    if (asResult !== null && Array.isArray(asResult)) {
      console.error('[noteplan-mcp] getEvents: using AppleScript via NotePlan');
      allEvents = asResult;
      usedAppleScript = true;
    }

    // Fall back to Swift helper
    if (!usedAppleScript) {
      console.error('[noteplan-mcp] getEvents: falling back to calendar-helper binary');
      const args = ['list-events', startStr, String(days)];
      if (input.calendar) {
        args.push(input.calendar);
      }

      const result = runSwiftHelper(args);
      if (result && !Array.isArray(result)) {
        return {
          success: false,
          error: result.error || 'Calendar helper returned unexpected data',
        };
      }
      allEvents = result || [];
    }

    const events = allEvents.slice(offset, offset + limit);
    const hasMore = offset + events.length < allEvents.length;
    const nextCursor = hasMore ? String(offset + events.length) : null;

    return {
      success: true,
      startDate: startStr,
      endDate: endDate.toISOString().split('T')[0],
      eventCount: events.length,
      totalCount: allEvents.length,
      offset,
      limit,
      hasMore,
      nextCursor,
      events,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get events',
    };
  }
}

/**
 * Create a new calendar event using Swift/EventKit
 */
export function createEvent(params: z.infer<typeof createEventSchema>) {
  try {
    const isAllDay = params.allDay || !params.startDate.includes(':');
    let startDate: Date;
    let endDate: Date;

    if (isAllDay) {
      startDate = new Date(params.startDate.split(' ')[0] + 'T00:00:00');
      if (params.endDate) {
        endDate = new Date(params.endDate.split(' ')[0] + 'T23:59:59');
      } else {
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59);
      }
    } else {
      startDate = new Date(params.startDate.replace(' ', 'T'));
      if (params.endDate) {
        endDate = new Date(params.endDate.replace(' ', 'T'));
      } else {
        endDate = new Date(startDate.getTime() + 3600000); // 1 hour
      }
    }

    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();

    // Try AppleScript first
    let asCmd = `createEvent with title "${escapeAppleScript(params.title)}" from date "${startStr}" to date "${endStr}"`;
    if (params.calendar) asCmd += ` in calendar "${escapeAppleScript(params.calendar)}"`;
    if (params.location) asCmd += ` at location "${escapeAppleScript(params.location)}"`;
    if (params.notes) asCmd += ` with notes "${escapeAppleScript(params.notes)}"`;
    if (isAllDay) asCmd += ' all day true';
    const asResult = tryCalendarAppleScript(asCmd);
    if (asResult !== null) {
      console.error('[noteplan-mcp] createEvent: using AppleScript via NotePlan');
      if (asResult.error) return { success: false, error: asResult.error };
      return {
        success: true,
        message: `Event "${params.title}" created`,
        event: { id: asResult.id || '', title: params.title, startDate: startStr, endDate: endStr },
      };
    }

    // Fall back to Swift helper
    console.error('[noteplan-mcp] createEvent: falling back to calendar-helper binary');
    const args = ['create-event', params.title, startStr, endStr];
    if (params.calendar) {
      args.push(params.calendar);
    }
    if (params.location) {
      args.push(params.location);
    }
    if (params.notes) {
      args.push(params.notes);
    }
    args.push(isAllDay ? 'true' : 'false');

    const result = runSwiftHelper(args);

    if (result?.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: `Event "${params.title}" created`,
      event: {
        id: result?.id || '',
        title: params.title,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create event',
    };
  }
}

/**
 * Update an existing calendar event using Swift/EventKit
 */
export function updateEvent(params: z.infer<typeof updateEventSchema>) {
  try {
    // Build JSON payload for updates
    const updates: Record<string, string> = {};
    if (params.title) updates.title = params.title;
    if (params.startDate) updates.startDate = new Date(params.startDate.replace(' ', 'T')).toISOString();
    if (params.endDate) updates.endDate = new Date(params.endDate.replace(' ', 'T')).toISOString();
    if (params.location !== undefined) updates.location = params.location;
    if (params.notes !== undefined) updates.notes = params.notes;

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No updates provided' };
    }

    // Try AppleScript first
    const updatesJson = escapeAppleScript(JSON.stringify(updates));
    const asResult = tryCalendarAppleScript(
      `updateEvent with id "${escapeAppleScript(params.eventId)}" with updates "${updatesJson}"`
    );
    if (asResult !== null) {
      console.error('[noteplan-mcp] updateEvent: using AppleScript via NotePlan');
      if (asResult.error) return { success: false, error: asResult.error };
      return { success: true, message: 'Event updated' };
    }

    // Fall back to Swift helper
    console.error('[noteplan-mcp] updateEvent: falling back to calendar-helper binary');
    const args = ['update-event', params.eventId, JSON.stringify(updates)];
    const result = runSwiftHelper(args);

    if (result?.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: 'Event updated',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update event',
    };
  }
}

/**
 * Delete a calendar event using Swift/EventKit
 */
export function deleteEvent(params: z.infer<typeof deleteEventSchema>) {
  try {
    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'calendar_delete_event',
        target: params.eventId,
        action: 'delete_event',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: event ${params.eventId} would be deleted`,
        eventId: params.eventId,
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'calendar_delete_event',
      target: params.eventId,
      action: 'delete_event',
    });
    if (!confirmation.ok) {
      const refreshHint = 'Call calendar_delete_event with dryRun=true to get a new confirmationToken.';
      const message =
        confirmation.reason === 'missing'
          ? `Confirmation token is required for calendar_delete_event. ${refreshHint}`
          : confirmation.reason === 'expired'
            ? `Confirmation token is expired for calendar_delete_event. ${refreshHint}`
            : `Confirmation token is invalid for calendar_delete_event. ${refreshHint}`;
      return {
        success: false,
        error: message,
      };
    }

    // Try AppleScript first
    const asResult = tryCalendarAppleScript(
      `deleteEvent with id "${escapeAppleScript(params.eventId)}"`
    );
    if (asResult !== null) {
      console.error('[noteplan-mcp] deleteEvent: using AppleScript via NotePlan');
      if (asResult.error) return { success: false, error: asResult.error };
      return { success: true, message: 'Event deleted' };
    }

    // Fall back to Swift helper
    console.error('[noteplan-mcp] deleteEvent: falling back to calendar-helper binary');
    const result = runSwiftHelper(['delete-event', params.eventId]);

    if (result?.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: 'Event deleted',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete event',
    };
  }
}

/**
 * List all calendars using Swift/EventKit
 */
export function listCalendars(_params: z.infer<typeof listCalendarsSchema>) {
  try {
    // Try AppleScript first (uses NotePlan's own calendar permission)
    const asResult = tryCalendarAppleScript('listCalendars');
    if (asResult !== null) {
      console.error('[noteplan-mcp] listCalendars: using AppleScript via NotePlan');
      if (asResult.error) {
        return { success: false, error: asResult.error };
      }
      if (Array.isArray(asResult)) {
        return { success: true, calendars: asResult };
      }
      // Unexpected shape — fall through to Swift helper
      console.error(`[noteplan-mcp] listCalendars: AppleScript returned unexpected shape, falling back`);
    }

    // Fall back to Swift helper
    console.error('[noteplan-mcp] listCalendars: falling back to calendar-helper binary');
    const result = runSwiftHelper(['list-calendars']);
    if (result && !Array.isArray(result)) {
      return {
        success: false,
        error: result.error || 'Calendar helper returned unexpected data',
      };
    }
    const calendars = result || [];

    return {
      success: true,
      calendars,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list calendars',
    };
  }
}
