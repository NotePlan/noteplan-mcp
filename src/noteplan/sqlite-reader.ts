// SQLite reader for space notes

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Note, Space, Folder, SQLiteNoteRow, SQLITE_NOTE_TYPES } from './types.js';
import { extractTitle, extractTagsFromContent } from './markdown-parser.js';
import { isSqliteAvailable, SqliteDatabase } from './sqlite-loader.js';

// Possible NotePlan storage paths (same as file-reader.ts)
const POSSIBLE_PATHS = [
  // Direct local paths (AppStore version) - preferred for local dev
  path.join(os.homedir(), 'Library/Containers/co.noteplan.NotePlan3/Data/Library/Application Support/co.noteplan.NotePlan3'),
  // Direct local paths (Setapp version)
  path.join(os.homedir(), 'Library/Containers/co.noteplan.NotePlan-setapp/Data/Library/Application Support/co.noteplan.NotePlan-setapp'),
  // Today app iCloud
  path.join(os.homedir(), 'Library/Mobile Documents/iCloud~co~noteplan~Today/Documents'),
  // NotePlan 3 iCloud
  path.join(os.homedir(), 'Library/Mobile Documents/iCloud~co~noteplan~NotePlan3/Documents'),
  // NotePlan iCloud
  path.join(os.homedir(), 'Library/Mobile Documents/iCloud~co~noteplan~NotePlan/Documents'),
  // NotePlan Setapp iCloud
  path.join(os.homedir(), 'Library/Mobile Documents/iCloud~co~noteplan~NotePlan-setapp/Documents'),
];

let db: SqliteDatabase | null = null;
let dbChecked = false;
let cachedDbPath: string | null = null;
const SPACE_TRASH_FOLDER_TITLE = '@Trash';

/**
 * Find the spaces database path
 */
function findDatabasePath(): string | null {
  for (const basePath of POSSIBLE_PATHS) {
    const dbPath = path.join(basePath, 'Caches', 'teamspace.db');
    if (fs.existsSync(dbPath)) {
      return dbPath;
    }
  }
  return null;
}

/**
 * Get or create the database connection
 */
export function getDatabase(): SqliteDatabase | null {
  if (db) return db;
  if (dbChecked) return null; // Already checked, no DB available

  dbChecked = true;

  if (!isSqliteAvailable()) {
    return null; // sql.js not initialized
  }

  cachedDbPath = findDatabasePath();
  if (!cachedDbPath) {
    // Only log once in stderr for MCP compatibility
    console.error('Note: Spaces database not found (spaces unavailable)');
    return null;
  }

  try {
    // Try read-write first (needed for sqlite-writer operations)
    db = new SqliteDatabase(cachedDbPath, { readonly: false });
    return db;
  } catch (error) {
    // If read-write fails (e.g., database locked), try read-only
    try {
      console.error('Note: Opening spaces database in read-only mode');
      db = new SqliteDatabase(cachedDbPath, { readonly: true });
      return db;
    } catch (readOnlyError) {
      console.error('Failed to open spaces database:', readOnlyError);
      return null;
    }
  }
}

/**
 * Get resolved teamspace database path (if available)
 */
export function getDatabasePath(): string | null {
  if (cachedDbPath) return cachedDbPath;
  cachedDbPath = findDatabasePath();
  return cachedDbPath;
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
 * List all spaces
 */
export function listSpaces(): Space[] {
  const database = getDatabase();
  if (!database) return [];

  try {
    // Spaces are stored as note_type = 10 with is_dir = 1
    const rows = database
      .prepare(
        `
        SELECT
          id,
          title,
          (SELECT COUNT(*) FROM notes n2 WHERE n2.parent = notes.id AND n2.note_type IN (?, ?)) as note_count
        FROM notes
        WHERE note_type = ?
        AND is_dir = 1
      `
      )
      .all(SQLITE_NOTE_TYPES.TEAMSPACE_NOTE, SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR, SQLITE_NOTE_TYPES.TEAMSPACE) as { id: string; title: string; note_count: number }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.title || row.id,
      noteCount: row.note_count,
    }));
  } catch (error) {
    console.error('Error listing spaces:', error);
    return [];
  }
}

