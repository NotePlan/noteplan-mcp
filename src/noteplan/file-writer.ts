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
import {
  readFileUtf8,
  statPath,
  pathExists,
  writeFileUtf8,
  makeDirectory,
  removePath,
  moveFile,
} from '../transport/bridge-fs.js';
import { BridgeHttpError } from '../transport/bridge-client.js';

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

  // Only treat .md and .txt as note extensions — path.extname would incorrectly
  // treat dots in titles (e.g. "21.01 Family") as extension separators.
  const KNOWN_NOTE_EXTENSIONS = ['.md', '.txt'];
  const requestedExt = path.extname(requested);
  const hasKnownExt = KNOWN_NOTE_EXTENSIONS.includes(requestedExt.toLowerCase());
  const requestedBase = hasKnownExt ? path.basename(requested, requestedExt) : requested;
  if (!requestedBase) {
    throw new Error('New filename is invalid');
  }

  if (keepExtension || !hasKnownExt) {
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
 * Use in-place writes for existing files so filesystem birthtime (exposed as
 * createdAt in MCP responses) does not reset on every edit.
 */
export async function writeNoteFile(filePath: string, content: string): Promise<void> {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);
  ensurePathInsideRoot(fullPath, getNotePlanPath(), 'File path');

  const normalizedContent = content.replace(/\r\n/g, '\n');

  if (await pathExists(fullPath)) {
    await writeFileUtf8(fullPath, normalizedContent);
    return;
  }
  try {
    await writeFileUtf8(fullPath, normalizedContent, { exclusive: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const conflict =
      code === 'EEXIST' ||
      code === 'EPERM' ||
      (err instanceof BridgeHttpError && err.status === 409);
    if (conflict) {
      await writeFileUtf8(fullPath, normalizedContent);
      return;
    }
    throw err;
  }
}

/**
 * Create a new project note
 */
export async function createProjectNote(title: string, content: string = '', folder?: string): Promise<string> {
  const safeTitle = sanitizeFilename(title);
  const cleanFolder = folder?.replace(/^Notes\//, '');
  const folderPath = cleanFolder ? path.join('Notes', cleanFolder) : 'Notes';
  const ext = getFileExtension();

  const filePath = path.join(folderPath, `${safeTitle}${ext}`);
  const fullPath = path.join(getNotePlanPath(), filePath);
  const altExt = ext === '.txt' ? '.md' : '.txt';
  const altPath = path.join(getNotePlanPath(), folderPath, `${safeTitle}${altExt}`);

  if (await pathExists(fullPath)) {
    throw new Error(`Note already exists: ${filePath}`);
  }
  if (await pathExists(altPath)) {
    throw new Error(`Note already exists: ${path.join(folderPath, `${safeTitle}${altExt}`)}`);
  }

  const noteContent = content || `# ${title}\n\n`;
  await writeNoteFile(filePath, noteContent);
  return filePath;
}

/**
 * Create or update a calendar note
 */
export async function createCalendarNote(dateStr: string, content: string): Promise<string> {
  const filePath = buildCalendarNotePath(dateStr);
  await writeNoteFile(filePath, content);
  return filePath;
}

/**
 * Append content to a note
 */
export async function appendToNote(filePath: string, content: string): Promise<void> {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);
  ensurePathInsideRoot(fullPath, getNotePlanPath(), 'File path');

  const existingContent = await readFileUtf8(fullPath);
  if (existingContent === null) {
    throw new Error(`Note not found: ${filePath}`);
  }

  const newContent = existingContent.endsWith('\n')
    ? existingContent + content
    : existingContent + '\n' + content;

  await writeNoteFile(filePath, newContent);
}

/**
 * Prepend content to a note (after frontmatter if present)
 */
export async function prependToNote(filePath: string, content: string): Promise<void> {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);
  ensurePathInsideRoot(fullPath, getNotePlanPath(), 'File path');

  const existingContent = await readFileUtf8(fullPath);
  if (existingContent === null) {
    throw new Error(`Note not found: ${filePath}`);
  }

  const lines = existingContent.split('\n');

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
  await writeNoteFile(filePath, lines.join('\n'));
}

/**
 * Update a note's content
 */
export async function updateNote(filePath: string, content: string): Promise<void> {
  const fullPath = toLocalNoteAbsolutePath(filePath);

  if (!(await pathExists(fullPath))) {
    throw new Error(`Note not found: ${filePath}`);
  }

  await writeNoteFile(filePath, content);
}

/**
 * Delete a note (move to trash)
 */
export async function deleteNote(filePath: string): Promise<string> {
  const fullPath = toLocalNoteAbsolutePath(filePath);

  if (!(await pathExists(fullPath))) {
    throw new Error(`Note not found: ${filePath}`);
  }

  if (!isValidNoteExtension(path.basename(fullPath))) {
    throw new Error(
      `Cannot delete: "${path.basename(fullPath)}" is not a note file. Only .md and .txt files are supported.`
    );
  }

  const trashPath = path.join(getNotesPath(), '@Trash');
  if (!(await pathExists(trashPath))) {
    await makeDirectory(trashPath);
  }

  const filename = path.basename(fullPath);
  const trashFilePath = path.join(trashPath, filename);

  let finalTrashPath = trashFilePath;
  let counter = 1;
  while (await pathExists(finalTrashPath)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    finalTrashPath = path.join(trashPath, `${base}-${counter}${ext}`);
    counter++;
  }

  await moveFile(fullPath, finalTrashPath);
  return path.relative(getNotePlanPath(), finalTrashPath);
}

/**
 * Preview local note move target without mutating the filesystem
 */
export async function previewMoveLocalNote(filePath: string, destinationFolder: string): Promise<MoveLocalNotePreview> {
  const fullPath = toLocalNoteAbsolutePath(filePath);
  const sourceStat = await statPath(fullPath);
  if (!sourceStat.exists) {
    throw new Error(`Note not found: ${filePath}`);
  }
  if (sourceStat.isDir) {
    throw new Error(`Not a note file: ${filePath}`);
  }

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
  if (await pathExists(nextAbsolutePath)) {
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
export async function moveLocalNote(filePath: string, destinationFolder: string): Promise<string> {
  const preview = await previewMoveLocalNote(filePath, destinationFolder);
  const sourcePath = path.join(getNotePlanPath(), preview.fromFilename);
  const targetPath = path.join(getNotePlanPath(), preview.toFilename);

  const targetDir = path.dirname(targetPath);
  if (!(await pathExists(targetDir))) {
    await makeDirectory(targetDir);
  }

  await moveFile(sourcePath, targetPath);
  return preview.toFilename;
}

/**
 * Preview restoring a local note from @Trash into Notes
 */
export async function previewRestoreLocalNoteFromTrash(
  filePath: string,
  destinationFolder: string
): Promise<MoveLocalNotePreview> {
  const fullPath = toLocalNoteAbsolutePath(filePath);
  const sourceStat = await statPath(fullPath);
  if (!sourceStat.exists) {
    throw new Error(`Note not found: ${filePath}`);
  }
  if (sourceStat.isDir) {
    throw new Error(`Not a note file: ${filePath}`);
  }

  const trashRoot = path.join(getNotesPath(), '@Trash');
  ensurePathInsideRoot(fullPath, trashRoot, 'Source note');

  const normalizedDestinationFolder = normalizeFolderInput(destinationFolder);
  const destinationDir = path.join(getNotePlanPath(), normalizedDestinationFolder);
  ensurePathInsideRoot(destinationDir, getNotesPath(), 'Destination folder');

  const nextAbsolutePath = path.join(destinationDir, path.basename(fullPath));
  if (await pathExists(nextAbsolutePath)) {
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
export async function restoreLocalNoteFromTrash(filePath: string, destinationFolder: string): Promise<string> {
  const preview = await previewRestoreLocalNoteFromTrash(filePath, destinationFolder);
  const sourcePath = path.join(getNotePlanPath(), preview.fromFilename);
  const targetPath = path.join(getNotePlanPath(), preview.toFilename);
  const targetDir = path.dirname(targetPath);
  if (!(await pathExists(targetDir))) {
    await makeDirectory(targetDir);
  }
  await moveFile(sourcePath, targetPath);
  return preview.toFilename;
}

/**
 * Preview local note rename target without mutating the filesystem
 */
export async function previewRenameLocalNoteFile(
  filePath: string,
  newFilename: string,
  keepExtension = true
): Promise<RenameLocalNotePreview> {
  const fullPath = toLocalNoteAbsolutePath(filePath);
  const sourceStat = await statPath(fullPath);
  if (!sourceStat.exists) {
    throw new Error(`Note not found: ${filePath}`);
  }
  if (sourceStat.isDir) {
    throw new Error(`Not a note file: ${filePath}`);
  }

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
  if (await pathExists(nextAbsolutePath)) {
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
export async function renameLocalNoteFile(
  filePath: string,
  newFilename: string,
  keepExtension = true
): Promise<string> {
  const preview = await previewRenameLocalNoteFile(filePath, newFilename, keepExtension);
  const sourcePath = path.join(getNotePlanPath(), preview.fromFilename);
  const targetPath = path.join(getNotePlanPath(), preview.toFilename);
  await moveFile(sourcePath, targetPath);
  return preview.toFilename;
}

/**
 * Preview creating a local folder under Notes
 */
export async function previewCreateFolder(folderPath: string): Promise<string> {
  const normalized = normalizeLocalFolderPath(folderPath, 'Folder path');
  if (!normalized) {
    throw new Error('Folder path is required');
  }
  const fullPath = path.join(getNotesPath(), normalized);
  ensurePathInsideRoot(fullPath, getNotesPath(), 'Folder path');
  if (await pathExists(fullPath)) {
    throw new Error(`Folder already exists: ${normalized}`);
  }
  return normalized;
}

/**
 * Create a folder in the Notes directory
 */
export async function createFolder(folderPath: string): Promise<string> {
  const normalized = await previewCreateFolder(folderPath);
  const fullPath = path.join(getNotesPath(), normalized);
  if (!(await pathExists(fullPath))) {
    await makeDirectory(fullPath);
  }
  return normalized;
}

/**
 * Preview deleting a local folder (validates and returns normalized path)
 */
export async function previewDeleteLocalFolder(folderPath: string): Promise<string> {
  const normalized = normalizeLocalFolderPath(folderPath, 'Source folder');
  if (!normalized) {
    throw new Error('Folder path is required');
  }
  const fullPath = path.join(getNotesPath(), normalized);
  ensurePathInsideRoot(fullPath, getNotesPath(), 'Source folder');
  const stat = await statPath(fullPath);
  if (!stat.exists) {
    throw new Error(`Folder not found: ${normalized}`);
  }
  if (!stat.isDir) {
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
export async function deleteLocalFolder(folderPath: string): Promise<string> {
  const normalized = await previewDeleteLocalFolder(folderPath);
  const fullPath = path.join(getNotesPath(), normalized);
  const folderName = path.basename(fullPath);

  const trashPath = path.join(getNotesPath(), '@Trash');
  if (!(await pathExists(trashPath))) {
    await makeDirectory(trashPath);
  }

  let targetPath = path.join(trashPath, folderName);
  let counter = 1;
  while (await pathExists(targetPath)) {
    targetPath = path.join(trashPath, `${folderName}-${counter}`);
    counter++;
  }

  await moveFile(fullPath, targetPath);
  return path.relative(getNotePlanPath(), targetPath);
}

/**
 * Preview moving a local folder under Notes
 */
export async function previewMoveLocalFolder(sourceFolder: string, destinationFolder: string): Promise<FolderLocalPreview> {
  const normalizedSource = normalizeLocalFolderPath(sourceFolder, 'Source folder');
  if (!normalizedSource) {
    throw new Error('Source folder is required');
  }
  const sourcePath = path.join(getNotesPath(), normalizedSource);
  ensurePathInsideRoot(sourcePath, getNotesPath(), 'Source folder');
  const sourceStat = await statPath(sourcePath);
  if (!sourceStat.exists) {
    throw new Error(`Source folder not found: ${normalizedSource}`);
  }
  if (!sourceStat.isDir) {
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
  const destStat = await statPath(destinationPath);
  if (!destStat.exists) {
    throw new Error(
      `Destination folder not found: ${normalizedDestination || 'Notes'}`
    );
  }
  if (!destStat.isDir) {
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
  if (await pathExists(targetPath)) {
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
export async function moveLocalFolder(sourceFolder: string, destinationFolder: string): Promise<FolderLocalPreview> {
  const preview = await previewMoveLocalFolder(sourceFolder, destinationFolder);
  const sourcePath = path.join(getNotesPath(), preview.fromFolder);
  const targetPath = path.join(getNotesPath(), preview.toFolder);
  await moveFile(sourcePath, targetPath);
  return preview;
}

/**
 * Preview renaming a local folder in place
 */
export async function previewRenameLocalFolder(sourceFolder: string, newName: string): Promise<FolderLocalPreview> {
  const normalizedSource = normalizeLocalFolderPath(sourceFolder, 'Source folder');
  if (!normalizedSource) {
    throw new Error('Source folder is required');
  }
  const sourcePath = path.join(getNotesPath(), normalizedSource);
  ensurePathInsideRoot(sourcePath, getNotesPath(), 'Source folder');
  const sourceStat = await statPath(sourcePath);
  if (!sourceStat.exists) {
    throw new Error(`Source folder not found: ${normalizedSource}`);
  }
  if (!sourceStat.isDir) {
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
  if (await pathExists(targetPath)) {
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
export async function renameLocalFolder(sourceFolder: string, newName: string): Promise<FolderLocalPreview> {
  const preview = await previewRenameLocalFolder(sourceFolder, newName);
  const sourcePath = path.join(getNotesPath(), preview.fromFolder);
  const targetPath = path.join(getNotesPath(), preview.toFolder);
  await moveFile(sourcePath, targetPath);
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
export async function ensureCalendarNote(dateStr: string): Promise<string> {
  // First try to find an existing note (checks multiple paths/extensions)
  const existingNote = await getCalendarNote(dateStr);
  if (existingNote) {
    return existingNote.filename;
  }

  // Create a new one using detected configuration
  const filePath = buildCalendarNotePath(dateStr);
  await writeNoteFile(filePath, '');
  return filePath;
}
