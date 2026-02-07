// Unified store that merges local and space notes

import * as path from 'path';
import { Note, NoteType, Folder, Space, SearchResult, SearchMatch } from './types.js';
import * as fileReader from './file-reader.js';
import * as fileWriter from './file-writer.js';
import * as sqliteReader from './sqlite-reader.js';
import * as sqliteWriter from './sqlite-writer.js';
import { getTodayDateString, parseFlexibleDate } from '../utils/date-utils.js';
import { matchFolder, FolderMatchResult } from '../utils/folder-matcher.js';
import { searchWithRipgrep, isRipgrepAvailable, RipgrepMatch } from './ripgrep-search.js';
import { fuzzySearch } from './fuzzy-search.js';
import { parseFlexibleDateFilter, isDateInRange } from '../utils/date-filters.js';

// Cache ripgrep availability check
let ripgrepAvailable: boolean | null = null;

/**
 * Result of folder resolution during note creation
 */
export interface FolderResolution {
  requested: string | undefined;
  resolved: string | undefined;
  matched: boolean;
  ambiguous: boolean;
  score: number;
  alternatives: string[];
}

/**
 * Result of creating a note with folder resolution info
 */
export interface CreateNoteResult {
  note: Note;
  folderResolution: FolderResolution;
}

/**
 * Get a note by various identifiers
 */
export function getNote(options: {
  id?: string;
  title?: string;
  filename?: string;
  date?: string;
  space?: string;
}): Note | null {
  const { id, title, filename, date, space } = options;

  // If ID is specified, get directly (best for space notes)
  if (id) {
    return sqliteReader.getSpaceNote(id);
  }

  // If date is specified, get calendar note
  if (date) {
    const dateStr = parseFlexibleDate(date);
    if (space) {
      return sqliteReader.getSpaceCalendarNote(dateStr, space);
    }
    return fileReader.getCalendarNote(dateStr);
  }

  // If filename is specified, try to get directly
  if (filename) {
    // Check if it's a space filename
    if (filename.includes('%%NotePlanCloud%%')) {
      return sqliteReader.getSpaceNote(filename);
    }
    return fileReader.readNoteFile(filename);
  }

  // If title is specified, search by title
  if (title) {
    if (space) {
      return sqliteReader.getSpaceNoteByTitle(title, space);
    }
    // Try local first
    const localNote = fileReader.getNoteByTitle(title);
    if (localNote) return localNote;

    // Try space
    return sqliteReader.getSpaceNoteByTitle(title);
  }

  return null;
}

/**
 * List all notes, optionally filtered
 */
export function listNotes(options: {
  folder?: string;
  space?: string;
  type?: NoteType;
} = {}): Note[] {
  const { folder, space, type } = options;
  const notes: Note[] = [];

  // Get local notes
  if (!space) {
    if (!type || type === 'note') {
      notes.push(...fileReader.listProjectNotes(folder));
    }
    if (!type || type === 'calendar') {
      notes.push(...fileReader.listCalendarNotes());
    }
  }

  // Get space notes
  if (space || !folder) {
    notes.push(...sqliteReader.listSpaceNotes(space));
  }

  // Sort by modified date (newest first)
  notes.sort((a, b) => {
    const dateA = a.modifiedAt?.getTime() || 0;
    const dateB = b.modifiedAt?.getTime() || 0;
    return dateB - dateA;
  });

  return notes;
}

/**
 * Enhanced search options
 */
export interface SearchOptions {
  types?: NoteType[];
  folder?: string;
  space?: string;
  limit?: number;
  fuzzy?: boolean;
  caseSensitive?: boolean;
  contextLines?: number;
  // Date filters
  modifiedAfter?: string;
  modifiedBefore?: string;
  createdAfter?: string;
  createdBefore?: string;
}

/**
 * Search across all notes with enhanced options
 */