/**
 * Get all descendant IDs of a space (folders and notes)
 * Uses recursive CTE to traverse parent hierarchy
 */
function getSpaceDescendantIds(database: SqliteDatabase, spaceId: string): string[] {
  try {
    const rows = database.prepare(`
      WITH RECURSIVE space_tree AS (
        -- Base case: direct children of the space
        SELECT id FROM notes WHERE parent = ?
        UNION ALL
        -- Recursive: children of folders in the tree
        SELECT n.id FROM notes n
        INNER JOIN space_tree st ON n.parent = st.id
      )
      SELECT id FROM space_tree
    `).all(spaceId) as { id: string }[];

    return rows.map(r => r.id);
  } catch (error) {
    console.error('Error getting space descendants:', error);
    return [];
  }
}

/**
 * Count notes and subfolders under a space folder (recursive)
 */
export function countSpaceFolderContents(folderId: string): { noteCount: number; folderCount: number } {
  const database = getDatabase();
  if (!database) return { noteCount: 0, folderCount: 0 };
  try {
    const row = database.prepare(`
      WITH RECURSIVE subtree AS (
        SELECT id, is_dir FROM notes WHERE parent = ?
        UNION ALL
        SELECT n.id, n.is_dir FROM notes n
        INNER JOIN subtree s ON n.parent = s.id
      )
      SELECT
        COUNT(CASE WHEN is_dir = 0 THEN 1 END) AS noteCount,
        COUNT(CASE WHEN is_dir = 1 THEN 1 END) AS folderCount
      FROM subtree
    `).get(folderId) as { noteCount: number; folderCount: number } | undefined;
    return row ?? { noteCount: 0, folderCount: 0 };
  } catch {
    return { noteCount: 0, folderCount: 0 };
  }
}

function getDescendantIdsForRoots(database: SqliteDatabase, rootIds: string[]): string[] {
  if (rootIds.length === 0) return [];
  try {
    const placeholders = rootIds.map(() => '?').join(',');
    const rows = database
      .prepare(
        `
        WITH RECURSIVE subtree AS (
          SELECT id FROM notes WHERE id IN (${placeholders})
          UNION ALL
          SELECT n.id FROM notes n
          INNER JOIN subtree s ON n.parent = s.id
        )
        SELECT id FROM subtree
      `
      )
      .all(...rootIds) as { id: string }[];
    return rows.map((row) => row.id);
  } catch (error) {
    console.error('Error getting descendants from roots:', error);
    return [];
  }
}

function getTrashDescendantIds(database: SqliteDatabase, spaceId?: string): Set<string> {
  try {
    let trashFolderRows = database
      .prepare(
        `
        SELECT id
        FROM notes
        WHERE is_dir = 1
        AND lower(title) = lower(?)
      `
      )
      .all(SPACE_TRASH_FOLDER_TITLE) as { id: string }[];

    if (spaceId) {
      const spaceDescendantIds = new Set(getSpaceDescendantIds(database, spaceId));
      trashFolderRows = trashFolderRows.filter((row) => spaceDescendantIds.has(row.id));
    }

    const trashFolderIds = trashFolderRows.map((row) => row.id);
    if (trashFolderIds.length === 0) return new Set();
    return new Set(getDescendantIdsForRoots(database, trashFolderIds));
  } catch (error) {
    console.error('Error getting trash descendants:', error);
    return new Set();
  }
}

function filterRowsByTrash(
  database: SqliteDatabase,
  rows: SQLiteNoteRow[],
  spaceId?: string,
  includeTrash = false
): SQLiteNoteRow[] {
  if (includeTrash) return rows;
  const trashDescendants = getTrashDescendantIds(database, spaceId);
  if (trashDescendants.size === 0) return rows;
  return rows.filter((row) => !trashDescendants.has(row.id));
}

function normalizeListSpaceOptions(
  spaceIdOrOptions?: string | { spaceId?: string; includeTrash?: boolean }
): { spaceId?: string; includeTrash: boolean } {
  if (typeof spaceIdOrOptions === 'string') {
    return { spaceId: spaceIdOrOptions, includeTrash: false };
  }
  return {
    spaceId: spaceIdOrOptions?.spaceId,
    includeTrash: spaceIdOrOptions?.includeTrash === true,
  };
}

