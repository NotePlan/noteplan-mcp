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
  tail: z.number().int().min(1).optional().describe('Return only the last N lines of the log'),
  clear: z.boolean().optional().default(false).describe('Clear the log file after reading it'),
});

export const getPluginSourceSchema = z.object({
  pluginId: z.string().describe('Plugin ID (e.g., "mcp.dashboard"). Use noteplan_list_plugins to find valid IDs.'),
  query: z.string().optional().describe('Search within the HTML source. Returns matching lines with line numbers and context. Much cheaper than reading full source.'),
  startLine: z.number().int().min(1).optional().describe('Return lines starting from this line number (1-based). Use with endLine for a slice.'),
  endLine: z.number().int().min(1).optional().describe('Return lines up to and including this line number (1-based).'),
  contextLines: z.number().int().min(0).max(10).optional().default(3).describe('Number of context lines around query matches (default: 3). Only used with query.'),
});

export const screenshotPluginSchema = z.object({
  pluginId: z.string().describe('Plugin ID to screenshot (e.g., "mcp.dashboard")'),
});

export const updatePluginHtmlSchema = z.object({
  pluginId: z.string().describe('Plugin ID (e.g., "mcp.dashboard")'),
  patches: z.array(z.object({
    find: z.string().describe('Exact string to find in the HTML'),
    replace: z.string().describe('Replacement string'),
  })).min(1).max(50).describe('Find/replace patches to apply sequentially (first match only per patch)'),
  autoLaunch: z.boolean().optional().default(true).describe('Reload plugins and run after patching (default: true)'),
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
    tip: 'Use action "log" to view a plugin\'s console output for debugging, or "source" with a query to search its code.',
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
    hint: 'Call noteplan_get_plugin_log to check for errors.',
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
  const { pluginId, tail, clear } = getPluginLogSchema.parse(args);

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

  const fullLog = fs.readFileSync(logPath, 'utf-8');
  const allLines = fullLog.split('\n');
  const totalLines = allLines.filter((l) => l.length > 0).length;

  let log: string;
  let truncated = false;

  if (tail && tail < allLines.length) {
    // Take the last N lines (preserving trailing newline behavior)
    log = allLines.slice(-tail).join('\n');
    truncated = true;
  } else {
    log = fullLog;
  }

  // Clear the log file after reading if requested
  if (clear) {
    fs.writeFileSync(logPath, '', 'utf-8');
  }

  return {
    success: true,
    pluginId,
    log,
    lineCount: totalLines,
    ...(truncated ? { truncated: true, showing: `last ${tail} lines of ${totalLines}` } : {}),
    ...(clear ? { cleared: true } : {}),
  };
}

export function getPluginSource(args: unknown): Record<string, unknown> {
  const { pluginId, query, startLine, endLine, contextLines } = getPluginSourceSchema.parse(args);

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
  const bounds = findHtmlTemplateBounds(scriptJs);

  // Get the source content and determine type
  let source: string;
  let mcpGenerated: boolean;
  let displayMode: string | undefined;

  if (bounds) {
    const escapedHtml = scriptJs.slice(bounds.start, bounds.end);
    source = unescapeTemplateHtml(escapedHtml);
    mcpGenerated = true;
    displayMode = 'main';
    if (scriptJs.includes('HTMLView.showWindow(')) displayMode = 'window';
    else if (scriptJs.includes('HTMLView.showInSplitView(')) displayMode = 'split';
  } else {
    source = scriptJs;
    mcpGenerated = false;
  }

  const allLines = source.split('\n');
  const totalLines = allLines.length;
  const sourceLength = source.length;

  // --- Query mode: grep within the source ---
  if (query) {
    const lowerQuery = query.toLowerCase();
    const matchingLineNums: number[] = [];

    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].toLowerCase().includes(lowerQuery)) {
        matchingLineNums.push(i);
      }
    }

    if (matchingLineNums.length === 0) {
      return {
        success: true,
        pluginId,
        mcpGenerated,
        matchCount: 0,
        totalLines,
        sourceLength,
        message: `No matches for "${query}"`,
      };
    }

    // Build result with context lines, merging overlapping ranges
    const ctx = contextLines ?? 3;
    const resultLines: string[] = [];
    let lastEmittedLine = -1;

    for (const matchIdx of matchingLineNums) {
      const rangeStart = Math.max(0, matchIdx - ctx);
      const rangeEnd = Math.min(allLines.length - 1, matchIdx + ctx);

      // Add separator if there's a gap from previous range
      if (lastEmittedLine >= 0 && rangeStart > lastEmittedLine + 1) {
        resultLines.push('---');
      }

      for (let i = rangeStart; i <= rangeEnd; i++) {
        if (i <= lastEmittedLine) continue; // skip already emitted
        const marker = i === matchIdx ? '>' : ' ';
        resultLines.push(`${marker} ${i + 1}\t${allLines[i]}`);
        lastEmittedLine = i;
      }
    }

    return {
      success: true,
      pluginId,
      mcpGenerated,
      matchCount: matchingLineNums.length,
      totalLines,
      sourceLength,
      matches: resultLines.join('\n'),
      hint: 'Use startLine/endLine to read a specific range, or noteplan_update_plugin_html to edit.',
    };
  }

  // --- Line range mode: return a slice ---
  if (startLine !== undefined || endLine !== undefined) {
    const from = Math.max(0, (startLine ?? 1) - 1); // convert 1-based to 0-based
    const to = Math.min(allLines.length, endLine ?? allLines.length);

    if (from >= allLines.length) {
      return {
        success: false,
        error: `startLine ${startLine} exceeds total lines (${totalLines})`,
        totalLines,
        sourceLength,
      };
    }

    const slicedLines = allLines.slice(from, to);
    const numbered = slicedLines.map((line, i) => `${from + i + 1}\t${line}`).join('\n');

    return {
      success: true,
      pluginId,
      mcpGenerated,
      ...(displayMode ? { displayMode } : {}),
      range: { from: from + 1, to: Math.min(to, allLines.length), totalLines },
      sourceLength,
      source: numbered,
      hint: 'Use query to search, or noteplan_update_plugin_html to edit.',
    };
  }

  // --- Full source mode (default) ---
  if (mcpGenerated) {
    return {
      success: true,
      pluginId,
      pluginJson,
      html: source,
      displayMode,
      mcpGenerated: true,
      totalLines,
      sourceLength,
      hint: 'Use noteplan_update_plugin_html for targeted edits, or noteplan_create_plugin to rewrite entirely. Use query param to search within source, or startLine/endLine for partial reads.',
    };
  }

  return {
    success: true,
    pluginId,
    pluginJson,
    scriptJs: source,
    mcpGenerated: false,
    totalLines,
    sourceLength,
  };
}

