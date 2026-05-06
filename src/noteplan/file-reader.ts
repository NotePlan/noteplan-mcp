// File system reader for local NotePlan notes
//
// All exported I/O functions are async and route through the MCP bridge
// when NotePlan is running (avoiding TCC prompts), falling back to direct
// fs access otherwise. The path detection at the bottom of the file stays
// synchronous because it bootstraps once at startup before any caller can
// await anything.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { Note, NoteType, Folder } from './types.js';
import { extractTitle, extractTagsFromContent } from './markdown-parser.js';
import { extractDateFromFilename } from '../utils/date-utils.js';
import { getDetectedAppName } from '../utils/version.js';
import { normalizeFilename } from '../utils/filename-normalize.js';
import { getBridgeClient } from '../transport/bridge-availability.js';
import { readFileUtf8, statPath, pathExists, readDir } from '../transport/bridge-fs.js';
import { isRipgrepAvailable, ripgrepOnlyMatching } from './ripgrep-search.js';

/** Valid note file extensions in NotePlan */
const VALID_NOTE_EXTENSIONS = ['.md', '.txt'];

/**
 * Check if a filename has a valid note file extension (.md or .txt).
 * NotePlan only treats .md and .txt files as text notes; all other files
 * (e.g. .key, .pdf, .png) are non-text attachments and should be ignored.
 */
export function isValidNoteExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return VALID_NOTE_EXTENSIONS.includes(ext);
}

/**
 * Folders that should be skipped when listing/recursing the user's notes:
 *   - dot-prefixed (e.g. .DS_Store, .git)
 *   - NotePlan's @Trash and @Archive system folders
 *   - <NoteName>_attachments folders that NotePlan auto-creates next to
 *     notes that have images/files attached. They're not user-organized
 *     folders and surfacing them confuses tools that just want the
 *     organizational tree.
 */
function isHiddenFolder(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (name === '@Trash' || name === '@Archive') return true;
  if (name.endsWith('_attachments')) return true;
  return false;
}

// MARK: - Storage path detection (sync, runs once at startup)

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
];

interface NotePlanConfig {
  storagePath: string;
  fileExtension: '.txt' | '.md';
  hasYearSubfolders: boolean;
}

let cachedConfig: NotePlanConfig | null = null;

