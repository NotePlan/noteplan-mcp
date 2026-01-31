// File system writer for local NotePlan notes

import * as fs from 'fs';
import * as path from 'path';
import {
  getNotePlanPath,
  getNotesPath,
  getCalendarPath,
  getFileExtension,
  hasYearSubfolders,
  buildCalendarNotePath,
  getCalendarNote,
} from './file-reader.js';

/**
 * Write content to a note file atomically
 * NotePlan's FolderMonitor will detect the change within ~300ms
 */
export function writeNoteFile(filePath: string, content: string): void {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Normalize line endings to Unix style
  const normalizedContent = content.replace(/\r\n/g, '\n');

  // Write atomically: write to temp file, then rename
  const tempPath = `${fullPath}.tmp`;
  fs.writeFileSync(tempPath, normalizedContent, { encoding: 'utf-8' });
  fs.renameSync(tempPath, fullPath);
}

/**
 * Create a new project note
 */
export function createProjectNote(title: string, content: string = '', folder?: string): string {
  // Sanitize title for filename
  const safeTitle = sanitizeFilename(title);
  const folderPath = folder ? path.join('Notes', folder) : 'Notes';
  const ext = getFileExtension(); // Use detected extension

  const filePath = path.join(folderPath, `${safeTitle}${ext}`);

  // Check if file already exists (with any extension)
  const fullPath = path.join(getNotePlanPath(), filePath);
  const altExt = ext === '.txt' ? '.md' : '.txt';
  const altPath = path.join(getNotePlanPath(), folderPath, `${safeTitle}${altExt}`);

  if (fs.existsSync(fullPath)) {
    throw new Error(`Note already exists: ${filePath}`);
  }
  if (fs.existsSync(altPath)) {
    throw new Error(`Note already exists: ${path.join(folderPath, `${safeTitle}${altExt}`)}`);
  }

  // Create content with title as heading if content is empty
  const noteContent = content || `# ${title}\n\n`;

  writeNoteFile(filePath, noteContent);
  return filePath;
}

/**
 * Create or update a calendar note
 */
export function createCalendarNote(dateStr: string, content: string): string {
  // Use the detected configuration for file path
  const filePath = buildCalendarNotePath(dateStr);

  writeNoteFile(filePath, content);
  return filePath;
}

/**
 * Append content to a note
 */
export function appendToNote(filePath: string, content: string): void {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${filePath}`);
  }

  const existingContent = fs.readFileSync(fullPath, 'utf-8');
  const newContent = existingContent.endsWith('\n')
    ? existingContent + content
    : existingContent + '\n' + content;

  writeNoteFile(filePath, newContent);
}

/**
 * Prepend content to a note (after frontmatter if present)
 */
export function prependToNote(filePath: string, content: string): void {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${filePath}`);
  }

  const existingContent = fs.readFileSync(fullPath, 'utf-8');
  const lines = existingContent.split('\n');

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

  // Insert content
  lines.splice(insertIndex, 0, content);
  writeNoteFile(filePath, lines.join('\n'));
}

/**
 * Update a note's content
 */
export function updateNote(filePath: string, content: string): void {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${filePath}`);
  }

  writeNoteFile(filePath, content);
}

/**
 * Delete a note (move to trash)
 */
export function deleteNote(filePath: string): void {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${filePath}`);
  }

  // Move to @Trash folder
  const trashPath = path.join(getNotePlanPath(), '@Trash');
  if (!fs.existsSync(trashPath)) {
    fs.mkdirSync(trashPath, { recursive: true });
  }

  const filename = path.basename(fullPath);
  const trashFilePath = path.join(trashPath, filename);

  // Handle duplicate filenames in trash
  let finalTrashPath = trashFilePath;
  let counter = 1;
  while (fs.existsSync(finalTrashPath)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    finalTrashPath = path.join(trashPath, `${base}-${counter}${ext}`);
    counter++;
  }

  fs.renameSync(fullPath, finalTrashPath);
}

/**
 * Create a folder in the Notes directory
 */
export function createFolder(folderPath: string): void {
  const fullPath = path.join(getNotesPath(), folderPath);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
}

/**
 * Sanitize a string for use as a filename
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-') // Replace illegal characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Ensure a calendar note exists, create if not
 * Returns the path to the existing or newly created note
 */
export function ensureCalendarNote(dateStr: string): string {
  // First try to find an existing note (checks multiple paths/extensions)
  const existingNote = getCalendarNote(dateStr);
  if (existingNote) {
    return existingNote.filename;
  }

  // Create a new one using detected configuration
  const filePath = buildCalendarNotePath(dateStr);
  writeNoteFile(filePath, '');
  return filePath;
}
