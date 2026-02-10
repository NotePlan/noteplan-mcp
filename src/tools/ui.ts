// AppleScript-based UI control tools for NotePlan

import { z } from 'zod';
import { escapeAppleScript, runAppleScript, APP_NAME } from '../utils/applescript.js';

// --- Schemas ---

export const openNoteSchema = z.object({
  title: z.string().optional().describe('Title of the note to open'),
  filename: z.string().optional().describe('Filename of the note to open'),
  inNewWindow: z.boolean().optional().default(false).describe('Open in a new window'),
  inSplitView: z.boolean().optional().default(false).describe('Open in split view'),
});

export const openTodaySchema = z.object({});

export const searchNotesSchema = z.object({
  query: z.string().describe('Search text'),
});

export const runPluginSchema = z.object({
  pluginId: z.string().describe('Plugin ID'),
  command: z.string().describe('Command name'),
  arguments: z.string().optional().describe('JSON arguments string'),
});

export const reloadPluginsSchema = z.object({});

export const openViewSchema = z.object({
  name: z.string().describe('Name of the view to open'),
});

export const toggleSidebarSchema = z.object({});

export const closePluginWindowSchema = z.object({
  windowID: z.string().optional().describe('Window ID to close (exact match)'),
  title: z.string().optional().describe('Window title to close (case-insensitive match). Omit both windowID and title to close all plugin windows.'),
});

export const listPluginWindowsSchema = z.object({});

// --- Implementations ---

export function openNote(args: z.infer<typeof openNoteSchema>): { success: boolean; message: string } {
  const { title, filename, inNewWindow, inSplitView } = openNoteSchema.parse(args);

  if (!title && !filename) {
    return { success: false, message: 'Either title or filename is required' };
  }

  let params = '';
  if (title) {
    params += ` titled "${escapeAppleScript(title)}"`;
  }
  if (filename) {
    params += ` at path "${escapeAppleScript(filename)}"`;
  }
  if (inNewWindow) {
    params += ' in new window true';
  }
  if (inSplitView) {
    params += ' in split view true';
  }
  params += ' in background true';

  const script = `tell application "${APP_NAME}" to showNote${params}`;
  runAppleScript(script);
  return { success: true, message: `Opened note${title ? ` "${title}"` : ` (${filename})`}` };
}

export function openToday(_args: z.infer<typeof openTodaySchema>): { success: boolean; message: string } {
  const script = `tell application "${APP_NAME}" to openToday`;
  runAppleScript(script);
  return { success: true, message: "Opened today's note" };
}

export function searchNotes(args: z.infer<typeof searchNotesSchema>): { success: boolean; message: string } {
  const { query } = searchNotesSchema.parse(args);
  const script = `tell application "${APP_NAME}" to searchNotes for "${escapeAppleScript(query)}" in background true`;
  runAppleScript(script);
  return { success: true, message: `Searching for "${query}"` };
}

export function runPlugin(args: z.infer<typeof runPluginSchema>): { success: boolean; message: string } {
  const { pluginId, command, arguments: pluginArgs } = runPluginSchema.parse(args);

  let params = `with id "${escapeAppleScript(pluginId)}" with command "${escapeAppleScript(command)}"`;

  if (pluginArgs) {
    params += ` with arguments "${escapeAppleScript(pluginArgs)}"`;
  }

  const script = `tell application "${APP_NAME}" to executePlugin ${params}`;
  runAppleScript(script);
  return { success: true, message: `Ran plugin ${pluginId} command "${command}"` };
}

export function reloadPlugins(_args: z.infer<typeof reloadPluginsSchema>): { success: boolean; message: string } {
  const script = `tell application "${APP_NAME}" to reloadPlugins`;
  runAppleScript(script);
  return { success: true, message: 'Plugins reloaded' };
}

export function openView(args: z.infer<typeof openViewSchema>): { success: boolean; message: string } {
  const { name } = openViewSchema.parse(args);
  const script = `tell application "${APP_NAME}" to openView named "${escapeAppleScript(name)}"`;
  runAppleScript(script);
  return { success: true, message: `Opened view "${name}"` };
}

export function toggleSidebar(_args: z.infer<typeof toggleSidebarSchema>): { success: boolean; message: string } {
  const script = `tell application "${APP_NAME}" to toggleSidebar`;
  runAppleScript(script);
  return { success: true, message: 'Sidebar toggled' };
}

export function closePluginWindow(args: z.infer<typeof closePluginWindowSchema>): Record<string, unknown> {
  const { windowID, title } = closePluginWindowSchema.parse(args);

  let params = '';
  if (windowID) {
    params = ` with id "${escapeAppleScript(windowID)}"`;
  } else if (title) {
    params = ` titled "${escapeAppleScript(title)}"`;
  }

  const script = `tell application "${APP_NAME}" to closePluginWindow${params}`;
  const result = runAppleScript(script);

  // NotePlan currently returns "true" regardless of whether a window was closed.
  // Parse the result for future-proofing in case NotePlan adds proper return values.
  const closed = result !== 'false';

  if (windowID) {
    return { success: closed, message: closed ? `Closed plugin window "${windowID}"` : `No plugin window found with ID "${windowID}"` };
  } else if (title) {
    return {
      success: closed,
      message: closed ? `Closed plugin window titled "${title}"` : `No plugin window found titled "${title}"`,
    };
  }
  return { success: closed, message: closed ? 'Closed all plugin windows' : 'No plugin windows were open' };
}

export function listPluginWindows(_args: z.infer<typeof listPluginWindowsSchema>): Record<string, unknown> {
  let raw: string;
  try {
    raw = runAppleScript(`tell application "${APP_NAME}" to listPluginWindows`, 15_000);
  } catch (e: any) {
    return { success: false, error: `Failed to list plugin windows: ${e.message}` };
  }

  let windows: any[];
  try {
    windows = JSON.parse(raw);
  } catch {
    return { success: false, error: 'Failed to parse plugin windows list from NotePlan' };
  }

  return {
    success: true,
    count: windows.length,
    windows,
  };
}
