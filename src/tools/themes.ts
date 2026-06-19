// Theme management tools for NotePlan

import { z } from 'zod';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getNotePlanPath } from '../noteplan/file-reader.js';
import { readDir, readFileUtf8, writeFileUtf8, makeDirectory, pathExists } from '../transport/bridge-fs.js';
import { getBridgeClient } from '../transport/bridge-availability.js';
import { getBridgeThemeSnapshot } from '../noteplan/preferences.js';
import { escapeAppleScript, runAppleScript, getAppName } from '../utils/applescript.js';

function themesPath(): string {
  return path.join(getNotePlanPath(), 'Themes');
}

// --- Validation constants ---

const SYSTEM_THEMES = [
  'default', 'toothbleach', 'toothbleach-condensed', 'solarized-light',
  'breakers', 'contrast', 'green', 'Monospace-Light',
  'dracula', 'dracula-pro', 'ayumirage', 'apple-dark', 'black-night',
  'black-morning', 'solarized-dark', 'spacegray', 'monokai', 'charcoal',
  'toothpaste', 'toothpaste-condensed', 'materialdark',
];

const VALID_EDITOR_KEYS = [
  'backgroundColor', 'altBackgroundColor', 'tintColor', 'tintColor2',
  'textColor', 'toolbarBackgroundColor', 'toolbarIconColor', 'menuItemColor',
  'timeBlockColor', 'shouldOverwriteFont',
  'sidebarStyleOverride', 'sidebarIconColorOverride', 'sidebarFolderColorOverride',
];

const VALID_STYLE_KEYS = [
  'body', 'title1', 'title2', 'title3', 'title4',
  'title-mark1', 'title-mark2', 'title-mark3', 'title-mark4',
  'bold', 'bold-left-mark', 'bold-right-mark',
  'italic', 'italic-left-mark', 'italic-right-mark',
  'boldItalic', 'boldItalic-left-mark', 'boldItalic-right-mark',
  'code', 'code-left-backtick', 'code-right-backtick', 'code-fence',
  'checked', 'checked-canceled', 'checked-scheduled',
  'todo', 'checked-todo-characters', 'tabbed',
  'quote-mark', 'quote-content',
  'link', 'schedule-to-date-link', 'done-date', 'schedule-from-date-link',
  'note-title-link', 'hashtag', 'attag', 'phonenumber',
  'highlighted', 'highlighted-left-marker', 'highlighted-right-marker',
  'strikethrough', 'strikethrough-left-tilde', 'strikethrough-right-tilde',
  'underline', 'underline-left-tilde', 'underline-right-tilde',
  'working-on', 'flagged-1', 'flagged-2', 'flagged-3',
  'file-attachment',
];

const VALID_STYLE_PROPERTIES = [
  'font', 'size', 'color', 'foregroundColor', 'backgroundColor',
  'type', 'kern', 'headIndent', 'firstLineHeadIndent',
  'lineSpacing', 'paragraphSpacing', 'paragraphSpacingBefore',
  'underlineStyle', 'underlineColor', 'strikethroughStyle', 'strikethroughColor',
  'leadingBorder', 'leadingBorderColor', 'borderRadius', 'horizontalMargin',
  'leftBorderPadding', 'rightBorderPadding', 'isFullWidthBorder', 'inlineBorder',
  'regex', 'matchPosition',
];

const FILENAME_REGEX = /^[a-zA-Z0-9_\-. ]+\.json$/;

// --- Schemas ---

export const listThemesSchema = z.object({});

export const getThemeSchema = z.object({
  filename: z.string().describe('Theme filename (e.g., "my-blue-theme.json")'),
});

export const saveThemeSchema = z.object({
  filename: z.string().describe('Theme filename, must end in .json (e.g., "mcp-blue-light.json")'),
  theme: z.object({
    name: z.string().describe('Display name of the theme'),
    style: z.enum(['Light', 'Dark']).describe('Theme style: "Light" or "Dark"'),
    author: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
    }).optional().describe('Optional author info'),
    editor: z.record(z.unknown()).describe('Editor color settings'),
    styles: z.record(z.unknown()).describe('Text formatting styles'),
  }).describe('The theme JSON object'),
  setActive: z.boolean().optional().default(true).describe('Immediately apply the theme (default: true)'),
  mode: z.enum(['light', 'dark', 'auto']).optional().describe('Mode to apply for: light, dark, or auto (default: based on theme style)'),
});

export const setThemeSchema = z.object({
  name: z.string().describe('Theme filename or system theme name'),
  mode: z.enum(['light', 'dark', 'auto']).optional().default('auto').describe('Mode to set: light, dark, or auto (default: auto)'),
});

// --- Helpers ---

