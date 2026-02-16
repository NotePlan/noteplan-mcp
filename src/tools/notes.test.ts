import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Copies of private helper functions from notes.ts
// These are verbatim copies so we can unit-test them without exporting.
// ---------------------------------------------------------------------------

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function isDebugTimingsEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

type IndentationStyle = 'tabs' | 'preserve';
function normalizeIndentationStyle(value: unknown): IndentationStyle {
  if (value === 'preserve') return 'preserve';
  return 'tabs';
}

function retabListIndentation(content: string): { content: string; linesRetabbed: number } {
  const lines = content.split('\n');
  let linesRetabbed = 0;

  const normalized = lines.map((line) => {
    const match = line.match(/^( +)(?=(?:[*+-]|\d+[.)])(?:\s|\t|\[))/);
    if (!match) return line;
    const spaceCount = match[1].length;
    if (spaceCount < 2) return line;
    const tabs = '\t'.repeat(Math.floor(spaceCount / 2));
    linesRetabbed += 1;
    return `${tabs}${line.slice(spaceCount)}`;
  });

  return {
    content: normalized.join('\n'),
    linesRetabbed,
  };
}

function extractAttachmentReferences(text: string): string[] {
  const matches = text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g);
  const refs = new Set<string>();
  for (const match of matches) {
    const ref = (match[1] || '').trim();
    if (!ref) continue;
    refs.add(ref);
  }
  return Array.from(refs);
}

function getRemovedAttachmentReferences(beforeText: string, afterText: string): string[] {
  const before = new Set(extractAttachmentReferences(beforeText));
  const after = new Set(extractAttachmentReferences(afterText));
  return Array.from(before).filter((ref) => !after.has(ref));
}

type LineWindowOptions = {
  startLine?: unknown;
  endLine?: unknown;
  limit?: unknown;
  offset?: unknown;
  cursor?: unknown;
  defaultLimit: number;
  maxLimit: number;
};

type LineWindow = {
  lineCount: number;
  rangeStartLine: number;
  rangeEndLine: number;
  rangeLineCount: number;
  returnedLineCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  content: string;
  lines: Array<{
    line: number;
    lineIndex: number;
    content: string;
  }>;
};

function buildLineWindow(allLines: string[], options: LineWindowOptions): LineWindow {
  const totalLineCount = allLines.length;
  const requestedStartLine = toBoundedInt(
    options.startLine,
    1,
    1,
    Math.max(1, totalLineCount)
  );
  const requestedEndLine = toBoundedInt(
    options.endLine,
    totalLineCount,
    requestedStartLine,
    Math.max(requestedStartLine, totalLineCount)
  );
  const rangeStartIndex = requestedStartLine - 1;
  const rangeEndIndexExclusive = requestedEndLine;
  const rangeLines = allLines.slice(rangeStartIndex, rangeEndIndexExclusive);
  const offset = toBoundedInt(options.cursor ?? options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(options.limit, options.defaultLimit, 1, options.maxLimit);
  const page = rangeLines.slice(offset, offset + limit);
  const hasMore = offset + page.length < rangeLines.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  return {
    lineCount: totalLineCount,
    rangeStartLine: requestedStartLine,
    rangeEndLine: requestedEndLine,
    rangeLineCount: rangeLines.length,
    returnedLineCount: page.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    content: page.join('\n'),
    lines: page.map((content, index) => ({
      line: requestedStartLine + offset + index,
      lineIndex: rangeStartIndex + offset + index,
      content,
    })),
  };
}

function normalizeDateToken(value?: string): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}

function noteMatchScore(
  note: { id?: string; title?: string; filename?: string; date?: string },
  query: string,
  queryDateToken: string | null
): number {
  const queryLower = query.toLowerCase();
  const idLower = (note.id || '').toLowerCase();
  const titleLower = (note.title || '').toLowerCase();
  const filenameLower = (note.filename || '').toLowerCase();
  const path_basename = filenameLower.split('/').pop() || '';
  const path_extname_idx = path_basename.lastIndexOf('.');
  const basenameLower =
    path_extname_idx > 0 ? path_basename.slice(0, path_extname_idx) : path_basename;
  const noteDateToken = normalizeDateToken(note.date);

  if (idLower && idLower === queryLower) return 1.0;
  if (filenameLower === queryLower) return 0.99;
  if (basenameLower === queryLower) return 0.97;
  if (titleLower === queryLower) return 0.96;
  if (queryDateToken && noteDateToken && queryDateToken === noteDateToken) return 0.95;
  if (titleLower.startsWith(queryLower)) return 0.9;
  if (basenameLower.startsWith(queryLower)) return 0.88;
  if (filenameLower.includes(`/${queryLower}`) || filenameLower.includes(queryLower)) return 0.83;
  if (`${titleLower} ${filenameLower}`.includes(queryLower)) return 0.76;
  return 0;
}

