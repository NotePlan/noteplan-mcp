// Plugin creation and management tools

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getNotePlanPath } from '../noteplan/file-reader.js';
import {
  issueConfirmationToken,
  validateAndConsumeConfirmationToken,
} from '../utils/confirmation-tokens.js';
import { reloadPlugins, runPlugin } from './ui.js';
import { escapeAppleScript, runAppleScript, APP_NAME } from '../utils/applescript.js';

function getPluginsPath(): string {
  return path.join(getNotePlanPath(), 'Plugins');
}

function validatePluginId(pluginId: string): string | null {
  if (pluginId.trim().length === 0) {
    return 'Invalid pluginId: must not be empty';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(pluginId)) {
    return 'Invalid pluginId: must contain only letters, digits, dots, hyphens, and underscores';
  }
  return null;
}

function toSafeJsIdentifier(name: string): string {
  // Strip whitespace, replace non-identifier chars with underscore
  let id = name.replace(/\s+/g, '').replace(/[^a-zA-Z0-9_$]/g, '_');
  // Ensure it doesn't start with a digit
  if (/^[0-9]/.test(id)) {
    id = '_' + id;
  }
  return id || '_command';
}

// --- Schemas ---

export const createPluginSchema = z.object({
  pluginId: z.string().describe('Plugin ID (e.g., "mcp.dashboard")'),
  pluginName: z.string().describe('Display name of the plugin'),
  commandName: z.string().describe('The command name'),
  html: z.string().describe('Full HTML content for the plugin view'),
  icon: z.string().optional().describe('Font Awesome icon name (e.g., "chart-bar")'),
  iconColor: z.string().optional().describe('Tailwind color like "blue-500"'),
  displayMode: z
    .enum(['main', 'split', 'window'])
    .optional()
    .default('main')
    .describe('Where to display the HTML view'),
  autoLaunch: z
    .boolean()
    .optional()
    .default(true)
    .describe('Reload plugins and run after creation'),
});

export const deletePluginSchema = z.object({
  pluginId: z.string().describe('Plugin ID to delete'),
  confirmationToken: z.string().optional().describe('Confirmation token (call without to receive one)'),
});

export const listPluginsSchema = z.object({
  query: z.string().optional().describe('Filter plugins by name or ID (case-insensitive substring match)'),
});

export const listAvailablePluginsSchema = z.object({
  query: z.string().optional().describe('Filter by plugin name or ID (case-insensitive substring match)'),
  includeBeta: z.boolean().optional().default(false).describe('Include beta/pre-release plugins (default: false, showing only stable releases)'),
});

export const installPluginSchema = z.object({
  pluginId: z.string().describe('Plugin ID to install or update'),
});

export const getPluginLogSchema = z.object({
  pluginId: z.string().describe('Plugin ID whose console log to read'),
});

export const getPluginSourceSchema = z.object({
  pluginId: z.string().describe('Plugin ID (e.g., "mcp.dashboard"). Use noteplan_list_plugins to find valid IDs.'),
});

// --- Implementations ---

export function listPlugins(args: z.infer<typeof listPluginsSchema>): Record<string, unknown> {
  const { query } = listPluginsSchema.parse(args ?? {});

  let raw: string;
  try {
    raw = runAppleScript(`tell application "${APP_NAME}" to listInstalledPlugins`, 30_000);
  } catch (e: any) {
    return { success: false, error: `Failed to list installed plugins: ${e.message}` };
  }

  let allPlugins: any[];
  try {
    allPlugins = JSON.parse(raw);
  } catch {
    return { success: false, error: 'Failed to parse plugin list from NotePlan' };
  }

  const plugins: Record<string, unknown>[] = [];
  for (const p of allPlugins) {
    const pluginId: string = p.id ?? '';
    const pluginName: string = p.name ?? '';

    if (query) {
      const lq = query.toLowerCase();
      if (!pluginId.toLowerCase().includes(lq) && !pluginName.toLowerCase().includes(lq)) continue;
    }

    const commands = Array.isArray(p.commands) ? p.commands : [];
    plugins.push({
      id: pluginId,
      name: pluginName,
      description: p.description ?? '',
      author: p.author ?? '',
      version: p.version ?? '',
      icon: p.icon ?? '',
      ...(p.iconColor ? { iconColor: p.iconColor } : {}),
      isEnabled: p.isEnabled ?? true,
      commandCount: commands.length,
      commands,
    });
  }

  plugins.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    success: true,
    count: plugins.length,
    plugins,
  };
}

