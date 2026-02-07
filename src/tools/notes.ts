// Note CRUD operations

import { z } from 'zod';
import path from 'path';
import * as store from '../noteplan/unified-store.js';
import * as frontmatter from '../noteplan/frontmatter-parser.js';

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

// Schema definitions
export const getNoteSchema = z.object({
  id: z.string().optional().describe('Note ID (use this for space notes - get it from search results)'),
  title: z.string().optional().describe('Note title to search for'),
  filename: z.string().optional().describe('Direct filename/path to the note (for local notes)'),
  date: z.string().optional().describe('Date for calendar notes (YYYYMMDD, YYYY-MM-DD, today, tomorrow, yesterday)'),
  space: z.string().optional().describe('Space ID to search in'),
});

export const listNotesSchema = z.object({
  folder: z.string().optional().describe('Filter by folder path'),
  space: z.string().optional().describe('Space ID to list from'),
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
  space: z.string().optional().describe('Restrict to a specific space ID'),
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
  space: z.string().optional().describe('Space ID to create in'),
});

export const updateNoteSchema = z.object({
  filename: z.string().describe('Filename/path of the note to update'),
  content: z
    .string()
    .describe('New content for the note. Include YAML frontmatter between --- delimiters at the start if the note has or should have properties'),
  allowEmptyContent: z
    .boolean()
    .optional()
    .describe('Allow replacing note content with empty/blank text (default: false)'),
});

export const deleteNoteSchema = z.object({
  filename: z.string().describe('Filename/path of the note to delete'),
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

  return {
    success: true,
    note: {
      id: note.id,
      title: note.title,
      filename: note.filename,
      content: note.content,
      type: note.type,
      source: note.source,
      folder: note.folder,
      spaceId: note.spaceId,
      date: note.date,
      modifiedAt: note.modifiedAt?.toISOString(),
    },
  };
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
    const result = store.createNote(params.title, params.content, {
      folder: params.folder,
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
    if (params.allowEmptyContent !== true && params.content.trim().length === 0) {
      return {
        success: false,
        error:
          'Empty content is blocked for noteplan_update_note. Use allowEmptyContent=true to override intentionally.',
      };
    }

    const note = store.updateNote(params.filename, params.content);

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
    store.deleteNote(params.filename);

    return {
      success: true,
      message: `Note ${params.filename} deleted`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete note',
    };
  }
}

// Get note with line numbers
export const getParagraphsSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  startLine: z.number().min(1).optional().describe('First line to include (1-indexed, inclusive)'),
  endLine: z.number().min(1).optional().describe('Last line to include (1-indexed, inclusive)'),
  limit: z.number().min(1).max(1000).optional().default(200).describe('Maximum lines to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset within selected range'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export function getParagraphs(params: z.infer<typeof getParagraphsSchema>) {
  const note = store.getNote({ filename: params.filename });

  if (!note) {
    return {
      success: false,
      error: 'Note not found',
    };
  }

  const lines = note.content.split('\n');
  const totalLineCount = lines.length;
  const requestedStartLine = toBoundedInt(params.startLine, 1, 1, Math.max(1, totalLineCount));
  const requestedEndLine = toBoundedInt(
    params.endLine,
    totalLineCount,
    requestedStartLine,
    Math.max(requestedStartLine, totalLineCount)
  );
  const rangeStartIndex = requestedStartLine - 1;
  const rangeEndIndexExclusive = requestedEndLine;
  const rangeLines = lines.slice(rangeStartIndex, rangeEndIndexExclusive);
  const offset = toBoundedInt(params.cursor ?? params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(params.limit, 200, 1, 1000);
  const page = rangeLines.slice(offset, offset + limit);
  const hasMore = offset + page.length < rangeLines.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  const result: Record<string, unknown> = {
    success: true,
    note: {
      title: note.title,
      filename: note.filename,
    },
    lineCount: totalLineCount,
    rangeStartLine: requestedStartLine,
    rangeEndLine: requestedEndLine,
    rangeLineCount: rangeLines.length,
    returnedLineCount: page.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    lines: page.map((content, index) => ({
      line: requestedStartLine + offset + index, // 1-indexed for user clarity
      lineIndex: rangeStartIndex + offset + index, // 0-indexed for API calls
      content,
    })),
  };

  if (totalLineCount > 500 && !params.startLine && !params.endLine && !params.cursor && !params.offset) {
    result.performanceHints = [
      'Use startLine/endLine or pagination cursor to fetch note content progressively.',
    ];
  }

  return result;
}

// Granular note operation schemas
export const setPropertySchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  key: z.string().describe('Property key (e.g., "icon", "bg-color", "status")'),
  value: z.string().describe('Property value'),
});

export const removePropertySchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  key: z.string().describe('Property key to remove'),
});

