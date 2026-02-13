// Note CRUD operations

import { z } from 'zod';
import path from 'path';
import * as store from '../noteplan/unified-store.js';
import * as frontmatter from '../noteplan/frontmatter-parser.js';
import { ensureTemplateFrontmatter } from './templates.js';
import {
  issueConfirmationToken,
  validateAndConsumeConfirmationToken,
} from '../utils/confirmation-tokens.js';
import { parseParagraphLine, buildParagraphLine } from '../noteplan/markdown-parser.js';
import { ParagraphType, TaskStatus as ParagraphTaskStatus } from '../noteplan/types.js';

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

function confirmationFailureMessage(toolName: string, reason: string): string {
  const refreshHint = `Call ${toolName} with dryRun=true to get a new confirmationToken.`;
  if (reason === 'missing') {
    return `Confirmation token is required for ${toolName}. ${refreshHint}`;
  }
  if (reason === 'expired') {
    return `Confirmation token is expired for ${toolName}. ${refreshHint}`;
  }
  return `Confirmation token is invalid for ${toolName}. ${refreshHint}`;
}

function resolveNoteTarget(
  id?: string,
  filename?: string,
  space?: string
): { identifier: string; note: ReturnType<typeof store.getNote> } {
  const identifier = (id && id.trim().length > 0 ? id : filename)?.trim();
  if (!identifier) {
    return { identifier: '', note: null };
  }

  const note = id
    ? store.getNote({ id: identifier, space }) ?? store.getNote({ filename: identifier, space })
    : store.getNote({ filename: identifier, space });
  return {
    identifier,
    note,
  };
}

type WritableNoteReferenceInput = {
  id?: string;
  filename?: string;
  title?: string;
  date?: string;
  query?: string;
  space?: string;
};

function resolveWritableNoteReference(input: WritableNoteReferenceInput): {
  note: ReturnType<typeof store.getNote>;
  error?: string;
  candidates?: Array<{ id: string; title: string; filename: string; score: number }>;
} {
  if (input.id && input.id.trim().length > 0) {
    const note = store.getNote({ id: input.id.trim(), space: input.space?.trim() });
    return { note, error: note ? undefined : 'Note not found' };
  }

  if (input.filename && input.filename.trim().length > 0) {
    const note = store.getNote({ filename: input.filename.trim(), space: input.space?.trim() });
    return { note, error: note ? undefined : 'Note not found' };
  }

  if (input.date && input.date.trim().length > 0) {
    let note = store.getNote({ date: input.date.trim(), space: input.space?.trim() });
    if (!note) {
      // Auto-create calendar notes on the fly (matches NotePlan native behavior)
      try {
        note = store.ensureCalendarNote(input.date.trim(), input.space?.trim());
      } catch {
        return { note: null, error: 'Failed to create calendar note for date' };
      }
    }
    return { note, error: note ? undefined : 'Note not found' };
  }

  const textQuery = input.query?.trim() || input.title?.trim();
  if (textQuery) {
    const resolved = resolveNote({
      query: textQuery,
      space: input.space?.trim(),
      types: ['note', 'calendar'],
      limit: 5,
      minScore: 0.88,
      ambiguityDelta: 0.06,
    }) as {
      success?: boolean;
      resolved?: { id?: string; filename?: string };
      ambiguous?: boolean;
      count?: number;
      candidates?: Array<{ id: string; title: string; filename: string; score: number }>;
    };

    if (resolved.success !== true) {
      return { note: null, error: 'Could not resolve note query' };
    }

    if (resolved.ambiguous === true || !resolved.resolved) {
      const label = input.title ? 'title' : 'query';
      return {
        note: null,
        error: `Ambiguous note ${label}. Resolve explicitly with noteplan_resolve_note or provide id/filename.`,
        candidates: resolved.candidates?.slice(0, 5) ?? [],
      };
    }

    const identifier = resolved.resolved.id || resolved.resolved.filename;
    if (!identifier) {
      return { note: null, error: 'Could not resolve note target' };
    }
    const note = store.getNote({ id: identifier, space: input.space?.trim() }) ?? store.getNote({ filename: identifier, space: input.space?.trim() });
    return { note, error: note ? undefined : 'Resolved note no longer exists' };
  }

  return {
    note: null,
    error: 'Provide one note reference: id, filename, title, date, or query',
  };
}

function getWritableIdentifier(
  note: NonNullable<ReturnType<typeof store.getNote>>
): { identifier: string; source: 'local' | 'space' } {
  if (note.source === 'space') {
    return {
      identifier: note.id || note.filename,
      source: 'space',
    };
  }
  return {
    identifier: note.filename,
    source: 'local',
  };
}

const PROGRESSIVE_READ_HINT =
  'Use startLine/endLine and cursor pagination for progressive note reads.';
const NEXT_CURSOR_HINT = 'Continue with nextCursor to fetch the next content page.';

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    // Consume all matched leading spaces; do not keep odd-space remainder.
    return `${tabs}${line.slice(spaceCount)}`;
  });

  return {
    content: normalized.join('\n'),
    linesRetabbed,
  };
}

