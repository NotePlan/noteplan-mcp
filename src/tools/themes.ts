// Theme management tools for NotePlan

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getNotePlanPath } from '../noteplan/file-reader.js';
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
  'leadingBorder', 'borderRadius', 'horizontalMargin',
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

function stripInvalidKeys(obj: Record<string, unknown>, validKeys: string[]): { cleaned: Record<string, unknown>; stripped: string[] } {
  const cleaned: Record<string, unknown> = {};
  const stripped: string[] = [];
  for (const key of Object.keys(obj)) {
    if (validKeys.includes(key)) {
      cleaned[key] = obj[key];
    } else {
      stripped.push(key);
    }
  }
  return { cleaned, stripped };
}

// --- Implementations ---

export function listThemes(_args: z.infer<typeof listThemesSchema>): Record<string, unknown> {
  const customThemes: Array<{ name: string; isCustom: boolean; filename: string }> = [];

  const dir = themesPath();
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const filename of entries) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf-8'));
        customThemes.push({
          name: content.name || path.basename(filename, '.json'),
          isCustom: true,
          filename,
        });
      } catch {
        customThemes.push({
          name: path.basename(filename, '.json'),
          isCustom: true,
          filename,
        });
      }
    }
  }

  const systemThemes = SYSTEM_THEMES.map(name => ({
    name,
    isCustom: false,
    filename: name,
  }));

  const currentLight = readDefaults('themeLight');
  const currentDark = readDefaults('themeDark');

  return {
    success: true,
    themes: [...customThemes, ...systemThemes],
    currentLight,
    currentDark,
  };
}

export function getTheme(args: z.infer<typeof getThemeSchema>): Record<string, unknown> {
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
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `Theme file not found: ${filename}` };
  }

  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { success: true, filename, theme: content };
  } catch (err: any) {
    return { success: false, error: `Failed to parse theme JSON: ${err.message}` };
  }
}

export function saveTheme(args: z.infer<typeof saveThemeSchema>): Record<string, unknown> {
  const { filename, theme, setActive, mode: parsedMode } = saveThemeSchema.parse(args);

  // Validate filename
  if (isPathTraversal(filename)) {
    return { success: false, error: 'Invalid filename: path traversal not allowed' };
  }
  if (!FILENAME_REGEX.test(filename)) {
    return { success: false, error: 'Invalid filename: must contain only alphanumeric characters, dashes, underscores, dots, spaces, and end with .json' };
  }

  const allStrippedKeys: string[] = [];

  // Validate and strip editor keys
  const editorResult = stripInvalidKeys(theme.editor as Record<string, unknown>, VALID_EDITOR_KEYS);
  allStrippedKeys.push(...editorResult.stripped.map(k => `editor.${k}`));

  // Validate and strip styles keys, then validate each style's properties
  const stylesInput = theme.styles as Record<string, unknown>;
  const stylesResult = stripInvalidKeys(stylesInput, VALID_STYLE_KEYS);
  allStrippedKeys.push(...stylesResult.stripped.map(k => `styles.${k}`));

  const cleanedStyles: Record<string, unknown> = {};
  for (const [styleKey, styleValue] of Object.entries(stylesResult.cleaned)) {
    if (styleValue && typeof styleValue === 'object' && !Array.isArray(styleValue)) {
      const propResult = stripInvalidKeys(styleValue as Record<string, unknown>, VALID_STYLE_PROPERTIES);
      allStrippedKeys.push(...propResult.stripped.map(p => `styles.${styleKey}.${p}`));
      cleanedStyles[styleKey] = propResult.cleaned;
    } else {
      cleanedStyles[styleKey] = styleValue;
    }
  }

  // Build the final theme object
  const finalTheme: Record<string, unknown> = {
    name: theme.name,
    style: theme.style,
    editor: editorResult.cleaned,
    styles: cleanedStyles,
  };
  if (theme.author) {
    finalTheme.author = theme.author;
  }

  // Ensure Themes folder exists
  const dir = themesPath();
  fs.mkdirSync(dir, { recursive: true });

  // Write the theme file
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(finalTheme, null, 2), 'utf-8');

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
        strippedKeys: allStrippedKeys.length > 0 ? allStrippedKeys : undefined,
        message: `Theme saved to ${filename} but failed to activate: ${err.message}`,
      };
    }

    // Warn if theme was applied to a mode the user isn't currently viewing
    const currentLight = readDefaults('themeLight');
    const currentDark = readDefaults('themeDark');
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
      strippedKeys: allStrippedKeys.length > 0 ? allStrippedKeys : undefined,
      message: `Theme saved and activated: ${filename}`,
      ...(modeHint ? { hint: modeHint } : {}),
    };
  }

  return {
    success: true,
    filename,
    strippedKeys: allStrippedKeys.length > 0 ? allStrippedKeys : undefined,
    message: `Theme saved: ${filename}`,
  };
}

export function setTheme(args: z.infer<typeof setThemeSchema>): Record<string, unknown> {
  const { name, mode } = setThemeSchema.parse(args);

  // Resolve display name → filename for custom themes
  let resolvedName = name;
  const dir = themesPath();
  if (fs.existsSync(dir)) {
    // If the name doesn't match a system theme or a file directly, search by display name
    const nameWithoutExt = name.replace(/\.json$/, '');
    const isSystemTheme = SYSTEM_THEMES.includes(nameWithoutExt) || SYSTEM_THEMES.includes(name);
    if (!isSystemTheme) {
      const isDirectFilename = fs.existsSync(path.join(dir, name)) || fs.existsSync(path.join(dir, name + '.json'));
      if (!isDirectFilename) {
        // Search custom themes by display name
        const entries = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        for (const filename of entries) {
          try {
            const content = JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf-8'));
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