export async function searchNotes(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { types, folder, space, limit = 50, fuzzy = false } = options;
  let results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  // Parse date filters
  const modifiedAfter = options.modifiedAfter
    ? parseFlexibleDateFilter(options.modifiedAfter)
    : null;
  const modifiedBefore = options.modifiedBefore
    ? parseFlexibleDateFilter(options.modifiedBefore)
    : null;
  const createdAfter = options.createdAfter
    ? parseFlexibleDateFilter(options.createdAfter)
    : null;
  const createdBefore = options.createdBefore
    ? parseFlexibleDateFilter(options.createdBefore)
    : null;

  // Check ripgrep availability (cached)
  if (ripgrepAvailable === null) {
    ripgrepAvailable = await isRipgrepAvailable();
    if (!ripgrepAvailable) {
      console.error('Note: ripgrep not found, using fallback search for local notes');
    }
  }

  // Search local notes
  if (!space) {
    if (ripgrepAvailable) {
      try {
        const searchPaths = folder
          ? [path.join(fileReader.getNotesPath(), folder)]
          : undefined;

        const rgMatches = await searchWithRipgrep(query, {
          caseSensitive: options.caseSensitive,
          contextLines: options.contextLines,
          paths: searchPaths,
          maxResults: limit * 2, // Get extra for filtering
        });

        results.push(...convertRipgrepToSearchResults(rgMatches));
      } catch (error) {
        console.error('Ripgrep search failed:', error);
        // Fall back to simple search
        const localNotes = fileReader.searchLocalNotes(query, {
          types,
          folder,
          limit: limit * 2,
        });
        results.push(...localNotes.map((note) => noteToSearchResult(note, lowerQuery)));
      }
    } else {
      // Fallback to original search method
      const localNotes = fileReader.searchLocalNotes(query, {
        types,
        folder,
        limit: limit * 2,
      });
      results.push(...localNotes.map((note) => noteToSearchResult(note, lowerQuery)));
    }
  }

  // Search space notes
  const spaceNotes = sqliteReader.searchSpaceNotesFTS(query, { spaceId: space, limit: limit * 2 });
  for (const note of spaceNotes) {
    results.push({
      note,
      matches: findMatches(note.content, lowerQuery),
      score: 50, // Base score, will be enhanced below
    });
  }

  // Apply date filters
  if (modifiedAfter || modifiedBefore || createdAfter || createdBefore) {
    results = results.filter((r) => {
      const modifiedOk = isDateInRange(r.note.modifiedAt, modifiedAfter, modifiedBefore);
      const createdOk = isDateInRange(r.note.createdAt, createdAfter, createdBefore);

      // If both filter types specified, both must pass; if only one, just that one
      if ((modifiedAfter || modifiedBefore) && (createdAfter || createdBefore)) {
        return modifiedOk && createdOk;
      }
      if (modifiedAfter || modifiedBefore) return modifiedOk;
      if (createdAfter || createdBefore) return createdOk;
      return true;
    });
  }

  // Apply enhanced scoring with recency boost
  results = results.map((r) => ({
    ...r,
    score: calculateEnhancedScore(r, lowerQuery),
  }));

  // Apply fuzzy re-ranking if enabled
  if (fuzzy && results.length > 0) {
    const allNotes = results.map((r) => r.note);
    return fuzzySearch(allNotes, query, limit);
  }

  // Sort by score and limit
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Convert a note to a SearchResult
 */
function noteToSearchResult(note: Note, query: string): SearchResult {
  const matches = findMatches(note.content, query);
  return {
    note,
    matches,
    score: calculateScore(note, matches, query),
  };
}

/**
 * Convert ripgrep matches to SearchResults
 */
function convertRipgrepToSearchResults(matches: RipgrepMatch[]): SearchResult[] {
  // Group matches by file
  const byFile = new Map<string, RipgrepMatch[]>();
  for (const m of matches) {
    const existing = byFile.get(m.file) || [];
    existing.push(m);
    byFile.set(m.file, existing);
  }

  const results: SearchResult[] = [];
  for (const [file, fileMatches] of byFile) {
    const note = fileReader.readNoteFile(file);
    if (note) {
      results.push({
        note,
        matches: fileMatches.map((m) => ({
          lineNumber: m.line,
          lineContent: m.content,
          matchStart: m.matchStart,
          matchEnd: m.matchEnd,
        })),
        score: fileMatches.length * 10, // Score by match count
      });
    }
  }
  return results;
}

/**
 * Enhanced scoring with recency boost
 */
function calculateEnhancedScore(result: SearchResult, query: string): number {
  let score = result.matches.length; // Base: match count

  const note = result.note;

  // Title match bonuses
  const lowerTitle = note.title.toLowerCase();
  if (lowerTitle === query) {
    score += 30; // Exact title match
  } else if (lowerTitle.includes(query)) {
    score += 15; // Partial title match
  }

  // Recency bonus (modified date) - significant boost for recent notes
  if (note.modifiedAt) {
    const daysSinceModified = (Date.now() - note.modifiedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceModified < 1) {
      score += 20; // Today
    } else if (daysSinceModified < 7) {
      score += 15; // This week
    } else if (daysSinceModified < 30) {
      score += 8; // This month
    } else if (daysSinceModified < 90) {
      score += 3; // Last 3 months
    }
    // Older notes get no boost
  }

  // Creation date bonus (smaller, for "newer" content)
  if (note.createdAt) {
    const daysSinceCreated = (Date.now() - note.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreated < 7) {
      score += 5; // Recently created
    } else if (daysSinceCreated < 30) {
      score += 2;
    }
  }

  // Penalty for @Archive and @Trash folders (push to bottom of results)
  if (note.folder) {
    const folderLower = note.folder.toLowerCase();
    if (folderLower.includes('@archive') || folderLower.includes('@trash')) {
      score -= 50; // Significant penalty to push these to the bottom
    }
  }

  // Also check note type for trash
  if (note.type === 'trash') {
    score -= 50;
  }

  return score;
}

/**
 * Find matches in content
 */
function findMatches(content: string, query: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lines = content.split('\n');
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    let index = lowerLine.indexOf(lowerQuery);

    while (index !== -1) {
      matches.push({
        lineNumber: i + 1,
        lineContent: line,
        matchStart: index,
        matchEnd: index + query.length,
      });
      index = lowerLine.indexOf(lowerQuery, index + 1);
    }
  }

  return matches;
}

