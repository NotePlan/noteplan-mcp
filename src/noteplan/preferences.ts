// NotePlan preferences reader
//
// Resolves NotePlan user preferences with a bridge-first, disk-cached strategy
// so we touch NotePlan's sandboxed container as rarely as possible. For a
// sandboxed app the preferences plist lives inside the container, so reading
// it with `defaults` triggers the macOS "access data from other apps" prompt.
//
// Resolution order (memoized per process):
//   1. Bridge snapshot — values the NotePlan bridge reported in /config at
//      startup. No container access. Newer NotePlan builds expose these; older
//      ones don't (fields arrive undefined) and we fall through.
//   2. On-disk cache (~/.noteplan-mcp-prefs.json, 3h TTL) — our OWN file, so
//      reading it never prompts. Survives server re-spawns, so the `defaults`
//      prompt happens at most once per TTL window even if the client restarts
//      the server on every message.
//   3. `defaults read co.noteplan.NotePlan3` — the one container read that can
//      prompt. Done lazily, only when 1 and 2 miss, then persisted to (2).

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Task marker configuration from NotePlan preferences
 */
export interface TaskMarkerConfig {
  isAsteriskTodo: boolean;
  isDashTodo: boolean;
  defaultTodoCharacter: '*' | '-';
  todoCharacter: '*' | '-'; // Computed from preferences, matches Globals.todoChar() in Swift
  useCheckbox: boolean;
  taskPrefix: string; // The complete prefix to use when creating tasks
}

/** Raw NotePlan preference values, from whichever tier resolved them. Fields
 *  use NotePlan's own conventions (e.g. firstDayOfWeek is NSCalendar 1=Sun..7). */
interface RawPrefs {
  firstDayOfWeek?: number;
  isAsteriskTodo?: boolean;
  isDashTodo?: boolean;
  defaultTodoCharacter?: string;
  themeLight?: string;
  themeDark?: string;
}

const PREFS_CACHE_FILE = path.join(os.homedir(), '.noteplan-mcp-prefs.json');
const PREFS_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
// Skip disk persistence under test so unit tests don't read/write the user's
// home dir or leak state between runs (they exercise the `defaults` path).
const DISK_CACHE_DISABLED = !!process.env.VITEST;

// ── Tier 1: bridge snapshot (set once at startup, no container access) ──────

let bridgeSnapshot: RawPrefs | null = null;

/**
 * Capture preference fields from the bridge's /config at startup. Free — no
 * container access. Absent fields (older NotePlan builds that don't report
 * prefs over the bridge) stay undefined and fall through to the disk/`defaults`
 * tiers lazily. Call this whenever the bridge is reachable at startup, even if
 * the config carries none of these fields — it also records that the bridge was
 * available, which lets theme lookups avoid the container.
 */
export function primePreferencesFromBridge(cfg: RawPrefs): void {
  bridgeSnapshot = {
    firstDayOfWeek: cfg.firstDayOfWeek,
    isAsteriskTodo: cfg.isAsteriskTodo,
    isDashTodo: cfg.isDashTodo,
    defaultTodoCharacter: cfg.defaultTodoCharacter,
    themeLight: cfg.themeLight,
    themeDark: cfg.themeDark,
  };
}

/**
 * Current light/dark theme filenames from the bridge snapshot.
 * - Returns null when the bridge was NOT available at startup → caller may
 *   fall back to its own (container-touching) read.
 * - Returns {light:null, dark:null} when the bridge WAS available but didn't
 *   report themes (older build) → "known nothing", so the caller can avoid the
 *   container entirely.
 */
export function getBridgeThemeSnapshot(): { light: string | null; dark: string | null } | null {
  if (!bridgeSnapshot) return null;
  return { light: bridgeSnapshot.themeLight ?? null, dark: bridgeSnapshot.themeDark ?? null };
}

// ── Tier 2: on-disk cache (our own file — reading it never prompts) ─────────

function readDiskCache(): RawPrefs | null {
  if (DISK_CACHE_DISABLED) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(PREFS_CACHE_FILE, 'utf-8'));
    if (typeof parsed?.cachedAt !== 'number') return null;
    if (Date.now() - parsed.cachedAt > PREFS_CACHE_TTL_MS) return null; // stale
    return (parsed.prefs as RawPrefs) ?? null;
  } catch {
    return null;
  }
}