function normalizeContentIndentation(
  content: string,
  style: IndentationStyle
): { content: string; linesRetabbed: number } {
  if (style === 'preserve') {
    return {
      content,
      linesRetabbed: 0,
    };
  }
  return retabListIndentation(content);
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

function buildAttachmentWarningMessage(referenceCount: number): string {
  return `Warning: edited/deleted content references ${referenceCount} attachment link(s). NotePlan may auto-trash referenced files when these links are removed.`;
}

function findParagraphBounds(lines: string[], lineIndex: number): { startIndex: number; endIndex: number } {
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

// Schema definitions
export const getNoteSchema = z.object({
  id: z.string().optional().describe('Note ID (use this for space notes - get it from search results)'),
  title: z.string().optional().describe('Note title to search for'),
  filename: z.string().optional().describe('Direct filename/path to the note (for local notes)'),
  date: z.string().optional().describe('Date for calendar notes (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)'),
  space: z.string().optional().describe('Space name or ID to search in'),
  includeContent: z
    .boolean()
    .optional()
    .describe('Include note body content and line payload (default: false, metadata/preview only)'),
  startLine: z.number().min(1).optional().describe('First line to include when includeContent=true (1-indexed)'),
  endLine: z.number().min(1).optional().describe('Last line to include when includeContent=true (1-indexed)'),
  limit: z.number().min(1).max(1000).optional().default(500).describe('Maximum lines to return when includeContent=true'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset within selected range'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
  previewChars: z
    .number()
    .min(0)
    .max(5000)
    .optional()
    .default(280)
    .describe('Preview length when includeContent=false (default: 280)'),
});

export const listNotesSchema = z.object({
  folder: z
    .string()
    .optional()
    .describe('Filter by project folder path (e.g., "20 - Areas" or "Notes/20 - Areas")'),
  space: z.string().optional().describe('Space name or ID to list from'),
  types: z
    .array(z.enum(['calendar', 'note', 'trash']))
    .optional()
    .describe('Filter by note types'),
  query: z.string().optional().describe('Filter notes by title/filename/folder substring'),
  limit: z.number().min(1).max(500).optional().default(50).describe('Maximum number of notes to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const resolveNoteSchema = z.object({
  query: z.string().describe('Note reference to resolve (ID, title, filename, or date token)'),
  space: z.string().optional().describe('Restrict to a specific space name or ID'),
  folder: z.string().optional().describe('Restrict to a folder path'),
  types: z
    .array(z.enum(['calendar', 'note', 'trash']))
    .optional()
    .describe('Restrict to note types'),
  limit: z.number().min(1).max(20).optional().default(5).describe('Candidate matches to return'),
  minScore: z.number().min(0).max(1).optional().default(0.88).describe('Minimum score for auto-resolution'),
  ambiguityDelta: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.06)
    .describe('If top scores are within this delta, treat as ambiguous'),
});

export const createNoteSchema = z.object({
  title: z.string().describe('Title for the new note'),
  content: z.string().optional().describe('Initial content for the note. Can include YAML frontmatter between --- delimiters for styling (icon, icon-color, bg-color, bg-color-dark, bg-pattern, status, priority, summary, type, domain)'),
  folder: z.string().optional().describe('Folder to create the note in. Supports smart matching (e.g., "projects" matches "10 - Projects")'),
  create_new_folder: z.boolean().optional().describe('Set to true to create a new folder instead of matching existing ones'),
  space: z.string().optional().describe('Space name or ID to create in (e.g., "My Team" or a UUID)'),
  noteType: z.enum(['note', 'template']).optional().default('note').describe('Type of note to create. Use "template" to create in @Templates with proper frontmatter'),
  templateTypes: z.array(z.enum(['empty-note', 'meeting-note', 'project-note', 'calendar-note'])).optional().describe('Template type tags — used when noteType="template"'),
});

export const updateNoteSchema = z.object({
  filename: z.string().describe('Filename/path of the note to update'),
  space: z.string().optional().describe('Space name or ID to search in'),
  content: z
    .string()
    .describe('New content for the note. Include YAML frontmatter between --- delimiters at the start if the note has or should have properties'),
  fullReplace: z
    .boolean()
    .optional()
    .describe('Required safety confirmation for whole-note rewrite. Must be true to proceed.'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview full-rewrite impact and get confirmationToken without modifying the note'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for full note rewrite'),
  allowEmptyContent: z
    .boolean()
    .optional()
    .describe('Allow replacing note content with empty/blank text (default: false)'),
});

export const deleteNoteSchema = z.object({
  id: z.string().optional().describe('Note ID (preferred for TeamSpace notes)'),
  filename: z.string().optional().describe('Filename/path of the note to delete'),
  space: z.string().optional().describe('Space name or ID to search in'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview deletion impact without deleting (default: false)'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for delete execution'),
}).superRefine((input, ctx) => {
  if (!input.id && !input.filename) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one note reference: id or filename',
      path: ['id'],
    });
  }
});

export const moveNoteSchema = z.object({
  id: z.string().optional().describe('Note ID (preferred for TeamSpace notes)'),
  filename: z.string().optional().describe('Filename/path of the note to move'),
  space: z.string().optional().describe('Space name or ID to search in'),
  destinationFolder: z
    .string()
    .describe('Destination folder. For local notes: folder path in Notes (if a full path is provided, basename must match current file). For TeamSpace notes: folder ID/path/name or "root"'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview move impact and get confirmationToken without modifying the note'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for move execution'),
}).superRefine((input, ctx) => {
  if (!input.id && !input.filename) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one note reference: id or filename',
      path: ['id'],
    });
  }
});

export const renameNoteFileSchema = z.object({
  id: z.string().optional().describe('Note ID (preferred for TeamSpace notes)'),
  filename: z.string().optional().describe('Filename/path of the note to rename'),
  space: z.string().optional().describe('Space name or ID to search in'),
  newFilename: z
    .string()
    .optional()
    .describe('New file name for local notes. Can be bare filename or full path in the same folder; defaults to keeping current extension'),
  newTitle: z
    .string()
    .optional()
    .describe('New title for TeamSpace notes'),
  keepExtension: z
    .boolean()
    .optional()
    .default(true)
    .describe('Keep current extension (.md/.txt) even if newFilename includes a different extension (default: true)'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview rename impact and get confirmationToken without modifying the note'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for rename execution'),
}).superRefine((input, ctx) => {
  if (!input.id && !input.filename) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one note reference: id or filename',
      path: ['filename'],
    });
  }
});

export const restoreNoteSchema = z.object({
  id: z.string().optional().describe('Trashed note ID (preferred for TeamSpace notes, usually from noteplan_delete_note response)'),
  filename: z.string().optional().describe('Trashed filename/path to restore (usually from noteplan_delete_note response)'),
  space: z.string().optional().describe('Space name or ID to search in'),
  destinationFolder: z
    .string()
    .optional()
    .describe('Restore destination. Local: folder under Notes. TeamSpace: folder ID/path/name or "root" (default: space root)'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview restore impact and get confirmationToken without modifying the note'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for restore execution'),
}).superRefine((input, ctx) => {
  if (!input.id && !input.filename) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one note reference: id or filename',
      path: ['id'],
    });
  }
});

// Tool implementations
export function getNote(params: z.infer<typeof getNoteSchema>) {
  const note = store.getNote(params);

  if (!note) {
    return {
      success: false,
      error: 'Note not found',
    };
  }

  const includeContent = toOptionalBoolean((params as { includeContent?: unknown }).includeContent) ?? false;
  const previewChars = toBoundedInt(
    (params as { previewChars?: unknown }).previewChars,
    280,
    0,
    5000
  );
  const allLines = note.content.split('\n');
  const lineCount = allLines.length;
  const contentLength = note.content.length;

  const result: Record<string, unknown> = {
    success: true,
    note: {
      id: note.id,
      title: note.title,
      filename: note.filename,
      type: note.type,
      source: note.source,
      folder: note.folder,
      spaceId: note.spaceId,
      date: note.date,
      modifiedAt: note.modifiedAt?.toISOString(),
      createdAt: note.createdAt?.toISOString(),
    },
    contentIncluded: includeContent,
    lineCount,
    contentLength,
  };

  if (!includeContent) {
    const preview = previewChars > 0 ? note.content.slice(0, previewChars) : '';
    result.preview = preview;
    result.previewTruncated = preview.length < note.content.length;
    if ((result.previewTruncated as boolean) || lineCount > 200) {
      result.performanceHints = [
        `Set includeContent=true. ${PROGRESSIVE_READ_HINT}`,
      ];
    }
    return result;
  }

  const lineWindow = buildLineWindow(allLines, {
    startLine: (params as { startLine?: unknown }).startLine,
    endLine: (params as { endLine?: unknown }).endLine,
    limit: (params as { limit?: unknown }).limit,
    offset: (params as { offset?: unknown }).offset,
    cursor: (params as { cursor?: unknown }).cursor,
    defaultLimit: 500,
    maxLimit: 1000,
  });
  result.rangeStartLine = lineWindow.rangeStartLine;
  result.rangeEndLine = lineWindow.rangeEndLine;
  result.rangeLineCount = lineWindow.rangeLineCount;
  result.returnedLineCount = lineWindow.returnedLineCount;
  result.offset = lineWindow.offset;
  result.limit = lineWindow.limit;
  result.hasMore = lineWindow.hasMore;
  result.nextCursor = lineWindow.nextCursor;
  result.content = lineWindow.content;
  result.lines = lineWindow.lines;
  if (lineWindow.hasMore) {
    result.performanceHints = [NEXT_CURSOR_HINT];
  }

  return result;
}

