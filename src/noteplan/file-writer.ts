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
  isValidNoteExtension,
} from './file-reader.js';

/**
 * Rename/move a file, with fallback for sandboxed/mounted filesystems.
 * EPERM/EXDEV: copy + delete instead of atomic rename.
 */
function moveFile(source: string, destination: string): void {
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EXDEV') {
      fs.copyFileSync(source, destination);
      fs.unlinkSync(source);
    } else {
      throw error;
    }
  }
}

function ensurePathInsideRoot(candidatePath: string, rootPath: string, label: string): void {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(rootPath);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`${label} must be inside ${path.basename(rootPath)}`);
  }
}

function toLocalNoteAbsolutePath(filePath: string): string {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);
  ensurePathInsideRoot(fullPath, getNotePlanPath(), 'File path');
  return fullPath;
}

function normalizeLocalFolderPath(folderPath: string, label = 'Folder path'): string {
  const notesRoot = path.resolve(getNotesPath());
  let normalized = folderPath.trim().replace(/\\/g, '/');
  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  if (path.isAbsolute(folderPath)) {
    const absoluteInput = path.resolve(folderPath);
    ensurePathInsideRoot(absoluteInput, notesRoot, label);
    normalized = path.relative(notesRoot, absoluteInput).replace(/\\/g, '/');
  }

  normalized = normalized.replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === '.') {
    return '';
  }
  if (normalized === 'Notes') {
    return '';
  }
  if (normalized.startsWith('Notes/')) {
    normalized = normalized.slice('Notes/'.length);
  }
  if (!normalized || normalized === '.') {
    return '';
  }

  if (normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} is invalid`);
  }

  return normalized;
}

/**
 * Map common folder aliases to their actual NotePlan @ folder names.
 * Only applies when the literal folder doesn't exist but the @ variant does.
 * E.g. "Archive" → "@Archive" (if Notes/Archive doesn't exist but Notes/@Archive does)
 */
const FOLDER_ALIASES: Record<string, string> = {
  archive: '@Archive',
  trash: '@Trash',
  templates: '@Templates',
};

function resolveAlias(segment: string, parentDir: string): string {
  const alias = FOLDER_ALIASES[segment.toLowerCase()];
  if (!alias) return segment;

  const literalPath = path.join(parentDir, segment);
  if (fs.existsSync(literalPath)) return segment; // user has a literal folder, use it

  const aliasPath = path.join(parentDir, alias);
  if (fs.existsSync(aliasPath)) return alias; // @ folder exists, use it

  return segment; // neither exists, keep as-is
}

function normalizeFolderInput(folderPath: string): string {
  let normalized = folderPath.trim().replace(/\\/g, '/');
  normalized = normalized.replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    throw new Error('Destination folder is required');
  }
  // Strip leading "Notes/" prefix before resolving aliases
  let withoutPrefix = normalized;
  if (withoutPrefix.startsWith('Notes/')) {
    withoutPrefix = withoutPrefix.slice('Notes/'.length);
  } else if (withoutPrefix === 'Notes') {
    return 'Notes';
  }
  // Resolve aliases segment by segment, checking filesystem at each level
  const rootDir = getNotesPath();
  const segments = withoutPrefix.split('/');
  let currentDir = rootDir;
  for (let i = 0; i < segments.length; i++) {
    segments[i] = resolveAlias(segments[i], currentDir);
    currentDir = path.join(currentDir, segments[i]);
  }
  return `Notes/${segments.join('/')}`;
}

function normalizeMoveDestinationFolderInput(
  destinationFolder: string,
  sourceFilename: string
): string {
  let normalized = destinationFolder.trim().replace(/\\/g, '/');
  normalized = normalized.replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    throw new Error('Destination folder is required');
  }

  const sourceBasename = path.basename(sourceFilename).toLowerCase();
  const lastSegment = path.posix.basename(normalized);
  const hasFileExtension = path.posix.extname(lastSegment).length > 0;

  if (hasFileExtension) {
    if (lastSegment.toLowerCase() === sourceBasename) {
      normalized = path.posix.dirname(normalized);
      if (normalized === '.' || normalized.trim().length === 0) {
        throw new Error('Destination folder is required');
      }
    } else {
      throw new Error(
        'destinationFolder must be a folder path, not a filename. Use noteplan_rename_note_file to change filenames.'
      );
    }
  }

  return normalizeFolderInput(normalized);
}

function resolveRenameInputInCurrentFolder(
  currentFullPath: string,
  newFilename: string
): string {
  const notePlanRoot = path.resolve(getNotePlanPath());
  const currentFolderRelative = path
    .relative(notePlanRoot, path.dirname(currentFullPath))
    .replace(/\\/g, '/');
  const normalizedCurrentFolder = currentFolderRelative === '.' ? '' : currentFolderRelative;

  let normalizedInput = newFilename.trim().replace(/\\/g, '/');
  if (!normalizedInput) {
    throw new Error('New filename is required');
  }

  if (path.isAbsolute(newFilename)) {
    const absoluteInput = path.resolve(newFilename);
    ensurePathInsideRoot(absoluteInput, notePlanRoot, 'New filename path');
    normalizedInput = path.relative(notePlanRoot, absoluteInput).replace(/\\/g, '/');
  }

  normalizedInput = normalizedInput.replace(/^\/+|\/+$/g, '');
  if (!normalizedInput) {
    throw new Error('New filename is required');
  }

  const hasPathSegments = normalizedInput.includes('/');
  if (!hasPathSegments) {
    return normalizedInput;
  }

  const inputDirRaw = path.posix.dirname(normalizedInput);
  const inputBase = path.posix.basename(normalizedInput);
  if (!inputBase || inputBase === '.') {
    throw new Error('New filename is invalid');
  }

  let normalizedInputDir = inputDirRaw === '.' ? '' : inputDirRaw;
  if (normalizedInputDir && !normalizedInputDir.startsWith('Notes/')) {
    normalizedInputDir = normalizedInputDir === 'Notes' ? 'Notes' : `Notes/${normalizedInputDir}`;
  }

  if (
    normalizedCurrentFolder &&
    normalizedInputDir &&
    normalizedInputDir !== normalizedCurrentFolder
  ) {
    throw new Error(
      'newFilename must stay in the same folder. Use noteplan_move_note to move across folders.'
    );
  }

  return inputBase;
}

function resolveRenamedFilename(
  currentFullPath: string,
  newFilename: string,
  keepExtension: boolean
): string {
  const currentFilename = path.basename(currentFullPath);
  const currentExt = path.extname(currentFilename);
  const requestedInput = resolveRenameInputInCurrentFolder(currentFullPath, newFilename);
  const requested = sanitizeFilename(requestedInput);
  if (!requested) {
    throw new Error('New filename is required');
  }
  const requestedExt = path.extname(requested);
  const requestedBase = path.basename(requested, requestedExt);
  if (!requestedBase) {
    throw new Error('New filename is invalid');
  }

  if (keepExtension || !requestedExt) {
    return `${requestedBase}${currentExt}`;
  }
  return `${requestedBase}${requestedExt}`;
}

export interface MoveLocalNotePreview {
  fromFilename: string;
  toFilename: string;
  destinationFolder: string;
}

export interface RenameLocalNotePreview {
  fromFilename: string;
  toFilename: string;
}

export interface FolderLocalPreview {
  fromFolder: string;
  toFolder: string;
  destinationFolder?: string;
}

/**
 * Write content to a note file atomically
 * NotePlan's FolderMonitor will detect the change within ~300ms.
 *
 * Important: use in-place writes for existing files so filesystem birthtime
 * (used as createdAt in MCP responses) does not reset on every edit.
 */
export function writeNoteFile(filePath: string, content: string): void {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);
  ensurePathInsideRoot(fullPath, getNotePlanPath(), 'File path');

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Normalize line endings to Unix style
  const normalizedContent = content.replace(/\r\n/g, '\n');

  // Preserve createdAt for existing notes by avoiding temp-file rename.
  // Renaming a temp file replaces the inode and resets birthtime.
  if (fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, normalizedContent, { encoding: 'utf-8' });
    return;
  }

  // For new files, create exclusively to avoid accidental overwrite races.
  try {
    fs.writeFileSync(fullPath, normalizedContent, { encoding: 'utf-8', flag: 'wx' });
  } catch (error) {
    const maybeErrno = error as NodeJS.ErrnoException;
    if (maybeErrno.code === 'EEXIST' || maybeErrno.code === 'EPERM') {
      // EEXIST: file appeared between existsSync and writeFileSync — safe to overwrite.
      // EPERM: sandboxed/mounted filesystems (e.g. Claude Co-Work, iCloud FUSE) may not
      //   support O_EXCL (wx flag). Fall back to plain write.
      fs.writeFileSync(fullPath, normalizedContent, { encoding: 'utf-8' });
      return;
    }
    throw error;
  }
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
  ensurePathInsideRoot(fullPath, getNotePlanPath(), 'File path');

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
  ensurePathInsideRoot(fullPath, getNotePlanPath(), 'File path');

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
  const fullPath = toLocalNoteAbsolutePath(filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${filePath}`);
  }

  writeNoteFile(filePath, content);
}

