// macOS Reminders operations via Swift/EventKit
// Prefers AppleScript via NotePlan (which already has reminders permission),
// falls back to the Swift reminders-helper binary.

import { z } from 'zod';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  issueConfirmationToken,
  validateAndConsumeConfirmationToken,
} from '../utils/confirmation-tokens.js';
import { runAppleScript, escapeAppleScript, APP_NAME } from '../utils/applescript.js';

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMPILED_HELPER = path.join(__dirname, '../../scripts/reminders-helper');
const SWIFT_HELPER = path.join(__dirname, '../../scripts/reminders-helper.swift');

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

/**
 * Run the reminders helper (prefers compiled binary, falls back to swift interpreter)
 */
function runSwiftHelper(args: string[], timeoutMs = 30000): any {
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
      throw new Error('Reminders query timed out.');
    }
    // Try to parse error from output
    try {
      const parsed = JSON.parse(error.stdout || '{}');
      if (parsed.error) throw new Error(enhancePermissionError(parsed.error));
    } catch {}
    throw new Error(enhancePermissionError(error.stderr || error.message || 'Reminders helper failed'));
  }
}

const NOTEPLAN_PERMISSION_HINT =
  ' As a workaround, open NotePlan and try again — the MCP server will route through' +
  " NotePlan's own reminders permission automatically.";

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
 * Try running a reminder command via AppleScript through NotePlan.
 * Returns parsed JSON on success, or null if NotePlan isn't running or
 * the command isn't supported.
 */