function findParagraphBounds(
  lines: string[],
  lineIndex: number
): { startIndex: number; endIndex: number } {
  let startIndex = lineIndex;
  while (startIndex > 0 && lines[startIndex - 1].trim() !== '') {
    startIndex -= 1;
  }

  let endIndex = lineIndex;
  while (endIndex < lines.length - 1 && lines[endIndex + 1].trim() !== '') {
    endIndex += 1;
  }

  return { startIndex, endIndex };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toBoundedInt', () => {
  it('returns default for NaN', () => {
    expect(toBoundedInt(NaN, 10, 0, 100)).toBe(10);
  });

  it('returns default for undefined', () => {
    expect(toBoundedInt(undefined, 10, 0, 100)).toBe(10);
  });

  it('returns clamped value for null (Number(null) === 0)', () => {
    // Number(null) === 0 which is finite, so it gets clamped to [min, max]
    expect(toBoundedInt(null, 10, 0, 100)).toBe(0);
    expect(toBoundedInt(null, 10, 5, 100)).toBe(5);
  });

  it('returns default for Infinity', () => {
    expect(toBoundedInt(Infinity, 10, 0, 100)).toBe(10);
  });

  it('returns default for -Infinity', () => {
    expect(toBoundedInt(-Infinity, 10, 0, 100)).toBe(10);
  });

  it('returns default for non-numeric strings', () => {
    expect(toBoundedInt('hello', 10, 0, 100)).toBe(10);
  });

  it('returns clamped value for empty string (Number("") === 0)', () => {
    // Number('') === 0 which is finite, so it gets clamped to [min, max]
    expect(toBoundedInt('', 10, 0, 100)).toBe(0);
    expect(toBoundedInt('', 10, 5, 100)).toBe(5);
  });

  it('floors decimal numbers', () => {
    expect(toBoundedInt(3.7, 10, 0, 100)).toBe(3);
    expect(toBoundedInt(3.2, 10, 0, 100)).toBe(3);
    expect(toBoundedInt(9.999, 10, 0, 100)).toBe(9);
  });

  it('clamps below min', () => {
    expect(toBoundedInt(-5, 10, 0, 100)).toBe(0);
    expect(toBoundedInt(3, 10, 5, 100)).toBe(5);
  });

  it('clamps above max', () => {
    expect(toBoundedInt(200, 10, 0, 100)).toBe(100);
    expect(toBoundedInt(50, 10, 0, 20)).toBe(20);
  });

  it('accepts numeric strings', () => {
    expect(toBoundedInt('42', 10, 0, 100)).toBe(42);
    expect(toBoundedInt('7', 10, 0, 100)).toBe(7);
  });

  it('accepts actual numbers within range', () => {
    expect(toBoundedInt(42, 10, 0, 100)).toBe(42);
    expect(toBoundedInt(0, 10, 0, 100)).toBe(0);
    expect(toBoundedInt(100, 10, 0, 100)).toBe(100);
  });
});

