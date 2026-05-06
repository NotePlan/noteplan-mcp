// Ripgrep wrapper for fast local file search

import { spawn } from 'child_process';
import { getNotesPath, getCalendarPath } from './file-reader.js';
import { getBridgeClient } from '../transport/bridge-availability.js';

export interface RipgrepMatch {
  file: string;
  line: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

export interface RipgrepOptions {
  caseSensitive?: boolean;
  wordBoundary?: boolean;
  contextLines?: number;
  maxResults?: number;
  paths?: string[];
}

export interface RipgrepSearchResponse {
  matches: RipgrepMatch[];
  partialResults: boolean;
  warning?: string;
  backend: 'bridge' | 'ripgrep';
}

/**
 * Search files using the NotePlan bridge (preferred) or ripgrep (fallback).
 *
 * The bridge path runs the regex against NoteCache inside NotePlan, which
 * avoids two problems with calling ripgrep from the MCP process:
 *   1. TCC interrupts ripgrep when the parent (Claude Code's node) lacks
 *      Full Disk Access — manifested as "ripgrep interrupted" warnings.
 *   2. Spawning a subprocess per search is slower on large vaults.
 *
 * Falls back to ripgrep when the bridge is unavailable (NotePlan closed
 * or older build) and finally errors out if ripgrep isn't installed.
 *
 * Note: the bridge path doesn't currently support `paths` (folder-scoped
 * search), `wordBoundary`, or `contextLines`; if any of those is
 * requested we go straight to ripgrep so the caller still gets the
 * exact behaviour they asked for.
 */
export async function searchWithRipgrep(
  pattern: string,
  options: RipgrepOptions = {}
): Promise<RipgrepSearchResponse> {
  const {
    caseSensitive = false,
    wordBoundary = false,
    contextLines = 0,
    maxResults = 100,
    paths = [getNotesPath(), getCalendarPath()],
  } = options;

  // The bridge backs onto SearchHelper, which is always case-insensitive
  // and uses all-words matching (not regex). Fall through to ripgrep when
  // the caller needs anything more specific.
  const canUseBridge =
    !wordBoundary &&
    contextLines === 0 &&
    options.paths === undefined &&
    !caseSensitive;
  if (canUseBridge) {
    const bridge = await getBridgeClient();
    if (bridge) {
      try {
        const matches = await bridge.search(pattern, { limit: maxResults });
        return { matches, partialResults: false, backend: 'bridge' };
      } catch (err) {
        console.error('[bridge.search] failed, falling back to ripgrep:', err instanceof Error ? err.message : err);
      }
    }
  }

  // Build args array (safe - no shell interpretation)
  const args: string[] = [
    '--json', // JSON output for parsing
    '--max-count',
    String(maxResults),
    '-g',
    '*.md',
    '-g',
    '*.txt',
  ];

  if (!caseSensitive) args.push('-i');
  if (wordBoundary) args.push('-w');
  if (contextLines > 0) args.push('-C', String(contextLines));

  // -- ensures pattern isn't treated as flag
  args.push('--', pattern);
  // Add paths (array elements are safe from injection)
  args.push(...paths.filter((p) => p)); // Filter out empty paths

  return new Promise((resolve, reject) => {
    const rg = spawn('rg', args, {
      stdio: ['ignore', 'pipe', 'pipe'], // No stdin, capture stdout/stderr
    });

    let stdout = '';
    let stderr = '';
    rg.stdout.on('data', (data) => {
      stdout += data;
    });
    rg.stderr.on('data', (data) => {
      stderr += data;
    });

    rg.on('close', (code) => {
      // Exit codes: 0 = matches found, 1 = no matches, 2+ = error
      if (code === 0 || code === 1) {
        resolve({
          matches: parseRipgrepJson(stdout),
          partialResults: false,
          backend: 'ripgrep',
        });
      } else {
        const interrupted = /interrupted system call/i.test(stderr);
        const partialMatches = parseRipgrepJson(stdout);
        if (interrupted && partialMatches.length > 0) {
          resolve({
            matches: partialMatches,
            partialResults: true,
            warning: 'ripgrep interrupted; returning partial local matches',
            backend: 'ripgrep',
          });
          return;
        }
        reject(new Error(`ripgrep error: ${stderr || `exit code ${code}`}`));
      }
    });

    rg.on('error', (err) => {
      // ripgrep not installed
      reject(new Error(`Failed to spawn ripgrep: ${err.message}`));
    });
  });
}

/**
 * Parse ripgrep JSON output format
 */
function parseRipgrepJson(output: string): RipgrepMatch[] {
  const matches: RipgrepMatch[] = [];
  if (!output.trim()) return matches;

  // ripgrep --json outputs one JSON object per line
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'match') {
        const data = obj.data;
        matches.push({
          file: data.path.text,
          line: data.line_number,
          content: data.lines.text.trimEnd(),
          matchStart: data.submatches[0]?.start ?? 0,
          matchEnd: data.submatches[0]?.end ?? 0,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }
  return matches;
}

/**
 * Check if ripgrep is available on the system
 */
export async function isRipgrepAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const rg = spawn('rg', ['--version'], { stdio: 'ignore' });
    rg.on('close', (code) => resolve(code === 0));
    rg.on('error', () => resolve(false));
  });
}

/**
 * Run ripgrep with --only-matching against the given paths and pattern.
 * Returns each raw match as a string (no file/line context). Used for
 * cheap aggregation tasks like global tag extraction where reading every
 * note's full content via the bridge would take ~minutes.
 *
 * Returns null when ripgrep isn't available so the caller can fall back.
 */
export async function ripgrepOnlyMatching(
  pattern: string,
  paths: string[]
): Promise<string[] | null> {
  if (paths.length === 0) return [];

  const args: string[] = [
    '--no-filename',
    '--no-line-number',
    '--only-matching',
    '-g', '*.md',
    '-g', '*.txt',
    '--', pattern,
    ...paths,
  ];

  return new Promise((resolve) => {
    const rg = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    rg.stdout.on('data', (d) => { stdout += d; });
    rg.stderr.on('data', (d) => { stderr += d; });
    rg.on('close', (code) => {
      // 0 = matches, 1 = no matches, 2+ = error
      if (code === 0 || code === 1) {
        resolve(stdout.split('\n').map((l) => l.trim()).filter(Boolean));
        return;
      }
      console.error(`[ripgrep] only-matching failed (code ${code}): ${stderr.slice(0, 200)}`);
      resolve(null);
    });
    rg.on('error', () => resolve(null));
  });
}
