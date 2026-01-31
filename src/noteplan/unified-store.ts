// Unified store that merges local and teamspace notes

import { Note, NoteType, Folder, Teamspace, SearchResult, SearchMatch } from './types.js';
import * as fileReader from './file-reader.js';
import * as fileWriter from './file-writer.js';
import * as sqliteReader from './sqlite-reader.js';
import * as sqliteWriter from './sqlite-writer.js';
import { getTodayDateString, parseFlexibleDate } from '../utils/date-utils.js';
import { matchFolder, FolderMatchResult } from '../utils/folder-matcher.js';

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
  title?: string;
  filename?: string;
  date?: string;
  teamspace?: string;
}): Note | null {
  const { title, filename, date, teamspace } = options;

  // If date is specified, get calendar note
  if (date) {
    const dateStr = parseFlexibleDate(date);
    if (teamspace) {
      return sqliteReader.getTeamspaceCalendarNote(dateStr, teamspace);
    }
    return fileReader.getCalendarNote(dateStr);
  }

  // If filename is specified, try to get directly
  if (filename) {
    // Check if it's a teamspace filename
    if (filename.includes('%%NotePlanCloud%%')) {
      return sqliteReader.getTeamspaceNote(filename);
    }
    return fileReader.readNoteFile(filename);
  }

  // If title is specified, search by title
  if (title) {
    if (teamspace) {
      return sqliteReader.getTeamspaceNoteByTitle(title, teamspace);
    }
    // Try local first
    const localNote = fileReader.getNoteByTitle(title);
    if (localNote) return localNote;

    // Try teamspace
    return sqliteReader.getTeamspaceNoteByTitle(title);
  }

  return null;
}

/**
 * List all notes, optionally filtered
 */
export function listNotes(options: {
  folder?: string;
  teamspace?: string;
  type?: NoteType;
} = {}): Note[] {
  const { folder, teamspace, type } = options;
  const notes: Note[] = [];

  // Get local notes
  if (!teamspace) {
    if (!type || type === 'note') {
      notes.push(...fileReader.listProjectNotes(folder));
    }
    if (!type || type === 'calendar') {
      notes.push(...fileReader.listCalendarNotes());
    }
  }

  // Get teamspace notes
  if (teamspace || !folder) {
    notes.push(...sqliteReader.listTeamspaceNotes(teamspace));
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
 * Search across all notes
 */
export function searchNotes(
  query: string,
  options: {
    types?: NoteType[];
    folder?: string;
    teamspace?: string;
    limit?: number;
  } = {}
): SearchResult[] {
  const { types, folder, teamspace, limit = 50 } = options;
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  // Search local notes
  if (!teamspace) {
    const localNotes = fileReader.searchLocalNotes(query, { types, folder, limit });
    for (const note of localNotes) {
      const matches = findMatches(note.content, lowerQuery);
      results.push({
        note,
        matches,
        score: calculateScore(note, matches, lowerQuery),
      });
    }
  }

  // Search teamspace notes
  const teamspaceNotes = sqliteReader.searchTeamspaceNotes(query, {
    teamspaceId: teamspace,
    limit,
  });
  for (const note of teamspaceNotes) {
    const matches = findMatches(note.content, lowerQuery);
    results.push({
      note,
      matches,
      score: calculateScore(note, matches, lowerQuery),
    });
  }

  // Sort by score and limit
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
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
    teamspace?: string;
    createNewFolder?: boolean;
  } = {}
): CreateNoteResult {
  const { folder, teamspace, createNewFolder = false } = options;

  // Initialize folder resolution info
  const folderResolution: FolderResolution = {
    requested: folder,
    resolved: folder,
    matched: false,
    ambiguous: false,
    score: 0,
    alternatives: [],
  };

  if (teamspace) {
    const filename = sqliteWriter.createTeamspaceNote(teamspace, title, content || `# ${title}\n\n`);
    const note = sqliteReader.getTeamspaceNote(filename);
    if (!note) throw new Error('Failed to create teamspace note');
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
    sqliteWriter.updateTeamspaceNote(filename, content);
    const note = sqliteReader.getTeamspaceNote(filename);
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
    sqliteWriter.deleteTeamspaceNote(filename);
  } else {
    fileWriter.deleteNote(filename);
  }
}

/**
 * Get today's daily note
 */
export function getTodayNote(teamspace?: string): Note | null {
  const dateStr = getTodayDateString();
  return getCalendarNote(dateStr, teamspace);
}

/**
 * Get a calendar note by date
 */
export function getCalendarNote(date: string, teamspace?: string): Note | null {
  const dateStr = parseFlexibleDate(date);

  if (teamspace) {
    return sqliteReader.getTeamspaceCalendarNote(dateStr, teamspace);
  }

  return fileReader.getCalendarNote(dateStr);
}

/**
 * Ensure a calendar note exists, create if not
 */
export function ensureCalendarNote(date: string, teamspace?: string): Note {
  const dateStr = parseFlexibleDate(date);

  if (teamspace) {
    let note = sqliteReader.getTeamspaceCalendarNote(dateStr, teamspace);
    if (!note) {
      sqliteWriter.createTeamspaceCalendarNote(teamspace, dateStr, '');
      note = sqliteReader.getTeamspaceCalendarNote(dateStr, teamspace);
    }
    if (!note) throw new Error('Failed to create teamspace calendar note');
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
  teamspace?: string
): Note {
  const note = ensureCalendarNote('today', teamspace);

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
 * List all teamspaces
 */
export function listTeamspaces(): Teamspace[] {
  return sqliteReader.listTeamspaces();
}

/**
 * List all folders
 */
export function listFolders(teamspace?: string): Folder[] {
  const folders: Folder[] = [];

  if (!teamspace) {
    folders.push(...fileReader.listFolders());
  }

  folders.push(...sqliteReader.listTeamspaceFolders(teamspace));

  return folders;
}

/**
 * List all tags
 */
export function listTags(teamspace?: string): string[] {
  const tags = new Set<string>();

  if (!teamspace) {
    fileReader.extractAllTags().forEach((tag) => tags.add(tag));
  }

  sqliteReader.extractTeamspaceTags(teamspace).forEach((tag) => tags.add(tag));

  return Array.from(tags).sort();
}
