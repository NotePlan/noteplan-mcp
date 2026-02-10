// SQLite writer for space notes

import { getDatabase, listSpaces } from './sqlite-reader.js';
import { SQLITE_NOTE_TYPES } from './types.js';
import { v4 as uuidv4 } from 'uuid';

const SPACE_TRASH_FOLDER_TITLE = '@Trash';

type SpaceNodeRow = {
  id: string;
  filename: string;
  parent: string | null;
  is_dir: number;
  title?: string;
};

type OpenDatabase = NonNullable<ReturnType<typeof getDatabase>>;

export interface SpaceMoveResult {
  noteId: string;
  previousParent: string | null;
  destinationParentId: string;
}

export interface SpaceTrashResult extends SpaceMoveResult {
  spaceId: string;
  trashFolderId: string;
}

export interface SpaceRenameResult {
  folderId: string;
  previousTitle: string;
  title: string;
}

/**
 * Generate a unique ID for a new note
 */
function generateNoteId(): string {
  return uuidv4();
}

/**
 * NotePlan's SQLite.swift Date parser expects UTC timestamps without timezone suffix:
 * yyyy-MM-dd'T'HH:mm:ss.SSS
 */
function currentSqliteTimestamp(): string {
  return new Date().toISOString().replace('Z', '');
}

let mcpChangesTableReady: boolean = false;

function ensureMcpChangesTable(database: OpenDatabase): void {
  if (mcpChangesTableReady) return;
  database.prepare(`
    CREATE TABLE IF NOT EXISTS mcp_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL
    )
  `).run();
  mcpChangesTableReady = true;
}

function queueMcpChange(database: OpenDatabase, noteId: string): void {
  ensureMcpChangesTable(database);
  database.prepare('INSERT INTO mcp_changes (note_id) VALUES (?)').run(noteId);
}

function getSpaceNode(identifier: string): SpaceNodeRow {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const row = database
    .prepare(
      `
      SELECT id, filename, parent, is_dir, title
      FROM notes
      WHERE id = ? OR filename = ?
    `
    )
    .get(identifier, identifier) as SpaceNodeRow | undefined;

  if (!row) {
    throw new Error(`Note not found: ${identifier}`);
  }
  return row;
}

function findRootSpaceIdForNode(database: OpenDatabase, nodeId: string): string {
  const row = database
    .prepare(
      `
      WITH RECURSIVE parent_chain AS (
        SELECT id, parent, note_type FROM notes WHERE id = ?
        UNION ALL
        SELECT n.id, n.parent, n.note_type FROM notes n
        INNER JOIN parent_chain pc ON n.id = pc.parent
      )
      SELECT id FROM parent_chain WHERE note_type = ? LIMIT 1
    `
    )
    .get(nodeId, SQLITE_NOTE_TYPES.TEAMSPACE) as { id: string } | undefined;

  if (!row?.id) {
    throw new Error('Could not resolve parent space for note');
  }
  return row.id;
}

function validateDestinationFolder(
  database: OpenDatabase,
  destinationParentId: string,
  expectedSpaceId: string
): void {
  const destination = database
    .prepare(
      `
      SELECT id, is_dir
      FROM notes
      WHERE id = ?
    `
    )
    .get(destinationParentId) as { id: string; is_dir: number } | undefined;

  if (!destination) {
    throw new Error(`Destination folder not found: ${destinationParentId}`);
  }
  if (destination.is_dir !== 1) {
    throw new Error(`Destination is not a folder: ${destinationParentId}`);
  }

  const destinationSpaceId = findRootSpaceIdForNode(database, destinationParentId);
  if (destinationSpaceId !== expectedSpaceId) {
    throw new Error('Destination folder must be in the same space');
  }
}

