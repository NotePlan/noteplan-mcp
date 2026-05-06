// Attachment operations for NotePlan notes

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';
import { getNotePlanPath } from '../noteplan/file-reader.js';
import {
  pathExists,
  statPath,
  readDir,
  makeDirectory,
  removePath,
  moveFile,
  readFileUtf8,
  writeFileUtf8,
  readFileBinary,
  writeFileBinary,
  toRelative,
} from '../transport/bridge-fs.js';
import { getBridgeClient } from '../transport/bridge-availability.js';

// ── Constants (mirrors FileAttachments.swift) ──

const ATTACHMENT_SUFFIX = '_attachments';

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'heic', 'heif',
]);

// ── Schema ──

export const attachmentsSchema = z.object({
  action: z.enum(['add', 'list', 'get', 'move']).describe('Action to perform'),
  // Note targeting (same pattern as other tools)
  id: z.string().optional().describe('Note ID'),
  filename: z.string().optional().describe('Note filename/path'),
  title: z.string().optional().describe('Note title (fuzzy matched)'),
  date: z.string().optional().describe('Calendar note date (YYYYMMDD or YYYY-MM-DD)'),
  query: z.string().optional().describe('Search query to find the note'),
  space: z.string().optional().describe('Space name or ID'),
  // Add action params
  data: z.string().optional().describe('Base64-encoded file data — required for add'),
  attachmentFilename: z.string().optional().describe('Filename for the attachment (e.g. "photo.png") — required for add and get'),
  mimeType: z.string().optional().describe('MIME type hint (e.g. "image/png") — used by add'),
  insertLink: z.boolean().optional().default(false).describe('Insert a markdown link into the note — used by add (default: false). The AI should usually place links itself via noteplan_edit_content for precise positioning.'),
  // Move action params
  destinationId: z.string().optional().describe('Destination note ID — used by move'),
  destinationFilename: z.string().optional().describe('Destination note filename — used by move'),
  destinationTitle: z.string().optional().describe('Destination note title — used by move'),
  destinationDate: z.string().optional().describe('Destination calendar note date — used by move'),
  // Get action params
  includeData: z.boolean().optional().default(false).describe('Include base64 data in response — used by get'),
  maxDataSize: z.number().optional().describe('Max base64 data size in bytes — used by get. Images are downscaled to fit. Omit for full size.'),
});

// ── Helpers (mirrors FileAttachments.swift patterns) ──

/**
 * Sanitize filename by removing markdown-conflicting characters.
 * Mirrors FileAttachments.cleanImageNameFromMarkdownConflicts()
 */
function cleanFilename(name: string): string {
  return name.replace(/[()[\]!]/g, '');
}

/**
 * Get the note name (filename without extension) for building the attachments folder name.
 * Mirrors: noteUrl.deletingPathExtension().lastPathComponent
 */
function getNoteBaseName(noteFilename: string): string {
  const basename = path.basename(noteFilename);
  const ext = path.extname(basename);
  return ext ? basename.slice(0, -ext.length) : basename;
}

/**
 * Get the absolute path to a note's attachments folder.
 * Pattern: {noteDir}/{noteName}_attachments/
 */
function getAttachmentsFolderPath(noteFilename: string): string {
  const notePlanPath = getNotePlanPath();
  const fullNotePath = path.isAbsolute(noteFilename)
    ? noteFilename
    : path.join(notePlanPath, noteFilename);
  const noteDir = path.dirname(fullNotePath);
  const noteName = getNoteBaseName(fullNotePath);
  return path.join(noteDir, `${noteName}${ATTACHMENT_SUFFIX}`);
}

/**
 * Get the relative markdown link path for an attachment.
 * Mirrors: url.pathComponents.suffix(2).joined(separator: "/")
 * Returns: "noteName_attachments/filename.png"
 */
function getRelativeAttachmentPath(noteFilename: string, attachmentFilename: string): string {
  const noteName = getNoteBaseName(noteFilename);
  return `${noteName}${ATTACHMENT_SUFFIX}/${attachmentFilename}`;
}

/**
 * Percent-encode special characters in paths for markdown links.
 * Mirrors: FileAttachments.encoded()
 */
function encodePath(filePath: string): string {
  return filePath
    .replace(/%/g, '%25')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/ /g, '%20');
}

/**
 * Check if a file is an image based on extension.
 */