export function createPlugin(args: z.infer<typeof createPluginSchema>): Record<string, unknown> {
  const {
    pluginId,
    pluginName,
    commandName,
    html,
    icon,
    iconColor,
    displayMode,
    autoLaunch,
  } = createPluginSchema.parse(args);

  const idError = validatePluginId(pluginId);
  if (idError) {
    return { success: false, error: idError };
  }

  const pluginsPath = getPluginsPath();
  const pluginDir = path.join(pluginsPath, pluginId);

  fs.mkdirSync(pluginDir, { recursive: true });

  // Build the plugin.json manifest
  const jsFunction = toSafeJsIdentifier(commandName);
  const manifest: Record<string, unknown> = {
    'plugin.id': pluginId,
    'plugin.name': pluginName,
    'plugin.description': `Created by MCP: ${pluginName}`,
    'plugin.author': 'MCP',
    'plugin.version': '1.0.0',
    'plugin.script': 'script.js',
    'plugin.icon': icon ?? 'puzzle-piece',
    'plugin.commands': [
      {
        name: commandName,
        description: pluginName,
        jsFunction,
        sidebarView: {
          title: pluginName,
          icon: icon ?? 'puzzle-piece',
          ...(iconColor ? { iconColor } : {}),
        },
      },
    ],
  };

  if (iconColor) {
    manifest['plugin.iconColor'] = iconColor;
  }

  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // Build script.js
  // Escape backticks and template literal expressions in the HTML for safe embedding
  const escapedHtml = html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

  // For showInMainWindow, we pass an options object with id for sidebar pinning
  let scriptJs: string;
  if (displayMode === 'main') {
    scriptJs = `// Generated by MCP
globalThis.${jsFunction} = async function() {
  const html = \`${escapedHtml}\`;
  await HTMLView.showInMainWindow(html, ${JSON.stringify(pluginName)}, { id: "main:${pluginId}:${pluginName}" });
};
`;
  } else {
    const showMethod = displayMode === 'window' ? 'showWindow' : 'showInSplitView';
    scriptJs = `// Generated by MCP
globalThis.${jsFunction} = async function() {
  const html = \`${escapedHtml}\`;
  await HTMLView.${showMethod}(html, ${JSON.stringify(pluginName)});
};
`;
  }

  fs.writeFileSync(path.join(pluginDir, 'script.js'), scriptJs, 'utf-8');

  const result: Record<string, unknown> = {
    success: true,
    message: `Plugin "${pluginName}" created successfully`,
    pluginId,
    commandName,
  };

  if (autoLaunch) {
    try {
      reloadPlugins({});
      // Brief delay to let plugins load before running
      execFileSync('sleep', ['1'], { timeout: 5000 });
      runPlugin({ pluginId, command: commandName });
      result.launched = true;
    } catch (error: any) {
      result.launched = false;
      result.launchError = error.message;
    }
  }

  return result;
}

export function deletePlugin(args: z.infer<typeof deletePluginSchema>): Record<string, unknown> {
  const { pluginId, confirmationToken } = deletePluginSchema.parse(args);

  const idError = validatePluginId(pluginId);
  if (idError) {
    return { success: false, error: idError };
  }

  const pluginsPath = getPluginsPath();
  const pluginDir = path.join(pluginsPath, pluginId);

  if (!fs.existsSync(pluginDir)) {
    return { success: false, error: `Plugin "${pluginId}" not found` };
  }

  const context = { tool: 'noteplan_delete_plugin', target: pluginId, action: 'delete' };

  if (!confirmationToken) {
    const token = issueConfirmationToken(context);
    return {
      success: false,
      error: 'Confirmation required to delete plugin',
      pluginId,
      ...token,
    };
  }

  const validation = validateAndConsumeConfirmationToken(confirmationToken, context);
  if (!validation.ok) {
    return {
      success: false,
      error: `Confirmation failed: ${validation.reason}`,
      pluginId,
    };
  }

  fs.rmSync(pluginDir, { recursive: true, force: true });

  // Reload plugins so NotePlan picks up the removal
  try {
    reloadPlugins({});
  } catch {
    // Non-fatal — plugin is already deleted from disk
  }

  return {
    success: true,
    message: `Plugin "${pluginId}" deleted`,
    pluginId,
  };
}