function writeDiskCache(prefs: RawPrefs): void {
  if (DISK_CACHE_DISABLED) return;
  try {
    const tmp = `${PREFS_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ cachedAt: Date.now(), prefs }), 'utf-8');
    fs.renameSync(tmp, PREFS_CACHE_FILE);
  } catch {
    // Best-effort: a write failure just means another lazy `defaults` read later.
  }
}

// ── Tier 3: direct `defaults` read (the one container access that can prompt) ─

function readPref(key: string): string | null {
  try {
    return execFileSync('defaults', ['read', 'co.noteplan.NotePlan3', key], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function readPrefsFromDefaults(): RawPrefs {
  const fdow = readPref('firstDayOfWeek');
  const asterisk = readPref('isAsteriskTodo');
  const dash = readPref('isDashTodo');
  const defaultChar = readPref('defaultTodoCharacter');
  const fdowNum = fdow !== null ? parseInt(fdow, 10) : NaN;
  return {
    firstDayOfWeek: Number.isNaN(fdowNum) ? undefined : fdowNum,
    isAsteriskTodo: asterisk !== null ? asterisk === '1' : undefined,
    isDashTodo: dash !== null ? dash === '1' : undefined,
    defaultTodoCharacter: defaultChar || undefined,
  };
}

// ── Resolver (memoized per process) ─────────────────────────────────────────

let resolved: RawPrefs | null = null;

function resolvePrefs(): RawPrefs {
  if (resolved) return resolved;

  // Tier 1: bridge. Trust it only when it actually carries prefs (newer build).
  if (bridgeSnapshot && typeof bridgeSnapshot.firstDayOfWeek === 'number') {
    resolved = bridgeSnapshot;
    return resolved;
  }

  // Tier 2: our disk cache (no container access; survives re-spawns).
  const disk = readDiskCache();
  if (disk) {
    resolved = disk;
    return resolved;
  }

  // Tier 3: read NotePlan's UserDefaults directly — the one read that can
  // prompt. Persist it so subsequent processes (re-spawns) don't re-prompt
  // within the TTL window.
  const fromDefaults = readPrefsFromDefaults();
  writeDiskCache(fromDefaults);
  resolved = fromDefaults;
  return resolved;
}

/** @internal test seam — clears the memoized snapshot/cache. */
export function __resetPreferencesCache(): void {
  resolved = null;
  bridgeSnapshot = null;
}

// ── Public accessors (synchronous; same signatures as before) ───────────────

function computeTaskMarkerConfig(
  isAsteriskTodo: boolean,
  isDashTodo: boolean,
  defaultChar: '*' | '-',
): TaskMarkerConfig {
  // Logic from NotePlan's TextUtils.adjustTodoMarks():
  // - Both asterisk AND dash enabled → no checkbox, just `* ` or `- ` by default
  // - Neither enabled → with checkbox `* [ ] ` or `- [ ] ` by default
  // - Only one enabled → that one is for tasks (without checkbox)
  const useCheckbox = !isAsteriskTodo && !isDashTodo;

  let taskChar: '*' | '-';
  if (isAsteriskTodo && isDashTodo) {
    taskChar = defaultChar;
  } else if (isAsteriskTodo) {
    taskChar = '*';
  } else if (isDashTodo) {
    taskChar = '-';
  } else {
    taskChar = defaultChar;
  }

  const taskPrefix = useCheckbox ? `${taskChar} [ ] ` : `${taskChar} `;

  return {
    isAsteriskTodo,
    isDashTodo,
    defaultTodoCharacter: defaultChar,
    todoCharacter: taskChar,
    useCheckbox,
    taskPrefix,
  };
}

/**
 * Get task marker configuration from NotePlan preferences (bridge → disk → defaults).
 */
export function getTaskMarkerConfig(): TaskMarkerConfig {
  const p = resolvePrefs();
  return computeTaskMarkerConfig(
    p.isAsteriskTodo ?? true,
    p.isDashTodo ?? false,
    p.defaultTodoCharacter === '-' ? '-' : '*',
  );
}

/**
 * Get cached task marker configuration. Resolution is already memoized per
 * process (and persisted to disk), so this is just an alias kept for callers.
 */
export function getTaskMarkerConfigCached(): TaskMarkerConfig {
  return getTaskMarkerConfig();
}

/**
 * Get the task prefix to use when creating new tasks
 */
export function getTaskPrefix(): string {
  return getTaskMarkerConfig().taskPrefix;
}

/**
 * Check if a character is configured as a task marker
 */
export function isTaskMarker(char: string): boolean {
  const config = getTaskMarkerConfig();
  if (char === '*') return config.isAsteriskTodo || (!config.isAsteriskTodo && !config.isDashTodo);
  if (char === '-') return config.isDashTodo || (!config.isAsteriskTodo && !config.isDashTodo);
  return false;
}

/**
 * Get the first day of week preference from NotePlan.
 * Returns 0-6 where 0 = Sunday (JavaScript getDay() convention).
 *
 * NotePlan stores this using NSCalendar convention: 1 = Sunday, ..., 7 = Saturday.
 * We convert to JavaScript's convention regardless of which tier supplied it,
 * so the bridge must report the same raw NSCalendar value `defaults` returns.
 */
export function getFirstDayOfWeek(): number {
  const raw = resolvePrefs().firstDayOfWeek ?? 2; // default Monday (NSCalendar 2)
  return (raw - 1) % 7;
}

/**
 * Get cached first day of week (resolution is memoized; alias kept for callers).
 */
export function getFirstDayOfWeekCached(): number {
  return getFirstDayOfWeek();
}