/**
 * Find the root space ID by traversing parent chain
 */
function findRootSpaceId(database: SqliteDatabase, noteId: string): string | undefined {
  try {
    const row = database.prepare(`
      WITH RECURSIVE parent_chain AS (
        SELECT id, parent, note_type FROM notes WHERE id = ?
        UNION ALL
        SELECT n.id, n.parent, n.note_type FROM notes n
        INNER JOIN parent_chain pc ON n.id = pc.parent
      )
      SELECT id FROM parent_chain WHERE note_type = ?
    `).get(noteId, SQLITE_NOTE_TYPES.TEAMSPACE) as { id: string } | undefined;

    return row?.id;
  } catch {
    return undefined;
  }
}

/**
 * Convert SQLite row to Note object
 */
function rowToNote(row: SQLiteNoteRow, database?: SqliteDatabase): Note {
  const spaceId = database ? findRootSpaceId(database, row.id) : undefined;
  const isCalendar = row.note_type === SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR;

  return {
    id: row.id,
    title: row.title || extractTitle(row.content || ''),
    filename: row.filename,
    content: row.content || '',
    type: isCalendar ? 'calendar' : 'note',
    source: 'space',
    spaceId,
    folder: row.parent || undefined,
    modifiedAt: row.modified_at ? new Date(row.modified_at) : undefined,
    createdAt: row.created_at ? new Date(row.created_at) : undefined,
  };
}

/**
 * List notes in a teamspace
 */
export function listSpaceNotes(
  spaceIdOrOptions?: string | { spaceId?: string; includeTrash?: boolean }
): Note[] {
  const database = getDatabase();
  if (!database) return [];
  const { spaceId, includeTrash } = normalizeListSpaceOptions(spaceIdOrOptions);

  try {
    let query = `
      SELECT id, content, note_type, title, filename, parent, is_dir, created_at, modified_at
      FROM notes
      WHERE note_type IN (?, ?)
      AND is_dir = 0
    `;
    const params: (number | string)[] = [
      SQLITE_NOTE_TYPES.TEAMSPACE_NOTE,
      SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR,
    ];

    if (spaceId) {
      const descendantIds = getSpaceDescendantIds(database, spaceId);
      if (descendantIds.length === 0) return [];

      const placeholders = descendantIds.map(() => '?').join(',');
      query += ` AND id IN (${placeholders})`;
      params.push(...descendantIds);
    }

    const rows = database.prepare(query).all(...params) as unknown as SQLiteNoteRow[];
    const filteredRows = filterRowsByTrash(database, rows, spaceId, includeTrash);
    return filteredRows.map(row => rowToNote(row, database));
  } catch (error) {
    console.error('Error listing teamspace notes:', error);
    return [];
  }
}

/**
 * Get a specific teamspace note by ID or filename
 */
export function getSpaceNote(identifier: string): Note | null {
  const database = getDatabase();
  if (!database) return null;

  try {
    const row = database
      .prepare(
        `
        SELECT id, content, note_type, title, filename, parent, is_dir, created_at, modified_at
        FROM notes
        WHERE (id = ? OR filename = ?)
        AND is_dir = 0
      `
      )
      .get(identifier, identifier) as SQLiteNoteRow | undefined;

    return row ? rowToNote(row, database) : null;
  } catch (error) {
    console.error('Error getting teamspace note:', error);
    return null;
  }
}

/**
 * Get a teamspace note by title
 */