function isDescendantFolder(
  database: OpenDatabase,
  potentialChildId: string,
  ancestorId: string
): boolean {
  const row = database
    .prepare(
      `
      WITH RECURSIVE parent_chain AS (
        SELECT id, parent FROM notes WHERE id = ?
        UNION ALL
        SELECT n.id, n.parent FROM notes n
        INNER JOIN parent_chain pc ON n.id = pc.parent
      )
      SELECT 1 AS found
      FROM parent_chain
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(potentialChildId, ancestorId) as { found: number } | undefined;

  return Boolean(row?.found);
}

function ensureSpaceTrashFolder(spaceId: string): string {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const existing = database
    .prepare(
      `
      SELECT id
      FROM notes
      WHERE is_dir = 1
      AND parent = ?
      AND lower(title) = lower(?)
      LIMIT 1
    `
    )
    .get(spaceId, SPACE_TRASH_FOLDER_TITLE) as { id: string } | undefined;

  if (existing?.id) return existing.id;

  const folderId = generateNoteId();
  const filename = `%%NotePlanCloud%%/${spaceId}/${folderId}`;
  const now = currentSqliteTimestamp();

  database
    .prepare(
      `
      INSERT INTO notes (id, content, note_type, title, filename, parent, is_dir, created_at, modified_at)
      VALUES (?, '', ?, ?, ?, ?, 1, ?, ?)
    `
    )
    .run(folderId, SQLITE_NOTE_TYPES.TEAMSPACE_NOTE, SPACE_TRASH_FOLDER_TITLE, filename, spaceId, now, now);
  queueMcpChange(database, folderId);

  return folderId;
}

function isNoteInSpaceTrash(database: OpenDatabase, noteId: string): boolean {
  const row = database
    .prepare(
      `
      WITH RECURSIVE parent_chain AS (
        SELECT id, parent, is_dir, title FROM notes WHERE id = ?
        UNION ALL
        SELECT n.id, n.parent, n.is_dir, n.title FROM notes n
        INNER JOIN parent_chain pc ON n.id = pc.parent
      )
      SELECT id
      FROM parent_chain
      WHERE is_dir = 1 AND lower(title) = lower(?)
      LIMIT 1
    `
    )
    .get(noteId, SPACE_TRASH_FOLDER_TITLE) as { id: string } | undefined;

  return Boolean(row?.id);
}

/**
 * Create a new note in a space
 */
export function createSpaceNote(
  spaceId: string,
  title: string,
  content: string = '',
  parent?: string
): string {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const noteId = generateNoteId();
  const filename = `%%NotePlanCloud%%/${spaceId}/${noteId}`;
  const now = currentSqliteTimestamp();

  try {
    database
      .prepare(
      `
        INSERT INTO notes (id, content, note_type, title, filename, parent, is_dir, created_at, modified_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
      )
      .run(noteId, content, SQLITE_NOTE_TYPES.TEAMSPACE_NOTE, title, filename, parent || spaceId, now, now);
    queueMcpChange(database, noteId);
    return filename;
  } catch (error) {
    console.error('Error creating space note:', error);
    throw new Error(`Failed to create space note: ${error}`);
  }
}

/**
 * Create a calendar note in a space
 */
