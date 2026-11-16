// Folder-level access control for the MCP server.
//
// Two env vars, each comma-separated, configured by the user in their MCP
// client's JSON config. Both default to empty → no filtering, fully
// backwards-compatible.
//
//   NOTEPLAN_ALLOWED_FOLDERS  Allowlist. When set, a path must sit
//                             inside one of the listed prefixes to be
//                             accessible.
//   NOTEPLAN_DENIED_FOLDERS   Denylist. Any path inside one of the
//                             listed prefixes is blocked outright,
//                             even if it also matches the allowlist.
//
// Matching is by path-prefix on the relative path inside the NotePlan
// storage root (e.g. `Notes/Personal/Finance` matches the file
// `Notes/Personal/Finance/2026.txt` and the folder itself, but NOT
// `Notes/PersonalRecords.txt`). The denylist always wins.
//
// Read operations (list, get, search) filter denied paths out of the
// response. Write operations (create, update, delete, move, rename,
// restore) reject with a clear error so the agent knows it hit a
// configured boundary instead of silently misbehaving.
//
// Symlinks: the file readers/writers follow symlinks, so a purely textual
// prefix check can be bypassed by a link inside an allowed folder that
// points into a denied one (`Notes/Public/link -> ../Personal`). When rules
// are configured, the path is therefore also resolved on disk (realpath of
// the nearest existing ancestor) and the rules must pass for BOTH the
// written path and the real path. A real path outside the storage root is
// rejected. If the root itself can't be resolved locally (no container
// access, files read through the app bridge), only the textual check runs.

import * as fs from 'fs';
import * as path from 'path';

const ALLOWED_ENV_KEY = 'NOTEPLAN_ALLOWED_FOLDERS';
const DENIED_ENV_KEY = 'NOTEPLAN_DENIED_FOLDERS';

/** Returns the NotePlan storage root. Set once at server start (and by tests). */
let storageRootProvider: (() => string) | null = null;

export function setFolderAccessStorageRoot(provider: (() => string) | null): void {
  storageRootProvider = provider;
}

interface FolderAccessConfig {
  allowed: string[];
  denied: string[];
}

let cached: FolderAccessConfig | null = null;

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => applyTopLevelSugar(normalizePathInput(entry)))
    .filter((entry) => entry.length > 0);
}

function normalizePathInput(input: string): string {
  // Strip surrounding whitespace, collapse backslashes to slashes, and
  // trim leading / trailing slashes so users can be sloppy with how
  // they write the prefixes (`Notes/Foo`, `/Notes/Foo/`, `Notes\Foo`).
  return input.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Treat a bare entry like `Personal` as sugar for `Notes/Personal` — the
 * filesystem layout puts every project note under `Notes/`, and most
 * users won't think to type that prefix. `Notes/...` and the reserved
 * top-level `Calendar` are passed through unchanged. Applied at config
 * parse time so the rest of the matcher stays oblivious.
 */
function applyTopLevelSugar(entry: string): string {
  if (!entry) return entry;
  if (entry === 'Notes' || entry.startsWith('Notes/')) return entry;
  if (entry === 'Calendar' || entry.startsWith('Calendar/')) return entry;
  return `Notes/${entry}`;
}

function loadConfig(): FolderAccessConfig {
  if (cached) return cached;
  cached = {
    allowed: parseList(process.env[ALLOWED_ENV_KEY]),
    denied: parseList(process.env[DENIED_ENV_KEY]),
  };
  return cached;
}

/** Test-only: drop the cache so a subsequent call re-reads `process.env`. */
export function __resetFolderAccessConfigForTests(): void {
  cached = null;
}

/**
 * True when `prefix` and `candidate` denote the same path or `candidate`
 * sits strictly inside `prefix`. Boundary-aware so `Notes/Foo` does NOT
 * match `Notes/FooBar`.
 */
function pathStartsWithPrefix(prefix: string, candidate: string): boolean {
  if (candidate === prefix) return true;
  return candidate.startsWith(`${prefix}/`);
}

type FolderAccessVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'denied' | 'not-allowed' | 'outside-root' };

