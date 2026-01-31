// SQLite writer for teamspace notes

import { getDatabase, listTeamspaces } from './sqlite-reader.js';
import { SQLITE_NOTE_TYPES } from './types.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a unique ID for a new note
 */
function generateNoteId(): string {
  return uuidv4();
}

/**
 * Create a new note in a teamspace
 */
export function createTeamspaceNote(
  teamspaceId: string,
  title: string,
  content: string = '',
  parent?: string
): string {
  const database = getDatabase();
  if (!database) {
    throw new Error('Teamspace database not available');
  }

  const noteId = generateNoteId();
  const filename = `%%NotePlanCloud%%/${teamspaceId}/${noteId}`;
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
    console.error('Error creating teamspace note:', error);
    throw new Error(`Failed to create teamspace note: ${error}`);
  }
}

/**
 * Create a calendar note in a teamspace
 */
export function createTeamspaceCalendarNote(
  teamspaceId: string,
  dateStr: string,
  content: string = ''
): string {
  const database = getDatabase();
  if (!database) {
    throw new Error('Teamspace database not available');
  }

  const noteId = generateNoteId();
  const filename = `%%NotePlanCloud%%/${teamspaceId}/${dateStr}`;
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
    console.error('Error creating teamspace calendar note:', error);
    throw new Error(`Failed to create teamspace calendar note: ${error}`);
  }
}

/**
 * Update a teamspace note's content
 */
export function updateTeamspaceNote(identifier: string, content: string): void {
  const database = getDatabase();
  if (!database) {
    throw new Error('Teamspace database not available');
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
    console.error('Error updating teamspace note:', error);
    throw new Error(`Failed to update teamspace note: ${error}`);
  }
}

/**
 * Update a teamspace note's title
 */
export function updateTeamspaceNoteTitle(identifier: string, title: string): void {
  const database = getDatabase();
  if (!database) {
    throw new Error('Teamspace database not available');
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
    console.error('Error updating teamspace note title:', error);
    throw new Error(`Failed to update teamspace note title: ${error}`);
  }
}

/**
 * Delete a teamspace note
 */
export function deleteTeamspaceNote(identifier: string): void {
  const database = getDatabase();
  if (!database) {
    throw new Error('Teamspace database not available');
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
    console.error('Error deleting teamspace note:', error);
    throw new Error(`Failed to delete teamspace note: ${error}`);
  }
}

/**
 * Create a folder in a teamspace
 */
export function createTeamspaceFolder(teamspaceId: string, name: string, parent?: string): string {
  const database = getDatabase();
  if (!database) {
    throw new Error('Teamspace database not available');
  }

  const folderId = generateNoteId();
  const filename = `%%NotePlanCloud%%/${teamspaceId}/${folderId}`;
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
    console.error('Error creating teamspace folder:', error);
    throw new Error(`Failed to create teamspace folder: ${error}`);
  }
}

/**
 * Get the default teamspace ID (first one found)
 */
export function getDefaultTeamspaceId(): string | null {
  const teamspaces = listTeamspaces();
  return teamspaces.length > 0 ? teamspaces[0].id : null;
}