export function createSpaceCalendarNote(
  spaceId: string,
  dateStr: string,
  content: string = ''
): string {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const noteId = generateNoteId();
  const canonicalFilename = `${dateStr}.md`;
  const now = currentSqliteTimestamp();

  try {
    const existing = database
      .prepare(
        `
        SELECT id
        FROM notes
        WHERE note_type = ?
        AND is_dir = 0
        AND parent = ?
        AND (filename = ? OR title = ?)
        LIMIT 1
      `
      )
      .get(
        SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR,
        spaceId,
        canonicalFilename,
        dateStr,
      ) as { id: string } | undefined;

    if (existing?.id) {
      return canonicalFilename;
    }

    database
      .prepare(
        `
        INSERT INTO notes (id, content, note_type, title, filename, parent, is_dir, created_at, modified_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
      )
      .run(
        noteId,
        content,
        SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR,
        dateStr,
        canonicalFilename,
        spaceId,
        now,
        now
      );
    queueMcpChange(database, noteId);
    return canonicalFilename;
  } catch (error) {
    console.error('Error creating space calendar note:', error);
    throw new Error(`Failed to create space calendar note: ${error}`);
  }
}

/**
 * Update a space note's content
 */
export function updateSpaceNote(identifier: string, content: string): void {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const node = getSpaceNode(identifier);
  const now = currentSqliteTimestamp();

  try {
    const result = database
      .prepare(
        `
        UPDATE notes
        SET content = ?, modified_at = ?
        WHERE id = ?
      `
      )
      .run(content, now, node.id);

    if (result.changes === 0) {
      throw new Error(`Note not found: ${identifier}`);
    }
    queueMcpChange(database, node.id);
  } catch (error) {
    console.error('Error updating space note:', error);
    throw new Error(`Failed to update space note: ${error}`);
  }
}

/**
 * Update a space note's title
 */
export function updateSpaceNoteTitle(identifier: string, title: string): void {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const node = getSpaceNode(identifier);
  const now = currentSqliteTimestamp();

  try {
    const result = database
      .prepare(
        `
        UPDATE notes
        SET title = ?, modified_at = ?
        WHERE id = ?
      `
      )
      .run(title, now, node.id);

    if (result.changes === 0) {
      throw new Error(`Note not found: ${identifier}`);
    }
    queueMcpChange(database, node.id);
  } catch (error) {
    console.error('Error updating space note title:', error);
    throw new Error(`Failed to update space note title: ${error}`);
  }
}

/**
 * Move a space note to another folder in the same space
 */
export function moveSpaceNote(identifier: string, destinationParentId: string): SpaceMoveResult {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const node = getSpaceNode(identifier);
  if (node.is_dir === 1) {
    throw new Error('Moving folders is not supported by this operation');
  }

  const spaceId = findRootSpaceIdForNode(database, node.id);
  validateDestinationFolder(database, destinationParentId, spaceId);

  if (node.parent === destinationParentId) {
    throw new Error('Note is already in the destination folder');
  }

  const now = currentSqliteTimestamp();
  try {
    const result = database
      .prepare(
        `
        UPDATE notes
        SET parent = ?, modified_at = ?
        WHERE id = ?
      `
      )
      .run(destinationParentId, now, node.id);

    if (result.changes === 0) {
      throw new Error(`Note not found: ${identifier}`);
    }
    queueMcpChange(database, node.id);

    return {
      noteId: node.id,
      previousParent: node.parent,
      destinationParentId,
    };
  } catch (error) {
    console.error('Error moving space note:', error);
    throw new Error(`Failed to move space note: ${error}`);
  }
}

/**
 * Delete a space note by moving it into the space @Trash folder
 */
export function deleteSpaceNote(identifier: string): SpaceTrashResult {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const node = getSpaceNode(identifier);
  if (node.is_dir === 1) {
    throw new Error('Deleting folders is not supported by this operation');
  }

  const spaceId = findRootSpaceIdForNode(database, node.id);
  const trashFolderId = ensureSpaceTrashFolder(spaceId);
  const moveResult = moveSpaceNote(identifier, trashFolderId);

  return {
    ...moveResult,
    spaceId,
    trashFolderId,
  };
}

/**
 * Restore a space note from @Trash
 */
export function restoreSpaceNote(
  identifier: string,
  destinationParentId?: string
): SpaceMoveResult {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const node = getSpaceNode(identifier);
  if (node.is_dir === 1) {
    throw new Error('Restoring folders is not supported by this operation');
  }
  if (!isNoteInSpaceTrash(database, node.id)) {
    throw new Error('Note is not in TeamSpace @Trash');
  }

  const spaceId = findRootSpaceIdForNode(database, node.id);
  const targetParentId = destinationParentId && destinationParentId.trim().length > 0
    ? destinationParentId.trim()
    : spaceId;
  return moveSpaceNote(identifier, targetParentId);
}

/**
 * Create a folder in a space
 */
export function createSpaceFolder(spaceId: string, name: string, parent?: string): string {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error('Folder name is required');
  }
  if (normalizedName.includes('/')) {
    throw new Error('Folder name must not contain "/"');
  }

  const parentId = parent?.trim() || spaceId;
  validateDestinationFolder(database, parentId, spaceId);

  const folderId = generateNoteId();
  const filename = `%%NotePlanCloud%%/${spaceId}/${folderId}`;
  const now = currentSqliteTimestamp();

  try {
    database
      .prepare(
        `
        INSERT INTO notes (id, content, note_type, title, filename, parent, is_dir, created_at, modified_at)
        VALUES (?, '', ?, ?, ?, ?, 1, ?, ?)
      `
      ).run(
        folderId,
        SQLITE_NOTE_TYPES.TEAMSPACE_NOTE,
        normalizedName,
        filename,
        parentId || null,
        now,
        now
      );
    queueMcpChange(database, folderId);
    return folderId;
  } catch (error) {
    console.error('Error creating space folder:', error);
    throw new Error(`Failed to create space folder: ${error}`);
  }
}

/**
 * Move a space folder to another folder in the same space
 */
export function moveSpaceFolder(identifier: string, destinationParentId: string): SpaceMoveResult {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const node = getSpaceNode(identifier);
  if (node.is_dir !== 1) {
    throw new Error('Only folders can be moved with this operation');
  }

  const spaceId = findRootSpaceIdForNode(database, node.id);
  if (node.id === spaceId) {
    throw new Error('Space root cannot be moved');
  }

  validateDestinationFolder(database, destinationParentId, spaceId);
  if (destinationParentId === node.id) {
    throw new Error('Destination folder cannot be the same as source folder');
  }
  if (node.parent === destinationParentId) {
    throw new Error('Folder is already in the destination folder');
  }
  if (isDescendantFolder(database, destinationParentId, node.id)) {
    throw new Error('Cannot move a folder into one of its descendants');
  }

  const now = currentSqliteTimestamp();
  try {
    const result = database
      .prepare(
        `
        UPDATE notes
        SET parent = ?, modified_at = ?
        WHERE id = ?
      `
      )
      .run(destinationParentId, now, node.id);

    if (result.changes === 0) {
      throw new Error(`Folder not found: ${identifier}`);
    }
    queueMcpChange(database, node.id);

    return {
      noteId: node.id,
      previousParent: node.parent,
      destinationParentId,
    };
  } catch (error) {
    console.error('Error moving space folder:', error);
    throw new Error(`Failed to move space folder: ${error}`);
  }
}

/**
 * Rename a space folder in place
 */
export function renameSpaceFolder(identifier: string, title: string): SpaceRenameResult {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const node = getSpaceNode(identifier);
  if (node.is_dir !== 1) {
    throw new Error('Only folders can be renamed with this operation');
  }
  const spaceId = findRootSpaceIdForNode(database, node.id);
  if (node.id === spaceId) {
    throw new Error('Space root cannot be renamed');
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new Error('Folder title is required');
  }
  if (normalizedTitle.includes('/')) {
    throw new Error('Folder title must not contain "/"');
  }

  const currentTitle = node.title?.trim() || '';
  if (currentTitle === normalizedTitle) {
    throw new Error('New folder title matches current title');
  }

  const duplicate = database
    .prepare(
      `
      SELECT id
      FROM notes
      WHERE is_dir = 1
      AND parent IS ?
      AND lower(title) = lower(?)
      AND id != ?
      LIMIT 1
    `
    )
    .get(node.parent, normalizedTitle, node.id) as { id: string } | undefined;
  if (duplicate?.id) {
    throw new Error('A sibling folder with this title already exists');
  }

  const now = currentSqliteTimestamp();
  try {
    const result = database
      .prepare(
        `
        UPDATE notes
        SET title = ?, modified_at = ?
        WHERE id = ?
      `
      )
      .run(normalizedTitle, now, node.id);

    if (result.changes === 0) {
      throw new Error(`Folder not found: ${identifier}`);
    }
    queueMcpChange(database, node.id);

    return {
      folderId: node.id,
      previousTitle: currentTitle,
      title: normalizedTitle,
    };
  } catch (error) {
    console.error('Error renaming space folder:', error);
    throw new Error(`Failed to rename space folder: ${error}`);
  }
}

/**
 * Get the default space ID (first one found)
 */
export function getDefaultSpaceId(): string | null {
  const spaces = listSpaces();
  return spaces.length > 0 ? spaces[0].id : null;
}