/**
 * Calculate relevance score
 */
function calculateScore(note: Note, matches: SearchMatch[], query: string): number {
  let score = matches.length;

  // Boost for title match
  if (note.title.toLowerCase().includes(query)) {
    score += 10;
  }

  // Boost for exact title match
  if (note.title.toLowerCase() === query) {
    score += 20;
  }

  // Boost for recent notes
  if (note.modifiedAt) {
    const daysSinceModified = (Date.now() - note.modifiedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceModified < 7) score += 5;
    else if (daysSinceModified < 30) score += 2;
  }

  return score;
}

/**
 * Create a new note with smart folder matching
 */
export function createNote(
  title: string,
  content?: string,
  options: {
    folder?: string;
    space?: string;
    createNewFolder?: boolean;
  } = {}
): CreateNoteResult {
  const { folder, space, createNewFolder = false } = options;

  // Initialize folder resolution info
  const folderResolution: FolderResolution = {
    requested: folder,
    resolved: folder,
    matched: false,
    ambiguous: false,
    score: 0,
    alternatives: [],
  };

  if (space) {
    const filename = sqliteWriter.createSpaceNote(space, title, content || `# ${title}\n\n`);
    const note = sqliteReader.getSpaceNote(filename);
    if (!note) throw new Error('Failed to create space note');
    return { note, folderResolution };
  }

  // Smart folder matching for local notes
  let resolvedFolder = folder;

  if (folder && !createNewFolder) {
    const folders = fileReader.listFolders();
    const match = matchFolder(folder, folders);

    if (match.matched && match.folder) {
      resolvedFolder = match.folder.path;
      folderResolution.resolved = match.folder.path;
      folderResolution.matched = true;
      folderResolution.ambiguous = match.ambiguous;
      folderResolution.score = match.score;
      folderResolution.alternatives = match.alternatives.map((f) => f.path);
    }
  }

  const filename = fileWriter.createProjectNote(title, content, resolvedFolder);
  const note = fileReader.readNoteFile(filename);
  if (!note) throw new Error('Failed to create note');
  return { note, folderResolution };
}

/**
 * Update a note's content
 */
export function updateNote(filename: string, content: string): Note {
  if (filename.includes('%%NotePlanCloud%%')) {
    sqliteWriter.updateSpaceNote(filename, content);
    const note = sqliteReader.getSpaceNote(filename);
    if (!note) throw new Error('Note not found after update');
    return note;
  }

  fileWriter.updateNote(filename, content);
  const note = fileReader.readNoteFile(filename);
  if (!note) throw new Error('Note not found after update');
  return note;
}