/**
 * Delete a note (move to trash)
 */
export function deleteNote(filePath: string): string {
  const fullPath = toLocalNoteAbsolutePath(filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${filePath}`);
  }

  // Reject non-text files (e.g. .key, .pdf) — only .md and .txt are valid notes
  if (!isValidNoteExtension(path.basename(fullPath))) {
    throw new Error(
      `Cannot delete: "${path.basename(fullPath)}" is not a note file. Only .md and .txt files are supported.`
    );
  }

  // Move to Notes/@Trash (matching NotePlan's own moveToTrash behavior)
  const trashPath = path.join(getNotesPath(), '@Trash');
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

  moveFile(fullPath, finalTrashPath);
  return path.relative(getNotePlanPath(), finalTrashPath);
}

/**
 * Preview local note move target without mutating the filesystem
 */
export function previewMoveLocalNote(filePath: string, destinationFolder: string): MoveLocalNotePreview {
  const fullPath = toLocalNoteAbsolutePath(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${filePath}`);
  }
  if (fs.statSync(fullPath).isDirectory()) {
    throw new Error(`Not a note file: ${filePath}`);
  }

  // Reject non-text files (e.g. .key, .pdf) — only .md and .txt are valid notes
  if (!isValidNoteExtension(path.basename(fullPath))) {
    throw new Error(
      `Cannot move: "${path.basename(fullPath)}" is not a note file. Only .md and .txt files are supported.`
    );
  }

  const notesRoot = getNotesPath();
  ensurePathInsideRoot(fullPath, notesRoot, 'Source note');

  const normalizedDestinationFolder = normalizeMoveDestinationFolderInput(
    destinationFolder,
    path.basename(fullPath)
  );
  const destinationDir = path.join(getNotePlanPath(), normalizedDestinationFolder);
  ensurePathInsideRoot(destinationDir, notesRoot, 'Destination folder');

  const nextAbsolutePath = path.join(destinationDir, path.basename(fullPath));
  if (path.resolve(nextAbsolutePath) === path.resolve(fullPath)) {
    throw new Error('Note is already in the destination folder');
  }
  if (fs.existsSync(nextAbsolutePath)) {
    throw new Error(`A note already exists at destination: ${path.relative(getNotePlanPath(), nextAbsolutePath)}`);
  }

  return {
    fromFilename: path.relative(getNotePlanPath(), fullPath),
    toFilename: path.relative(getNotePlanPath(), nextAbsolutePath),
    destinationFolder: normalizedDestinationFolder,
  };
}