function evaluateRules(normalized: string, allowed: string[], denied: string[]): FolderAccessVerdict {
  if (denied.some((prefix) => pathStartsWithPrefix(prefix, normalized))) {
    return { allowed: false, reason: 'denied' };
  }
  if (allowed.length > 0 && !allowed.some((prefix) => pathStartsWithPrefix(prefix, normalized))) {
    return { allowed: false, reason: 'not-allowed' };
  }
  return { allowed: true };
}

/**
 * The symlink-resolved path of `normalized` relative to the real storage
 * root: realpath of the nearest existing ancestor plus the not-yet-existing
 * rest (so new files are checked too). Returns 'outside' when it leaves the
 * root, and null when it can't be resolved locally.
 */
function resolveRealRelativePath(normalized: string): string | 'outside' | null {
  if (!storageRootProvider) return null;
  let rawRoot: string;
  let realRoot: string;
  try {
    rawRoot = storageRootProvider();
    realRoot = fs.realpathSync.native(rawRoot);
  } catch {
    return null;
  }

  let existing = path.resolve(rawRoot, normalized);
  const missing: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(existing);
      const realFull = missing.length > 0 ? path.join(real, ...missing.reverse()) : real;
      const relative = path.relative(realRoot, realFull);
      if (relative === '') return '';
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return 'outside';
      return relative.split(path.sep).join('/');
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return null;
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * Single evaluation pass that powers both `isFolderAllowed` (boolean) and
 * `assertFolderAllowed` (throws with a categorized reason). Short-circuits
 * before normalization when no rules are configured, so the no-rules case
 * pays nothing and callers don't need a separate "rules enabled?" guard.
 */
function evaluateFolderAccess(relativePath: string): FolderAccessVerdict {
  const { allowed, denied } = loadConfig();
  if (allowed.length === 0 && denied.length === 0) return { allowed: true };

  const normalized = normalizePathInput(relativePath);
  const lexical = evaluateRules(normalized, allowed, denied);
  if (!lexical.allowed) return lexical;

  // Follow symlinks the same way the file operations do.
  const real = resolveRealRelativePath(normalized);
  if (real === 'outside') return { allowed: false, reason: 'outside-root' };
  if (real === null || real === normalized) return lexical;
  return evaluateRules(real, allowed, denied);
}

/**
 * True when configured allow/deny rules permit access to `relativePath`.
 * Folder or file path; same prefix logic. With no rules configured this
 * always returns true so callers can use it unconditionally.
 */
export function isFolderAllowed(relativePath: string): boolean {
  return evaluateFolderAccess(relativePath).allowed;
}

/**
 * True when ANY allow/deny rule is configured. Lets aggregating callers
 * (e.g. `listTags`, which has no per-file path to filter on) pick a fast
 * unfiltered path when no rules are set and a slower per-note walk when
 * they are.
 */
export function hasFolderAccessRules(): boolean {
  const { allowed, denied } = loadConfig();
  return allowed.length > 0 || denied.length > 0;
}

/**
 * Throw a clear error when a write operation targets a blocked folder.
 * Use at the top of mutating store / file-writer entry points so agents
 * see a diagnostic instead of an opaque permission error or, worse, a
 * silent half-completed write.
 */
export function assertFolderAllowed(relativePath: string, action: string): void {
  const verdict = evaluateFolderAccess(relativePath);
  if (verdict.allowed) return;
  const reason = verdict.reason === 'denied'
    ? `it is inside a folder listed in ${DENIED_ENV_KEY}`
    : verdict.reason === 'outside-root'
      ? 'it points outside the NotePlan folder (through a symlink)'
      : `it is not inside any folder listed in ${ALLOWED_ENV_KEY}`;
  throw new Error(`Cannot ${action} "${relativePath}": ${reason}.`);
}