function tryReminderAppleScript(command: string): any | null {
  try {
    const result = runAppleScript(`tell application "${APP_NAME}" to ${command}`);
    if (!result) return null;
    return JSON.parse(result);
  } catch (err) {
    console.error(`[noteplan-mcp] AppleScript reminder fallback: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// Schema definitions
export const getRemindersSchema = z.object({
  list: z.string().optional().describe('Filter by reminder list name'),
  includeCompleted: z.boolean().optional().describe('Include completed reminders (default: false)'),
  query: z.string().optional().describe('Filter reminders by title/notes/list substring'),
  limit: z.number().min(1).max(500).optional().default(100).describe('Maximum reminders to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const createReminderSchema = z.object({
  title: z.string().describe('Reminder title'),
  list: z.string().optional().describe('Reminder list name (defaults to default list)'),
  dueDate: z.string().optional().describe('Due date (YYYY-MM-DD or YYYY-MM-DD HH:MM)'),
  notes: z.string().optional().describe('Reminder notes'),
  priority: z.number().optional().describe('Priority: 0 (none), 1 (high), 5 (medium), 9 (low)'),
});

export const completeReminderSchema = z.object({
  reminderId: z.string().describe('Reminder ID to mark as complete'),
});

export const updateReminderSchema = z.object({
  reminderId: z.string().describe('Reminder ID (from get_reminders)'),
  title: z.string().optional().describe('New title'),
  dueDate: z.string().optional().describe('New due date'),
  notes: z.string().optional().describe('New notes'),
  priority: z.number().optional().describe('New priority'),
});

export const deleteReminderSchema = z.object({
  reminderId: z.string().describe('Reminder ID to delete'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview deletion impact without deleting the reminder (default: false)'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for delete execution'),
});

export const listReminderListsSchema = z.object({
  query: z.string().optional().describe('Filter reminder lists by name substring'),
  limit: z.number().min(1).max(200).optional().default(100).describe('Maximum reminder lists to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

/**
 * Get reminders using Swift/EventKit
 */
export function getReminders(params: z.infer<typeof getRemindersSchema>) {
  try {
    const input = params ?? ({} as z.infer<typeof getRemindersSchema>);

    // Try AppleScript first
    let allReminders: any[] = [];
    let usedAppleScript = false;
    let asCmd = 'listReminders';
    if (input.list) asCmd += ` in list "${escapeAppleScript(input.list)}"`;
    if (input.includeCompleted === true) asCmd += ' include completed true';
    const asResult = tryReminderAppleScript(asCmd);
    if (asResult !== null && Array.isArray(asResult)) {
      console.error('[noteplan-mcp] getReminders: using AppleScript via NotePlan');
      allReminders = asResult;
      usedAppleScript = true;
    }

    // Fall back to Swift helper
    if (!usedAppleScript) {
      console.error('[noteplan-mcp] getReminders: falling back to reminders-helper binary');
      const args = ['list-reminders'];
      if (input.list) {
        args.push(input.list);
      } else {
        args.push('');
      }
      args.push(input.includeCompleted === true ? 'true' : 'false');
      allReminders = runSwiftHelper(args) || [];
    }

    const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : undefined;
    const filtered = query
      ? allReminders.filter((reminder: any) =>
          `${reminder.title || ''} ${reminder.notes || ''} ${reminder.list || ''}`
            .toLowerCase()
            .includes(query)
        )
      : allReminders;
    const offset = toBoundedInt(input.cursor ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = toBoundedInt(input.limit, 100, 1, 500);
    const reminders = filtered.slice(offset, offset + limit);
    const hasMore = offset + reminders.length < filtered.length;
    const nextCursor = hasMore ? String(offset + reminders.length) : null;

    return {
      success: true,
      reminderCount: reminders.length,
      totalCount: filtered.length,
      offset,
      limit,
      hasMore,
      nextCursor,
      reminders,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get reminders',
    };
  }
}

/**
 * Create a new reminder using Swift/EventKit
 */
export function createReminder(params: z.infer<typeof createReminderSchema>) {
  try {
    // Try AppleScript first
    let asCmd = `createReminder with title "${escapeAppleScript(params.title)}"`;
    if (params.list) asCmd += ` in list "${escapeAppleScript(params.list)}"`;
    if (params.dueDate) {
      const dueDate = new Date(params.dueDate.replace(' ', 'T'));
      asCmd += ` due date "${dueDate.toISOString()}"`;
    }
    if (params.notes) asCmd += ` with notes "${escapeAppleScript(params.notes)}"`;
    if (params.priority !== undefined) asCmd += ` with priority ${params.priority}`;
    const asResult = tryReminderAppleScript(asCmd);
    if (asResult !== null) {
      console.error('[noteplan-mcp] createReminder: using AppleScript via NotePlan');
      if (asResult.error) return { success: false, error: asResult.error };
      return {
        success: true,
        message: `Reminder "${params.title}" created`,
        reminder: { id: asResult.id || '', title: params.title },
      };
    }

    // Fall back to Swift helper
    console.error('[noteplan-mcp] createReminder: falling back to reminders-helper binary');
    const args = ['create-reminder', params.title];
    args.push(params.list || '');

    if (params.dueDate) {
      const dueDate = new Date(params.dueDate.replace(' ', 'T'));
      args.push(dueDate.toISOString());
    } else {
      args.push('');
    }

    args.push(params.notes || '');
    args.push(String(params.priority || 0));

    const result = runSwiftHelper(args);

    if (result?.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: `Reminder "${params.title}" created`,
      reminder: {
        id: result?.id || '',
        title: params.title,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create reminder',
    };
  }
}

/**
 * Mark a reminder as complete using Swift/EventKit
 */
export function completeReminder(params: z.infer<typeof completeReminderSchema>) {
  try {
    // Try AppleScript first
    const asResult = tryReminderAppleScript(
      `completeReminder with id "${escapeAppleScript(params.reminderId)}"`
    );
    if (asResult !== null) {
      console.error('[noteplan-mcp] completeReminder: using AppleScript via NotePlan');
      if (asResult.error) return { success: false, error: asResult.error };
      return { success: true, message: 'Reminder marked as complete' };
    }

    // Fall back to Swift helper
    console.error('[noteplan-mcp] completeReminder: falling back to reminders-helper binary');
    const result = runSwiftHelper(['complete-reminder', params.reminderId]);

    if (result?.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: 'Reminder marked as complete',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to complete reminder',
    };
  }
}

/**
 * Update an existing reminder using Swift/EventKit
 */
export function updateReminder(params: z.infer<typeof updateReminderSchema>) {
  try {
    const updates: Record<string, any> = {};
    if (params.title) updates.title = params.title;
    if (params.dueDate) {
      updates.dueDate = new Date(params.dueDate.replace(' ', 'T')).toISOString();
    }
    if (params.notes !== undefined) updates.notes = params.notes;
    if (params.priority !== undefined) updates.priority = params.priority;

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No updates provided' };
    }

    // Try AppleScript first
    const updatesJson = escapeAppleScript(JSON.stringify(updates));
    const asResult = tryReminderAppleScript(
      `updateReminder with id "${escapeAppleScript(params.reminderId)}" with updates "${updatesJson}"`
    );
    if (asResult !== null) {
      console.error('[noteplan-mcp] updateReminder: using AppleScript via NotePlan');
      if (asResult.error) return { success: false, error: asResult.error };
      return { success: true, message: 'Reminder updated' };
    }

    // Fall back to Swift helper
    console.error('[noteplan-mcp] updateReminder: falling back to reminders-helper binary');
    const result = runSwiftHelper(['update-reminder', params.reminderId, JSON.stringify(updates)]);

    if (result?.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: 'Reminder updated',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update reminder',
    };
  }
}

/**
 * Delete a reminder using Swift/EventKit
 */
export function deleteReminder(params: z.infer<typeof deleteReminderSchema>) {
  try {
    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'reminders_delete',
        target: params.reminderId,
        action: 'delete_reminder',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: reminder ${params.reminderId} would be deleted`,
        reminderId: params.reminderId,
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'reminders_delete',
      target: params.reminderId,
      action: 'delete_reminder',
    });
    if (!confirmation.ok) {
      const refreshHint = 'Call reminders_delete with dryRun=true to get a new confirmationToken.';
      const message =
        confirmation.reason === 'missing'
          ? `Confirmation token is required for reminders_delete. ${refreshHint}`
          : confirmation.reason === 'expired'
            ? `Confirmation token is expired for reminders_delete. ${refreshHint}`
            : `Confirmation token is invalid for reminders_delete. ${refreshHint}`;
      return {
        success: false,
        error: message,
      };
    }

    // Try AppleScript first
    const asResult = tryReminderAppleScript(
      `deleteReminder with id "${escapeAppleScript(params.reminderId)}"`
    );
    if (asResult !== null) {
      console.error('[noteplan-mcp] deleteReminder: using AppleScript via NotePlan');
      if (asResult.error) return { success: false, error: asResult.error };
      return { success: true, message: 'Reminder deleted' };
    }

    // Fall back to Swift helper
    console.error('[noteplan-mcp] deleteReminder: falling back to reminders-helper binary');
    const result = runSwiftHelper(['delete-reminder', params.reminderId]);

    if (result?.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: 'Reminder deleted',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete reminder',
    };
  }
}