/**
 * Move a local note to another folder
 */
export function moveLocalNote(filePath: string, destinationFolder: string): string {
  const preview = previewMoveLocalNote(filePath, destinationFolder);
  const sourcePath = path.join(getNotePlanPath(), preview.fromFilename);
  const targetPath = path.join(getNotePlanPath(), preview.toFilename);

  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  moveFile(sourcePath, targetPath);
  return preview.toFilename;
}

/**
 * Preview restoring a local note from @Trash into Notes
 */
export function previewRestoreLocalNoteFromTrash(
  filePath: string,
  destinationFolder: string
): MoveLocalNotePreview {
  const fullPath = toLocalNoteAbsolutePath(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${filePath}`);
  }
  if (fs.statSync(fullPath).isDirectory()) {
    throw new Error(`Not a note file: ${filePath}`);
  }

  const trashRoot = path.join(getNotesPath(), '@Trash');
  ensurePathInsideRoot(fullPath, trashRoot, 'Source note');

  const normalizedDestinationFolder = normalizeFolderInput(destinationFolder);
  const destinationDir = path.join(getNotePlanPath(), normalizedDestinationFolder);
  ensurePathInsideRoot(destinationDir, getNotesPath(), 'Destination folder');

  const nextAbsolutePath = path.join(destinationDir, path.basename(fullPath));
  if (fs.existsSync(nextAbsolutePath)) {
    throw new Error(`A note already exists at destination: ${path.relative(getNotePlanPath(), nextAbsolutePath)}`);
  }

  return {
    fromFilename: path.relative(getNotePlanPath(), fullPath),
    toFilename: path.relative(getNotePlanPath(), nextAbsolutePath),
    destinationFolder: normalizedDestinationFolder,
  };
}

/**
 * Restore a local note from @Trash into Notes
 */
export function restoreLocalNoteFromTrash(filePath: string, destinationFolder: string): string {
  const preview = previewRestoreLocalNoteFromTrash(filePath, destinationFolder);
  const sourcePath = path.join(getNotePlanPath(), preview.fromFilename);
  const targetPath = path.join(getNotePlanPath(), preview.toFilename);
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  moveFile(sourcePath, targetPath);
  return preview.toFilename;
}

/**
 * Preview local note rename target without mutating the filesystem
 */
export function previewRenameLocalNoteFile(
  filePath: string,
  newFilename: string,
  keepExtension = true
): RenameLocalNotePreview {
  const fullPath = toLocalNoteAbsolutePath(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${filePath}`);
  }
  if (fs.statSync(fullPath).isDirectory()) {
    throw new Error(`Not a note file: ${filePath}`);
  }

  // Reject non-text files (e.g. .key, .pdf) — only .md and .txt are valid notes
  if (!isValidNoteExtension(path.basename(fullPath))) {
    throw new Error(
      `Cannot rename: "${path.basename(fullPath)}" is not a note file. Only .md and .txt files are supported.`
    );
  }

  const notesRoot = getNotesPath();
  ensurePathInsideRoot(fullPath, notesRoot, 'Source note');

  const nextBasename = resolveRenamedFilename(fullPath, newFilename, keepExtension);
  const nextAbsolutePath = path.join(path.dirname(fullPath), nextBasename);
  if (path.resolve(nextAbsolutePath) === path.resolve(fullPath)) {
    throw new Error('New filename matches current filename');
  }
  if (fs.existsSync(nextAbsolutePath)) {
    throw new Error(`A note already exists with filename: ${path.relative(getNotePlanPath(), nextAbsolutePath)}`);
  }

  return {
    fromFilename: path.relative(getNotePlanPath(), fullPath),
    toFilename: path.relative(getNotePlanPath(), nextAbsolutePath),
  };
}

