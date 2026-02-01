// Fuzzy search layer using Fuse.js

import Fuse, { IFuseOptions, FuseResultMatch } from 'fuse.js';
import { Note, SearchResult, SearchMatch } from './types.js';

const fuseOptions: IFuseOptions<Note> = {
  keys: [
    { name: 'title', weight: 2 },
    { name: 'content', weight: 1 },
  ],
  threshold: 0.4, // 0 = exact match only, 1 = match anything
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
  ignoreLocation: true, // Match anywhere in string
};

/**
 * Perform fuzzy search on notes using Fuse.js
 * Handles typos and partial matches
 */
export function fuzzySearch(notes: Note[], query: string, limit: number = 50): SearchResult[] {
  const fuse = new Fuse(notes, fuseOptions);
  const results = fuse.search(query, { limit });

  return results.map((result) => ({
    note: result.item,
    score: Math.round((1 - (result.score || 0)) * 100), // Convert to 0-100 scale
    matches: convertFuseMatches(result.matches || []),
  }));
}

/**
 * Convert Fuse.js match format to our SearchMatch format
 */
function convertFuseMatches(fuseMatches: readonly FuseResultMatch[]): SearchMatch[] {
  const matches: SearchMatch[] = [];

  for (const fm of fuseMatches) {
    if (fm.key === 'content' && fm.value) {
      // Find line number for content matches
      const lines = fm.value.split('\n');
      let charIndex = 0;

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        for (const [start, end] of fm.indices || []) {
          if (start >= charIndex && start < charIndex + line.length + 1) {
            matches.push({
              lineNumber: lineNum + 1,
              lineContent: line,
              matchStart: start - charIndex,
              matchEnd: end - charIndex + 1,
            });
          }
        }
        charIndex += line.length + 1; // +1 for newline
      }
    } else if (fm.key === 'title' && fm.value) {
      // Title match - add as line 0
      for (const [start, end] of fm.indices || []) {
        matches.push({
          lineNumber: 0, // Title is "line 0"
          lineContent: fm.value,
          matchStart: start,
          matchEnd: end + 1,
        });
      }
    }
  }

  return matches;
}