/**
 * List all reminder lists using Swift/EventKit
 */
export function listReminderLists(params: z.infer<typeof listReminderListsSchema>) {
  try {
    const input = params ?? ({} as z.infer<typeof listReminderListsSchema>);

    // Try AppleScript first
    let allLists: any[];
    const asResult = tryReminderAppleScript('listReminderLists');
    if (asResult !== null && Array.isArray(asResult)) {
      console.error('[noteplan-mcp] listReminderLists: using AppleScript via NotePlan');
      allLists = asResult;
    } else {
      console.error('[noteplan-mcp] listReminderLists: falling back to reminders-helper binary');
      allLists = runSwiftHelper(['list-lists']) || [];
    }

    const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : undefined;
    const filtered = query
      ? allLists.filter((list: any) => {
          const name = typeof list === 'string' ? list : list.name || '';
          return name.toLowerCase().includes(query);
        })
      : allLists;
    const offset = toBoundedInt(input.cursor ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = toBoundedInt(input.limit, 100, 1, 200);
    const lists = filtered.slice(offset, offset + limit);
    const hasMore = offset + lists.length < filtered.length;
    const nextCursor = hasMore ? String(offset + lists.length) : null;

    return {
      success: true,
      count: lists.length,
      totalCount: filtered.length,
      offset,
      limit,
      hasMore,
      nextCursor,
      lists,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list reminder lists',
    };
  }
}