describe('isDebugTimingsEnabled', () => {
  it('returns true for boolean true', () => {
    expect(isDebugTimingsEnabled(true)).toBe(true);
  });

  it('returns false for boolean false', () => {
    expect(isDebugTimingsEnabled(false)).toBe(false);
  });

  it('returns true for string "true" (case-insensitive)', () => {
    expect(isDebugTimingsEnabled('true')).toBe(true);
    expect(isDebugTimingsEnabled('TRUE')).toBe(true);
    expect(isDebugTimingsEnabled('True')).toBe(true);
    expect(isDebugTimingsEnabled('  true  ')).toBe(true);
  });

  it('returns true for string "1"', () => {
    expect(isDebugTimingsEnabled('1')).toBe(true);
  });

  it('returns false for string "false", "0", and random strings', () => {
    expect(isDebugTimingsEnabled('false')).toBe(false);
    expect(isDebugTimingsEnabled('0')).toBe(false);
    expect(isDebugTimingsEnabled('random')).toBe(false);
    expect(isDebugTimingsEnabled('yes')).toBe(false);
  });

  it('returns false for undefined, null, and number', () => {
    expect(isDebugTimingsEnabled(undefined)).toBe(false);
    expect(isDebugTimingsEnabled(null)).toBe(false);
    expect(isDebugTimingsEnabled(1)).toBe(false);
    expect(isDebugTimingsEnabled(0)).toBe(false);
  });
});