export function listNotes(params?: z.infer<typeof listNotesSchema>) {
  const input = params ?? ({} as z.infer<typeof listNotesSchema>);
  const notes = store.listNotes({
    folder: input.folder,
    space: input.space,
  });
  const allowedTypes = input.types ? new Set(input.types) : null;
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : undefined;

  const filtered = notes.filter((note) => {
    if (allowedTypes && !allowedTypes.has(note.type)) return false;
    if (!query) return true;

    const haystack = `${note.title} ${note.filename} ${note.folder || ''}`.toLowerCase();
    return haystack.includes(query);
  });

  const offset = toBoundedInt(input.cursor ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(input.limit, 50, 1, 500);
  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + page.length < filtered.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  return {
    success: true,
    count: page.length,
    totalCount: filtered.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    notes: page.map((note) => ({
      id: note.id,
      title: note.title,
      filename: note.filename,
      type: note.type,
      source: note.source,
      folder: note.folder,
      spaceId: note.spaceId,
      modifiedAt: note.modifiedAt?.toISOString(),
    })),
  };
}

function normalizeDateToken(value?: string): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}

function noteMatchScore(
  note: ReturnType<typeof store.listNotes>[number],
  query: string,
  queryDateToken: string | null
): number {
  const queryLower = query.toLowerCase();
  const idLower = (note.id || '').toLowerCase();
  const titleLower = (note.title || '').toLowerCase();
  const filenameLower = (note.filename || '').toLowerCase();
  const basenameLower = path.basename(filenameLower, path.extname(filenameLower));
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

export function resolveNote(params: z.infer<typeof resolveNoteSchema>) {
  const query = typeof params?.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }

  const limit = toBoundedInt(params.limit, 5, 1, 20);
  const minScore = Math.min(1, Math.max(0, Number(params.minScore ?? 0.88)));
  const ambiguityDelta = Math.min(1, Math.max(0, Number(params.ambiguityDelta ?? 0.06)));
  const queryDateToken = normalizeDateToken(query);
  const allowedTypes = params.types ? new Set(params.types) : null;
  const includeStageTimings = isDebugTimingsEnabled(
    (params as { debugTimings?: unknown }).debugTimings
  );
  const stageTimings: Record<string, number> = {};

  const listStart = Date.now();
  const notes = store.listNotes({
    folder: params.folder,
    space: params.space,
  });
  const listNotesMs = Date.now() - listStart;
  if (includeStageTimings) {
    stageTimings.listNotesMs = listNotesMs;
  }

  const scoreStart = Date.now();
  const scored = notes
    .filter((note) => !allowedTypes || allowedTypes.has(note.type))
    .map((note) => ({
      note,
      score: noteMatchScore(note, query, queryDateToken),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
      return a.note.filename.localeCompare(b.note.filename);
    });
  const scoreAndSortMs = Date.now() - scoreStart;
  if (includeStageTimings) {
    stageTimings.scoreAndSortMs = scoreAndSortMs;
  }

  const resolveStart = Date.now();
  const candidates = scored.slice(0, limit);
  const top = candidates[0];
  const second = candidates[1];
  const scoreDelta = top && second ? top.score - second.score : 1;
  const confident = Boolean(top) && top.score >= minScore;
  const ambiguous = Boolean(second) && scoreDelta < ambiguityDelta;
  const resolved = confident && !ambiguous ? top.note : null;
  const mappedCandidates = candidates.map((entry) => ({
    id: entry.note.id,
    title: entry.note.title,
    filename: entry.note.filename,
    type: entry.note.type,
    source: entry.note.source,
    folder: entry.note.folder,
    spaceId: entry.note.spaceId,
    score: Number(entry.score.toFixed(3)),
  }));
  const resolveResultMs = Date.now() - resolveStart;
  if (includeStageTimings) {
    stageTimings.resolveResultMs = resolveResultMs;
  }

  const result: Record<string, unknown> = {
    success: true,
    query,
    count: candidates.length,
    resolved: resolved
      ? {
          id: resolved.id,
          title: resolved.title,
          filename: resolved.filename,
          type: resolved.type,
          source: resolved.source,
          folder: resolved.folder,
          spaceId: resolved.spaceId,
          score: Number((top?.score ?? 0).toFixed(3)),
        }
      : null,
    exactMatch: Boolean(top) && Number((top?.score ?? 0).toFixed(3)) >= 0.96,
    ambiguous,
    confidence: top ? Number(top.score.toFixed(3)) : 0,
    confidenceDelta: Number(scoreDelta.toFixed(3)),
    suggestedGetNoteArgs: resolved
      ? resolved.source === 'space' && resolved.id
        ? { id: resolved.id }
        : { filename: resolved.filename }
      : null,
    candidates: mappedCandidates,
  };

  const performanceHints: string[] = [];
  if (listNotesMs > 1200) {
    if (!params.space) {
      performanceHints.push('Set space to scope note resolution to one workspace.');
    }
    if (!params.folder) {
      performanceHints.push('Set folder to reduce note candidate scans.');
    }
    if (!params.types || params.types.length !== 1) {
      performanceHints.push('Set one note type when possible (calendar, note, or trash).');
    }
  }
  if (candidates.length === 0) {
    performanceHints.push('Try noteplan_search with a broader query to discover canonical note IDs first.');
  }
  if (performanceHints.length > 0) {
    result.performanceHints = performanceHints;
  }

  if (includeStageTimings) {
    result.stageTimings = stageTimings;
  }

  return result;
}

export function createNote(params: z.infer<typeof createNoteSchema>) {
  try {
    const isTemplate = params.noteType === 'template';
    const folder = isTemplate && !params.folder ? '@Templates' : params.folder;
    const content = isTemplate
      ? ensureTemplateFrontmatter(params.title, params.content, params.templateTypes)
      : params.content;

    const result = store.createNote(params.title, content, {
      folder,
      space: params.space,
      createNewFolder: params.create_new_folder,
    });

    return {
      success: true,
      note: {
        title: result.note.title,
        filename: result.note.filename,
        type: result.note.type,
        source: result.note.source,
        folder: result.note.folder,
      },
      folderResolution: {
        requested: result.folderResolution.requested,
        resolved: result.folderResolution.resolved,
        matched: result.folderResolution.matched,
        ambiguous: result.folderResolution.ambiguous,
        score: result.folderResolution.score,
        alternatives: result.folderResolution.alternatives,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create note',
    };
  }
}

export function updateNote(params: z.infer<typeof updateNoteSchema>) {
  try {
    if (params.fullReplace !== true) {
      return {
        success: false,
        error:
          'Full note replacement is blocked for noteplan_update_note unless fullReplace=true. Prefer noteplan_search_paragraphs + noteplan_edit_line/insert_content/delete_lines for targeted edits.',
      };
    }

    const existingNote = store.getNote({ filename: params.filename, space: params.space });
    if (!existingNote) {
      return {
        success: false,
        error: 'Note not found',
      };
    }

    if (params.allowEmptyContent !== true && params.content.trim().length === 0) {
      return {
        success: false,
        error:
          'Empty content is blocked for noteplan_update_note. Use allowEmptyContent=true to override intentionally.',
      };
    }

    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_update_note',
        target: params.filename,
        action: 'full_replace',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: note ${params.filename} would be fully replaced`,
        note: {
          id: existingNote.id,
          title: existingNote.title,
          filename: existingNote.filename,
          type: existingNote.type,
          source: existingNote.source,
          folder: existingNote.folder,
          spaceId: existingNote.spaceId,
        },
        currentContentLength: existingNote.content.length,
        newContentLength: params.content.length,
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'noteplan_update_note',
      target: params.filename,
      action: 'full_replace',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_update_note', confirmation.reason),
      };
    }

    const writeTarget = getWritableIdentifier(existingNote);
    const note = store.updateNote(writeTarget.identifier, params.content, {
      source: writeTarget.source,
    });

    return {
      success: true,
      note: {
        title: note.title,
        filename: note.filename,
        type: note.type,
        source: note.source,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update note',
    };
  }
}

export function deleteNote(params: z.infer<typeof deleteNoteSchema>) {
  try {
    const target = resolveNoteTarget(params.id, params.filename, params.space);
    const note = target.note;
    if (!note) {
      return {
        success: false,
        error: 'Note not found',
      };
    }

    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_delete_note',
        target: target.identifier,
        action: 'delete_note',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: note ${target.identifier} would be moved to trash`,
        note: {
          id: note.id,
          title: note.title,
          filename: note.filename,
          type: note.type,
          source: note.source,
          folder: note.folder,
          spaceId: note.spaceId,
        },
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'noteplan_delete_note',
      target: target.identifier,
      action: 'delete_note',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_delete_note', confirmation.reason),
      };
    }

    const deleted = store.deleteNote(target.identifier);

    return {
      success: true,
      message:
        deleted.source === 'space'
          ? `TeamSpace note moved to @Trash`
          : `Note moved to @Trash`,
      fromIdentifier: deleted.fromIdentifier,
      trashedIdentifier: deleted.toIdentifier,
      suggestedRestoreArgs:
        deleted.source === 'space'
          ? { id: deleted.noteId || deleted.fromIdentifier }
          : { filename: deleted.toIdentifier },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete note',
    };
  }
}

