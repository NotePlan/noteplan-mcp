// NotePlan preferences reader
// Reads user preferences from UserDefaults to match NotePlan's behavior

import { execFileSync } from 'child_process';

/**
 * Task marker configuration from NotePlan preferences
 */
export interface TaskMarkerConfig {
  isAsteriskTodo: boolean;
  isDashTodo: boolean;
  defaultTodoCharacter: '*' | '-';
  useCheckbox: boolean;
  taskPrefix: string; // The complete prefix to use when creating tasks
}

/**
 * Read a boolean preference from NotePlan's UserDefaults
 * Uses execFileSync (not execSync) to avoid shell injection
 */
function readBoolPref(key: string, defaultValue: boolean): boolean {
  try {
    const result = execFileSync('defaults', ['read', 'co.noteplan.NotePlan3', key], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result === '1';
  } catch {
    return defaultValue;
  }
}

/**
 * Read a string preference from NotePlan's UserDefaults
 * Uses execFileSync (not execSync) to avoid shell injection
 */
function readStringPref(key: string, defaultValue: string): string {
  try {
    const result = execFileSync('defaults', ['read', 'co.noteplan.NotePlan3', key], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Get task marker configuration from NotePlan preferences
 *
 * Logic from NotePlan's TextUtils.adjustTodoMarks():
 * - Both asterisk AND dash enabled → No checkbox, just `* ` or `- ` based on default
 * - Neither enabled → With checkbox `* [ ] ` or `- [ ] ` based on default
 * - Only one enabled → That one is for tasks (without checkbox)
 */
export function getTaskMarkerConfig(): TaskMarkerConfig {
  const isAsteriskTodo = readBoolPref('isAsteriskTodo', true);
  const isDashTodo = readBoolPref('isDashTodo', false);
  const defaultChar = readStringPref('defaultTodoCharacter', '*') as '*' | '-';

  // Determine if checkboxes should be used
  // Checkboxes are used when NEITHER asterisk nor dash is enabled as a todo marker
  const useCheckbox = !isAsteriskTodo && !isDashTodo;

  // Determine which character to use
  let taskChar: '*' | '-';
  if (isAsteriskTodo && isDashTodo) {
    // Both enabled: use the default character
    taskChar = defaultChar;
  } else if (isAsteriskTodo) {
    // Only asterisk enabled
    taskChar = '*';
  } else if (isDashTodo) {
    // Only dash enabled
    taskChar = '-';
  } else {
    // Neither enabled: use the default character (with checkbox)
    taskChar = defaultChar;
  }

  // Build the task prefix
  const taskPrefix = useCheckbox ? `${taskChar} [ ] ` : `${taskChar} `;

  return {
    isAsteriskTodo,
    isDashTodo,
    defaultTodoCharacter: defaultChar,
    useCheckbox,
    taskPrefix,
  };
}

// Cache the config to avoid repeated shell calls
let cachedConfig: TaskMarkerConfig | null = null;
let cacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Get cached task marker configuration
 */
export function getTaskMarkerConfigCached(): TaskMarkerConfig {
  const now = Date.now();
  if (!cachedConfig || now - cacheTime > CACHE_TTL) {
    cachedConfig = getTaskMarkerConfig();
    cacheTime = now;
  }
  return cachedConfig;
}

/**
 * Get the task prefix to use when creating new tasks
 */
export function getTaskPrefix(): string {
  return getTaskMarkerConfigCached().taskPrefix;
}

/**
 * Check if a character is configured as a task marker
 */
export function isTaskMarker(char: string): boolean {
  const config = getTaskMarkerConfigCached();

  if (char === '*') return config.isAsteriskTodo || (!config.isAsteriskTodo && !config.isDashTodo);
  if (char === '-') return config.isDashTodo || (!config.isAsteriskTodo && !config.isDashTodo);

  return false;
}

/**
 * Read an integer preference from NotePlan's UserDefaults
 */
function readIntPref(key: string, defaultValue: number): number {
  try {
    const result = execFileSync('defaults', ['read', 'co.noteplan.NotePlan3', key], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const parsed = parseInt(result, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  } catch {
    return defaultValue;
  }
}

/**
 * Get the first day of week preference from NotePlan
 * Returns 0-6 where 0 = Sunday, 1 = Monday, etc. (JavaScript convention)
 *
 * NotePlan stores this using NSCalendar convention: 1 = Sunday, 2 = Monday, ..., 7 = Saturday
 * We convert to JavaScript's getDay() convention: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
 */
export function getFirstDayOfWeek(): number {
  // NotePlan uses NSCalendar weekday: 1 = Sunday, 2 = Monday, ..., 7 = Saturday
  // Default to 2 (Monday) if not set
  const notePlanValue = readIntPref('firstDayOfWeek', 2);

  // Convert to JavaScript convention: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  // NSCalendar 1 → JS 0, NSCalendar 2 → JS 1, etc.
  return (notePlanValue - 1) % 7;
}

// Cache for first day of week
let cachedFirstDayOfWeek: number | null = null;
let firstDayOfWeekCacheTime = 0;

/**
 * Get cached first day of week
 */
export function getFirstDayOfWeekCached(): number {
  const now = Date.now();
  if (cachedFirstDayOfWeek === null || now - firstDayOfWeekCacheTime > CACHE_TTL) {
    cachedFirstDayOfWeek = getFirstDayOfWeek();
    firstDayOfWeekCacheTime = now;
  }
  return cachedFirstDayOfWeek;
}
