// Note CRUD operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';
import * as frontmatter from '../noteplan/frontmatter-parser.js';

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
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

export const createNoteSchema = z.object({
  title: z.string().describe('Title for the new note'),
  content: z.string().optional().describe('Initial content for the note. Can include YAML frontmatter between --- delimiters for styling (icon, icon-color, bg-color, bg-color-dark, bg-pattern, status, priority, summary, type, domain)'),
  folder: z.string().optional().describe('Folder to create the note in. Supports smart matching (e.g., "projects" matches "10 - Projects")'),
  create_new_folder: z.boolean().optional().describe('Set to true to create a new folder instead of matching existing ones'),
  space: z.string().optional().describe('Space ID to create in'),
});

export const updateNoteSchema = z.object({
  filename: z.string().describe('Filename/path of the note to update'),
  content: z.string().describe('New content for the note. Include YAML frontmatter between --- delimiters at the start if the note has or should have properties'),
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

  return {
    success: true,
    note: {
      title: note.title,
      filename: note.filename,
    },
    lineCount: lines.length,
    lines: lines.map((content, index) => ({
      line: index + 1, // 1-indexed for user clarity
      lineIndex: index, // 0-indexed for API calls
      content,
    })),
  };
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
