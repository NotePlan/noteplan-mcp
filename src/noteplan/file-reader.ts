// File system reader for local NotePlan notes

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Note, NoteType, Folder } from './types.js';
import { extractTitle, extractTagsFromContent } from './markdown-parser.js';
import { extractDateFromFilename } from '../utils/date-utils.js';

// Possible NotePlan storage paths (in order of preference)
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
  // Legacy local container paths
  path.join(os.homedir(), 'Library/Containers/co.noteplan.NotePlan3/Data/Documents'),
  path.join(os.homedir(), 'Library/Containers/co.noteplan.NotePlan/Data/Documents'),
  path.join(os.homedir(), 'Library/Containers/co.noteplan.NotePlan-setapp/Data/Documents'),
];

// Cached configuration
interface NotePlanConfig {
  storagePath: string;
  fileExtension: '.txt' | '.md';
  hasYearSubfolders: boolean;
}

let cachedConfig: NotePlanConfig | null = null;

/**
 * Detect the file extension used in a directory by examining existing files
 */
function detectFileExtension(calendarPath: string): '.txt' | '.md' {
  try {
    const entries = fs.readdirSync(calendarPath, { withFileTypes: true });

    let txtCount = 0;
    let mdCount = 0;
    let newestTxt = 0;
    let newestMd = 0;

    for (const entry of entries) {
      if (entry.isFile()) {
        // Check for daily note pattern (YYYYMMDD)
        if (/^\d{8}\.(txt|md)$/.test(entry.name)) {
          const filePath = path.join(calendarPath, entry.name);
          const stats = fs.statSync(filePath);

          if (entry.name.endsWith('.txt')) {
            txtCount++;
            newestTxt = Math.max(newestTxt, stats.mtimeMs);
          } else if (entry.name.endsWith('.md')) {
            mdCount++;
            newestMd = Math.max(newestMd, stats.mtimeMs);
          }
        }
      }
    }

    // Prefer the extension with the most recent file, then by count
    if (newestTxt > newestMd) return '.txt';
    if (newestMd > newestTxt) return '.md';
    if (txtCount > mdCount) return '.txt';
    return '.md'; // Default to .md
  } catch {
    return '.txt'; // Default to .txt
  }
}

/**
 * Check if calendar notes use year subfolders (Calendar/2024/20240101.txt)
 * or flat structure (Calendar/20240101.txt)
 */
function detectYearSubfolders(calendarPath: string): boolean {
  try {
    const entries = fs.readdirSync(calendarPath, { withFileTypes: true });

    // Check for year directories (4 digits)
    for (const entry of entries) {
      if (entry.isDirectory() && /^\d{4}$/.test(entry.name)) {
        // Verify it contains calendar notes
        const yearPath = path.join(calendarPath, entry.name);
        const yearEntries = fs.readdirSync(yearPath);
        if (yearEntries.some(f => /^\d{8}\.(txt|md)$/.test(f))) {
          return true;
        }
      }
    }

    // Check for flat structure (files directly in Calendar/)
    for (const entry of entries) {
      if (entry.isFile() && /^\d{8}\.(txt|md)$/.test(entry.name)) {
        return false;
      }
    }

    return false; // Default to flat
  } catch {
    return false;
  }
}

/**
 * Score a storage path based on most recent modification time
 * Checks the root folder and top-level folders (Calendar, Notes) - folder mtime updates when contents change
 */
function scoreStoragePath(storagePath: string): number {
  let newestMtime = 0;

  try {
    // Check the root storage folder
    const rootStats = fs.statSync(storagePath);
    newestMtime = Math.max(newestMtime, rootStats.mtimeMs);

    // Check Calendar folder
    const calendarPath = path.join(storagePath, 'Calendar');
    if (fs.existsSync(calendarPath)) {
      const calendarStats = fs.statSync(calendarPath);
      newestMtime = Math.max(newestMtime, calendarStats.mtimeMs);
    }

    // Check Notes folder
    const notesPath = path.join(storagePath, 'Notes');
    if (fs.existsSync(notesPath)) {
      const notesStats = fs.statSync(notesPath);
      newestMtime = Math.max(newestMtime, notesStats.mtimeMs);
    }
  } catch {
    return 0;
  }

  return newestMtime;
}