export function getSpaceNoteByTitle(
  title: string,
  spaceId?: string,
  includeTrash = false
): Note | null {
  const database = getDatabase();
  if (!database) return null;

  try {
    let query = `
      SELECT id, content, note_type, title, filename, parent, is_dir, created_at, modified_at
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

    if (spaceId) {
      const descendantIds = getSpaceDescendantIds(database, spaceId);
      if (descendantIds.length === 0) return null;

      const placeholders = descendantIds.map(() => '?').join(',');
      query += ` AND id IN (${placeholders})`;
      params.push(...descendantIds);
    }

    const rows = database.prepare(query).all(...params) as unknown as SQLiteNoteRow[];
    const filteredRows = filterRowsByTrash(database, rows, spaceId, includeTrash);
    const row = filteredRows[0];
    return row ? rowToNote(row, database) : null;
  } catch (error) {
    console.error('Error getting teamspace note by title:', error);
    return null;
  }
}

/**
 * Search teamspace notes using LIKE pattern (fallback)
 */
export function searchSpaceNotes(
  query: string,
  options: {
    spaceId?: string;
    limit?: number;
    includeTrash?: boolean;
  } = {}
): Note[] {
  const database = getDatabase();
  if (!database) return [];

  const { spaceId, limit = 50, includeTrash = false } = options;

  try {
    let sql = `
      SELECT id, content, note_type, title, filename, parent, is_dir, created_at, modified_at
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

    if (spaceId) {
      const descendantIds = getSpaceDescendantIds(database, spaceId);
      if (descendantIds.length === 0) return [];

      const placeholders = descendantIds.map(() => '?').join(',');
      sql += ` AND id IN (${placeholders})`;
      params.push(...descendantIds);
    }

    sql += ` LIMIT ?`;
    params.push(limit);

    const rows = database.prepare(sql).all(...params) as unknown as SQLiteNoteRow[];
    const filteredRows = filterRowsByTrash(database, rows, spaceId, includeTrash);
    return filteredRows.map(row => rowToNote(row, database));
  } catch (error) {
    console.error('Error searching teamspace notes:', error);
    return [];
  }
}

/**
 * Build search patterns from user input
 * Handles OR patterns: "meeting|standup" -> ['meeting', 'standup']
 */