/**
 * Rename a local note file inside the same folder
 */
export function renameLocalNoteFile(
  filePath: string,
  newFilename: string,
  keepExtension = true
): string {
  const preview = previewRenameLocalNoteFile(filePath, newFilename, keepExtension);
  const sourcePath = path.join(getNotePlanPath(), preview.fromFilename);
  const targetPath = path.join(getNotePlanPath(), preview.toFilename);
  moveFile(sourcePath, targetPath);
  return preview.toFilename;
}

/**
 * Preview creating a local folder under Notes
 */
export function previewCreateFolder(folderPath: string): string {
  const normalized = normalizeLocalFolderPath(folderPath, 'Folder path');
  if (!normalized) {
    throw new Error('Folder path is required');
  }
  const fullPath = path.join(getNotesPath(), normalized);
  ensurePathInsideRoot(fullPath, getNotesPath(), 'Folder path');
  if (fs.existsSync(fullPath)) {
    throw new Error(`Folder already exists: ${normalized}`);
  }
  return normalized;
}

/**
 * Create a folder in the Notes directory
 */
export function createFolder(folderPath: string): string {
  const normalized = previewCreateFolder(folderPath);
  const fullPath = path.join(getNotesPath(), normalized);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
  return normalized;
}

/**
 * Preview deleting a local folder (validates and returns normalized path)
 */