/**
 * Check if a path contains a valid NotePlan structure (has Calendar or Notes folder)
 */
function isValidNotePlanPath(storagePath: string): boolean {
  if (!fs.existsSync(storagePath)) return false;

  const hasCalendar = fs.existsSync(path.join(storagePath, 'Calendar'));
  const hasNotes = fs.existsSync(path.join(storagePath, 'Notes'));

  return hasCalendar || hasNotes;
}

/**
 * Detect and cache NotePlan configuration
 */
function detectConfig(): NotePlanConfig {
  if (cachedConfig) return cachedConfig;

  // Find the best storage path by scoring each one
  let bestPath: string | null = null;
  let bestScore = -1;

  for (const storagePath of POSSIBLE_PATHS) {
    if (isValidNotePlanPath(storagePath)) {
      const score = scoreStoragePath(storagePath);
      if (score > bestScore) {
        bestScore = score;
        bestPath = storagePath;
      }
    }
  }

  if (!bestPath) {
    throw new Error('NotePlan storage not found. Is NotePlan installed?');
  }

  const calendarPath = path.join(bestPath, 'Calendar');
  const hasYearSubfolders = detectYearSubfolders(calendarPath);

  // Detect extension in the right location
  const extensionDetectPath = hasYearSubfolders
    ? path.join(calendarPath, new Date().getFullYear().toString())
    : calendarPath;

  const fileExtension = fs.existsSync(extensionDetectPath)
    ? detectFileExtension(extensionDetectPath)
    : detectFileExtension(calendarPath);

  cachedConfig = {
    storagePath: bestPath,
    fileExtension,
    hasYearSubfolders,
  };

  console.error(`NotePlan config: ${bestPath} (ext: ${fileExtension}, yearFolders: ${hasYearSubfolders})`);

  return cachedConfig;
}

/**
 * Get the NotePlan storage path
 */
export function getNotePlanPath(): string {
  return detectConfig().storagePath;
}

/**
 * Get the detected file extension
 */
export function getFileExtension(): '.txt' | '.md' {
  return detectConfig().fileExtension;
}

/**
 * Get whether year subfolders are used
 */
export function hasYearSubfolders(): boolean {
  return detectConfig().hasYearSubfolders;
}

/**
 * Get all available NotePlan storage paths (for multi-source searching)
 */
export function getAllNotePlanPaths(): string[] {
  return POSSIBLE_PATHS.filter(isValidNotePlanPath);
}

/**
 * Get the Calendar notes directory
 */
export function getCalendarPath(): string {
  return path.join(getNotePlanPath(), 'Calendar');
}

/**
 * Get the project Notes directory
 */
export function getNotesPath(): string {
  return path.join(getNotePlanPath(), 'Notes');
}

/**
 * Build the calendar note file path for a given date
 */
export function buildCalendarNotePath(dateStr: string): string {
  const config = detectConfig();
  const ext = config.fileExtension;

  if (config.hasYearSubfolders) {
    const year = dateStr.substring(0, 4);
    return `Calendar/${year}/${dateStr}${ext}`;
  }

  return `Calendar/${dateStr}${ext}`;
}

/**
 * Read a note file from the file system
 */
