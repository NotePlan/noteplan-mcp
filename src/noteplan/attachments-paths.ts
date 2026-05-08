// Path helpers for the per-note `_attachments` sibling folder NotePlan uses
// to store images and other files referenced by a note. Lives in the
// noteplan/ layer so both the tools/attachments.ts API surface and
// file-writer.ts (move/rename/delete) can share the conventions instead
// of duplicating them.

import * as path from 'path';

export const ATTACHMENT_SUFFIX = '_attachments';

/**
 * Get the note base name (filename without extension) that the
 * `_attachments` folder name is derived from. Mirrors NotePlan's
 * `noteUrl.deletingPathExtension().lastPathComponent`.
 */
export function getNoteBaseName(filename: string): string {
  const basename = path.basename(filename);
  const ext = path.extname(basename);
  return ext ? basename.slice(0, -ext.length) : basename;
}

/**
 * Absolute path to the sibling `_attachments` folder for the given note.
 * Pattern: `{noteDir}/{noteName}_attachments`.
 */
export function getAttachmentsAbsolutePath(absoluteNotePath: string): string {
  const noteDir = path.dirname(absoluteNotePath);
  const noteName = getNoteBaseName(absoluteNotePath);
  return path.join(noteDir, `${noteName}${ATTACHMENT_SUFFIX}`);
}