export function previewDeleteLocalFolder(folderPath: string): string {
  const normalized = normalizeLocalFolderPath(folderPath, 'Source folder');
  if (!normalized) {
    throw new Error('Folder path is required');
  }
  const fullPath = path.join(getNotesPath(), normalized);
  ensurePathInsideRoot(fullPath, getNotesPath(), 'Source folder');
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Folder not found: ${normalized}`);
  }
  if (!fs.statSync(fullPath).isDirectory()) {
    throw new Error(`Not a folder: ${normalized}`);
  }

  const folderName = path.basename(fullPath);
  if (folderName.toLowerCase() === '@trash') {
    throw new Error('Cannot delete the @Trash folder');
  }

  return normalized;
}

/**
 * Delete a local folder (move to @Trash)
 */
export function deleteLocalFolder(folderPath: string): string {
  const normalized = previewDeleteLocalFolder(folderPath);
  const fullPath = path.join(getNotesPath(), normalized);
  const folderName = path.basename(fullPath);

  // Move to Notes/@Trash (matching NotePlan's own moveToTrash behavior)
  const trashPath = path.join(getNotesPath(), '@Trash');
  if (!fs.existsSync(trashPath)) {
    fs.mkdirSync(trashPath, { recursive: true });
  }

  let targetPath = path.join(trashPath, folderName);
  let counter = 1;
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(trashPath, `${folderName}-${counter}`);
    counter++;
  }

  moveFile(fullPath, targetPath);
  return path.relative(getNotePlanPath(), targetPath);
}

/**
 * Preview moving a local folder under Notes
 */
export function previewMoveLocalFolder(sourceFolder: string, destinationFolder: string): FolderLocalPreview {
  const normalizedSource = normalizeLocalFolderPath(sourceFolder, 'Source folder');
  if (!normalizedSource) {
    throw new Error('Source folder is required');
  }
  const sourcePath = path.join(getNotesPath(), normalizedSource);
  ensurePathInsideRoot(sourcePath, getNotesPath(), 'Source folder');
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source folder not found: ${normalizedSource}`);
  }
  if (!fs.statSync(sourcePath).isDirectory()) {
    throw new Error(`Source is not a folder: ${normalizedSource}`);
  }

  const normalizedDestination = normalizeLocalFolderPath(
    destinationFolder,
    'Destination folder'
  );
  const destinationPath = normalizedDestination
    ? path.join(getNotesPath(), normalizedDestination)
    : getNotesPath();
  ensurePathInsideRoot(destinationPath, getNotesPath(), 'Destination folder');
  if (!fs.existsSync(destinationPath)) {
    throw new Error(
      `Destination folder not found: ${normalizedDestination || 'Notes'}`
    );
  }
  if (!fs.statSync(destinationPath).isDirectory()) {
    throw new Error('Destination is not a folder');
  }
  if (
    path.resolve(destinationPath) === path.resolve(sourcePath) ||
    path.resolve(destinationPath).startsWith(`${path.resolve(sourcePath)}${path.sep}`)
  ) {
    throw new Error('Cannot move a folder into itself or one of its descendants');
  }

  const targetPath = path.join(destinationPath, path.basename(sourcePath));
  if (path.resolve(targetPath) === path.resolve(sourcePath)) {
    throw new Error('Folder is already in the destination');
  }
  if (fs.existsSync(targetPath)) {
    throw new Error(
      `A folder already exists at destination: ${path.relative(getNotesPath(), targetPath)}`
    );
  }

  return {
    fromFolder: normalizedSource,
    toFolder: path.relative(getNotesPath(), targetPath).replace(/\\/g, '/'),
    destinationFolder: normalizedDestination || 'Notes',
  };
}

