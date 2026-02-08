// macOS Calendar events operations via Swift/EventKit

import { z } from 'zod';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  issueConfirmationToken,
  validateAndConsumeConfirmationToken,
} from '../utils/confirmation-tokens.js';

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

    // Use compiled binary if it exists
    if (fs.existsSync(COMPILED_HELPER)) {
      result = execFileSync(COMPILED_HELPER, args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      }).trim();
    } else {
      // Fall back to swift interpreter
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
      if (parsed.error) throw new Error(parsed.error);
    } catch {}
    throw new Error(error.stderr || error.message || 'Calendar helper failed');
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

    // Format date as YYYY-MM-DD for Swift helper
    const startStr = startDate.toISOString().split('T')[0];

    const args = ['list-events', startStr, String(days)];
    if (input.calendar) {
      args.push(input.calendar);
    }

    const allEvents = runSwiftHelper(args) || [];
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

    // Format as ISO dates for Swift helper
    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();

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
    const calendars = runSwiftHelper(['list-calendars']) || [];

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