export function readNoteFile(filePath: string): Note | null {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);

    // Reject paths outside the NotePlan data directory
    const resolvedFull = path.resolve(fullPath);
    const resolvedRoot = path.resolve(getNotePlanPath());
    if (resolvedFull !== resolvedRoot && !resolvedFull.startsWith(`${resolvedRoot}${path.sep}`)) {
      return null;
    }

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      return null;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const relativePath = path.relative(getNotePlanPath(), fullPath);
    const filename = path.basename(fullPath);

    // Determine note type
    let type: NoteType = 'note';
    let date: string | undefined;

    if (relativePath.startsWith('Calendar/') || relativePath.startsWith('Calendar\\')) {
      type = 'calendar';
      date = extractDateFromFilename(filename) || undefined;
    } else if (relativePath.includes('Trash/') || relativePath.includes('Trash\\') ||
               relativePath.startsWith('@Trash/') || relativePath.startsWith('@Trash\\')) {
      type = 'trash';
    }

    // Extract folder from path
    const folder = path.dirname(relativePath);

    return {
      id: relativePath,
      title: type === 'calendar' && date ? date : extractTitle(content),
      filename: relativePath,
      content,
      type,
      source: 'local',
      folder: folder !== '.' ? folder : undefined,
      date,
      modifiedAt: stats.mtime,
      createdAt: stats.birthtime,
    };
  } catch (error) {
    console.error(`Error reading note file ${filePath}:`, error);
    return null;
  }
}

/**
 * List all notes in a directory (recursive)
 */
export function listNotesInDirectory(dirPath: string, type: NoteType = 'note'): Note[] {
  const notes: Note[] = [];

  try {
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(getNotePlanPath(), dirPath);

    // Reject paths outside the NotePlan data directory
    const resolvedFull = path.resolve(fullPath);
    const resolvedRoot = path.resolve(getNotePlanPath());
    if (resolvedFull !== resolvedRoot && !resolvedFull.startsWith(`${resolvedRoot}${path.sep}`)) {
      return notes;
    }

    if (!fs.existsSync(fullPath)) {
      return notes;
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(fullPath, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and Trash
        if (entry.name.startsWith('.') || entry.name === '@Trash' || entry.name === '@Archive') {
          continue;
        }
        // Recurse into subdirectories
        notes.push(...listNotesInDirectory(entryPath, type));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        const note = readNoteFile(entryPath);
        if (note) {
          notes.push(note);
        }
      }
    }
  } catch (error) {
    console.error(`Error listing notes in ${dirPath}:`, error);
  }

  return notes;
}

/**
 * Count notes and subfolders in a directory (recursive, lightweight — no file reads)
 */
export function countNotesInDirectory(dirPath: string): { noteCount: number; folderCount: number } {
  let noteCount = 0;
  let folderCount = 0;
  try {
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(getNotePlanPath(), dirPath);
    if (!fs.existsSync(fullPath)) return { noteCount, folderCount };

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === '@Trash' || entry.name === '@Archive') continue;
        folderCount++;
        const sub = countNotesInDirectory(path.join(fullPath, entry.name));
        noteCount += sub.noteCount;
        folderCount += sub.folderCount;
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        noteCount++;
      }
    }
  } catch {
    // silently ignore unreadable directories
  }
  return { noteCount, folderCount };
}

/**
 * List all project notes
 */
export function listProjectNotes(folder?: string): Note[] {
  const basePath = folder ? path.join(getNotesPath(), folder) : getNotesPath();
  return listNotesInDirectory(basePath, 'note');
}

/**
 * List all calendar notes
 */
export function listCalendarNotes(year?: string): Note[] {
  const basePath = year ? path.join(getCalendarPath(), year) : getCalendarPath();
  return listNotesInDirectory(basePath, 'calendar');
}

/**
 * Get a calendar note by date - tries multiple file paths
 */