function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Generate the markdown link for an attachment.
 * Images: ![image](relativePath)
 * Files:  ![file](relativePath)
 */
function toMarkdownLink(noteFilename: string, attachmentFilename: string): string {
  const relativePath = getRelativeAttachmentPath(noteFilename, attachmentFilename);
  const encoded = encodePath(relativePath);
  const alt = isImageFile(attachmentFilename) ? 'image' : 'file';
  return `![${alt}](${encoded})`;
}

/**
 * Ensure path is inside the NotePlan root directory.
 */
function ensureInsideRoot(targetPath: string): boolean {
  const notePlanPath = getNotePlanPath();
  const resolvedPath = path.resolve(targetPath);
  const resolvedRoot = path.resolve(notePlanPath);
  return resolvedPath.startsWith(`${resolvedRoot}${path.sep}`);
}

// ── Note resolution (shared pattern with other tools) ──

async function resolveNoteForAttachment(params: {
  id?: string;
  filename?: string;
  title?: string;
  date?: string;
  query?: string;
  space?: string;
}): Promise<{
  note: Awaited<ReturnType<typeof store.getNote>>;
  error?: string;
}> {
  const { id, filename, title, date, query, space } = params;

  if (id?.trim()) {
    const note = await store.getNote({ id: id.trim(), space: space?.trim() })
      ??  await store.getNote({ filename: id.trim(), space: space?.trim() });
    return { note, error: note ? undefined : `Note not found: ${id}` };
  }

  if (filename?.trim()) {
    const note = await store.getNote({ filename: filename.trim(), space: space?.trim() });
    return { note, error: note ? undefined : `Note not found: ${filename}` };
  }

  if (date?.trim()) {
    const note = await store.getNote({ date: date.trim(), space: space?.trim() });
    return { note, error: note ? undefined : `Calendar note not found for date: ${date}` };
  }

  const textQuery = title?.trim() || query?.trim();
  if (textQuery) {
    const note = await store.getNote({ title: textQuery, space: space?.trim() });
    if (note) {
      return { note };
    }
    return { note: null, error: `No note found matching: ${textQuery}` };
  }

  return { note: null, error: 'Provide id, filename, title, date, or query to identify the note' };
}

// ── Actions ──

/**
 * Add an attachment to a note.
 * - Decodes base64 data
 * - Creates the _attachments folder if needed
 * - Writes the file
 * - Returns the markdown link for the AI to place where it wants
 */
export async function addAttachment(params: z.infer<typeof attachmentsSchema>) {
  const { data, attachmentFilename } = params;

  if (!data) {
    return { success: false, error: 'data (base64-encoded file content) is required for add' };
  }
  if (!attachmentFilename) {
    return { success: false, error: 'attachmentFilename is required for add' };
  }

  const { note, error } = await resolveNoteForAttachment(params);
  if (!note) {
    return { success: false, error: error || 'Note not found' };
  }

  if (note.source === 'space') {
    return { success: false, error: 'Attachments are not supported for Space notes (no local filesystem path)' };
  }

  const cleanName = cleanFilename(attachmentFilename);
  if (!cleanName || cleanName.trim().length === 0) {
    return { success: false, error: 'Invalid attachment filename after sanitization' };
  }

  const attachmentsFolder = getAttachmentsFolderPath(note.filename);
  const attachmentPath = path.join(attachmentsFolder, cleanName);

  if (!ensureInsideRoot(attachmentPath)) {
    return { success: false, error: 'Attachment path escapes NotePlan directory' };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(data, 'base64');
  } catch {
    return { success: false, error: 'Invalid base64 data' };
  }

  if (buffer.length === 0) {
    return { success: false, error: 'Decoded attachment data is empty' };
  }

  // writeFileBinary creates the parent dir itself, so no explicit mkdir.
  await writeFileBinary(attachmentPath, buffer);

  const markdownLink = toMarkdownLink(note.filename, cleanName);

  // Only insert link if explicitly requested (default: false)
  if (params.insertLink === true) {
    const fullNotePath = path.join(getNotePlanPath(), note.filename);
    const content = (await readFileUtf8(fullNotePath)) ?? '';
    const newContent = content.endsWith('\n')
      ? content + markdownLink + '\n'
      : content + '\n' + markdownLink + '\n';
    await writeFileUtf8(fullNotePath, newContent);
  }

  return {
    success: true,
    attachmentPath: getRelativeAttachmentPath(note.filename, cleanName),
    markdownLink,
    noteFilename: note.filename,
    noteTitle: note.title,
    fileSize: buffer.length,
    isImage: isImageFile(cleanName),
    linkInserted: params.insertLink === true,
    hint: params.insertLink === true
      ? undefined
      : 'Use noteplan_edit_content to place the markdownLink where you want it in the note.',
  };
}

