// SQLite writer for space notes

import { getDatabase, listSpaces } from './sqlite-reader.js';
import { SQLITE_NOTE_TYPES } from './types.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a unique ID for a new note
 */
function generateNoteId(): string {
  return uuidv4();
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
  const now = new Date().toISOString();

  try {
    database
      .prepare(
        `
        INSERT INTO notes (id, content, note_type, title, filename, parent, is_dir, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
      )
      .run(noteId, content, SQLITE_NOTE_TYPES.TEAMSPACE_NOTE, title, filename, parent || null, now, now);

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
  const filename = `%%NotePlanCloud%%/${spaceId}/${dateStr}`;
  const now = new Date().toISOString();

  try {
    database
      .prepare(
        `
        INSERT INTO notes (id, content, note_type, title, filename, parent, is_dir, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)
      `
      )
      .run(noteId, content, SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR, dateStr, filename, now, now);

    return filename;
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

  const now = new Date().toISOString();

  try {
    const result = database
      .prepare(
        `
        UPDATE notes
        SET content = ?, updated_at = ?
        WHERE id = ? OR filename = ?
      `
      )
      .run(content, now, identifier, identifier);

    if (result.changes === 0) {
      throw new Error(`Note not found: ${identifier}`);
    }
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

  const now = new Date().toISOString();

  try {
    const result = database
      .prepare(
        `
        UPDATE notes
        SET title = ?, updated_at = ?
        WHERE id = ? OR filename = ?
      `
      )
      .run(title, now, identifier, identifier);

    if (result.changes === 0) {
      throw new Error(`Note not found: ${identifier}`);
    }
  } catch (error) {
    console.error('Error updating space note title:', error);
    throw new Error(`Failed to update space note title: ${error}`);
  }
}

/**
 * Delete a space note
 */
export function deleteSpaceNote(identifier: string): void {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  try {
    const result = database
      .prepare(
        `
        DELETE FROM notes
        WHERE id = ? OR filename = ?
      `
      )
      .run(identifier, identifier);

    if (result.changes === 0) {
      throw new Error(`Note not found: ${identifier}`);
    }
  } catch (error) {
    console.error('Error deleting space note:', error);
    throw new Error(`Failed to delete space note: ${error}`);
  }
}

/**
 * Create a folder in a space
 */
export function createSpaceFolder(spaceId: string, name: string, parent?: string): string {
  const database = getDatabase();
  if (!database) {
    throw new Error('Space database not available');
  }

  const folderId = generateNoteId();
  const filename = `%%NotePlanCloud%%/${spaceId}/${folderId}`;
  const now = new Date().toISOString();

  try {
    database
      .prepare(
        `
        INSERT INTO notes (id, content, note_type, title, filename, parent, is_dir, created_at, updated_at)
        VALUES (?, '', ?, ?, ?, ?, 1, ?, ?)
      `
      )
      .run(folderId, SQLITE_NOTE_TYPES.TEAMSPACE_NOTE, name, filename, parent || null, now, now);

    return filename;
  } catch (error) {
    console.error('Error creating space folder:', error);
    throw new Error(`Failed to create space folder: ${error}`);
  }
}

/**
 * Get the default space ID (first one found)
 */
export function getDefaultSpaceId(): string | null {
  const spaces = listSpaces();
  return spaces.length > 0 ? spaces[0].id : null;
}