describe('toOptionalBoolean', () => {
  it('returns undefined for undefined', () => {
    expect(toOptionalBoolean(undefined)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(toOptionalBoolean(null)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(toOptionalBoolean('')).toBeUndefined();
  });

  it('returns true for boolean true', () => {
    expect(toOptionalBoolean(true)).toBe(true);
  });

  it('returns false for boolean false', () => {
    expect(toOptionalBoolean(false)).toBe(false);
  });

  it('returns true for string "true" (case-insensitive, trimmed)', () => {
    expect(toOptionalBoolean('true')).toBe(true);
    expect(toOptionalBoolean('TRUE')).toBe(true);
    expect(toOptionalBoolean('True')).toBe(true);
    expect(toOptionalBoolean('  true  ')).toBe(true);
  });

  it('returns false for string "false" (case-insensitive, trimmed)', () => {
    expect(toOptionalBoolean('false')).toBe(false);
    expect(toOptionalBoolean('FALSE')).toBe(false);
    expect(toOptionalBoolean('False')).toBe(false);
    expect(toOptionalBoolean('  false  ')).toBe(false);
  });

  it('returns undefined for unrecognized string', () => {
    expect(toOptionalBoolean('yes')).toBeUndefined();
    expect(toOptionalBoolean('no')).toBeUndefined();
    expect(toOptionalBoolean('1')).toBeUndefined();
    expect(toOptionalBoolean('0')).toBeUndefined();
    expect(toOptionalBoolean('random')).toBeUndefined();
  });
});

describe('normalizeIndentationStyle', () => {
  it('returns "preserve" for "preserve"', () => {
    expect(normalizeIndentationStyle('preserve')).toBe('preserve');
  });

  it('returns "tabs" for "tabs"', () => {
    expect(normalizeIndentationStyle('tabs')).toBe('tabs');
  });

  it('returns "tabs" for anything else', () => {
    expect(normalizeIndentationStyle(undefined)).toBe('tabs');
    expect(normalizeIndentationStyle(null)).toBe('tabs');
    expect(normalizeIndentationStyle('spaces')).toBe('tabs');
    expect(normalizeIndentationStyle(42)).toBe('tabs');
    expect(normalizeIndentationStyle('')).toBe('tabs');
  });
});

describe('retabListIndentation', () => {
  it('converts 2 spaces to 1 tab for * item', () => {
    const result = retabListIndentation('  * item');
    expect(result.content).toBe('\t* item');
    expect(result.linesRetabbed).toBe(1);
  });

  it('converts 4 spaces to 2 tabs for - item', () => {
    const result = retabListIndentation('    - item');
    expect(result.content).toBe('\t\t- item');
    expect(result.linesRetabbed).toBe(1);
  });

  it('converts 6 spaces to 3 tabs for + item', () => {
    const result = retabListIndentation('      + item');
    expect(result.content).toBe('\t\t\t+ item');
    expect(result.linesRetabbed).toBe(1);
  });

  it('works for numbered lists', () => {
    const result = retabListIndentation('  1. item');
    expect(result.content).toBe('\t1. item');
    expect(result.linesRetabbed).toBe(1);
  });

  it('works for checkbox tasks', () => {
    const result = retabListIndentation('  * [x] done');
    expect(result.content).toBe('\t* [x] done');
    expect(result.linesRetabbed).toBe(1);
  });

  it('handles odd spaces (3) with floor(3/2)=1 tab', () => {
    const result = retabListIndentation('   * item');
    expect(result.content).toBe('\t* item');
    expect(result.linesRetabbed).toBe(1);
  });

  it('does NOT convert 1 space (spaceCount < 2)', () => {
    const result = retabListIndentation(' * item');
    expect(result.content).toBe(' * item');
    expect(result.linesRetabbed).toBe(0);
  });

  it('does NOT convert plain text with leading spaces', () => {
    const result = retabListIndentation('  some plain text');
    expect(result.content).toBe('  some plain text');
    expect(result.linesRetabbed).toBe(0);
  });

  it('does NOT convert lines starting with tabs (already tabbed)', () => {
    const result = retabListIndentation('\t* already tabbed');
    expect(result.content).toBe('\t* already tabbed');
    expect(result.linesRetabbed).toBe(0);
  });

  it('preserves lines with no leading spaces', () => {
    const result = retabListIndentation('* top level item');
    expect(result.content).toBe('* top level item');
    expect(result.linesRetabbed).toBe(0);
  });

  it('handles multi-line content, only retabbing list lines', () => {
    const input = [
      '# Heading',
      '  * nested item',
      'Some text',
      '    - deep item',
      '  plain text not a list',
    ].join('\n');
    const result = retabListIndentation(input);
    const expected = [
      '# Heading',
      '\t* nested item',
      'Some text',
      '\t\t- deep item',
      '  plain text not a list',
    ].join('\n');
    expect(result.content).toBe(expected);
    expect(result.linesRetabbed).toBe(2);
  });

  it('returns correct linesRetabbed count', () => {
    const input = [
      '  * one',
      '  - two',
      '* three',
      '  + four',
    ].join('\n');
    const result = retabListIndentation(input);
    expect(result.linesRetabbed).toBe(3);
  });
});

describe('extractAttachmentReferences', () => {
  it('extracts a single image reference', () => {
    expect(extractAttachmentReferences('![image](path.png)')).toEqual(['path.png']);
  });

  it('extracts multiple references', () => {
    const text = '![a](one.png) some text ![b](two.jpg)';
    expect(extractAttachmentReferences(text)).toEqual(['one.png', 'two.jpg']);
  });

  it('deduplicates identical references', () => {
    const text = '![a](same.png) and ![b](same.png)';
    expect(extractAttachmentReferences(text)).toEqual(['same.png']);
  });

  it('returns empty array for no references', () => {
    expect(extractAttachmentReferences('no images here')).toEqual([]);
    expect(extractAttachmentReferences('')).toEqual([]);
  });

  it('handles alt text with spaces and folder paths', () => {
    const text = '![alt text with spaces](folder/file.jpg)';
    expect(extractAttachmentReferences(text)).toEqual(['folder/file.jpg']);
  });
});

describe('getRemovedAttachmentReferences', () => {
  it('returns refs present in before but not in after', () => {
    const before = '![a](one.png) ![b](two.png)';
    const after = '![a](one.png)';
    expect(getRemovedAttachmentReferences(before, after)).toEqual(['two.png']);
  });

  it('returns empty when no refs removed', () => {
    const before = '![a](one.png)';
    const after = '![a](one.png) ![b](two.png)';
    expect(getRemovedAttachmentReferences(before, after)).toEqual([]);
  });

  it('returns empty when before has no refs', () => {
    const before = 'no images';
    const after = '![a](one.png)';
    expect(getRemovedAttachmentReferences(before, after)).toEqual([]);
  });

  it('works with multiple removals', () => {
    const before = '![a](one.png) ![b](two.png) ![c](three.png)';
    const after = '![b](two.png)';
    const removed = getRemovedAttachmentReferences(before, after);
    expect(removed).toContain('one.png');
    expect(removed).toContain('three.png');
    expect(removed).not.toContain('two.png');
    expect(removed).toHaveLength(2);
  });
});

describe('buildLineWindow', () => {
  const sampleLines = ['line1', 'line2', 'line3', 'line4', 'line5'];

  it('returns full content with defaults', () => {
    const result = buildLineWindow(sampleLines, { defaultLimit: 100, maxLimit: 200 });
    expect(result.lineCount).toBe(5);
    expect(result.rangeStartLine).toBe(1);
    expect(result.rangeEndLine).toBe(5);
    expect(result.rangeLineCount).toBe(5);
    expect(result.returnedLineCount).toBe(5);
    expect(result.content).toBe('line1\nline2\nline3\nline4\nline5');
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('selects a range with startLine/endLine (1-indexed)', () => {
    const result = buildLineWindow(sampleLines, {
      startLine: 2,
      endLine: 4,
      defaultLimit: 100,
      maxLimit: 200,
    });
    expect(result.rangeStartLine).toBe(2);
    expect(result.rangeEndLine).toBe(4);
    expect(result.rangeLineCount).toBe(3);
    expect(result.content).toBe('line2\nline3\nline4');
  });

  it('caps output with limit', () => {
    const result = buildLineWindow(sampleLines, {
      defaultLimit: 2,
      maxLimit: 200,
    });
    expect(result.returnedLineCount).toBe(2);
    expect(result.content).toBe('line1\nline2');
    expect(result.hasMore).toBe(true);
  });

  it('skips lines with offset', () => {
    const result = buildLineWindow(sampleLines, {
      offset: 2,
      defaultLimit: 100,
      maxLimit: 200,
    });
    expect(result.offset).toBe(2);
    expect(result.returnedLineCount).toBe(3);
    expect(result.content).toBe('line3\nline4\nline5');
  });

  it('cursor acts as offset', () => {
    const result = buildLineWindow(sampleLines, {
      cursor: '3',
      offset: 0,
      defaultLimit: 100,
      maxLimit: 200,
    });
    expect(result.offset).toBe(3);
    expect(result.returnedLineCount).toBe(2);
    expect(result.content).toBe('line4\nline5');
  });

  it('hasMore=true when more lines available', () => {
    const result = buildLineWindow(sampleLines, {
      limit: 3,
      defaultLimit: 100,
      maxLimit: 200,
    });
    expect(result.hasMore).toBe(true);
    expect(result.returnedLineCount).toBe(3);
  });

  it('nextCursor is string of next offset', () => {
    const result = buildLineWindow(sampleLines, {
      limit: 2,
      defaultLimit: 100,
      maxLimit: 200,
    });
    expect(result.nextCursor).toBe('2');
  });

  it('hasMore=false and nextCursor=null at end', () => {
    const result = buildLineWindow(sampleLines, {
      defaultLimit: 100,
      maxLimit: 200,
    });
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('lines array has correct 1-indexed line numbers', () => {
    const result = buildLineWindow(sampleLines, {
      startLine: 2,
      endLine: 4,
      defaultLimit: 100,
      maxLimit: 200,
    });
    expect(result.lines).toEqual([
      { line: 2, lineIndex: 1, content: 'line2' },
      { line: 3, lineIndex: 2, content: 'line3' },
      { line: 4, lineIndex: 3, content: 'line4' },
    ]);
  });

  it('handles empty content', () => {
    const result = buildLineWindow([], { defaultLimit: 100, maxLimit: 200 });
    expect(result.lineCount).toBe(0);
    expect(result.rangeLineCount).toBe(0);
    expect(result.returnedLineCount).toBe(0);
    expect(result.content).toBe('');
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.lines).toEqual([]);
  });
});

describe('normalizeDateToken', () => {
  it('normalizes "2024-01-15" to "20240115"', () => {
    expect(normalizeDateToken('2024-01-15')).toBe('20240115');
  });

  it('passes through "20240115" unchanged', () => {
    expect(normalizeDateToken('20240115')).toBe('20240115');
  });

  it('returns null for non-8-digit result', () => {
    expect(normalizeDateToken('2024')).toBeNull();
    expect(normalizeDateToken('abc')).toBeNull();
    expect(normalizeDateToken('123456789')).toBeNull();
  });

  it('returns null for undefined/empty', () => {
    expect(normalizeDateToken(undefined)).toBeNull();
    expect(normalizeDateToken('')).toBeNull();
  });
});

describe('noteMatchScore', () => {
  it('returns 1.0 for exact id match', () => {
    const note = { id: 'abc-123', title: 'Something', filename: 'something.md' };
    expect(noteMatchScore(note, 'abc-123', null)).toBe(1.0);
  });

  it('returns 0.99 for exact filename match', () => {
    const note = { id: 'xyz', title: 'Something', filename: 'notes/my-note.md' };
    expect(noteMatchScore(note, 'notes/my-note.md', null)).toBe(0.99);
  });

  it('returns 0.97 for exact basename match', () => {
    const note = { id: 'xyz', title: 'Something Else', filename: 'folder/my-note.md' };
    expect(noteMatchScore(note, 'my-note', null)).toBe(0.97);
  });

  it('returns 0.96 for exact title match', () => {
    const note = { id: 'xyz', title: 'My Note Title', filename: 'folder/different.md' };
    expect(noteMatchScore(note, 'My Note Title', null)).toBe(0.96);
  });

  it('returns 0.95 for date token match', () => {
    const note = { id: 'xyz', title: 'Daily', filename: 'cal.md', date: '2024-01-15' };
    const queryDateToken = normalizeDateToken('2024-01-15');
    expect(noteMatchScore(note, '2024-01-15', queryDateToken)).toBe(0.95);
  });

  it('returns 0.9 for title starts with query', () => {
    const note = { id: 'xyz', title: 'Meeting notes for project X', filename: 'other.md' };
    expect(noteMatchScore(note, 'meeting notes', null)).toBe(0.9);
  });

  it('returns 0.88 for basename starts with query', () => {
    const note = { id: 'xyz', title: 'Something Else', filename: 'folder/meeting-recap.md' };
    expect(noteMatchScore(note, 'meeting', null)).toBe(0.88);
  });

  it('returns 0.83 for filename contains query', () => {
    const note = { id: 'xyz', title: 'Unrelated', filename: 'projects/quarterly-review.md' };
    expect(noteMatchScore(note, 'quarterly-review.md', null)).toBe(0.83);
  });

  it('returns 0.76 for combined title+filename contains query', () => {
    const note = { id: 'xyz', title: 'Project', filename: 'folder/notes.md' };
    // The query must span title and filename combined: "project folder/notes.md"
    // actually let's test with something that only matches across the combination
    expect(noteMatchScore(note, 'project folder', null)).toBe(0.76);
  });

  it('returns 0 for no match', () => {
    const note = { id: 'xyz', title: 'Something', filename: 'folder/note.md' };
    expect(noteMatchScore(note, 'completely-unrelated-query', null)).toBe(0);
  });
});

describe('findParagraphBounds', () => {
  it('handles single paragraph (no blank lines)', () => {
    const lines = ['line one', 'line two', 'line three'];
    expect(findParagraphBounds(lines, 1)).toEqual({ startIndex: 0, endIndex: 2 });
  });

  it('handles paragraph bounded by blanks', () => {
    const lines = ['first para', '', 'second', 'para', '', 'third para'];
    expect(findParagraphBounds(lines, 2)).toEqual({ startIndex: 2, endIndex: 3 });
    expect(findParagraphBounds(lines, 3)).toEqual({ startIndex: 2, endIndex: 3 });
  });

  it('handles first paragraph (starts at line 0)', () => {
    const lines = ['first', 'paragraph', '', 'second'];
    expect(findParagraphBounds(lines, 0)).toEqual({ startIndex: 0, endIndex: 1 });
    expect(findParagraphBounds(lines, 1)).toEqual({ startIndex: 0, endIndex: 1 });
  });

  it('handles last paragraph (extends to end)', () => {
    const lines = ['first', '', 'last', 'paragraph'];
    expect(findParagraphBounds(lines, 2)).toEqual({ startIndex: 2, endIndex: 3 });
    expect(findParagraphBounds(lines, 3)).toEqual({ startIndex: 2, endIndex: 3 });
  });
});

// ---------------------------------------------------------------------------
// matchesFrontmatterProperties — exported from unified-store
// ---------------------------------------------------------------------------

import { matchesFrontmatterProperties, normalizeFrontmatterScalar } from '../noteplan/unified-store.js';

describe('normalizeFrontmatterScalar', () => {
  it('strips surrounding double quotes', () => {
    expect(normalizeFrontmatterScalar('"book"', false)).toBe('book');
  });

  it('strips surrounding single quotes', () => {
    expect(normalizeFrontmatterScalar("'book'", false)).toBe('book');
  });

  it('lowercases when caseSensitive is false', () => {
    expect(normalizeFrontmatterScalar('Book', false)).toBe('book');
  });

  it('preserves case when caseSensitive is true', () => {
    expect(normalizeFrontmatterScalar('Book', true)).toBe('Book');
  });

  it('trims whitespace', () => {
    expect(normalizeFrontmatterScalar('  hello  ', false)).toBe('hello');
  });
});

describe('matchesFrontmatterProperties', () => {
  const makeNote = (content: string) => ({
    id: 'test-id',
    title: 'Test Note',
    filename: 'test.md',
    type: 'note' as const,
    source: 'local' as const,
    folder: '',
    content,
    modifiedAt: new Date(),
    createdAt: new Date(),
    spaceId: undefined,
    date: undefined,
  });

  it('matches a single property filter', () => {
    const note = makeNote('---\ntype: book\n---\nSome content');
    expect(matchesFrontmatterProperties(note, [['type', 'book']], false)).toBe(true);
  });

  it('rejects when property value does not match', () => {
    const note = makeNote('---\ntype: article\n---\nSome content');
    expect(matchesFrontmatterProperties(note, [['type', 'book']], false)).toBe(false);
  });

  it('rejects when property key is missing', () => {
    const note = makeNote('---\ntitle: My Note\n---\nSome content');
    expect(matchesFrontmatterProperties(note, [['type', 'book']], false)).toBe(false);
  });

  it('returns false when there is no frontmatter', () => {
    const note = makeNote('Just some text without frontmatter');
    expect(matchesFrontmatterProperties(note, [['type', 'book']], false)).toBe(false);
  });

  it('matches case-insensitively by default', () => {
    const note = makeNote('---\nType: Book\n---\nContent');
    expect(matchesFrontmatterProperties(note, [['type', 'book']], false)).toBe(true);
  });

  it('matches comma-separated list values', () => {
    const note = makeNote('---\ntags: fiction, book, novel\n---\nContent');
    expect(matchesFrontmatterProperties(note, [['tags', 'book']], false)).toBe(true);
  });

  it('requires all filters to match', () => {
    const note = makeNote('---\ntype: book\nstatus: reading\n---\nContent');
    expect(matchesFrontmatterProperties(note, [['type', 'book'], ['status', 'reading']], false)).toBe(true);
    expect(matchesFrontmatterProperties(note, [['type', 'book'], ['status', 'done']], false)).toBe(false);
  });
});

// ── Regression: read-write line number consistency with frontmatter ──
// These tests verify that line numbers from buildLineWindow (used by get_notes
// and getParagraphs) can be directly used in delete/edit/replace operations
// without any frontmatter offset mismatch. This was a real user-reported bug
// where delete_lines previewed wrong content because it applied a frontmatter
// offset while get_notes used absolute line numbers.

describe('frontmatter line number consistency (regression)', () => {
  // A note with 3 lines of frontmatter (lines 1-3) and 5 content lines (4-8)
  const noteWithFM = [
    '---',                    // line 1
    'title: Wishlist',        // line 2
    '---',                    // line 3
    '# Wishlist',             // line 4
    '',                       // line 5
    '## AI',                  // line 6
    '- Feature A',            // line 7
    '- Choose AI provider',   // line 8  ← user wants to delete this
  ].join('\n');
  const allLines = noteWithFM.split('\n');

  it('buildLineWindow reports absolute line numbers including frontmatter', () => {
    const window = buildLineWindow(allLines, {
      startLine: 1,
      endLine: 8,
      defaultLimit: 100,
      maxLimit: 100,
    });
    expect(window.lines[0]).toEqual({ line: 1, lineIndex: 0, content: '---' });
    expect(window.lines[3]).toEqual({ line: 4, lineIndex: 3, content: '# Wishlist' });
    expect(window.lines[7]).toEqual({ line: 8, lineIndex: 7, content: '- Choose AI provider' });
  });

  it('line number from buildLineWindow can be used directly for array splice', () => {
    // Simulate: user reads note, gets line 8 = "- Choose AI provider"
    const window = buildLineWindow(allLines, {
      startLine: 1,
      endLine: 8,
      defaultLimit: 100,
      maxLimit: 100,
    });
    const targetLine = window.lines.find(l => l.content === '- Choose AI provider');
    expect(targetLine).toBeDefined();
    expect(targetLine!.line).toBe(8);

    // Now simulate delete: splice at (line - 1) with no frontmatter offset
    const splicedLines = [...allLines];
    splicedLines.splice(targetLine!.line - 1, 1);
    expect(splicedLines).toEqual([
      '---', 'title: Wishlist', '---', '# Wishlist', '', '## AI', '- Feature A',
    ]);
    // The deleted line should be "- Choose AI provider", not something else
    expect(splicedLines).not.toContain('- Choose AI provider');
  });

  it('searching for content returns line numbers usable for deletion', () => {
    // Simulate searchParagraphs: find "Choose AI provider", get line number
    const window = buildLineWindow(allLines, {
      defaultLimit: allLines.length,
      maxLimit: allLines.length,
    });
    const match = window.lines.find(l => l.content.includes('Choose AI provider'));
    expect(match).toBeDefined();
    expect(match!.line).toBe(8);

    // Use that line number for deletion (absolute, no offset)
    const startIndex = match!.line - 1; // 0-indexed
    expect(allLines[startIndex]).toBe('- Choose AI provider');
  });

  it('startLine/endLine window with frontmatter uses absolute numbering', () => {
    // Read lines 6-8 (the AI section)
    const window = buildLineWindow(allLines, {
      startLine: 6,
      endLine: 8,
      defaultLimit: 100,
      maxLimit: 100,
    });
    expect(window.lines).toEqual([
      { line: 6, lineIndex: 5, content: '## AI' },
      { line: 7, lineIndex: 6, content: '- Feature A' },
      { line: 8, lineIndex: 7, content: '- Choose AI provider' },
    ]);
  });

  it('note without frontmatter: line 1 is first line of content', () => {
    const noFM = ['# Title', 'Body 1', 'Body 2'].join('\n');
    const noFMLines = noFM.split('\n');
    const window = buildLineWindow(noFMLines, {
      defaultLimit: 100,
      maxLimit: 100,
    });
    expect(window.lines[0]).toEqual({ line: 1, lineIndex: 0, content: '# Title' });
    expect(window.lines[1]).toEqual({ line: 2, lineIndex: 1, content: 'Body 1' });
  });
});

// ── Manual test procedure for frontmatter line consistency ──
// Run this against a live NotePlan MCP server to verify read/write consistency.
//
// SETUP: Create a test note with frontmatter:
//   noteplan_manage_note(action="create", title="FM Line Test", content=`
//   ---
//   test: true
//   ---
//   # FM Line Test
//
//   Line A
//   Line B
//   Line C
//   `)
//
// TEST 1: Read and verify line numbers
//   noteplan_get_notes(filename="...", includeContent=true)
//   → Verify: "---" is line 1, "# FM Line Test" is line 4, "Line A" is line 6
//
// TEST 2: Search and verify line numbers match
//   noteplan_paragraphs(action="search", filename="...", query="Line B")
//   → Verify: result.line matches get_notes line for "Line B" (should be 7)
//
// TEST 3: Delete using the line number from search
//   noteplan_edit_content(action="delete_lines", filename="...", startLine=7, endLine=7, dryRun=true)
//   → Verify: dry run preview shows "Line B", NOT a different line
//   → If preview shows wrong content, the frontmatter offset bug has regressed!
//
// TEST 4: Edit a line using absolute number
//   noteplan_edit_content(action="edit_line", filename="...", line=6, content="Line A (edited)")
//   → Verify: "Line A" was changed, not a different line
//
// TEST 5: Replace lines using absolute numbers
//   noteplan_edit_content(action="replace_lines", filename="...", startLine=6, endLine=8,
//     content="Replaced A\nReplaced B\nReplaced C", dryRun=true)
//   → Verify: preview shows "Line A", "Line B", "Line C" being replaced
//
// TEST 6: Insert at absolute line
//   noteplan_edit_content(action="insert", filename="...", position="at-line", line=6,
//     content="Inserted before Line A")
//   → Verify: new line appears at line 6, "Line A" moves to line 7
//
// TEST 7: Frontmatter protection
//   noteplan_edit_content(action="delete_lines", filename="...", startLine=1, endLine=3)
//   → Verify: returns error about frontmatter protection, does NOT delete
//
// CLEANUP:
//   noteplan_manage_note(action="delete", filename="...")
//