// --- HTML extraction/insertion helpers for MCP-generated plugins ---

/**
 * Find the HTML template literal in an MCP-generated script.js.
 * Pattern: `const html = \`...\`;` where the backtick is unescaped.
 * Returns { start, end } indices of the HTML content (inside the backticks),
 * or null if this is not an MCP-generated plugin.
 */
function findHtmlTemplateBounds(scriptJs: string): { start: number; end: number } | null {
  const marker = 'const html = `';
  const markerIdx = scriptJs.indexOf(marker);
  if (markerIdx === -1) return null;

  const contentStart = markerIdx + marker.length;

  // Find the matching unescaped closing backtick
  let i = contentStart;
  while (i < scriptJs.length) {
    if (scriptJs[i] === '`') {
      // Check if it's escaped (count preceding backslashes)
      let backslashes = 0;
      let j = i - 1;
      while (j >= contentStart && scriptJs[j] === '\\') {
        backslashes++;
        j--;
      }
      // Unescaped if even number of preceding backslashes
      if (backslashes % 2 === 0) {
        return { start: contentStart, end: i };
      }
    }
    i++;
  }

  return null;
}

/** Unescape HTML that was embedded in a JS template literal */
function unescapeTemplateHtml(escaped: string): string {
  // Reverse the escaping done in createPlugin:
  // 1. \${ → ${  (template expression)
  // 2. \` → `    (backtick)
  // 3. \\ → \    (backslash — must be last)
  return escaped.replace(/\\\$\{/g, '${').replace(/\\`/g, '`').replace(/\\\\/g, '\\');
}

/** Escape HTML for embedding in a JS template literal */
function escapeTemplateHtml(html: string): string {
  // Same order as createPlugin: \ → \\, ` → \`, ${ → \${
  return html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/**
 * When a patch find string doesn't match, try to locate a near-miss.
 * Uses progressively shorter prefixes of each line to find the divergence
 * point, then returns a snippet of the actual source around that location.
 */
function findNearestMatch(html: string, findStr: string): string | null {
  const lines = findStr.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  // Strategy 1: progressively shorter prefixes of the first non-empty line
  const firstLine = lines[0].trim();
  if (firstLine.length >= 10) {
    // Try full line, then shrink by 5 chars each step down to 10
    for (let len = firstLine.length; len >= 10; len -= 5) {
      const prefix = firstLine.slice(0, len);
      const idx = html.indexOf(prefix);
      if (idx !== -1) {
        return extractSnippet(html, idx);
      }
    }
  }

  // Strategy 2: try subsequent lines of the find string (for multi-line finds)
  for (let i = 1; i < lines.length && i < 5; i++) {
    const line = lines[i].trim();
    if (line.length < 10) continue;
    for (let len = line.length; len >= 10; len -= 5) {
      const prefix = line.slice(0, len);
      const idx = html.indexOf(prefix);
      if (idx !== -1) {
        return extractSnippet(html, idx);
      }
    }
  }

  return null;
}

/** Extract a snippet around a character position with line numbers */
function extractSnippet(html: string, pos: number): string {
  const allLines = html.split('\n');

  // Find which line the position falls on
  let charCount = 0;
  let targetLine = 0;
  for (let i = 0; i < allLines.length; i++) {
    charCount += allLines[i].length + 1; // +1 for \n
    if (charCount > pos) {
      targetLine = i;
      break;
    }
  }

  // Show a few lines around the target
  const ctxLines = 3;
  const from = Math.max(0, targetLine - ctxLines);
  const to = Math.min(allLines.length, targetLine + ctxLines + 1);
  const snippet = allLines
    .slice(from, to)
    .map((line, i) => {
      const lineNum = from + i + 1;
      const marker = from + i === targetLine ? '>' : ' ';
      const truncated = line.length > 120 ? line.slice(0, 117) + '...' : line;
      return `${marker} ${lineNum}\t${truncated}`;
    })
    .join('\n');

  return snippet;
}

export function updatePluginHtml(args: unknown): Record<string, unknown> {
  const { pluginId, patches, autoLaunch } = updatePluginHtmlSchema.parse(args);

  const idError = validatePluginId(pluginId);
  if (idError) {
    return { success: false, error: idError };
  }

  const pluginsPath = getPluginsPath();
  const pluginDir = path.join(pluginsPath, pluginId);

  if (!fs.existsSync(pluginDir)) {
    return { success: false, error: `Plugin "${pluginId}" not found` };
  }

  const scriptPath = path.join(pluginDir, 'script.js');
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `script.js not found in plugin folder "${pluginId}"` };
  }

  const scriptJs = fs.readFileSync(scriptPath, 'utf-8');
  const bounds = findHtmlTemplateBounds(scriptJs);

  if (!bounds) {
    return {
      success: false,
      error: 'This plugin was not generated by MCP (no `const html = \\`...\\`` pattern found). Use noteplan_get_plugin_source to read the full source and noteplan_create_plugin to rewrite it.',
    };
  }

  // Extract and unescape the HTML
  const escapedHtml = scriptJs.slice(bounds.start, bounds.end);
  let html = unescapeTemplateHtml(escapedHtml);

  // Apply patches sequentially
  const patchResults: Array<Record<string, unknown>> = [];
  let appliedCount = 0;

  for (const patch of patches) {
    const idx = html.indexOf(patch.find);
    const truncatedFind = patch.find.length > 80 ? patch.find.slice(0, 77) + '...' : patch.find;

    if (idx === -1) {
      const result: Record<string, unknown> = { find: truncatedFind, applied: false };

      // Near-miss: try to find where the first line of the find string appears
      const nearMatch = findNearestMatch(html, patch.find);
      if (nearMatch) {
        result.nearestMatch = nearMatch;
      }

      patchResults.push(result);
      continue;
    }

    html = html.slice(0, idx) + patch.replace + html.slice(idx + patch.find.length);
    appliedCount++;
    patchResults.push({ find: truncatedFind, applied: true });
  }

  if (appliedCount === 0) {
    return {
      success: false,
      error: 'No patches matched. Check that your find strings exactly match the current HTML content.',
      patches: patchResults,
    };
  }

  // Re-escape and write back
  const newEscapedHtml = escapeTemplateHtml(html);
  const newScriptJs = scriptJs.slice(0, bounds.start) + newEscapedHtml + scriptJs.slice(bounds.end);
  fs.writeFileSync(scriptPath, newScriptJs, 'utf-8');

  const result: Record<string, unknown> = {
    success: true,
    appliedCount,
    totalPatches: patches.length,
    patches: patchResults,
    htmlLength: html.length,
    hint: 'Call noteplan_get_plugin_log to check for errors.',
    ...(appliedCount < patches.length
      ? { warning: `Only ${appliedCount} of ${patches.length} patches applied. Non-matching patches were skipped.` }
      : {}),
  };

  if (autoLaunch) {
    try {
      reloadPlugins({});
      execFileSync('sleep', ['1'], { timeout: 5000 });

      // Read command name from plugin.json to run the plugin
      const manifestPath = path.join(pluginDir, 'plugin.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const commands = manifest['plugin.commands'];
          if (Array.isArray(commands) && commands.length > 0 && commands[0].name) {
            runPlugin({ pluginId, command: commands[0].name });
          }
        } catch {
          // Non-fatal — plugin files were already updated
        }
      }
      result.launched = true;
    } catch (error: any) {
      result.launched = false;
      result.launchError = error.message;
    }
  }

  return result;
}