function parseSearchPatterns(input: string): string[] {
  // Split by | for OR patterns
  return input.split('|').map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Search space notes using LIKE with OR pattern support
 * This is the primary search method - we don't modify NotePlan's database
 */
export function searchSpaceNotesFTS(
  query: string,
  options: { spaceId?: string; limit?: number; includeTrash?: boolean } = {}
): Note[] {
  const database = getDatabase();
  if (!database) return [];

  const { spaceId, limit = 50, includeTrash = false } = options;

  // Parse OR patterns
  const patterns = parseSearchPatterns(query);
  if (patterns.length === 0) return [];

  try {
    // Build OR conditions for multiple patterns
    const orConditions = patterns
      .map(() => '(content LIKE ? OR title LIKE ?)')
      .join(' OR ');

    let sql = `
      SELECT id, content, note_type, title, filename, parent, is_dir, created_at, modified_at
      FROM notes
      WHERE (${orConditions})
      AND note_type IN (?, ?)
      AND is_dir = 0
    `;

    // Build params: each pattern needs two placeholders (content, title)
    const params: (string | number)[] = [];
    for (const pattern of patterns) {
      const searchPattern = `%${pattern}%`;
      params.push(searchPattern, searchPattern);
    }
    params.push(SQLITE_NOTE_TYPES.TEAMSPACE_NOTE, SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR);

    if (spaceId) {
      const descendantIds = getSpaceDescendantIds(database, spaceId);
      if (descendantIds.length === 0) return [];
      const placeholders = descendantIds.map(() => '?').join(',');
      sql += ` AND id IN (${placeholders})`;
      params.push(...descendantIds);
    }

    // Order by modified_at (most recent first) for relevance
    sql += ` ORDER BY modified_at DESC LIMIT ?`;
    params.push(limit);

    const rows = database.prepare(sql).all(...params) as unknown as SQLiteNoteRow[];
    const filteredRows = filterRowsByTrash(database, rows, spaceId, includeTrash);
    return filteredRows.map((row) => rowToNote(row, database));
  } catch (error) {
    console.error('Error searching space notes:', error);
    return [];
  }
}

/**
 * List folders in teamspace
 */
export function listSpaceFolders(
  spaceIdOrOptions?: string | { spaceId?: string; includeTrash?: boolean }
): Folder[] {
  const database = getDatabase();
  if (!database) return [];
  const { spaceId, includeTrash } = normalizeListSpaceOptions(spaceIdOrOptions);

  try {
    let query = `
      SELECT id, title, filename, parent
      FROM notes
      WHERE is_dir = 1
    `;
    const params: string[] = [];

    if (spaceId) {
      const descendantIds = getSpaceDescendantIds(database, spaceId);
      if (descendantIds.length === 0) return [];

      const placeholders = descendantIds.map(() => '?').join(',');
      query += ` AND id IN (${placeholders})`;
      params.push(...descendantIds);
    }

    let rows = database.prepare(query).all(...params) as { id: string; title: string; filename: string; parent: string }[];
    if (!includeTrash) {
      rows = rows.filter((row) => row.title?.toLowerCase() !== SPACE_TRASH_FOLDER_TITLE.toLowerCase());
    }

    return rows.map((row) => ({
      id: row.id,
      path: row.filename,
      name: row.title || row.id,
      source: 'space' as const,
      spaceId: findRootSpaceId(database, row.id),
    }));
  } catch (error) {
    console.error('Error listing teamspace folders:', error);
    return [];
  }
}

export function resolveSpaceFolder(
  spaceId: string,
  identifier: string,
  options: { includeTrash?: boolean } = {}
): Folder | null {
  const query = identifier.trim();
  if (!query) return null;
  const lowerQuery = query.toLowerCase();
  const folders = listSpaceFolders({ spaceId, includeTrash: options.includeTrash === true });

  const exactById = folders.find((folder) => folder.id === query);
  if (exactById) return exactById;

  const exactByPath = folders.find((folder) => folder.path.toLowerCase() === lowerQuery);
  if (exactByPath) return exactByPath;

  const exactByName = folders.filter((folder) => folder.name.toLowerCase() === lowerQuery);
  if (exactByName.length === 1) {
    return exactByName[0];
  }

  return null;
}

export function isSpaceNoteInTrash(identifier: string): boolean {
  const database = getDatabase();
  if (!database) return false;

  try {
    const row = database
      .prepare(
        `
        WITH RECURSIVE parent_chain AS (
          SELECT id, parent, is_dir, title
          FROM notes
          WHERE (id = ? OR filename = ?)
          AND is_dir = 0
          UNION ALL
          SELECT n.id, n.parent, n.is_dir, n.title
          FROM notes n
          INNER JOIN parent_chain pc ON n.id = pc.parent
        )
        SELECT id
        FROM parent_chain
        WHERE is_dir = 1
        AND lower(title) = lower(?)
        LIMIT 1
      `
      )
      .get(identifier, identifier, SPACE_TRASH_FOLDER_TITLE) as { id: string } | undefined;
    return Boolean(row?.id);
  } catch (error) {
    console.error('Error checking TeamSpace trash status:', error);
    return false;
  }
}

/**
 * Extract all unique tags from teamspace notes
 */
export function extractSpaceTags(spaceId?: string): string[] {
  const notes = listSpaceNotes(spaceId);
  const tags = new Set<string>();

  for (const note of notes) {
    for (const tag of extractTagsFromContent(note.content)) {
      tags.add(tag);
    }
  }

  return Array.from(tags).sort();
}

/**
 * Get calendar note from teamspace by date
 */
export function getSpaceCalendarNote(dateStr: string, spaceId: string): Note | null {
  const database = getDatabase();
  if (!database) return null;

  try {
    // Get descendants first
    const descendantIds = getSpaceDescendantIds(database, spaceId);
    if (descendantIds.length === 0) return null;

    const placeholders = descendantIds.map(() => '?').join(',');
    const row = database
      .prepare(
        `
        SELECT id, content, note_type, title, filename, parent, is_dir, created_at, modified_at
        FROM notes
        WHERE note_type = ?
        AND id IN (${placeholders})
        AND filename LIKE ?
        AND is_dir = 0
      `
      )
      .get(
        SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR,
        ...descendantIds,
        `%${dateStr}%`
      ) as SQLiteNoteRow | undefined;

    return row ? rowToNote(row, database) : null;
  } catch (error) {
    console.error('Error getting teamspace calendar note:', error);
    return null;
  }
}