/**
 * List attachments for a note.
 */
export async function listAttachments(params: z.infer<typeof attachmentsSchema>) {
  const { note, error } = await resolveNoteForAttachment(params);
  if (!note) {
    return { success: false, error: error || 'Note not found' };
  }

  if (note.source === 'space') {
    return { success: false, error: 'Attachments are not supported for Space notes' };
  }

  const attachmentsFolder = getAttachmentsFolderPath(note.filename);

  if (!(await pathExists(attachmentsFolder))) {
    return {
      success: true,
      noteFilename: note.filename,
      noteTitle: note.title,
      attachmentsFolder: getRelativeAttachmentPath(note.filename, '').slice(0, -1),
      count: 0,
      attachments: [],
    };
  }

  // Bridge.list returns size+mtime per entry in one round-trip; falls back
  // to fs.promises.readdir + a stat per entry when the bridge isn't there.
  const bridge = await getBridgeClient();
  type Entry = { name: string; isDir: boolean; size: number; modifiedAt: string };
  let entries: Entry[];
  if (bridge) {
    const rows = await bridge.list(toRelative(attachmentsFolder));
    entries = rows.map((r) => ({
      name: r.name,
      isDir: r.isDir,
      size: r.size,
      modifiedAt: new Date(r.mtime).toISOString(),
    }));
  } else {
    const dirents = await fs.promises.readdir(attachmentsFolder, { withFileTypes: true });
    entries = await Promise.all(
      dirents.map(async (e) => {
        const stats = await fs.promises.stat(path.join(attachmentsFolder, e.name));
        return {
          name: e.name,
          isDir: e.isDirectory(),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        };
      }),
    );
  }
  const attachments = entries
    .filter((e) => !e.isDir && !e.name.startsWith('.'))
    .map((e) => ({
      filename: e.name,
      relativePath: getRelativeAttachmentPath(note.filename, e.name),
      markdownLink: toMarkdownLink(note.filename, e.name),
      isImage: isImageFile(e.name),
      size: e.size,
      modifiedAt: e.modifiedAt,
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));

  return {
    success: true,
    noteFilename: note.filename,
    noteTitle: note.title,
    attachmentsFolder: getRelativeAttachmentPath(note.filename, '').slice(0, -1),
    count: attachments.length,
    attachments,
  };
}

/**
 * Get a specific attachment's metadata and optionally its base64 data.
 */
export async function getAttachment(params: z.infer<typeof attachmentsSchema>) {
  const attachmentName = params.attachmentFilename;

  if (!attachmentName) {
    return { success: false, error: 'attachmentFilename is required for get' };
  }

  const { note, error } = await resolveNoteForAttachment(params);
  if (!note) {
    return { success: false, error: error || 'Note not found' };
  }

  if (note.source === 'space') {
    return { success: false, error: 'Attachments are not supported for Space notes' };
  }

  const attachmentsFolder = getAttachmentsFolderPath(note.filename);
  const filePath = path.join(attachmentsFolder, cleanFilename(attachmentName));

  if (!ensureInsideRoot(filePath)) {
    return { success: false, error: 'Attachment path escapes NotePlan directory' };
  }

  const stats = await statPath(filePath);
  if (!stats.exists) {
    return { success: false, error: `Attachment not found: ${attachmentName}` };
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4',
    txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  };

  const result: Record<string, unknown> = {
    success: true,
    filename: path.basename(filePath),
    relativePath: getRelativeAttachmentPath(note.filename, path.basename(filePath)),
    markdownLink: toMarkdownLink(note.filename, path.basename(filePath)),
    isImage: isImageFile(filePath),
    mimeType: mimeMap[ext] || 'application/octet-stream',
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    noteFilename: note.filename,
    noteTitle: note.title,
  };

  if (params.includeData) {
    const fileData = (await readFileBinary(filePath)) ?? Buffer.alloc(0);
    const maxSize = params.maxDataSize;

    if (maxSize && isImageFile(filePath) && fileData.length > maxSize) {
      // Return a size warning instead of truncated data
      result.data = null;
      result.dataTruncated = true;
      result.originalSize = fileData.length;
      result.hint = `Image is ${fileData.length} bytes (${Math.round(fileData.length / 1024)}KB). Base64 would be ~${Math.round(fileData.length * 1.37 / 1024)}KB. Consider using a smaller maxDataSize or accessing the file directly.`;
    } else {
      result.data = fileData.toString('base64');
    }
  }

  return result;
}

/**
 * Move an attachment from one note to another.
 * - Moves the file on disk
 * - Removes the old markdown link from the source note
 * - Returns the new markdown link for the AI to place in the destination note
 */
export async function moveAttachment(params: z.infer<typeof attachmentsSchema>) {
  const attachmentName = params.attachmentFilename;

  if (!attachmentName) {
    return { success: false, error: 'attachmentFilename is required for move' };
  }

  // Resolve source note
  const { note: sourceNote, error: srcError } = await resolveNoteForAttachment(params);
  if (!sourceNote) {
    return { success: false, error: srcError || 'Source note not found' };
  }
  if (sourceNote.source === 'space') {
    return { success: false, error: 'Attachments are not supported for Space notes' };
  }

  // Resolve destination note
  const { note: destNote, error: destError } = await resolveNoteForAttachment({
    id: params.destinationId,
    filename: params.destinationFilename,
    title: params.destinationTitle,
    date: params.destinationDate,
    space: params.space,
  });
  if (!destNote) {
    return { success: false, error: destError || 'Destination note not found. Provide destinationId, destinationFilename, destinationTitle, or destinationDate.' };
  }
  if (destNote.source === 'space') {
    return { success: false, error: 'Attachments are not supported for Space destination notes' };
  }

  // Resolve source file path
  const cleanName = cleanFilename(attachmentName);
  const srcFolder = getAttachmentsFolderPath(sourceNote.filename);
  const srcPath = path.join(srcFolder, cleanName);

  if (!ensureInsideRoot(srcPath)) {
    return { success: false, error: 'Source attachment path escapes NotePlan directory' };
  }
  if (!(await pathExists(srcPath))) {
    return { success: false, error: `Attachment not found in source note: ${attachmentName}` };
  }

  // Resolve destination file path
  const destFolder = getAttachmentsFolderPath(destNote.filename);
  const destPath = path.join(destFolder, cleanName);

  if (!ensureInsideRoot(destPath)) {
    return { success: false, error: 'Destination attachment path escapes NotePlan directory' };
  }

  if (!(await pathExists(destFolder))) {
    await makeDirectory(destFolder);
  }

  await moveFile(srcPath, destPath);

  // Remove the old markdown link from the source note content
  const srcNotePath = path.join(getNotePlanPath(), sourceNote.filename);
  const srcContent = (await readFileUtf8(srcNotePath)) ?? '';
  const oldLink = toMarkdownLink(sourceNote.filename, cleanName);
  const oldLinkEncoded = toMarkdownLink(sourceNote.filename, attachmentName); // try original name too
  let newSrcContent = srcContent;
  for (const link of [oldLink, oldLinkEncoded]) {
    newSrcContent = newSrcContent
      .split('\n')
      .filter((line) => !line.includes(link))
      .join('\n');
  }
  if (newSrcContent !== srcContent) {
    await writeFileUtf8(srcNotePath, newSrcContent);
  }

  // Clean up empty source attachments folder
  try {
    const remaining = (await readDir(srcFolder)).filter((e) => !e.name.startsWith('.'));
    if (remaining.length === 0) {
      await removePath(srcFolder);
    }
  } catch { /* ignore cleanup errors */ }

  const newMarkdownLink = toMarkdownLink(destNote.filename, cleanName);

  return {
    success: true,
    movedFrom: getRelativeAttachmentPath(sourceNote.filename, cleanName),
    movedTo: getRelativeAttachmentPath(destNote.filename, cleanName),
    markdownLink: newMarkdownLink,
    sourceNote: { filename: sourceNote.filename, title: sourceNote.title },
    destinationNote: { filename: destNote.filename, title: destNote.title },
    oldLinkRemoved: newSrcContent !== srcContent,
    hint: 'Use noteplan_edit_content to place the markdownLink in the destination note.',
  };
}