export function listAvailablePlugins(args: unknown): Record<string, unknown> {
  const { query, includeBeta } = listAvailablePluginsSchema.parse(args ?? {});

  let script = `tell application "${APP_NAME}" to listAvailablePlugins`;
  if (includeBeta) {
    script = `tell application "${APP_NAME}" to listAvailablePlugins include beta true`;
  }

  let raw: string;
  try {
    raw = runAppleScript(script, 30_000);
  } catch (e: any) {
    return { success: false, error: `Failed to list available plugins: ${e.message}` };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { success: false, error: 'Failed to parse available plugins from NotePlan' };
  }

  if (parsed.error) {
    return { success: false, error: parsed.error };
  }

  const allPlugins: any[] = Array.isArray(parsed) ? parsed : [];
  const plugins: Record<string, unknown>[] = [];
  for (const p of allPlugins) {
    const pluginId: string = p.id ?? '';
    const pluginName: string = p.name ?? '';

    if (query) {
      const lq = query.toLowerCase();
      if (!pluginId.toLowerCase().includes(lq) && !pluginName.toLowerCase().includes(lq)) continue;
    }

    const commands = Array.isArray(p.commands) ? p.commands : [];
    plugins.push({
      id: pluginId,
      name: pluginName,
      description: p.description ?? '',
      author: p.author ?? '',
      version: p.version ?? '',
      icon: p.icon ?? '',
      ...(p.iconColor ? { iconColor: p.iconColor } : {}),
      ...(p.releaseStatus ? { releaseStatus: p.releaseStatus } : {}),
      ...(p.availableUpdate ? { availableUpdate: p.availableUpdate } : {}),
      commandCount: commands.length,
      commands,
    });
  }

  plugins.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    success: true,
    count: plugins.length,
    plugins,
  };
}

export function installPlugin(args: unknown): Record<string, unknown> {
  const { pluginId } = installPluginSchema.parse(args);

  const idError = validatePluginId(pluginId);
  if (idError) {
    return { success: false, error: idError };
  }

  try {
    const script = `tell application "${APP_NAME}" to installPlugin with id "${escapeAppleScript(pluginId)}"`;
    const result = runAppleScript(script, 30_000);
    if (result === 'false') {
      return { success: false, error: `Failed to install plugin "${pluginId}"` };
    }
  } catch (e: any) {
    return { success: false, error: `Failed to trigger install: ${e.message}` };
  }

  return {
    success: true,
    message: `Install/update triggered for plugin "${pluginId}". NotePlan is processing the installation asynchronously.`,
  };
}

export function getPluginLog(args: unknown): Record<string, unknown> {
  const { pluginId } = getPluginLogSchema.parse(args);

  const idError = validatePluginId(pluginId);
  if (idError) {
    return { success: false, error: idError };
  }

  const pluginsPath = getPluginsPath();
  const logPath = path.join(pluginsPath, pluginId, '_MCP-console.log');

  if (!fs.existsSync(logPath)) {
    return {
      success: true,
      log: '',
      message: `No console log found for plugin "${pluginId}". The plugin may not have been run yet, or it produced no output.`,
    };
  }

  const log = fs.readFileSync(logPath, 'utf-8');

  return {
    success: true,
    pluginId,
    log,
    lineCount: log.split('\n').filter((l) => l.length > 0).length,
  };
}

export function getPluginSource(args: unknown): Record<string, unknown> {
  const { pluginId } = getPluginSourceSchema.parse(args);

  const idError = validatePluginId(pluginId);
  if (idError) {
    return { success: false, error: idError };
  }

  const pluginsPath = getPluginsPath();
  const pluginDir = path.join(pluginsPath, pluginId);

  if (!fs.existsSync(pluginDir)) {
    return { success: false, error: `Plugin "${pluginId}" not found` };
  }

  const manifestPath = path.join(pluginDir, 'plugin.json');
  const scriptPath = path.join(pluginDir, 'script.js');

  if (!fs.existsSync(manifestPath)) {
    return { success: false, error: `plugin.json not found in plugin folder "${pluginId}"` };
  }
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `script.js not found in plugin folder "${pluginId}"` };
  }

  let pluginJson: unknown;
  try {
    pluginJson = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e: any) {
    return { success: false, error: `Failed to parse plugin.json: ${e.message}` };
  }

  const scriptJs = fs.readFileSync(scriptPath, 'utf-8');

  return {
    success: true,
    pluginId,
    pluginJson,
    scriptJs,
  };
}