export function moveNote(params: z.infer<typeof moveNoteSchema>) {
  try {
    const target = resolveNoteTarget(params.id, params.filename, params.space);
    if (!target.note) {
      return {
        success: false,
        error: 'Note not found',
      };
    }
    const preview = store.previewMoveNote(target.identifier, params.destinationFolder);
    const confirmationTarget =
      `${preview.fromFilename}=>${preview.toFilename}::${preview.destinationParentId ?? preview.destinationFolder}`;

    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_move_note',
        target: confirmationTarget,
        action: 'move_note',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: note ${preview.fromFilename} would move to ${preview.toFilename}`,
        fromFilename: preview.fromFilename,
        toFilename: preview.toFilename,
        destinationFolder: preview.destinationFolder,
        note: {
          id: preview.note.id,
          title: preview.note.title,
          filename: preview.note.filename,
          type: preview.note.type,
          source: preview.note.source,
          folder: preview.note.folder,
          spaceId: preview.note.spaceId,
        },
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'noteplan_move_note',
      target: confirmationTarget,
      action: 'move_note',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_move_note', confirmation.reason),
      };
    }

    const moved = store.moveNote(target.identifier, params.destinationFolder);
    return {
      success: true,
      message:
        moved.note.source === 'space'
          ? `TeamSpace note moved to folder ${moved.destinationFolder}`
          : `Note moved to ${moved.toFilename}`,
      fromFilename: moved.fromFilename,
      toFilename: moved.toFilename,
      destinationFolder: moved.destinationFolder,
      destinationParentId: moved.destinationParentId,
      note: {
        id: moved.note.id,
        title: moved.note.title,
        filename: moved.note.filename,
        type: moved.note.type,
        source: moved.note.source,
        folder: moved.note.folder,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to move note',
    };
  }
}

export function restoreNote(params: z.infer<typeof restoreNoteSchema>) {
  try {
    const target = resolveNoteTarget(params.id, params.filename, params.space);
    if (!target.note) {
      return {
        success: false,
        error: 'Note not found',
      };
    }

    const preview = store.previewRestoreNote(target.identifier, params.destinationFolder);
    const confirmationTarget = `${preview.fromIdentifier}=>${preview.toIdentifier}`;

    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_restore_note',
        target: confirmationTarget,
        action: 'restore_note',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: note ${preview.fromIdentifier} would be restored`,
        fromIdentifier: preview.fromIdentifier,
        toIdentifier: preview.toIdentifier,
        source: preview.source,
        note: {
          id: preview.note.id,
          title: preview.note.title,
          filename: preview.note.filename,
          type: preview.note.type,
          source: preview.note.source,
          folder: preview.note.folder,
          spaceId: preview.note.spaceId,
        },
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'noteplan_restore_note',
      target: confirmationTarget,
      action: 'restore_note',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_restore_note', confirmation.reason),
      };
    }

    const restored = store.restoreNote(target.identifier, params.destinationFolder);
    return {
      success: true,
      message:
        restored.source === 'space'
          ? 'TeamSpace note restored'
          : `Local note restored to ${restored.toIdentifier}`,
      fromIdentifier: restored.fromIdentifier,
      toIdentifier: restored.toIdentifier,
      source: restored.source,
      note: {
        id: restored.note.id,
        title: restored.note.title,
        filename: restored.note.filename,
        type: restored.note.type,
        source: restored.note.source,
        folder: restored.note.folder,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to restore note',
    };
  }
}