export const insertContentSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  content: z.string().describe('Content to insert'),
  position: z
    .enum(['start', 'end', 'after-heading', 'at-line'])
    .describe('Where to insert: start (after frontmatter), end, after-heading, or at-line'),
  heading: z.string().optional().describe('Heading name (required for after-heading position)'),
  line: z.number().optional().describe('Line number (1-indexed, required for at-line position)'),
});

export const appendContentSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  content: z.string().describe('Content to append'),
});

export const deleteLinesSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  startLine: z.number().describe('First line to delete (1-indexed, inclusive)'),
  endLine: z.number().describe('Last line to delete (1-indexed, inclusive)'),
});

export const editLineSchema = z.object({
  filename: z.string().describe('Filename/path of the note'),
  line: z.number().describe('Line number to edit (1-indexed)'),
  content: z.string().describe('New content for the line'),
  allowEmptyContent: z
    .boolean()
    .optional()
    .describe('Allow replacing line content with empty/blank text (default: false)'),
});

// Granular note operation implementations
export function setProperty(params: z.infer<typeof setPropertySchema>) {
  try {
    const note = store.getNote({ filename: params.filename });
    if (!note) {
      return { success: false, error: 'Note not found' };
    }

    const newContent = frontmatter.setFrontmatterProperty(note.content, params.key, params.value);
    store.updateNote(params.filename, newContent);

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
    const note = store.getNote({ filename: params.filename });
    if (!note) {
      return { success: false, error: 'Note not found' };
    }

    const newContent = frontmatter.removeFrontmatterProperty(note.content, params.key);
    store.updateNote(params.filename, newContent);

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
    const note = store.getNote({ filename: params.filename });
    if (!note) {
      return { success: false, error: 'Note not found' };
    }

    const newContent = frontmatter.insertContentAtPosition(note.content, params.content, {
      position: params.position,
      heading: params.heading,
      line: params.line,
    });
    store.updateNote(params.filename, newContent);

    return {
      success: true,
      message: `Content inserted at ${params.position}`,
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
    const note = store.getNote({ filename: params.filename });
    if (!note) {
      return { success: false, error: 'Note not found' };
    }

    const newContent = frontmatter.insertContentAtPosition(note.content, params.content, {
      position: 'end',
    });
    store.updateNote(params.filename, newContent);

    return {
      success: true,
      message: 'Content appended',
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
    const note = store.getNote({ filename: params.filename });
    if (!note) {
      return { success: false, error: 'Note not found' };
    }

    const newContent = frontmatter.deleteLines(note.content, params.startLine, params.endLine);
    store.updateNote(params.filename, newContent);

    return {
      success: true,
      message: `Lines ${params.startLine}-${params.endLine} deleted`,
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

    const note = store.getNote({ filename: params.filename });
    if (!note) {
      return { success: false, error: 'Note not found' };
    }

    const lines = note.content.split('\n');
    const lineIndex = params.line - 1; // Convert to 0-indexed

    if (lineIndex < 0 || lineIndex >= lines.length) {
      return {
        success: false,
        error: `Line ${params.line} does not exist (note has ${lines.length} lines)`,
      };
    }

    const originalLine = lines[lineIndex];
    lines[lineIndex] = params.content;
    const newContent = lines.join('\n');

    store.updateNote(params.filename, newContent);

    return {
      success: true,
      message: `Line ${params.line} updated`,
      originalLine,
      newLine: params.content,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to edit line',
    };
  }
}
