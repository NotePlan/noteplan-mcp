// SQLite reader for teamspace notes

import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Note, Teamspace, Folder, SQLiteNoteRow, SQLITE_NOTE_TYPES } from './types.js';
import { extractTitle } from './markdown-parser.js';

const TEAMSPACE_DB_PATH = path.join(os.homedir(), 'Library/Caches/teamspace.db');

let db: Database.Database | null = null;
let dbChecked = false;

/**
 * Get or create the database connection
 */
export function getDatabase(): Database.Database | null {
  if (db) return db;
  if (dbChecked) return null; // Already checked, no DB available

  dbChecked = true;

  if (!fs.existsSync(TEAMSPACE_DB_PATH)) {
    // Only log once in stderr for MCP compatibility
    console.error('Note: Teamspace database not found (teamspaces unavailable)');
    return null;
  }

  try {
    db = new Database(TEAMSPACE_DB_PATH, { readonly: false });
    return db;
  } catch (error) {
    console.error('Failed to open teamspace database:', error);
    return null;
  }
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * List all teamspaces
 */
export function listTeamspaces(): Teamspace[] {
  const database = getDatabase();
  if (!database) return [];

  try {
    // Teamspaces are stored as note_type = 10
    const rows = database
      .prepare(
        `
        SELECT
          id,
          title,
          (SELECT COUNT(*) FROM notes n2 WHERE n2.filename LIKE '%%NotePlanCloud%%/' || notes.id || '/%') as note_count
        FROM notes
        WHERE note_type = ?
        AND is_dir = 0
      `
      )
      .all(SQLITE_NOTE_TYPES.TEAMSPACE) as { id: string; title: string; note_count: number }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.title || row.id,
      noteCount: row.note_count,
    }));
  } catch (error) {
    console.error('Error listing teamspaces:', error);
    return [];
  }
}

/**
 * Get teamspace ID from filename
 */