export function renameNoteFile(params: z.infer<typeof renameNoteFileSchema>) {
  try {
    // Resolve the note to determine if it's local or space
    const target = resolveNoteTarget(params.id, params.filename, params.space);
    if (!target.note) {
      return { success: false, error: 'Note not found' };
    }

    const note = target.note;

    // Space note: rename title
    if (note.source === 'space') {
      if (!params.newTitle) {
        return {
          success: false,
          error: 'newTitle is required for TeamSpace notes (use newFilename for local notes)',
        };
      }
      const writeId = note.id || note.filename;
      const confirmationTarget = `${note.title}=>${params.newTitle}`;

      if (params.dryRun === true) {
        const token = issueConfirmationToken({
          tool: 'noteplan_rename_note_file',
          target: confirmationTarget,
          action: 'rename_note_file',
        });
        return {
          success: true,
          dryRun: true,
          message: `Dry run: TeamSpace note would be renamed from "${note.title}" to "${params.newTitle}"`,
          fromTitle: note.title,
          toTitle: params.newTitle,
          note: {
            id: note.id,
            title: note.title,
            filename: note.filename,
            type: note.type,
            source: note.source,
            folder: note.folder,
            spaceId: note.spaceId,
          },
          ...token,
        };
      }

      const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
        tool: 'noteplan_rename_note_file',
        target: confirmationTarget,
        action: 'rename_note_file',
      });
      if (!confirmation.ok) {
        return {
          success: false,
          error: confirmationFailureMessage('noteplan_rename_note_file', confirmation.reason),
        };
      }

      const renamed = store.renameSpaceNote(writeId, params.newTitle);
      return {
        success: true,
        message: `TeamSpace note renamed from "${renamed.fromTitle}" to "${renamed.toTitle}"`,
        fromTitle: renamed.fromTitle,
        toTitle: renamed.toTitle,
        note: {
          id: renamed.note.id,
          title: renamed.note.title,
          filename: renamed.note.filename,
          type: renamed.note.type,
          source: renamed.note.source,
          folder: renamed.note.folder,
          spaceId: renamed.note.spaceId,
        },
      };
    }

    // Local note: rename file
    if (!params.newFilename) {
      return {
        success: false,
        error: 'newFilename is required for local notes (use newTitle for TeamSpace notes)',
      };
    }

    const keepExtension = params.keepExtension ?? true;
    const preview = store.previewRenameNoteFile(note.filename, params.newFilename, keepExtension);
    const confirmationTarget = `${preview.fromFilename}=>${preview.toFilename}`;

    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_rename_note_file',
        target: confirmationTarget,
        action: 'rename_note_file',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: note ${preview.fromFilename} would rename to ${preview.toFilename}`,
        fromFilename: preview.fromFilename,
        toFilename: preview.toFilename,
        note: {
          id: preview.note.id,
          title: preview.note.title,
          filename: preview.note.filename,
          type: preview.note.type,
          source: preview.note.source,
          folder: preview.note.folder,
          spaceId: preview.note.spaceId,
        },
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'noteplan_rename_note_file',
      target: confirmationTarget,
      action: 'rename_note_file',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_rename_note_file', confirmation.reason),
      };
    }

    const renamed = store.renameNoteFile(note.filename, params.newFilename, keepExtension);
    return {
      success: true,
      message: `Note renamed to ${renamed.toFilename}`,
      fromFilename: renamed.fromFilename,
      toFilename: renamed.toFilename,
      note: {
        id: renamed.note.id,
        title: renamed.note.title,
        filename: renamed.note.filename,
        type: renamed.note.type,
        source: renamed.note.source,
        folder: renamed.note.folder,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to rename note',
    };
  }
}

// Get note with line numbers
export const getParagraphsSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  space: z.string().optional().describe('Space name or ID to search in'),
  startLine: z.number().min(1).optional().describe('First line to include (1-indexed, inclusive)'),
  endLine: z.number().min(1).optional().describe('Last line to include (1-indexed, inclusive)'),
  limit: z.number().min(1).max(1000).optional().default(200).describe('Maximum lines to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset within selected range'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const searchParagraphsSchema = z.object({
  id: z.string().optional().describe('Note ID (preferred for space notes)'),
  title: z.string().optional().describe('Note title to search for'),
  filename: z.string().optional().describe('Direct filename/path to the note'),
  date: z.string().optional().describe('Date for calendar notes (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)'),
  space: z.string().optional().describe('Space name or ID to search in'),
  query: z.string().describe('Text to find in note lines/paragraphs'),
  caseSensitive: z.boolean().optional().default(false).describe('Case-sensitive match (default: false)'),
  wholeWord: z.boolean().optional().default(false).describe('Require whole-word matches (default: false)'),
  startLine: z.number().min(1).optional().describe('First line to search (1-indexed, inclusive)'),
  endLine: z.number().min(1).optional().describe('Last line to search (1-indexed, inclusive)'),
  contextLines: z.number().min(0).max(5).optional().default(1).describe('Context lines before/after each match'),
  paragraphMaxChars: z
    .number()
    .min(50)
    .max(5000)
    .optional()
    .default(600)
    .describe('Maximum paragraph text chars per match'),
  limit: z.number().min(1).max(200).optional().default(20).describe('Maximum matches to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
}).superRefine((input, ctx) => {
  if (!input.id && !input.title && !input.filename && !input.date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one note reference: id, title, filename, or date',
      path: ['id'],
    });
  }
});

export function getParagraphs(params: z.infer<typeof getParagraphsSchema>) {
  const note = store.getNote({ filename: params.filename, space: params.space });

  if (!note) {
    return {
      success: false,
      error: 'Note not found',
    };
  }

  const allLines = note.content.split('\n');
  const lineWindow = buildLineWindow(allLines, {
    startLine: params.startLine,
    endLine: params.endLine,
    limit: params.limit,
    offset: params.offset,
    cursor: params.cursor,
    defaultLimit: 200,
    maxLimit: 1000,
  });

  const result: Record<string, unknown> = {
    success: true,
    note: {
      title: note.title,
      filename: note.filename,
    },
    lineCount: lineWindow.lineCount,
    rangeStartLine: lineWindow.rangeStartLine,
    rangeEndLine: lineWindow.rangeEndLine,
    rangeLineCount: lineWindow.rangeLineCount,
    returnedLineCount: lineWindow.returnedLineCount,
    offset: lineWindow.offset,
    limit: lineWindow.limit,
    hasMore: lineWindow.hasMore,
    nextCursor: lineWindow.nextCursor,
    content: lineWindow.content,
    lines: lineWindow.lines.map((lineObj) => {
      const meta = parseParagraphLine(lineObj.content, lineObj.lineIndex, lineObj.lineIndex === 0);
      return {
        ...lineObj,
        type: meta.type,
        indentLevel: meta.indentLevel,
        ...(meta.headingLevel !== undefined && { headingLevel: meta.headingLevel }),
        ...(meta.taskStatus !== undefined && { taskStatus: meta.taskStatus }),
        ...(meta.priority !== undefined && { priority: meta.priority }),
        ...(meta.marker !== undefined && { marker: meta.marker }),
        ...(meta.hasCheckbox !== undefined && { hasCheckbox: meta.hasCheckbox }),
        ...(meta.tags.length > 0 && { tags: meta.tags }),
        ...(meta.mentions.length > 0 && { mentions: meta.mentions }),
        ...(meta.scheduledDate !== undefined && { scheduledDate: meta.scheduledDate }),
      };
    }),
  };

  if (lineWindow.hasMore) {
    result.performanceHints = [NEXT_CURSOR_HINT];
  } else if (
    lineWindow.lineCount > 500 &&
    !params.startLine &&
    !params.endLine &&
    !params.cursor &&
    !params.offset
  ) {
    result.performanceHints = [PROGRESSIVE_READ_HINT];
  }

  return result;
}

export function searchParagraphs(params: z.infer<typeof searchParagraphsSchema>) {
  const query = typeof params?.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }
  if (!params.id && !params.title && !params.filename && !params.date) {
    return {
      success: false,
      error: 'Provide one note reference: id, title, filename, or date',
    };
  }

  const note = store.getNote({
    id: params.id,
    title: params.title,
    filename: params.filename,
    date: params.date,
    space: params.space,
  });

  if (!note) {
    return {
      success: false,
      error: 'Note not found',
    };
  }

  const allLines = note.content.split('\n');
  const lineWindow = buildLineWindow(allLines, {
    startLine: params.startLine,
    endLine: params.endLine,
    defaultLimit: allLines.length,
    maxLimit: allLines.length,
  });
  const caseSensitive = params.caseSensitive ?? false;
  const wholeWord = params.wholeWord ?? false;
  const contextLines = toBoundedInt(params.contextLines, 1, 0, 5);
  const paragraphMaxChars = toBoundedInt(params.paragraphMaxChars, 600, 50, 5000);
  const normalizedQuery = caseSensitive ? query : query.toLowerCase();
  const matcher = wholeWord
    ? new RegExp(`\\b${escapeRegExp(query)}\\b`, caseSensitive ? '' : 'i')
    : null;

  const allMatches = lineWindow.lines
    .map((line) => {
      const haystack = caseSensitive ? line.content : line.content.toLowerCase();
      const isMatch = matcher ? matcher.test(line.content) : haystack.includes(normalizedQuery);
      if (!isMatch) return null;

      const paragraphBounds = findParagraphBounds(allLines, line.lineIndex);
      const paragraphRaw = allLines
        .slice(paragraphBounds.startIndex, paragraphBounds.endIndex + 1)
        .join('\n');
      const paragraphTruncated = paragraphRaw.length > paragraphMaxChars;
      const paragraph = paragraphTruncated
        ? `${paragraphRaw.slice(0, Math.max(0, paragraphMaxChars - 3))}...`
        : paragraphRaw;
      const contextStart = Math.max(0, line.lineIndex - contextLines);
      const contextEnd = Math.min(allLines.length - 1, line.lineIndex + contextLines);

      const meta = parseParagraphLine(line.content, line.lineIndex, line.lineIndex === 0);

      return {
        line: line.line,
        lineIndex: line.lineIndex,
        content: line.content,
        type: meta.type,
        indentLevel: meta.indentLevel,
        ...(meta.headingLevel !== undefined && { headingLevel: meta.headingLevel }),
        ...(meta.taskStatus !== undefined && { taskStatus: meta.taskStatus }),
        ...(meta.priority !== undefined && { priority: meta.priority }),
        ...(meta.marker !== undefined && { marker: meta.marker }),
        ...(meta.hasCheckbox !== undefined && { hasCheckbox: meta.hasCheckbox }),
        ...(meta.tags.length > 0 && { tags: meta.tags }),
        ...(meta.mentions.length > 0 && { mentions: meta.mentions }),
        ...(meta.scheduledDate !== undefined && { scheduledDate: meta.scheduledDate }),
        paragraphStartLine: paragraphBounds.startIndex + 1,
        paragraphEndLine: paragraphBounds.endIndex + 1,
        paragraph,
        paragraphTruncated,
        contextBefore: allLines.slice(contextStart, line.lineIndex),
        contextAfter: allLines.slice(line.lineIndex + 1, contextEnd + 1),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const offset = toBoundedInt(params.cursor ?? params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(params.limit, 20, 1, 200);
  const page = allMatches.slice(offset, offset + limit);
  const hasMore = offset + page.length < allMatches.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  const result: Record<string, unknown> = {
    success: true,
    query,
    count: page.length,
    totalCount: allMatches.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    rangeStartLine: lineWindow.rangeStartLine,
    rangeEndLine: lineWindow.rangeEndLine,
    searchedLineCount: lineWindow.rangeLineCount,
    note: {
      id: note.id,
      title: note.title,
      filename: note.filename,
      type: note.type,
      source: note.source,
      folder: note.folder,
      spaceId: note.spaceId,
      date: note.date,
    },
    matches: page,
  };

  if (hasMore) {
    result.performanceHints = [NEXT_CURSOR_HINT];
  } else if (allMatches.length === 0) {
    result.performanceHints = [
      'Try caseSensitive=false, wholeWord=false, or broaden startLine/endLine range.',
    ];
  }

  return result;
}

// Granular note operation schemas
export const setPropertySchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  space: z.string().optional().describe('Space name or ID to search in'),
  key: z.string().describe('Property key (e.g., "icon", "bg-color", "status")'),
  value: z.string().describe('Property value'),
});

export const removePropertySchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  space: z.string().optional().describe('Space name or ID to search in'),
  key: z.string().describe('Property key to remove'),
});

export const insertContentSchema = z.object({
  id: z.string().optional().describe('Note ID (preferred for space notes)'),
  filename: z.string().optional().describe('Filename/path of the note'),
  title: z.string().optional().describe('Note title to target (resolved if unique)'),
  date: z.string().optional().describe('Calendar note date target (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)'),
  query: z.string().optional().describe('Resolvable note query (fuzzy note lookup before insert)'),
  space: z.string().optional().describe('Space name or ID scope for title/date/query resolution'),
  content: z.string().describe('Content to insert'),
  position: z
    .enum(['start', 'end', 'after-heading', 'at-line', 'in-section'])
    .describe('Where to insert: start (after frontmatter), end, after-heading (right after heading/marker line), in-section (at end of section, before next heading/marker), or at-line'),
  heading: z
    .string()
    .optional()
    .describe('Heading or section marker text (required for after-heading and in-section; matches both ## headings and **bold:** section markers)'),
  line: z.number().optional().describe('Line number (1-indexed, required for at-line position)'),
  indentationStyle: z
    .enum(['tabs', 'preserve'])
    .optional()
    .default('tabs')
    .describe('Indentation normalization for inserted list/task lines. Default: tabs'),
  type: z
    .enum(['title', 'heading', 'task', 'checklist', 'bullet', 'quote', 'separator', 'empty', 'text'])
    .optional()
    .describe('Paragraph type — when set, content is auto-formatted with correct markdown markers'),
  taskStatus: z
    .enum(['open', 'done', 'cancelled', 'scheduled'])
    .optional()
    .describe('Task/checklist status (default: open). Only used when type is task or checklist'),
  headingLevel: z
    .number()
    .min(1)
    .max(6)
    .optional()
    .describe('Heading level 1-6 (only used when type is heading or title)'),
  priority: z
    .number()
    .min(1)
    .max(3)
    .optional()
    .describe('Priority 1-3 (! / !! / !!!) appended to task/checklist lines'),
  indentLevel: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe('Tab indentation level for task/checklist/bullet lines'),
}).superRefine((input, ctx) => {
  if (!input.id && !input.filename && !input.title && !input.date && !input.query) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one note reference: id, filename, title, date, or query',
      path: ['filename'],
    });
  }
});

export const appendContentSchema = z.object({
  id: z.string().optional().describe('Note ID (preferred for space notes)'),
  filename: z.string().optional().describe('Filename/path of the note'),
  title: z.string().optional().describe('Note title to target (resolved if unique)'),
  date: z.string().optional().describe('Calendar note date target (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)'),
  query: z.string().optional().describe('Resolvable note query (fuzzy note lookup before append)'),
  space: z.string().optional().describe('Space name or ID scope for title/date/query resolution'),
  content: z.string().describe('Content to append'),
  indentationStyle: z
    .enum(['tabs', 'preserve'])
    .optional()
    .default('tabs')
    .describe('Indentation normalization for appended list/task lines. Default: tabs'),
}).superRefine((input, ctx) => {
  if (!input.id && !input.filename && !input.title && !input.date && !input.query) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one note reference: id, filename, title, date, or query',
      path: ['filename'],
    });
  }
});

const noteReferenceSchema = {
  id: z.string().optional().describe('Note ID (preferred for space notes)'),
  filename: z.string().optional().describe('Filename/path of the note'),
  title: z.string().optional().describe('Note title'),
  date: z.string().optional().describe('Calendar note date (auto-creates if missing)'),
  query: z.string().optional().describe('Fuzzy note query'),
  space: z.string().optional().describe('Space name or ID scope'),
};

export const deleteLinesSchema = z.object({
  ...noteReferenceSchema,
  startLine: z.number().describe('First line to delete (1-indexed, inclusive)'),
  endLine: z.number().describe('Last line to delete (1-indexed, inclusive)'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview lines that would be deleted without modifying the note (default: false)'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for delete execution'),
});

export const editLineSchema = z.object({
  ...noteReferenceSchema,
  line: z.number().describe('Line number to edit (1-indexed)'),
  content: z.string().describe('New content for the line'),
  indentationStyle: z
    .enum(['tabs', 'preserve'])
    .optional()
    .default('tabs')
    .describe('Indentation normalization for edited list/task lines. Default: tabs'),
  allowEmptyContent: z
    .boolean()
    .optional()
    .describe('Allow replacing line content with empty/blank text (default: false)'),
});

export const replaceLinesSchema = z.object({
  ...noteReferenceSchema,
  startLine: z.number().describe('First line to replace (1-indexed, inclusive)'),
  endLine: z.number().describe('Last line to replace (1-indexed, inclusive)'),
  content: z.string().describe('Replacement content for the selected line range'),
  indentationStyle: z
    .enum(['tabs', 'preserve'])
    .optional()
    .default('tabs')
    .describe('Indentation normalization for replacement list/task lines. Default: tabs'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview line replacement and get confirmationToken without modifying the note'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for replace execution'),
  allowEmptyContent: z
    .boolean()
    .optional()
    .describe('Allow replacing selected lines with empty content (default: false). Prefer delete_lines for pure deletion.'),
});

// Granular note operation implementations
export function setProperty(params: z.infer<typeof setPropertySchema>) {
  try {
    const note = store.getNote({ filename: params.filename, space: params.space });
    if (!note) {
      return { success: false, error: 'Note not found' };
    }

    const newContent = frontmatter.setFrontmatterProperty(note.content, params.key, params.value);
    const writeIdentifier = note.source === 'space' ? (note.id || note.filename) : note.filename;
    store.updateNote(writeIdentifier, newContent, { source: note.source });

    return {
      success: true,
      message: `Property "${params.key}" set to "${params.value}"`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set property',
    };
  }
}

export function removeProperty(params: z.infer<typeof removePropertySchema>) {
  try {
    const note = store.getNote({ filename: params.filename, space: params.space });
    if (!note) {
      return { success: false, error: 'Note not found' };
    }

    const newContent = frontmatter.removeFrontmatterProperty(note.content, params.key);
    const writeIdentifier = note.source === 'space' ? (note.id || note.filename) : note.filename;
    store.updateNote(writeIdentifier, newContent, { source: note.source });

    return {
      success: true,
      message: `Property "${params.key}" removed`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove property',
    };
  }
}

export function insertContent(params: z.infer<typeof insertContentSchema>) {
  try {
    const resolved = resolveWritableNoteReference(params);
    if (!resolved.note) {
      return {
        success: false,
        error: resolved.error || 'Note not found',
        candidates: resolved.candidates,
      };
    }
    const note = resolved.note;

    const indentationStyle = normalizeIndentationStyle(
      (params as { indentationStyle?: unknown }).indentationStyle
    );
    let contentToInsert = params.content;
    if (params.type) {
      contentToInsert = contentToInsert
        .split('\n')
        .map((line) =>
          buildParagraphLine(line, params.type as ParagraphType, {
            headingLevel: params.headingLevel,
            taskStatus: (params.taskStatus as ParagraphTaskStatus) ?? undefined,
            indentLevel: params.indentLevel,
            priority: params.priority,
          })
        )
        .join('\n');
    }
    const normalized = normalizeContentIndentation(contentToInsert, indentationStyle);
    const newContent = frontmatter.insertContentAtPosition(note.content, normalized.content, {
      position: params.position,
      heading: params.heading,
      line: params.line,
    });
    const writeTarget = getWritableIdentifier(note);
    store.updateNote(writeTarget.identifier, newContent, {
      source: writeTarget.source,
    });

    return {
      success: true,
      message: `Content inserted at ${params.position}`,
      note: {
        id: note.id,
        title: note.title,
        filename: note.filename,
      },
      indentationStyle,
      linesRetabbed: normalized.linesRetabbed,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to insert content',
    };
  }
}

export function appendContent(params: z.infer<typeof appendContentSchema>) {
  try {
    const resolved = resolveWritableNoteReference(params);
    if (!resolved.note) {
      return {
        success: false,
        error: resolved.error || 'Note not found',
        candidates: resolved.candidates,
      };
    }
    const note = resolved.note;

    const indentationStyle = normalizeIndentationStyle(
      (params as { indentationStyle?: unknown }).indentationStyle
    );
    const normalized = normalizeContentIndentation(params.content, indentationStyle);
    const newContent = frontmatter.insertContentAtPosition(note.content, normalized.content, {
      position: 'end',
    });
    const writeTarget = getWritableIdentifier(note);
    store.updateNote(writeTarget.identifier, newContent, {
      source: writeTarget.source,
    });

    return {
      success: true,
      message: 'Content appended',
      note: {
        id: note.id,
        title: note.title,
        filename: note.filename,
      },
      indentationStyle,
      linesRetabbed: normalized.linesRetabbed,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to append content',
    };
  }
}

export function deleteLines(params: z.infer<typeof deleteLinesSchema>) {
  try {
    const resolved = resolveWritableNoteReference(params);
    if (!resolved.note) {
      return { success: false, error: resolved.error || 'Note not found', candidates: resolved.candidates };
    }
    const note = resolved.note;

    const allLines = note.content.split('\n');
    const boundedStartLine = toBoundedInt(params.startLine, 1, 1, Math.max(1, allLines.length));
    const boundedEndLine = toBoundedInt(
      params.endLine,
      boundedStartLine,
      boundedStartLine,
      Math.max(boundedStartLine, allLines.length)
    );
    const lineCountToDelete = boundedEndLine - boundedStartLine + 1;
    const previewStartIndex = boundedStartLine - 1;
    const previewEndIndexExclusive = boundedEndLine;
    const deletedLinesPreview = allLines
      .slice(previewStartIndex, previewEndIndexExclusive)
      .slice(0, 20)
      .map((content, index) => ({
        line: boundedStartLine + index,
        content,
      }));
    const deletedText = allLines.slice(previewStartIndex, previewEndIndexExclusive).join('\n');
    const removedAttachmentReferences = extractAttachmentReferences(deletedText);
    const attachmentWarning =
      removedAttachmentReferences.length > 0
        ? buildAttachmentWarningMessage(removedAttachmentReferences.length)
        : undefined;

    const confirmTarget = `${note.filename}:${boundedStartLine}-${boundedEndLine}`;
    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_delete_lines',
        target: confirmTarget,
        action: 'delete_lines',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: lines ${boundedStartLine}-${boundedEndLine} would be deleted`,
        lineCountToDelete,
        deletedLinesPreview,
        previewTruncated: lineCountToDelete > deletedLinesPreview.length,
        removedAttachmentReferences: removedAttachmentReferences.slice(0, 20),
        removedAttachmentReferencesTruncated: removedAttachmentReferences.length > 20,
        warnings: attachmentWarning ? [attachmentWarning] : undefined,
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'noteplan_delete_lines',
      target: confirmTarget,
      action: 'delete_lines',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_delete_lines', confirmation.reason),
      };
    }

    const newContent = frontmatter.deleteLines(note.content, boundedStartLine, boundedEndLine);
    const writeIdentifier = note.source === 'space' ? (note.id || note.filename) : note.filename;
    store.updateNote(writeIdentifier, newContent, { source: note.source });

    return {
      success: true,
      message: `Lines ${boundedStartLine}-${boundedEndLine} deleted`,
      lineCountToDelete,
      removedAttachmentReferences: removedAttachmentReferences.slice(0, 20),
      removedAttachmentReferencesTruncated: removedAttachmentReferences.length > 20,
      warnings: attachmentWarning ? [attachmentWarning] : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete lines',
    };
  }
}