/**
 * Move a local folder under Notes
 */
export function moveLocalFolder(sourceFolder: string, destinationFolder: string): FolderLocalPreview {
  const preview = previewMoveLocalFolder(sourceFolder, destinationFolder);
  const sourcePath = path.join(getNotesPath(), preview.fromFolder);
  const targetPath = path.join(getNotesPath(), preview.toFolder);
  moveFile(sourcePath, targetPath);
  return preview;
}

/**
 * Preview renaming a local folder in place
 */
export function previewRenameLocalFolder(sourceFolder: string, newName: string): FolderLocalPreview {
  const normalizedSource = normalizeLocalFolderPath(sourceFolder, 'Source folder');
  if (!normalizedSource) {
    throw new Error('Source folder is required');
  }
  const sourcePath = path.join(getNotesPath(), normalizedSource);
  ensurePathInsideRoot(sourcePath, getNotesPath(), 'Source folder');
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source folder not found: ${normalizedSource}`);
  }
  if (!fs.statSync(sourcePath).isDirectory()) {
    throw new Error(`Source is not a folder: ${normalizedSource}`);
  }

  let normalizedInput = newName.trim().replace(/\\/g, '/');
  if (!normalizedInput) {
    throw new Error('New folder name is required');
  }
  if (path.isAbsolute(newName)) {
    const absoluteInput = path.resolve(newName);
    ensurePathInsideRoot(absoluteInput, getNotesPath(), 'New folder name path');
    normalizedInput = path.relative(getNotesPath(), absoluteInput).replace(/\\/g, '/');
  }
  normalizedInput = normalizedInput.replace(/^\/+|\/+$/g, '');
  if (!normalizedInput) {
    throw new Error('New folder name is required');
  }

  if (normalizedInput.includes('/')) {
    const expectedParent = path.dirname(normalizedSource).replace(/\\/g, '/');
    let providedParent = path.posix.dirname(normalizedInput);
    if (providedParent === 'Notes') {
      providedParent = '';
    } else if (providedParent.startsWith('Notes/')) {
      providedParent = providedParent.slice('Notes/'.length);
    }
    if (providedParent === '.') {
      providedParent = '';
    }
    if ((expectedParent === '.' ? '' : expectedParent) !== providedParent) {
      throw new Error(
        'newName must stay in the same parent folder. Use folder move to change parent.'
      );
    }
    normalizedInput = path.posix.basename(normalizedInput);
  }

  const safeName = sanitizeFilename(normalizedInput);
  if (!safeName) {
    throw new Error('New folder name is invalid');
  }

  const targetPath = path.join(path.dirname(sourcePath), safeName);
  if (path.resolve(targetPath) === path.resolve(sourcePath)) {
    throw new Error('New folder name matches current name');
  }
  if (fs.existsSync(targetPath)) {
    throw new Error(
      `A folder with this name already exists: ${path.relative(getNotesPath(), targetPath)}`
    );
  }

  return {
    fromFolder: normalizedSource,
    toFolder: path.relative(getNotesPath(), targetPath).replace(/\\/g, '/'),
  };
}

/**
 * Rename a local folder in place
 */
export function renameLocalFolder(sourceFolder: string, newName: string): FolderLocalPreview {
  const preview = previewRenameLocalFolder(sourceFolder, newName);
  const sourcePath = path.join(getNotesPath(), preview.fromFolder);
  const targetPath = path.join(getNotesPath(), preview.toFolder);
  moveFile(sourcePath, targetPath);
  return preview;
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