function detectFileExtension(calendarPath: string): '.txt' | '.md' {
  try {
    const entries = fs.readdirSync(calendarPath, { withFileTypes: true });

    let txtCount = 0;
    let mdCount = 0;
    let newestTxt = 0;
    let newestMd = 0;

    for (const entry of entries) {
      if (entry.isFile()) {
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

    if (newestTxt > newestMd) return '.txt';
    if (newestMd > newestTxt) return '.md';
    if (txtCount > mdCount) return '.txt';
    return '.md';
  } catch {
    return '.txt';
  }
}

function detectYearSubfolders(calendarPath: string): boolean {
  try {
    const entries = fs.readdirSync(calendarPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && /^\d{4}$/.test(entry.name)) {
        const yearPath = path.join(calendarPath, entry.name);
        const yearEntries = fs.readdirSync(yearPath);
        if (yearEntries.some(f => /^\d{8}\.(txt|md)$/.test(f))) {
          return true;
        }
      }
    }

    for (const entry of entries) {
      if (entry.isFile() && /^\d{8}\.(txt|md)$/.test(entry.name)) {
        return false;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function scoreStoragePath(storagePath: string): number {
  let newestMtime = 0;
  try {
    const rootStats = fs.statSync(storagePath);
    newestMtime = Math.max(newestMtime, rootStats.mtimeMs);

    const calendarPath = path.join(storagePath, 'Calendar');
    if (fs.existsSync(calendarPath)) {
      newestMtime = Math.max(newestMtime, fs.statSync(calendarPath).mtimeMs);
    }

    const notesPath = path.join(storagePath, 'Notes');
    if (fs.existsSync(notesPath)) {
      newestMtime = Math.max(newestMtime, fs.statSync(notesPath).mtimeMs);
    }
  } catch {
    return 0;
  }
  return newestMtime;
}

function isValidNotePlanPath(storagePath: string): boolean {
  if (!fs.existsSync(storagePath)) return false;
  return fs.existsSync(path.join(storagePath, 'Calendar')) ||
    fs.existsSync(path.join(storagePath, 'Notes'));
}

function detectStoragePathViaAppleScript(): string | null {
  try {
    const appName = getDetectedAppName();
    const isRunning = execFileSync('osascript', ['-e', `application "${appName}" is running`], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3_000,
    }).trim();
    if (isRunning !== 'true') return null;

    const result = execFileSync('osascript', ['-e', `tell application "${appName}" to getStoragePath`], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5_000,
    }).trim();
    if (result && fs.existsSync(result)) {
      console.error(`[noteplan-mcp] Storage path from app: ${result}`);
      return result;
    }
  } catch {
    console.error('[noteplan-mcp] Could not get storage path from NotePlan, falling back to filesystem detection');
  }
  return null;
}

const CLOUDKIT_PATHS = [
  path.join(os.homedir(), 'Library/Containers/co.noteplan.NotePlan3/Data/Library/Application Support/co.noteplan.NotePlan3'),
  path.join(os.homedir(), 'Library/Containers/co.noteplan.NotePlan-setapp/Data/Library/Application Support/co.noteplan.NotePlan-setapp'),
];

const ICLOUD_DRIVE_PATHS = [
  path.join(os.homedir(), 'Library/Mobile Documents/iCloud~co~noteplan~Today/Documents'),
  path.join(os.homedir(), 'Library/Mobile Documents/iCloud~co~noteplan~NotePlan3/Documents'),
  path.join(os.homedir(), 'Library/Mobile Documents/iCloud~co~noteplan~NotePlan/Documents'),
  path.join(os.homedir(), 'Library/Mobile Documents/iCloud~co~noteplan~NotePlan-setapp/Documents'),
];

function detectStoragePathViaUserDefaults(): string | null {
  try {
    const result = execFileSync('defaults', ['read', 'co.noteplan.NotePlan3', 'isUsingCloudKit'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3_000,
    }).trim();

    const isCloudKit = result === '1';
    const candidates = isCloudKit ? CLOUDKIT_PATHS : ICLOUD_DRIVE_PATHS;

    for (const candidate of candidates) {
      if (isValidNotePlanPath(candidate)) {
        console.error(`[noteplan-mcp] Storage path from UserDefaults (${isCloudKit ? 'CloudKit' : 'iCloud Drive'}): ${candidate}`);
        return candidate;
      }
    }
  } catch {
    // Preference not set or defaults command failed — fall through
  }
  return null;
}

function detectConfig(): NotePlanConfig {
  if (cachedConfig) return cachedConfig;

  let bestPath: string | null = detectStoragePathViaAppleScript();

  if (!bestPath) {
    bestPath = detectStoragePathViaUserDefaults();
  }

  if (!bestPath) {
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
  }

  if (!bestPath) {
    throw new Error('NotePlan storage not found. Is NotePlan installed?');
  }

  const calendarPath = path.join(bestPath, 'Calendar');
  const hasYearSubfolders = detectYearSubfolders(calendarPath);

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

// MARK: - Synchronous path getters (read cached config)

export function getNotePlanPath(): string {
  return detectConfig().storagePath;
}

export function getFileExtension(): '.txt' | '.md' {
  return detectConfig().fileExtension;
}

export function hasYearSubfolders(): boolean {
  return detectConfig().hasYearSubfolders;
}

export function getAllNotePlanPaths(): string[] {
  return POSSIBLE_PATHS.filter(isValidNotePlanPath);
}

export function getCalendarPath(): string {
  return path.join(getNotePlanPath(), 'Calendar');
}

export function getNotesPath(): string {
  return path.join(getNotePlanPath(), 'Notes');
}

export function buildCalendarNotePath(dateStr: string): string {
  const config = detectConfig();
  const ext = config.fileExtension;
  if (config.hasYearSubfolders) {
    const year = dateStr.substring(0, 4);
    return `Calendar/${year}/${dateStr}${ext}`;
  }
  return `Calendar/${dateStr}${ext}`;
}

// NotePlan stores `defaultNoteExtension` as a real preference; the fs
// heuristic in detectFileExtension only counts existing files, so a user
// who recently switched to .md will still get .txt for new calendar notes
// until the new files outnumber the old. Calendar notes are extension-
// sensitive (NotePlan ignores wrong-extension files), so we ask the
// bridge for the truth whenever NotePlan is running.
const BRIDGE_EXT_TTL_MS = 60_000;
let bridgeFileExtensionCache: { ext: '.txt' | '.md'; expiresAt: number } | null = null;

/** @internal exposed for tests; the cache TTL prevents real-world leaks. */
export function __resetCalendarExtensionCache(): void {
  bridgeFileExtensionCache = null;
}

export async function resolveNotePlanFileExtension(): Promise<'.txt' | '.md'> {
  if (bridgeFileExtensionCache && bridgeFileExtensionCache.expiresAt > Date.now()) {
    return bridgeFileExtensionCache.ext;
  }
  const bridge = await getBridgeClient();
  if (bridge) {
    try {
      const config = await bridge.config();
      if (config.fileExtension === '.md' || config.fileExtension === '.txt') {
        bridgeFileExtensionCache = {
          ext: config.fileExtension,
          expiresAt: Date.now() + BRIDGE_EXT_TTL_MS,
        };
        return config.fileExtension;
      }
    } catch {
      // Fall through to fs heuristic.
    }
  }
  return detectConfig().fileExtension;
}

export async function buildCalendarNotePathAsync(dateStr: string): Promise<string> {
  const ext = await resolveNotePlanFileExtension();
  if (detectConfig().hasYearSubfolders) {
    const year = dateStr.substring(0, 4);
    return `Calendar/${year}/${dateStr}${ext}`;
  }
  return `Calendar/${dateStr}${ext}`;
}

// MARK: - Async I/O exports

/**
 * Read a note file from the file system (or via the bridge when NotePlan
 * is running). Handles Unicode NFC/NFD path mismatches and rejects paths
 * outside the storage root.
 */
export async function readNoteFile(filePath: string): Promise<Note | null> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getNotePlanPath(), filePath);

    const resolvedFull = path.resolve(fullPath);
    const resolvedRoot = path.resolve(getNotePlanPath());
    if (resolvedFull !== resolvedRoot && !resolvedFull.startsWith(`${resolvedRoot}${path.sep}`)) {
      return null;
    }

    let resolvedPath = fullPath;
    let stats = await statPath(resolvedPath);

    if (!stats.exists) {
      // Try Unicode-normalized form (NFC) — handles NFD/NFC mismatches on macOS
      const nfcPath = normalizeFilename(resolvedPath);
      if (nfcPath !== resolvedPath) {
        const nfcStats = await statPath(nfcPath);
        if (nfcStats.exists) {
          resolvedPath = nfcPath;
          stats = nfcStats;
        }
      }
    }

    if (!stats.exists) {
      // Last resort: scan the parent directory for a Unicode-equivalent match
      const dir = path.dirname(fullPath);
      const targetBase = normalizeFilename(path.basename(fullPath));
      const entries = await readDir(dir);
      const match = entries.find((e) => e.name.normalize('NFC') === targetBase);
      if (!match) return null;
      resolvedPath = path.join(dir, match.name);
      stats = await statPath(resolvedPath);
      if (!stats.exists) return null;
    }

    if (stats.isDir) return null;

    const resolvedFinal = path.resolve(resolvedPath);
    if (resolvedFinal !== resolvedRoot && !resolvedFinal.startsWith(`${resolvedRoot}${path.sep}`)) {
      return null;
    }

    if (!isValidNoteExtension(path.basename(resolvedPath))) {
      return null;
    }

    const content = await readFileUtf8(resolvedPath);
    if (content === null) return null;

    const relativePath = path.relative(getNotePlanPath(), resolvedPath);
    const filename = path.basename(resolvedPath);

    let type: NoteType = 'note';
    let date: string | undefined;

    if (relativePath.startsWith('Calendar/') || relativePath.startsWith('Calendar\\')) {
      type = 'calendar';
      date = extractDateFromFilename(filename) || undefined;
    } else if (relativePath.includes('Trash/') || relativePath.includes('Trash\\') ||
               relativePath.startsWith('@Trash/') || relativePath.startsWith('@Trash\\')) {
      type = 'trash';
    }

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
      createdAt: stats.ctime,
    };
  } catch (error) {
    console.error(`Error reading note file ${filePath}:`, error);
    return null;
  }
}