export function editLine(params: z.infer<typeof editLineSchema>) {
  try {
    if (params.allowEmptyContent !== true && params.content.trim().length === 0) {
      return {
        success: false,
        error:
          'Empty line content is blocked for noteplan_edit_line. Use noteplan_delete_lines or set allowEmptyContent=true.',
      };
    }

    const resolved = resolveWritableNoteReference(params);
    if (!resolved.note) {
      return { success: false, error: resolved.error || 'Note not found', candidates: resolved.candidates };
    }
    const note = resolved.note;

    const lines = note.content.split('\n');
    const originalLineCount = lines.length;
    const lineIndex = params.line - 1; // Convert to 0-indexed

    if (lineIndex < 0 || lineIndex >= lines.length) {
      return {
        success: false,
        error: `Line ${params.line} does not exist (note has ${lines.length} lines)`,
      };
    }

    const originalLine = lines[lineIndex];
    const indentationStyle = normalizeIndentationStyle(
      (params as { indentationStyle?: unknown }).indentationStyle
    );
    const normalized = normalizeContentIndentation(params.content, indentationStyle);
    const replacementLines = normalized.content.split('\n');
    lines.splice(lineIndex, 1, ...replacementLines);
    const lineDelta = replacementLines.length - 1;
    const updatedLineCount = originalLineCount + lineDelta;
    const newContent = lines.join('\n');
    const removedAttachmentReferences = getRemovedAttachmentReferences(
      originalLine,
      normalized.content
    );
    const warnings: string[] = [];
    if (lineDelta !== 0) {
      warnings.push(
        `Line numbers shifted by ${lineDelta > 0 ? '+' : ''}${lineDelta} after this edit. Re-read line numbers before the next mutation.`
      );
    }
    if (removedAttachmentReferences.length > 0) {
      warnings.push(buildAttachmentWarningMessage(removedAttachmentReferences.length));
    }

    const writeIdentifier = note.source === 'space' ? (note.id || note.filename) : note.filename;
    store.updateNote(writeIdentifier, newContent, { source: note.source });

    return {
      success: true,
      message: `Line ${params.line} updated`,
      originalLine,
      newLine: normalized.content,
      indentationStyle,
      linesRetabbed: normalized.linesRetabbed,
      insertedLineCount: replacementLines.length,
      lineDelta,
      originalLineCount,
      newLineCount: updatedLineCount,
      removedAttachmentReferences: removedAttachmentReferences.slice(0, 20),
      removedAttachmentReferencesTruncated: removedAttachmentReferences.length > 20,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to edit line',
    };
  }
}