export function screenshotPlugin(args: unknown): Record<string, unknown> {
  const { pluginId } = screenshotPluginSchema.parse(args);

  const idError = validatePluginId(pluginId);
  if (idError) {
    return { success: false, error: idError };
  }

  const pluginsPath = getPluginsPath();
  const pluginDir = path.join(pluginsPath, pluginId);

  if (!fs.existsSync(pluginDir)) {
    return { success: false, error: `Plugin "${pluginId}" not found` };
  }

  const screenshotPath = path.join(pluginDir, '_screenshot.png');

  // Clean up any stale screenshot from a previous call
  if (fs.existsSync(screenshotPath)) {
    fs.unlinkSync(screenshotPath);
  }

  // Ask NotePlan to capture the plugin's WebView
  let appleScriptResult = '';
  try {
    const script = `tell application "${APP_NAME}" to screenshotPlugin with id "${escapeAppleScript(pluginId)}"`;
    appleScriptResult = runAppleScript(script, 15_000);
  } catch (e: any) {
    return { success: false, error: `AppleScript error: ${e.message}` };
  }

  // If AppleScript returned true, file should already exist (synchronous RunLoop wait).
  // If false, still check briefly in case of timing edge cases.
  if (!fs.existsSync(screenshotPath)) {
    if (appleScriptResult === 'false') {
      return { success: false, error: 'Failed to capture screenshot. Is the plugin view open and visible?' };
    }
    // Brief poll in case of slight delay
    const maxWait = 3000;
    let waited = 0;
    while (!fs.existsSync(screenshotPath) && waited < maxWait) {
      execFileSync('sleep', ['0.2'], { timeout: 3000 });
      waited += 200;
    }
  }

  if (!fs.existsSync(screenshotPath)) {
    return { success: false, error: 'Screenshot file not created. Is the plugin view visible?' };
  }

  // Read the image and encode as base64
  const imageBuffer = fs.readFileSync(screenshotPath);
  const base64Data = imageBuffer.toString('base64');

  // Clean up
  fs.unlinkSync(screenshotPath);

  return {
    success: true,
    pluginId,
    _imageData: base64Data,
    _imageMimeType: 'image/png',
  };
}
