// macOS Reminders operations via Swift/EventKit

import { z } from 'zod';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMPILED_HELPER = path.join(__dirname, '../../scripts/reminders-helper');
const SWIFT_HELPER = path.join(__dirname, '../../scripts/reminders-helper.swift');

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
      if (parsed.error) throw new Error(parsed.error);
    } catch {}
    throw new Error(error.stderr || error.message || 'Reminders helper failed');
  }
}

// Schema definitions
export const getRemindersSchema = z.object({
  list: z.string().optional().describe('Filter by reminder list name'),
  includeCompleted: z.boolean().optional().describe('Include completed reminders (default: false)'),
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
});

export const listReminderListsSchema = z.object({});

/**
 * Get reminders using Swift/EventKit
 */
export function getReminders(params: z.infer<typeof getRemindersSchema>) {
  try {
    const args = ['list-reminders'];
    if (params.list) {
      args.push(params.list);
    } else {
      args.push('');
    }
    args.push(params.includeCompleted ? 'true' : 'false');

    const reminders = runSwiftHelper(args) || [];

    return {
      success: true,
      reminderCount: reminders.length,
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
export function listReminderLists(_params: z.infer<typeof listReminderListsSchema>) {
  try {
    const lists = runSwiftHelper(['list-lists']) || [];

    return {
      success: true,
      lists,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list reminder lists',
    };
  }
}