export function replaceLines(params: z.infer<typeof replaceLinesSchema>) {
  try {
    const resolved = resolveWritableNoteReference(params);
    if (!resolved.note) {
      return { success: false, error: resolved.error || 'Note not found', candidates: resolved.candidates };
    }
    const note = resolved.note;

    const allLines = note.content.split('\n');
    const originalLineCount = allLines.length;
    const boundedStartLine = toBoundedInt(params.startLine, 1, 1, Math.max(1, originalLineCount));
    const boundedEndLine = toBoundedInt(
      params.endLine,
      boundedStartLine,
      boundedStartLine,
      Math.max(boundedStartLine, originalLineCount)
    );
    const startIndex = boundedStartLine - 1;
    const lineCountToReplace = boundedEndLine - boundedStartLine + 1;
    const replacedText = allLines.slice(startIndex, boundedEndLine).join('\n');
    const indentationStyle = normalizeIndentationStyle(
      (params as { indentationStyle?: unknown }).indentationStyle
    );
    const normalized = normalizeContentIndentation(params.content, indentationStyle);
    if (params.allowEmptyContent !== true && normalized.content.trim().length === 0) {
      return {
        success: false,
        error:
          'Empty replacement content is blocked for noteplan_replace_lines. Use noteplan_delete_lines or set allowEmptyContent=true.',
      };
    }

    const replacementLines = normalized.content.length > 0 ? normalized.content.split('\n') : [];
    const lineDelta = replacementLines.length - lineCountToReplace;
    const newLineCount = originalLineCount + lineDelta;
    const removedAttachmentReferences = getRemovedAttachmentReferences(
      replacedText,
      normalized.content
    );
    const warnings: string[] = [];
    if (removedAttachmentReferences.length > 0) {
      warnings.push(buildAttachmentWarningMessage(removedAttachmentReferences.length));
    }
    if (lineDelta !== 0) {
      warnings.push(
        `Line numbers shifted by ${lineDelta > 0 ? '+' : ''}${lineDelta} after this replacement. Re-read line numbers before the next mutation.`
      );
    }

    const target = `${note.filename}:${boundedStartLine}-${boundedEndLine}:${replacementLines.length}:${normalized.content.length}`;
    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_replace_lines',
        target,
        action: 'replace_lines',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: lines ${boundedStartLine}-${boundedEndLine} would be replaced`,
        lineCountToReplace,
        insertedLineCount: replacementLines.length,
        lineDelta,
        originalLineCount,
        newLineCount,
        indentationStyle,
        linesRetabbed: normalized.linesRetabbed,
        removedAttachmentReferences: removedAttachmentReferences.slice(0, 20),
        removedAttachmentReferencesTruncated: removedAttachmentReferences.length > 20,
        warnings: warnings.length > 0 ? warnings : undefined,
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'noteplan_replace_lines',
      target,
      action: 'replace_lines',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_replace_lines', confirmation.reason),
      };
    }

    allLines.splice(startIndex, lineCountToReplace, ...replacementLines);
    const writeIdentifier = note.source === 'space' ? (note.id || note.filename) : note.filename;
    store.updateNote(writeIdentifier, allLines.join('\n'), { source: note.source });

    return {
      success: true,
      message: `Lines ${boundedStartLine}-${boundedEndLine} replaced`,
      lineCountToReplace,
      insertedLineCount: replacementLines.length,
      lineDelta,
      originalLineCount,
      newLineCount,
      indentationStyle,
      linesRetabbed: normalized.linesRetabbed,
      removedAttachmentReferences: removedAttachmentReferences.slice(0, 20),
      removedAttachmentReferencesTruncated: removedAttachmentReferences.length > 20,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to replace lines',
    };
  }
}