function getTeamspaceIdFromFilename(filename: string): string | undefined {
  // Pattern: %%NotePlanCloud%%/[teamspace-id]/[note-id]
  const match = filename.match(/%%NotePlanCloud%%\/([^/]+)\//);
  return match ? match[1] : undefined;
}

/**
 * Convert SQLite row to Note object
 */
function rowToNote(row: SQLiteNoteRow): Note {
  const teamspaceId = getTeamspaceIdFromFilename(row.filename);
  const isCalendar = row.note_type === SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR;

  return {
    id: row.id,
    title: row.title || extractTitle(row.content || ''),
    filename: row.filename,
    content: row.content || '',
    type: isCalendar ? 'calendar' : 'note',
    source: 'teamspace',
    teamspaceId,
    folder: row.parent || undefined,
    modifiedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    createdAt: row.created_at ? new Date(row.created_at) : undefined,
  };
}

/**
 * List notes in a teamspace
 */
export function listTeamspaceNotes(teamspaceId?: string): Note[] {
  const database = getDatabase();
  if (!database) return [];

  try {
    let query = `
      SELECT id, content, note_type, title, filename, parent, is_dir, created_at, updated_at
      FROM notes
      WHERE note_type IN (?, ?)
      AND is_dir = 0
    `;
    const params: (number | string)[] = [
      SQLITE_NOTE_TYPES.TEAMSPACE_NOTE,
      SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR,
    ];

    if (teamspaceId) {
      query += ` AND filename LIKE ?`;
      params.push(`%%NotePlanCloud%%/${teamspaceId}/%`);
    }

    const rows = database.prepare(query).all(...params) as SQLiteNoteRow[];
    return rows.map(rowToNote);
  } catch (error) {
    console.error('Error listing teamspace notes:', error);
    return [];
  }
}

/**
 * Get a specific teamspace note by ID or filename
 */
export function getTeamspaceNote(identifier: string): Note | null {
  const database = getDatabase();
  if (!database) return null;

  try {
    const row = database
      .prepare(
        `
        SELECT id, content, note_type, title, filename, parent, is_dir, created_at, updated_at
        FROM notes
        WHERE (id = ? OR filename = ?)
        AND is_dir = 0
      `
      )
      .get(identifier, identifier) as SQLiteNoteRow | undefined;

    return row ? rowToNote(row) : null;
  } catch (error) {
    console.error('Error getting teamspace note:', error);
    return null;
  }
}

/**
 * Get a teamspace note by title
 */
export function getTeamspaceNoteByTitle(title: string, teamspaceId?: string): Note | null {
  const database = getDatabase();
  if (!database) return null;

  try {
    let query = `
      SELECT id, content, note_type, title, filename, parent, is_dir, created_at, updated_at
      FROM notes
      WHERE title = ?
      AND note_type IN (?, ?)
      AND is_dir = 0
    `;
    const params: (string | number)[] = [
      title,
      SQLITE_NOTE_TYPES.TEAMSPACE_NOTE,
      SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR,
    ];

    if (teamspaceId) {
      query += ` AND filename LIKE ?`;
      params.push(`%%NotePlanCloud%%/${teamspaceId}/%`);
    }

    const row = database.prepare(query).get(...params) as SQLiteNoteRow | undefined;
    return row ? rowToNote(row) : null;
  } catch (error) {
    console.error('Error getting teamspace note by title:', error);
    return null;
  }
}

/**
 * Search teamspace notes
 */
export function searchTeamspaceNotes(
  query: string,
  options: {
    teamspaceId?: string;
    limit?: number;
  } = {}
): Note[] {
  const database = getDatabase();
  if (!database) return [];

  const { teamspaceId, limit = 50 } = options;

  try {
    let sql = `
      SELECT id, content, note_type, title, filename, parent, is_dir, created_at, updated_at
      FROM notes
      WHERE (content LIKE ? OR title LIKE ?)
      AND note_type IN (?, ?)
      AND is_dir = 0
    `;
    const searchPattern = `%${query}%`;
    const params: (string | number)[] = [
      searchPattern,
      searchPattern,
      SQLITE_NOTE_TYPES.TEAMSPACE_NOTE,
      SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR,
    ];

    if (teamspaceId) {
      sql += ` AND filename LIKE ?`;
      params.push(`%%NotePlanCloud%%/${teamspaceId}/%`);
    }

    sql += ` LIMIT ?`;
    params.push(limit);

    const rows = database.prepare(sql).all(...params) as SQLiteNoteRow[];
    return rows.map(rowToNote);
  } catch (error) {
    console.error('Error searching teamspace notes:', error);
    return [];
  }
}

/**
 * List folders in teamspace
 */
export function listTeamspaceFolders(teamspaceId?: string): Folder[] {
  const database = getDatabase();
  if (!database) return [];

  try {
    let query = `
      SELECT id, title, filename
      FROM notes
      WHERE is_dir = 1
    `;
    const params: string[] = [];

    if (teamspaceId) {
      query += ` AND filename LIKE ?`;
      params.push(`%%NotePlanCloud%%/${teamspaceId}/%`);
    }

    const rows = database.prepare(query).all(...params) as { id: string; title: string; filename: string }[];

    return rows.map((row) => ({
      path: row.filename,
      name: row.title || row.id,
      source: 'teamspace' as const,
      teamspaceId: getTeamspaceIdFromFilename(row.filename),
    }));
  } catch (error) {
    console.error('Error listing teamspace folders:', error);
    return [];
  }
}

/**
 * Extract all unique tags from teamspace notes
 */
export function extractTeamspaceTags(teamspaceId?: string): string[] {
  const notes = listTeamspaceNotes(teamspaceId);
  const tags = new Set<string>();

  for (const note of notes) {
    const matches = note.content.match(/#[\w-/]+/g);
    if (matches) {
      matches.forEach((tag) => tags.add(tag));
    }
  }

  return Array.from(tags).sort();
}

/**
 * Get calendar note from teamspace by date
 */
export function getTeamspaceCalendarNote(dateStr: string, teamspaceId: string): Note | null {
  const database = getDatabase();
  if (!database) return null;

  try {
    // Calendar notes in teamspace have filename containing the date
    const row = database
      .prepare(
        `
        SELECT id, content, note_type, title, filename, parent, is_dir, created_at, updated_at
        FROM notes
        WHERE note_type = ?
        AND filename LIKE ?
        AND filename LIKE ?
        AND is_dir = 0
      `
      )
      .get(
        SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR,
        `%%NotePlanCloud%%/${teamspaceId}/%`,
        `%${dateStr}%`
      ) as SQLiteNoteRow | undefined;

    return row ? rowToNote(row) : null;
  } catch (error) {
    console.error('Error getting teamspace calendar note:', error);
    return null;
  }
}