/**
 * Delete a note
 */
export function deleteNote(filename: string): void {
  if (filename.includes('%%NotePlanCloud%%')) {
    sqliteWriter.deleteSpaceNote(filename);
  } else {
    fileWriter.deleteNote(filename);
  }
}

/**
 * Get today's daily note
 */
export function getTodayNote(space?: string): Note | null {
  const dateStr = getTodayDateString();
  return getCalendarNote(dateStr, space);
}

/**
 * Get a calendar note by date
 */
export function getCalendarNote(date: string, space?: string): Note | null {
  const dateStr = parseFlexibleDate(date);

  if (space) {
    return sqliteReader.getSpaceCalendarNote(dateStr, space);
  }

  return fileReader.getCalendarNote(dateStr);
}

/**
 * Ensure a calendar note exists, create if not
 */
export function ensureCalendarNote(date: string, space?: string): Note {
  const dateStr = parseFlexibleDate(date);

  if (space) {
    let note = sqliteReader.getSpaceCalendarNote(dateStr, space);
    if (!note) {
      sqliteWriter.createSpaceCalendarNote(space, dateStr, '');
      note = sqliteReader.getSpaceCalendarNote(dateStr, space);
    }
    if (!note) throw new Error('Failed to create space calendar note');
    return note;
  }

  const filename = fileWriter.ensureCalendarNote(dateStr);
  const note = fileReader.readNoteFile(filename);
  if (!note) throw new Error('Failed to create calendar note');
  return note;
}

/**
 * Add content to today's note
 */
export function addToToday(
  content: string,
  position: 'start' | 'end' = 'end',
  space?: string
): Note {
  const note = ensureCalendarNote('today', space);

  let newContent: string;
  if (position === 'start') {
    const lines = note.content.split('\n');
    // Find end of frontmatter if present
    let insertIndex = 0;
    if (lines[0]?.trim() === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === '---') {
          insertIndex = i + 1;
          break;
        }
      }
    }
    lines.splice(insertIndex, 0, content);
    newContent = lines.join('\n');
  } else {
    newContent = note.content + (note.content.endsWith('\n') ? '' : '\n') + content;
  }

  return updateNote(note.filename, newContent);
}

/**
 * List all spaces
 */
export function listSpaces(): Space[] {
  return sqliteReader.listSpaces();
}

// Keep old name for backwards compatibility
export const listTeamspaces = listSpaces;

export interface ListFoldersOptions {
  space?: string;
  includeLocal?: boolean;
  includeSpaces?: boolean;
  query?: string;
  maxDepth?: number;
}

/**
 * List folders with optional source/depth/query filtering
 */
export function listFolders(options: ListFoldersOptions = {}): Folder[] {
  const {
    space,
    includeLocal = !options.space,
    includeSpaces = Boolean(options.space),
    query,
    maxDepth,
  } = options;
  const folders: Folder[] = [];

  if (includeLocal) {
    folders.push(...fileReader.listFolders(maxDepth));
  }

  if (includeSpaces) {
    folders.push(...sqliteReader.listSpaceFolders(space));
  }

  const deduped = folders.filter((folder, index, arr) => {
    const key = `${folder.source}:${folder.spaceId || ''}:${folder.path}`;
    return arr.findIndex((candidate) =>
      `${candidate.source}:${candidate.spaceId || ''}:${candidate.path}` === key
    ) === index;
  });

  const normalizedQuery = query?.trim().toLowerCase();
  const filtered = normalizedQuery
    ? deduped.filter((folder) => {
        const path = folder.path.toLowerCase();
        const name = folder.name.toLowerCase();
        return path.includes(normalizedQuery) || name.includes(normalizedQuery);
      })
    : deduped;

  filtered.sort((a, b) => a.path.localeCompare(b.path));
  return filtered;
}

/**
 * List all tags
 */
export function listTags(space?: string): string[] {
  const tags = new Set<string>();

  if (!space) {
    fileReader.extractAllTags().forEach((tag) => tags.add(tag));
  }

  sqliteReader.extractSpaceTags(space).forEach((tag) => tags.add(tag));

  return Array.from(tags).sort();
}
