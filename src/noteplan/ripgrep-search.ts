// Ripgrep wrapper for fast local file search

import { spawn } from 'child_process';
import { getNotesPath, getCalendarPath } from './file-reader.js';

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

/**
 * Search files using ripgrep for fast regex-enabled search
 * Uses spawn() with array arguments to avoid shell injection
 */
export async function searchWithRipgrep(
  pattern: string,
  options: RipgrepOptions = {}
): Promise<RipgrepMatch[]> {
  const {
    caseSensitive = false,
    wordBoundary = false,
    contextLines = 0,
    maxResults = 100,
    paths = [getNotesPath(), getCalendarPath()],
  } = options;

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
        resolve(parseRipgrepJson(stdout));
      } else {
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