export function getCalendarNote(dateStr: string): Note | null {
  const config = detectConfig();
  const year = dateStr.substring(0, 4);

  // Build list of paths to try (in order of preference)
  const pathsToTry: string[] = [];

  // First try the detected configuration
  if (config.hasYearSubfolders) {
    pathsToTry.push(`Calendar/${year}/${dateStr}${config.fileExtension}`);
    // Also try the other extension
    const otherExt = config.fileExtension === '.txt' ? '.md' : '.txt';
    pathsToTry.push(`Calendar/${year}/${dateStr}${otherExt}`);
  } else {
    pathsToTry.push(`Calendar/${dateStr}${config.fileExtension}`);
    const otherExt = config.fileExtension === '.txt' ? '.md' : '.txt';
    pathsToTry.push(`Calendar/${dateStr}${otherExt}`);
  }

  // Try flat structure with both extensions
  pathsToTry.push(`Calendar/${dateStr}.txt`);
  pathsToTry.push(`Calendar/${dateStr}.md`);

  // Try year subfolder with both extensions
  pathsToTry.push(`Calendar/${year}/${dateStr}.txt`);
  pathsToTry.push(`Calendar/${year}/${dateStr}.md`);

  // Deduplicate
  const uniquePaths = [...new Set(pathsToTry)];

  for (const filePath of uniquePaths) {
    const note = readNoteFile(filePath);
    if (note) return note;
  }

  return null;
}

/**
 * Get a note by title (searches project notes)
 */
export function getNoteByTitle(title: string): Note | null {
  const notes = listProjectNotes();
  const lowerTitle = title.toLowerCase();

  // Try exact match first
  const exactMatch = notes.find((n) => n.title.toLowerCase() === lowerTitle);
  if (exactMatch) return exactMatch;

  // Try filename match (without extension)
  const filenameMatch = notes.find((n) => {
    const basename = path.basename(n.filename, path.extname(n.filename));
    return basename.toLowerCase() === lowerTitle;
  });
  if (filenameMatch) return filenameMatch;

  // Try partial match
  const partialMatch = notes.find((n) => n.title.toLowerCase().includes(lowerTitle));
  return partialMatch || null;
}

/**
 * List all folders in the Notes directory
 */
export function listFolders(maxDepth?: number): Folder[] {
  const folders: Folder[] = [];

  function scanDir(dirPath: string, relativePath: string = '', depth: number = 0) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') &&
            entry.name !== '@Trash' && entry.name !== '@Archive') {
          const nextDepth = depth + 1;
          if (typeof maxDepth === 'number' && nextDepth > maxDepth) {
            continue;
          }

          const folderRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          folders.push({
            path: folderRelPath,
            name: entry.name,
            source: 'local',
          });

          // Recurse unless max depth reached
          if (typeof maxDepth !== 'number' || nextDepth < maxDepth) {
            scanDir(path.join(dirPath, entry.name), folderRelPath, nextDepth);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning folder ${dirPath}:`, error);
    }
  }

  scanDir(getNotesPath(), '', 0);
  return folders;
}

/**
 * Extract all unique tags from local notes
 */
export function extractAllTags(): string[] {
  const tags = new Set<string>();
  const notes = [...listProjectNotes(), ...listCalendarNotes()];

  for (const note of notes) {
    for (const tag of extractTagsFromContent(note.content)) {
      tags.add(tag);
    }
  }

  return Array.from(tags).sort();
}

/**
 * Search notes by content
 */
export function searchLocalNotes(
  query: string,
  options: {
    types?: NoteType[];
    folder?: string;
    limit?: number;
  } = {}
): Note[] {
  const { types, folder, limit = 50 } = options;
  const results: Note[] = [];
  const lowerQuery = query.toLowerCase();

  // Get notes to search
  let notes: Note[] = [];
  if (!types || types.includes('note')) {
    notes.push(...listProjectNotes(folder));
  }
  if (!types || types.includes('calendar')) {
    notes.push(...listCalendarNotes());
  }

  // Search
  for (const note of notes) {
    if (
      note.content.toLowerCase().includes(lowerQuery) ||
      note.title.toLowerCase().includes(lowerQuery)
    ) {
      results.push(note);
      if (results.length >= limit) break;
    }
  }

  return results;
}