function readDefaults(key: string): string | null {
  try {
    return execFileSync('defaults', ['read', 'co.noteplan.NotePlan3', key], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function isPathTraversal(filename: string): boolean {
  return filename.includes('..') || filename.includes('/') || filename.includes('\\');
}

/**
 * Resolve the active light/dark theme without touching NotePlan's container
 * when the bridge is reachable. Prefers the bridge's /config snapshot (newer
 * builds report the current themes directly); when the bridge was available
 * but didn't report them, returns nulls rather than reading the container;
 * only falls back to the container-touching `defaults` read when the bridge is
 * genuinely unavailable.
 */
async function resolveCurrentThemes(): Promise<{ light: string | null; dark: string | null }> {
  const snapshot = getBridgeThemeSnapshot();
  if (snapshot) return snapshot;
  if (await getBridgeClient()) return { light: null, dark: null };
  return { light: readDefaults('themeLight'), dark: readDefaults('themeDark') };
}

/** List keys not present in the whitelist. Informational only — we no longer
 *  strip unknown keys: NotePlan owns the theme schema (which evolves), and
 *  user themes legitimately add custom regex highlighters with arbitrary
 *  names and properties (isRevealOnCursorRange, isMarkdownCharacter, etc.).
 *  Stripping silently destroyed user customizations on every save/edit. */
function findUnknownKeys(obj: Record<string, unknown>, validKeys: string[]): string[] {
  return Object.keys(obj).filter((k) => !validKeys.includes(k));
}

// --- Implementations ---

export async function listThemes(_args: z.infer<typeof listThemesSchema>): Promise<Record<string, unknown>> {
  const customThemes: Array<{ name: string; isCustom: boolean; filename: string }> = [];

  const dir = themesPath();
  // readDir routes through the bridge when available (returns [] if missing),
  // so we never read the Themes folder off the container directly.
  const entries = (await readDir(dir)).filter(e => !e.isDir && e.name.endsWith('.json'));
  for (const { name: filename } of entries) {
    let name = path.basename(filename, '.json');
    const raw = await readFileUtf8(path.join(dir, filename));
    if (raw) {
      try {
        const content = JSON.parse(raw);
        if (content.name) name = content.name;
      } catch {
        // Unparseable theme file — fall back to the filename-derived name.
      }
    }
    customThemes.push({ name, isCustom: true, filename });
  }

  const systemThemes = SYSTEM_THEMES.map(name => ({
    name,
    isCustom: false,
    filename: name,
  }));

  // Active theme comes from the bridge when reachable; only the bridge-down
  // fallback touches the container (see resolveCurrentThemes).
  const { light: currentLight, dark: currentDark } = await resolveCurrentThemes();

  return {
    success: true,
    themes: [...customThemes, ...systemThemes],
    currentLight,
    currentDark,
  };
}

export async function getTheme(args: z.infer<typeof getThemeSchema>): Promise<Record<string, unknown>> {
  const { filename } = getThemeSchema.parse(args);

  if (isPathTraversal(filename)) {
    return { success: false, error: 'Invalid filename: path traversal not allowed' };
  }

  // Check if it's a system theme
  const nameWithoutExt = filename.replace(/\.json$/, '');
  if (SYSTEM_THEMES.includes(nameWithoutExt) || SYSTEM_THEMES.includes(filename)) {
    return {
      success: false,
      error: `"${filename}" is a system theme and cannot be read directly. You can use it as a base by referencing its name when creating a new theme.`,
    };
  }

  const filePath = path.join(themesPath(), filename);
  const raw = await readFileUtf8(filePath);
  if (raw === null) {
    return { success: false, error: `Theme file not found: ${filename}` };
  }

  try {
    const content = JSON.parse(raw);
    return { success: true, filename, theme: content };
  } catch (err: any) {
    return { success: false, error: `Failed to parse theme JSON: ${err.message}` };
  }
}

export async function saveTheme(args: z.infer<typeof saveThemeSchema>): Promise<Record<string, unknown>> {
  const { filename, theme, setActive, mode: parsedMode } = saveThemeSchema.parse(args);

  // Validate filename
  if (isPathTraversal(filename)) {
    return { success: false, error: 'Invalid filename: path traversal not allowed' };
  }
  if (!FILENAME_REGEX.test(filename)) {
    return { success: false, error: 'Invalid filename: must contain only alphanumeric characters, dashes, underscores, dots, spaces, and end with .json' };
  }

  // Survey unknown keys for caller awareness (typo catcher) but keep them in
  // the written file. The VALID_* lists below are an out-of-date subset of
  // what NotePlan actually accepts, and user themes routinely use custom
  // regex highlighters with arbitrary keys — stripping them silently
  // destroyed user customizations on every save.
  const editorInput = (theme.editor ?? {}) as Record<string, unknown>;
  const stylesInput = (theme.styles ?? {}) as Record<string, unknown>;

  const unknownKeys: string[] = [];
  unknownKeys.push(...findUnknownKeys(editorInput, VALID_EDITOR_KEYS).map((k) => `editor.${k}`));
  unknownKeys.push(...findUnknownKeys(stylesInput, VALID_STYLE_KEYS).map((k) => `styles.${k}`));
  for (const [styleKey, styleValue] of Object.entries(stylesInput)) {
    if (styleValue && typeof styleValue === 'object' && !Array.isArray(styleValue)) {
      unknownKeys.push(
        ...findUnknownKeys(styleValue as Record<string, unknown>, VALID_STYLE_PROPERTIES).map(
          (p) => `styles.${styleKey}.${p}`,
        ),
      );
    }
  }

  // Build the final theme object — pass editor and styles through verbatim.
  const finalTheme: Record<string, unknown> = {
    name: theme.name,
    style: theme.style,
    editor: editorInput,
    styles: stylesInput,
  };
  if (theme.author) {
    finalTheme.author = theme.author;
  }

  // Ensure Themes folder exists
  const dir = themesPath();
  await makeDirectory(dir);

  // Write the theme file
  const filePath = path.join(dir, filename);
  await writeFileUtf8(filePath, JSON.stringify(finalTheme, null, 2));

  // Activate the theme if requested
  if (setActive) {
    const mode = parsedMode || (theme.style === 'Light' ? 'light' : 'dark');
    const script = `tell application "${getAppName()}" to setTheme to "${escapeAppleScript(filename)}" for mode "${escapeAppleScript(mode)}"`;
    try {
      runAppleScript(script);
    } catch (err: any) {
      return {
        success: true,
        filename,
        unknownKeys: unknownKeys.length > 0 ? unknownKeys : undefined,
        message: `Theme saved to ${filename} but failed to activate: ${err.message}`,
      };
    }

    // Warn if theme was applied to a mode the user isn't currently viewing.
    // Resolution prefers the bridge; the hint is simply omitted when current
    // themes are unknown (bridge up but not reported) rather than reading the
    // container.
    const { light: currentLight, dark: currentDark } = await resolveCurrentThemes();
    const nameWithoutExt = filename.replace(/\.json$/, '');
    const modeHint =
      mode === 'dark' && currentLight && currentLight !== nameWithoutExt && currentLight !== filename
        ? 'Note: This dark theme was activated for dark mode. Switch to dark mode to see it.'
        : mode === 'light' && currentDark && currentDark !== nameWithoutExt && currentDark !== filename
          ? 'Note: This light theme was activated for light mode. Switch to light mode to see it.'
          : undefined;

    return {
      success: true,
      filename,
      activatedForMode: mode,
      unknownKeys: unknownKeys.length > 0 ? unknownKeys : undefined,
      message: `Theme saved and activated: ${filename}`,
      ...(modeHint ? { hint: modeHint } : {}),
    };
  }

  return {
    success: true,
    filename,
    unknownKeys: unknownKeys.length > 0 ? unknownKeys : undefined,
    message: `Theme saved: ${filename}`,
  };
}

export async function setTheme(args: z.infer<typeof setThemeSchema>): Promise<Record<string, unknown>> {
  const { name, mode } = setThemeSchema.parse(args);

  // Resolve display name → filename for custom themes. All folder access goes
  // through the bridge when available; readDir/pathExists degrade to empty/false
  // if the Themes folder isn't there, so no explicit existence guard is needed.
  let resolvedName = name;
  const dir = themesPath();
  const nameWithoutExt = name.replace(/\.json$/, '');
  const isSystemTheme = SYSTEM_THEMES.includes(nameWithoutExt) || SYSTEM_THEMES.includes(name);
  if (!isSystemTheme) {
    const isDirectFilename =
      (await pathExists(path.join(dir, name))) || (await pathExists(path.join(dir, name + '.json')));
    if (!isDirectFilename) {
      // Search custom themes by display name
      const entries = (await readDir(dir)).filter(e => !e.isDir && e.name.endsWith('.json'));
      for (const { name: filename } of entries) {
        const raw = await readFileUtf8(path.join(dir, filename));
        if (!raw) continue;
        try {
          const content = JSON.parse(raw);
          if (content.name === name) {
            resolvedName = filename;
            break;
          }
        } catch {
          // skip
        }
      }
    }
  }

  const resolvedMode = mode ?? 'auto';
  const script = `tell application "${getAppName()}" to setTheme to "${escapeAppleScript(resolvedName)}" for mode "${escapeAppleScript(resolvedMode)}"`;
  runAppleScript(script);

  const result: Record<string, unknown> = {
    success: true,
    message: `Theme set to "${name}" for mode "${resolvedMode}"`,
  };

  if (resolvedName !== name) {
    result.resolvedFilename = resolvedName;
  }

  return result;
}