/**
 * List all notes in a directory (recursive).
 */
export async function listNotesInDirectory(dirPath: string, type: NoteType = 'note'): Promise<Note[]> {
  const notes: Note[] = [];

  try {
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(getNotePlanPath(), dirPath);

    const resolvedFull = path.resolve(fullPath);
    const resolvedRoot = path.resolve(getNotePlanPath());
    if (resolvedFull !== resolvedRoot && !resolvedFull.startsWith(`${resolvedRoot}${path.sep}`)) {
      return notes;
    }

    // readDir returns [] for missing dirs, so an explicit pathExists check
    // would be a redundant stat round-trip per recursion level.
    const entries = await readDir(fullPath);

    for (const entry of entries) {
      const entryPath = path.join(fullPath, entry.name);

      if (entry.isDir) {
        if (isHiddenFolder(entry.name)) continue;
        notes.push(...(await listNotesInDirectory(entryPath, type)));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        const note = await readNoteFile(entryPath);
        if (note) notes.push(note);
      }
    }
  } catch (error) {
    console.error(`Error listing notes in ${dirPath}:`, error);
  }

  return notes;
}

/**
 * Count notes and subfolders in a directory (recursive, lightweight — no file reads).
 */
export async function countNotesInDirectory(dirPath: string): Promise<{ noteCount: number; folderCount: number }> {
  let noteCount = 0;
  let folderCount = 0;
  try {
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(getNotePlanPath(), dirPath);
    const entries = await readDir(fullPath);
    for (const entry of entries) {
      if (entry.isDir) {
        if (isHiddenFolder(entry.name)) continue;
        folderCount++;
        const sub = await countNotesInDirectory(path.join(fullPath, entry.name));
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

export async function listProjectNotes(folder?: string): Promise<Note[]> {
  const basePath = folder ? path.join(getNotesPath(), folder) : getNotesPath();
  return listNotesInDirectory(basePath, 'note');
}

export async function listCalendarNotes(year?: string): Promise<Note[]> {
  const basePath = year ? path.join(getCalendarPath(), year) : getCalendarPath();
  return listNotesInDirectory(basePath, 'calendar');
}

/**
 * Get a calendar note by date — tries multiple file paths.
 */
export async function getCalendarNote(dateStr: string): Promise<Note | null> {
  const config = detectConfig();
  const preferredExt = await resolveNotePlanFileExtension();
  const year = dateStr.substring(0, 4);

  const pathsToTry: string[] = [];
  if (config.hasYearSubfolders) {
    pathsToTry.push(`Calendar/${year}/${dateStr}${preferredExt}`);
    const otherExt = preferredExt === '.txt' ? '.md' : '.txt';
    pathsToTry.push(`Calendar/${year}/${dateStr}${otherExt}`);
  } else {
    pathsToTry.push(`Calendar/${dateStr}${preferredExt}`);
    const otherExt = preferredExt === '.txt' ? '.md' : '.txt';
    pathsToTry.push(`Calendar/${dateStr}${otherExt}`);
  }

  pathsToTry.push(`Calendar/${dateStr}.txt`);
  pathsToTry.push(`Calendar/${dateStr}.md`);
  pathsToTry.push(`Calendar/${year}/${dateStr}.txt`);
  pathsToTry.push(`Calendar/${year}/${dateStr}.md`);

  const uniquePaths = [...new Set(pathsToTry)];

  for (const filePath of uniquePaths) {
    const note = await readNoteFile(filePath);
    if (note) return note;
  }

  return null;
}

/**
 * Get a note by title (searches project notes).
 */
export async function getNoteByTitle(title: string): Promise<Note | null> {
  const notes = await listProjectNotes();
  const lowerTitle = title.toLowerCase();

  const exactMatch = notes.find((n) => n.title.toLowerCase() === lowerTitle);
  if (exactMatch) return exactMatch;

  const filenameMatch = notes.find((n) => {
    const basename = path.basename(n.filename, path.extname(n.filename));
    return basename.toLowerCase() === lowerTitle;
  });
  if (filenameMatch) return filenameMatch;

  const partialMatch = notes.find((n) => n.title.toLowerCase().includes(lowerTitle));
  return partialMatch || null;
}

/**
 * List all folders in the Notes directory.
 */
export async function listFolders(maxDepth?: number): Promise<Folder[]> {
  const folders: Folder[] = [];

  async function scanDir(dirPath: string, relativePath: string = '', depth: number = 0): Promise<void> {
    const entries = await readDir(dirPath);

    for (const entry of entries) {
      if (entry.isDir && !isHiddenFolder(entry.name)) {
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

        if (typeof maxDepth !== 'number' || nextDepth < maxDepth) {
          await scanDir(path.join(dirPath, entry.name), folderRelPath, nextDepth);
        }
      }
    }
  }

  await scanDir(getNotesPath(), '', 0);
  return folders;
}

/**
 * Extract all unique tags from local notes.
 *
 * Preferred path: a single `/notes/tags` request to the bridge. NotePlan
 * iterates its own files (no TCC, no per-file HTTP overhead) and returns
 * the deduped, hierarchy-expanded tag list using its native parser.
 *
 * Second path: ripgrep `--only-matching` over Notes/ + Calendar/ — works
 * when running outside the bridge but is unreliable when the calling
 * process lacks Full Disk Access (ripgrep gets interrupted by TCC).
 *
 * Last-resort fallback: read every note via the bridge / fs and extract
 * tags individually. This was the only path before Phase 2c; ~67s on a
 * 5700-note vault.
 */
export async function extractAllTags(): Promise<string[]> {
  const bridge = await getBridgeClient();
  if (bridge) {
    try {
      return (await bridge.tags()).sort();
    } catch {
      // Older NotePlan build without the /notes/tags endpoint, or other
      // transient failure — drop through to the slower paths.
    }
  }

  const tags = new Set<string>();

  if (await isRipgrepAvailable()) {
    const matches = await ripgrepOnlyMatching(
      String.raw`[@#][\w/-]+(\([^)]*\))?`,
      [getNotesPath(), getCalendarPath()]
    );
    if (matches !== null) {
      for (const tag of extractTagsFromContent(matches.join('\n'))) {
        tags.add(tag);
      }
      return Array.from(tags).sort();
    }
  }

  const [projectNotes, calendarNotes] = await Promise.all([
    listProjectNotes(),
    listCalendarNotes(),
  ]);
  const notes = [...projectNotes, ...calendarNotes];

  for (const note of notes) {
    for (const tag of extractTagsFromContent(note.content)) {
      tags.add(tag);
    }
  }

  return Array.from(tags).sort();
}

/**
 * Search notes by content.
 */
export async function searchLocalNotes(
  query: string,
  options: {
    types?: NoteType[];
    folder?: string;
    limit?: number;
  } = {}
): Promise<Note[]> {
  const { types, folder, limit = 50 } = options;
  const results: Note[] = [];
  const lowerQuery = query.toLowerCase();

  let notes: Note[] = [];
  if (!types || types.includes('note')) {
    notes.push(...(await listProjectNotes(folder)));
  }
  if (!types || types.includes('calendar')) {
    notes.push(...(await listCalendarNotes()));
  }

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
