// Unified store that merges local and space notes

import * as path from 'path';
import { Note, NoteType, Folder, Space, SearchResult, SearchMatch } from './types.js';
import * as fileReader from './file-reader.js';
import * as fileWriter from './file-writer.js';
import * as sqliteReader from './sqlite-reader.js';
import * as sqliteWriter from './sqlite-writer.js';
import * as frontmatter from './frontmatter-parser.js';
import { getTodayDateString, parseFlexibleDate } from '../utils/date-utils.js';
import { matchFolder, FolderMatchResult } from '../utils/folder-matcher.js';
import { searchWithRipgrep, isRipgrepAvailable, RipgrepMatch } from './ripgrep-search.js';
import { fuzzySearch } from './fuzzy-search.js';
import { parseFlexibleDateFilter, isDateInRange } from '../utils/date-filters.js';

// Cache ripgrep availability check
let ripgrepAvailable: boolean | null = null;
const LIST_NOTES_CACHE_TTL_MS = 5000;
const LIST_FOLDERS_CACHE_TTL_MS = 15000;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const listNotesCache = new Map<string, CacheEntry<Note[]>>();
const listFoldersCache = new Map<string, CacheEntry<Folder[]>>();

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): T {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

function invalidateListingCaches(): void {
  listNotesCache.clear();
  listFoldersCache.clear();
}

function normalizeLocalFolderFilter(folder?: string): string | undefined {
  if (!folder) return undefined;
  let normalized = folder.trim().replace(/\\/g, '/');
  if (!normalized) return undefined;
  normalized = normalized.replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === 'Notes') return undefined;
  if (normalized.startsWith('Notes/')) {
    normalized = normalized.slice('Notes/'.length);
  }
  if (!normalized || normalized === '.') return undefined;
  return normalized;
}

/**
 * Result of folder resolution during note creation
 */
export interface FolderResolution {
  requested: string | undefined;
  resolved: string | undefined;
  matched: boolean;
  ambiguous: boolean;
  score: number;
  alternatives: string[];
}

/**
 * Result of creating a note with folder resolution info
 */
export interface CreateNoteResult {
  note: Note;
  folderResolution: FolderResolution;
}

export interface MoveNoteResult {
  note: Note;
  fromFilename: string;
  toFilename: string;
  destinationFolder: string;
  destinationParentId?: string;
}

export interface RenameNoteFileResult {
  note: Note;
  fromFilename: string;
  toFilename: string;
}

export interface RenameSpaceNoteResult {
  note: Note;
  fromTitle: string;
  toTitle: string;
}

export interface DeleteNoteResult {
  source: 'local' | 'space';
  fromIdentifier: string;
  toIdentifier: string;
  noteId?: string;
}

export interface RestoreNoteResult {
  source: 'local' | 'space';
  note: Note;
  fromIdentifier: string;
  toIdentifier: string;
}

/**
 * Resolve a space name or ID to a valid space UUID.
 * Accepts either a UUID (exact match) or a human-readable name (case-insensitive).
 * Returns undefined when the input is undefined/empty (pass-through for optional params).
 * Throws when a non-empty value doesn't match any known space.
 */
export function resolveSpaceId(space: string | undefined): string | undefined {
  if (!space) return undefined;
  const trimmed = space.trim();
  if (!trimmed) return undefined;

  const spaces = sqliteReader.listSpaces();

  // Exact ID match takes priority (unambiguous)
  const idMatch = spaces.find((s) => s.id === trimmed);
  if (idMatch) return idMatch.id;

  // Fall back to case-insensitive name match
  const lower = trimmed.toLowerCase();
  const nameMatches = spaces.filter((s) => s.name.toLowerCase() === lower);

  if (nameMatches.length === 1) return nameMatches[0].id;

  if (nameMatches.length > 1) {
    const options = nameMatches.map((s) => `${s.name} (${s.id})`).join(', ');
    throw new Error(
      `Ambiguous space name: "${space}" matches ${nameMatches.length} spaces. Use the space ID instead: ${options}`
    );
  }

  const available = spaces.map((s) => `${s.name} (${s.id})`);
  throw new Error(
    `Space not found: "${space}". Available spaces: ${available.length > 0 ? available.join(', ') : 'none'}`
  );
}

/**
 * Get a note by various identifiers
 */
export function getNote(options: {
  id?: string;
  title?: string;
  filename?: string;
  date?: string;
  space?: string;
}): Note | null {
  const { id, title, filename, date } = options;
  const space = resolveSpaceId(options.space);

  // If ID is specified, get directly (best for space notes)
  if (id) {
    const spaceNote = sqliteReader.getSpaceNote(id);
    if (spaceNote) return spaceNote;
    // Fallback: for local notes, id === filename
    const localNote = fileReader.readNoteFile(id);
    if (localNote) return localNote;
    return null;
  }

  // If date is specified, get calendar note
  if (date) {
    const dateStr = parseFlexibleDate(date);
    if (space) {
      return sqliteReader.getSpaceCalendarNote(dateStr, space);
    }
    return fileReader.getCalendarNote(dateStr);
  }

  // If filename is specified, try to get directly
  if (filename) {
    const normalizedFilename = filename.trim();

    if (space) {
      const directSpaceNote = sqliteReader.getSpaceNote(normalizedFilename);
      if (directSpaceNote && directSpaceNote.spaceId === space) {
        return directSpaceNote;
      }
      const scopedSpaceNote = sqliteReader
        .listSpaceNotes(space)
        .find((note) => note.filename === normalizedFilename || note.id === normalizedFilename);
      if (scopedSpaceNote) {
        return scopedSpaceNote;
      }
    }

    // Check if it's a space filename
    if (normalizedFilename.includes('%%NotePlanCloud%%')) {
      return sqliteReader.getSpaceNote(normalizedFilename);
    }
    const localNote = fileReader.readNoteFile(normalizedFilename);
    if (localNote) return localNote;
    return sqliteReader.getSpaceNote(normalizedFilename);
  }

  // If title is specified, search by title
  if (title) {
    if (space) {
      return sqliteReader.getSpaceNoteByTitle(title, space);
    }
    // Try local first
    const localNote = fileReader.getNoteByTitle(title);
    if (localNote) return localNote;

    // Try space
    return sqliteReader.getSpaceNoteByTitle(title);
  }

  return null;
}

/**
 * List all notes, optionally filtered
 */
export function listNotes(options: {
  folder?: string;
  space?: string;
  type?: NoteType;
} = {}): Note[] {
  const { folder, type } = options;
  const space = resolveSpaceId(options.space);
  const normalizedFolder = normalizeLocalFolderFilter(folder);
  const cacheKey = JSON.stringify({
    folder: normalizedFolder || '',
    space: space || '',
    type: type || '',
  });
  const cached = getCachedValue(listNotesCache, cacheKey);
  if (cached) {
    return cached;
  }

  const notes: Note[] = [];
  const hasFolderScope = Boolean(normalizedFolder);

  // Get local notes
  if (!space) {
    if (!type || type === 'note') {
      notes.push(...fileReader.listProjectNotes(normalizedFolder));
    }
    if ((!type || type === 'calendar') && !hasFolderScope) {
      notes.push(...fileReader.listCalendarNotes());
    }
  }

  // Get space notes
  if (space || !hasFolderScope) {
    notes.push(...sqliteReader.listSpaceNotes(space));
  }

  // Sort by modified date (newest first)
  notes.sort((a, b) => {
    const dateA = a.modifiedAt?.getTime() || 0;
    const dateB = b.modifiedAt?.getTime() || 0;
    return dateB - dateA;
  });

  return setCachedValue(listNotesCache, cacheKey, notes, LIST_NOTES_CACHE_TTL_MS);
}

/**
 * Enhanced search options
 */
export interface SearchOptions {
  searchField?: 'content' | 'title' | 'filename' | 'title_or_filename';
  types?: NoteType[];
  folder?: string;
  space?: string;
  limit?: number;
  fuzzy?: boolean;
  caseSensitive?: boolean;
  contextLines?: number;
  // Date filters
  modifiedAfter?: string;
  modifiedBefore?: string;
  createdAfter?: string;
  createdBefore?: string;
  propertyFilters?: Record<string, string>;
  propertyCaseSensitive?: boolean;
}

export interface SearchExecutionResult {
  results: SearchResult[];
  partialResults: boolean;
  backend: 'ripgrep' | 'fallback' | 'simple';
  warnings: string[];
}

/**
 * Search across all notes with enhanced options
 */
export async function searchNotes(
  query: string,
  options: SearchOptions = {}
): Promise<SearchExecutionResult> {
  const { types, folder, limit = 50, fuzzy = false } = options;
  const space = resolveSpaceId(options.space);
  const normalizedFolder = normalizeLocalFolderFilter(folder);
  const searchField = options.searchField ?? 'content';
  const effectiveTypes: NoteType[] | undefined =
    searchField === 'content' ? types : (types ?? ['note']);
  let results: SearchResult[] = [];
  let partialResults = false;
  const warnings: string[] = [];
  let backend: 'ripgrep' | 'fallback' | 'simple' = 'simple';
  const lowerQuery = query.toLowerCase();

  // Parse date filters
  const modifiedAfter = options.modifiedAfter
    ? parseFlexibleDateFilter(options.modifiedAfter)
    : null;
  const modifiedBefore = options.modifiedBefore
    ? parseFlexibleDateFilter(options.modifiedBefore)
    : null;
  const createdAfter = options.createdAfter
    ? parseFlexibleDateFilter(options.createdAfter)
    : null;
  const createdBefore = options.createdBefore
    ? parseFlexibleDateFilter(options.createdBefore)
    : null;
  const propertyFilterEntries = Object.entries(options.propertyFilters ?? {})
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  const propertyCaseSensitive = options.propertyCaseSensitive === true;

  // Check ripgrep availability (cached)
  if (ripgrepAvailable === null) {
    ripgrepAvailable = await isRipgrepAvailable();
    if (!ripgrepAvailable) {
      console.error('Note: ripgrep not found, using fallback search for local notes');
    }
  }

  if (searchField === 'content') {
    // Search local notes
    if (!space) {
      if (ripgrepAvailable) {
        try {
          const searchPaths = normalizedFolder
            ? [path.join(fileReader.getNotesPath(), normalizedFolder)]
            : undefined;

          const rgResult = await searchWithRipgrep(query, {
            caseSensitive: options.caseSensitive,
            contextLines: options.contextLines,
            paths: searchPaths,
            maxResults: limit * 2, // Get extra for filtering
          });

          backend = 'ripgrep';
          partialResults = rgResult.partialResults;
          if (rgResult.warning) warnings.push(rgResult.warning);
          results.push(...convertRipgrepToSearchResults(rgResult.matches));
        } catch (error) {
          console.error('Ripgrep search failed:', error);
          backend = 'fallback';
          warnings.push('ripgrep failed; using fallback local search');
          // Fall back to simple search
          const localNotes = fileReader.searchLocalNotes(query, {
            types: effectiveTypes,
            folder: normalizedFolder,
            limit: limit * 2,
          });
          results.push(...localNotes.map((note) => noteToSearchResult(note, lowerQuery)));
        }
      } else {
        backend = 'simple';
        warnings.push('ripgrep unavailable; using fallback local search');
        // Fallback to original search method
        const localNotes = fileReader.searchLocalNotes(query, {
          types: effectiveTypes,
          folder: normalizedFolder,
          limit: limit * 2,
        });
        results.push(...localNotes.map((note) => noteToSearchResult(note, lowerQuery)));
      }
    }

    // Search space notes
    const spaceNotes = sqliteReader.searchSpaceNotesFTS(query, { spaceId: space, limit: limit * 2 });
    for (const note of spaceNotes) {
      results.push({
        note,
        matches: findMatches(note.content, lowerQuery),
        score: 50, // Base score, will be enhanced below
      });
    }
  } else {
    backend = 'simple';
    warnings.push(
      `searchField=${searchField} performs metadata matching on titles/filenames (not full-text content search).`
    );
    const candidates = listNotes({
      folder: normalizedFolder,
      space,
    }).filter((note) => !effectiveTypes || effectiveTypes.includes(note.type));

    results = candidates
      .map((note) => scoreMetadataMatch(note, query, searchField, options.caseSensitive === true))
      .filter((entry): entry is SearchResult => entry !== null);
  }

  // Apply date filters
  if (modifiedAfter || modifiedBefore || createdAfter || createdBefore) {
    results = results.filter((r) => {
      const modifiedOk = isDateInRange(r.note.modifiedAt, modifiedAfter, modifiedBefore);
      const createdOk = isDateInRange(r.note.createdAt, createdAfter, createdBefore);

      // If both filter types specified, both must pass; if only one, just that one
      if ((modifiedAfter || modifiedBefore) && (createdAfter || createdBefore)) {
        return modifiedOk && createdOk;
      }
      if (modifiedAfter || modifiedBefore) return modifiedOk;
      if (createdAfter || createdBefore) return createdOk;
      return true;
    });
  }

  if (propertyFilterEntries.length > 0) {
    results = results.filter((r) =>
      matchesFrontmatterProperties(r.note, propertyFilterEntries, propertyCaseSensitive)
    );
  }

  // Apply enhanced scoring with recency boost
  results = results.map((r) => ({
    ...r,
    score: calculateEnhancedScore(r, lowerQuery),
  }));

  // Apply fuzzy re-ranking if enabled
  if (fuzzy && results.length > 0) {
    const allNotes = results.map((r) => r.note);
    return {
      results: fuzzySearch(allNotes, query, limit),
      partialResults,
      backend,
      warnings,
    };
  }

  // Sort by score and limit
  results.sort((a, b) => b.score - a.score);
  return {
    results: results.slice(0, limit),
    partialResults,
    backend,
    warnings,
  };
}

function splitSearchTerms(query: string): string[] {
  const tokens = query
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length > 0 ? tokens : [query.trim()];
}

function metadataScore(value: string, term: string): number {
  if (!value || !term) return 0;
  if (value === term) return 120;
  if (value.startsWith(term)) return 100;
  const slashSegment = value.split('/').some((segment) => segment === term);
  if (slashSegment) return 95;
  if (value.includes(term)) return 80;
  return 0;
}

function scoreMetadataMatch(
  note: Note,
  rawQuery: string,
  searchField: 'title' | 'filename' | 'title_or_filename',
  caseSensitive: boolean
): SearchResult | null {
  const terms = splitSearchTerms(rawQuery);
  const title = caseSensitive ? note.title : note.title.toLowerCase();
  const filename = caseSensitive ? note.filename : note.filename.toLowerCase();
  let bestScore = 0;
  let matchedOn: 'title' | 'filename' | null = null;

  for (const rawTerm of terms) {
    const term = caseSensitive ? rawTerm : rawTerm.toLowerCase();
    if (!term) continue;

    if (searchField === 'title' || searchField === 'title_or_filename') {
      const score = metadataScore(title, term);
      if (score > bestScore) {
        bestScore = score;
        matchedOn = 'title';
      }
    }
    if (searchField === 'filename' || searchField === 'title_or_filename') {
      const score = metadataScore(filename, term);
      if (score > bestScore) {
        bestScore = score;
        matchedOn = 'filename';
      }
    }
  }

  if (bestScore <= 0 || !matchedOn) return null;

  const lineContent = matchedOn === 'title' ? note.title : note.filename;
  return {
    note,
    matches: [
      {
        lineNumber: 1,
        lineContent,
        matchStart: 0,
        matchEnd: Math.min(lineContent.length, 120),
      },
    ],
    score: bestScore,
  };
}

export function normalizeFrontmatterScalar(value: string, caseSensitive: boolean): string {
  let normalized = value.trim();
  const quoted =
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"));
  if (quoted && normalized.length >= 2) {
    normalized = normalized.slice(1, -1).trim();
  }
  return caseSensitive ? normalized : normalized.toLowerCase();
}

export function matchesFrontmatterProperties(
  note: Note,
  propertyFilters: ReadonlyArray<readonly [string, string]>,
  caseSensitive: boolean
): boolean {
  const parsed = frontmatter.parseNoteContent(note.content);
  if (!parsed.frontmatter) return false;

  const frontmatterEntries = Object.entries(parsed.frontmatter);
  for (const [filterKey, filterValue] of propertyFilters) {
    const expectedKey = caseSensitive ? filterKey : filterKey.toLowerCase();
    const expectedValue = normalizeFrontmatterScalar(filterValue, caseSensitive);

    const actualEntry = frontmatterEntries.find(([actualKey]) => {
      const normalizedActualKey = caseSensitive ? actualKey : actualKey.toLowerCase();
      return normalizedActualKey === expectedKey;
    });
    if (!actualEntry) return false;

    const actualValue = normalizeFrontmatterScalar(actualEntry[1], caseSensitive);
    if (actualValue === expectedValue) continue;

    const listTokens = actualValue
      .split(/[;,]/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (!listTokens.includes(expectedValue)) {
      return false;
    }
  }

  return true;
}

/**
 * Convert a note to a SearchResult
 */
function noteToSearchResult(note: Note, query: string): SearchResult {
  const matches = findMatches(note.content, query);
  return {
    note,
    matches,
    score: calculateScore(note, matches, query),
  };
}

/**
 * Convert ripgrep matches to SearchResults
 */
function convertRipgrepToSearchResults(matches: RipgrepMatch[]): SearchResult[] {
  // Group matches by file
  const byFile = new Map<string, RipgrepMatch[]>();
  for (const m of matches) {
    const existing = byFile.get(m.file) || [];
    existing.push(m);
    byFile.set(m.file, existing);
  }

  const results: SearchResult[] = [];
  for (const [file, fileMatches] of byFile) {
    const note = fileReader.readNoteFile(file);
    if (note) {
      results.push({
        note,
        matches: fileMatches.map((m) => ({
          lineNumber: m.line,
          lineContent: m.content,
          matchStart: m.matchStart,
          matchEnd: m.matchEnd,
        })),
        score: fileMatches.length * 10, // Score by match count
      });
    }
  }
  return results;
}

/**
 * Enhanced scoring with recency boost
 */
function calculateEnhancedScore(result: SearchResult, query: string): number {
  let score = result.matches.length; // Base: match count

  const note = result.note;

  // Title match bonuses
  const lowerTitle = note.title.toLowerCase();
  if (lowerTitle === query) {
    score += 30; // Exact title match
  } else if (lowerTitle.includes(query)) {
    score += 15; // Partial title match
  }

  // Recency bonus (modified date) - significant boost for recent notes
  if (note.modifiedAt) {
    const daysSinceModified = (Date.now() - note.modifiedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceModified < 1) {
      score += 20; // Today
    } else if (daysSinceModified < 7) {
      score += 15; // This week
    } else if (daysSinceModified < 30) {
      score += 8; // This month
    } else if (daysSinceModified < 90) {
      score += 3; // Last 3 months
    }
    // Older notes get no boost
  }

  // Creation date bonus (smaller, for "newer" content)
  if (note.createdAt) {
    const daysSinceCreated = (Date.now() - note.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreated < 7) {
      score += 5; // Recently created
    } else if (daysSinceCreated < 30) {
      score += 2;
    }
  }

  // Penalty for @Archive and @Trash folders (push to bottom of results)
  if (note.folder) {
    const folderLower = note.folder.toLowerCase();
    if (folderLower.includes('@archive') || folderLower.includes('@trash')) {
      score -= 50; // Significant penalty to push these to the bottom
    }
  }

  // Also check note type for trash
  if (note.type === 'trash') {
    score -= 50;
  }

  return score;
}

/**
 * Find matches in content
 */
function findMatches(content: string, query: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lines = content.split('\n');
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    let index = lowerLine.indexOf(lowerQuery);

    while (index !== -1) {
      matches.push({
        lineNumber: i + 1,
        lineContent: line,
        matchStart: index,
        matchEnd: index + query.length,
      });
      index = lowerLine.indexOf(lowerQuery, index + 1);
    }
  }

  return matches;
}

/**
 * Calculate relevance score
 */
function calculateScore(note: Note, matches: SearchMatch[], query: string): number {
  let score = matches.length;

  // Boost for title match
  if (note.title.toLowerCase().includes(query)) {
    score += 10;
  }

  // Boost for exact title match
  if (note.title.toLowerCase() === query) {
    score += 20;
  }

  // Boost for recent notes
  if (note.modifiedAt) {
    const daysSinceModified = (Date.now() - note.modifiedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceModified < 7) score += 5;
    else if (daysSinceModified < 30) score += 2;
  }

  return score;
}

/**
 * Create a new note with smart folder matching
 */
export function createNote(
  title: string,
  content?: string,
  options: {
    folder?: string;
    space?: string;
    createNewFolder?: boolean;
  } = {}
): CreateNoteResult {
  const { folder, space, createNewFolder = false } = options;

  // Initialize folder resolution info
  const folderResolution: FolderResolution = {
    requested: folder,
    resolved: folder,
    matched: false,
    ambiguous: false,
    score: 0,
    alternatives: [],
  };

  // Auto-prepend title heading if content doesn't already start with one
  let effectiveContent = content || `# ${title}\n\n`;
  if (content) {
    const hasHeadingDirectly = /^\s*#\s/.test(content);
    const hasFmThenHeading = /^\s*---[\s\S]*?---\s*\n\s*#\s/.test(content);

    if (!hasHeadingDirectly && !hasFmThenHeading) {
      // Content has no heading — insert one
      const parsed = frontmatter.parseNoteContent(content);
      if (parsed.hasFrontmatter) {
        // Insert heading after frontmatter, before body
        const fmLineCount = frontmatter.getFrontmatterLineCount(content);
        const lines = content.split('\n');
        const fmPart = lines.slice(0, fmLineCount).join('\n');
        const bodyPart = lines.slice(fmLineCount).join('\n');
        effectiveContent = `${fmPart}\n# ${title}\n${bodyPart}`;
      } else {
        effectiveContent = `# ${title}\n${content}`;
      }
    }
  }

  const resolvedSpace = resolveSpaceId(space);
  if (resolvedSpace) {
    const filename = sqliteWriter.createSpaceNote(resolvedSpace, title, effectiveContent);
    const note = sqliteReader.getSpaceNote(filename);
    if (!note) throw new Error('Failed to create space note');
    invalidateListingCaches();
    return { note, folderResolution };
  }

  // Smart folder matching for local notes
  let resolvedFolder = folder;

  if (folder && !createNewFolder) {
    const folders = fileReader.listFolders();
    const match = matchFolder(folder, folders);

    if (match.matched && match.folder) {
      resolvedFolder = match.folder.path;
      folderResolution.resolved = match.folder.path;
      folderResolution.matched = true;
      folderResolution.ambiguous = match.ambiguous;
      folderResolution.score = match.score;
      folderResolution.alternatives = match.alternatives.map((f) => f.path);
    }
  }

  const filename = fileWriter.createProjectNote(title, effectiveContent, resolvedFolder);
  const note = fileReader.readNoteFile(filename);
  if (!note) throw new Error('Failed to create note');
  invalidateListingCaches();
  return { note, folderResolution };
}

/**
 * Update a note's content
 */
export function updateNote(
  identifier: string,
  content: string,
  options: { source?: Note['source'] } = {}
): Note {
  const updateSpace = (spaceIdentifier: string): Note => {
    const existing = sqliteReader.getSpaceNote(spaceIdentifier);
    if (!existing) {
      throw new Error(`Note not found: ${spaceIdentifier}`);
    }
    const writeIdentifier = existing.id || spaceIdentifier;
    sqliteWriter.updateSpaceNote(writeIdentifier, content);
    const note = sqliteReader.getSpaceNote(writeIdentifier);
    if (!note) throw new Error('Note not found after update');
    invalidateListingCaches();
    return note;
  };

  const updateLocal = (localIdentifier: string): Note => {
    fileWriter.updateNote(localIdentifier, content);
    const note = fileReader.readNoteFile(localIdentifier);
    if (!note) throw new Error('Note not found after update');
    invalidateListingCaches();
    return note;
  };

  if (options.source === 'space') {
    return updateSpace(identifier);
  }
  if (options.source === 'local') {
    return updateLocal(identifier);
  }

  if (identifier.includes('%%NotePlanCloud%%')) {
    return updateSpace(identifier);
  }

  const localNote = fileReader.readNoteFile(identifier);
  const spaceNote = sqliteReader.getSpaceNote(identifier);

  if (localNote) {
    return updateLocal(localNote.filename);
  }
  if (spaceNote) {
    return updateSpace(spaceNote.id || identifier);
  }

  throw new Error(`Note not found: ${identifier}`);
}

/**
 * Delete a note
 */
export function deleteNote(identifier: string): DeleteNoteResult {
  const note = getNoteByIdentifierOrThrow(identifier);
  if (note.source === 'space') {
    const moved = sqliteWriter.deleteSpaceNote(note.id || note.filename);
    invalidateListingCaches();
    return {
      source: 'space',
      fromIdentifier: moved.noteId,
      toIdentifier: moved.trashFolderId,
      noteId: moved.noteId,
    };
  }

  const trashedPath = fileWriter.deleteNote(note.filename);
  invalidateListingCaches();
  return {
    source: 'local',
    fromIdentifier: note.filename,
    toIdentifier: trashedPath,
  };
}

function getNoteByIdentifierOrThrow(
  identifier: string,
  options: { allowTrash?: boolean } = {}
): Note {
  const note = getNote({ id: identifier }) ?? getNote({ filename: identifier });
  if (!note) {
    throw new Error('Note not found');
  }
  if (options.allowTrash !== true && note.type === 'trash') {
    throw new Error('Note is in trash');
  }
  return note;
}

function getLocalProjectNoteOrThrow(identifier: string, action: string): Note {
  const note = getNoteByIdentifierOrThrow(identifier);
  if (note.source !== 'local') {
    throw new Error(`${action} is currently supported for local notes only`);
  }
  if (note.type !== 'note') {
    throw new Error(`${action} is supported for project notes only`);
  }
  return note;
}

function resolveSpaceMoveDestination(
  note: Note,
  destinationFolder: string,
  options: { allowTrashDestination?: boolean } = {}
): { id: string; label: string } {
  const query = destinationFolder.trim();
  if (!query) {
    throw new Error('Destination folder is required');
  }
  if (!note.spaceId) {
    throw new Error('Could not resolve note space');
  }

  const normalized = query.toLowerCase();
  if (normalized === 'root' || normalized === 'space-root' || query === note.spaceId) {
    return {
      id: note.spaceId,
      label: note.spaceId,
    };
  }

  const folder = sqliteReader.resolveSpaceFolder(note.spaceId, query, { includeTrash: true });
  if (!folder?.id) {
    throw new Error(`Destination folder not found in space: ${destinationFolder}`);
  }
  if (options.allowTrashDestination !== true && folder.name.toLowerCase() === '@trash') {
    throw new Error('Use noteplan_delete_note to move notes into TeamSpace @Trash');
  }

  return {
    id: folder.id,
    label: folder.path,
  };
}

export function previewMoveNote(identifier: string, destinationFolder: string): MoveNoteResult {
  const note = getNoteByIdentifierOrThrow(identifier);

  if (note.source === 'space') {
    if (note.type !== 'note') {
      throw new Error('Moving calendar notes in TeamSpaces is not supported');
    }
    const destination = resolveSpaceMoveDestination(note, destinationFolder);
    return {
      note,
      fromFilename: note.filename,
      toFilename: note.filename,
      destinationFolder: destination.label,
      destinationParentId: destination.id,
    };
  }

  const preview = fileWriter.previewMoveLocalNote(note.filename, destinationFolder);
  return {
    note,
    ...preview,
  };
}

export function moveNote(identifier: string, destinationFolder: string): MoveNoteResult {
  const preview = previewMoveNote(identifier, destinationFolder);

  if (preview.note.source === 'space') {
    if (!preview.note.id || !preview.destinationParentId) {
      throw new Error('Could not resolve TeamSpace move target');
    }
    sqliteWriter.moveSpaceNote(preview.note.id, preview.destinationParentId);
    const movedNote = sqliteReader.getSpaceNote(preview.note.id);
    if (!movedNote) {
      throw new Error('Failed to read note after move');
    }
    invalidateListingCaches();
    return {
      note: movedNote,
      fromFilename: preview.fromFilename,
      toFilename: preview.toFilename,
      destinationFolder: preview.destinationFolder,
      destinationParentId: preview.destinationParentId,
    };
  }

  const nextFilename = fileWriter.moveLocalNote(preview.note.filename, destinationFolder);
  const movedNote = fileReader.readNoteFile(nextFilename);
  if (!movedNote) {
    throw new Error('Failed to read note after move');
  }
  invalidateListingCaches();
  return {
    note: movedNote,
    fromFilename: preview.fromFilename,
    toFilename: preview.toFilename,
    destinationFolder: preview.destinationFolder,
  };
}

export function previewRestoreNote(
  identifier: string,
  destinationFolder?: string
): RestoreNoteResult {
  const note = getNoteByIdentifierOrThrow(identifier, { allowTrash: true });

  if (note.source === 'space') {
    if (!note.id) {
      throw new Error('Space note ID is required for restore');
    }
    if (!sqliteReader.isSpaceNoteInTrash(note.id)) {
      throw new Error('Note is not in TeamSpace @Trash');
    }
    const destination = destinationFolder
      ? resolveSpaceMoveDestination(note, destinationFolder)
      : { id: note.spaceId || '', label: note.spaceId || '' };
    if (!destination.id) {
      throw new Error('Could not resolve TeamSpace restore destination');
    }
    return {
      source: 'space',
      note,
      fromIdentifier: note.id,
      toIdentifier: destination.id,
    };
  }

  if (note.type !== 'trash') {
    throw new Error('Local note is not in @Trash');
  }
  const preview = fileWriter.previewRestoreLocalNoteFromTrash(
    note.filename,
    destinationFolder && destinationFolder.trim().length > 0 ? destinationFolder : 'Notes'
  );
  const restoredNote = fileReader.readNoteFile(preview.fromFilename);
  if (!restoredNote) {
    throw new Error('Failed to read local trash note');
  }
  return {
    source: 'local',
    note: restoredNote,
    fromIdentifier: preview.fromFilename,
    toIdentifier: preview.toFilename,
  };
}

export function restoreNote(identifier: string, destinationFolder?: string): RestoreNoteResult {
  const preview = previewRestoreNote(identifier, destinationFolder);

  if (preview.source === 'space') {
    sqliteWriter.restoreSpaceNote(preview.fromIdentifier, preview.toIdentifier);
    const restoredNote = sqliteReader.getSpaceNote(preview.fromIdentifier);
    if (!restoredNote) {
      throw new Error('Failed to read TeamSpace note after restore');
    }
    invalidateListingCaches();
    return {
      source: 'space',
      note: restoredNote,
      fromIdentifier: preview.fromIdentifier,
      toIdentifier: preview.toIdentifier,
    };
  }

  const restoredFilename = fileWriter.restoreLocalNoteFromTrash(
    preview.fromIdentifier,
    destinationFolder && destinationFolder.trim().length > 0 ? destinationFolder : 'Notes'
  );
  const restoredNote = fileReader.readNoteFile(restoredFilename);
  if (!restoredNote) {
    throw new Error('Failed to read local note after restore');
  }
  invalidateListingCaches();
  return {
    source: 'local',
    note: restoredNote,
    fromIdentifier: preview.fromIdentifier,
    toIdentifier: preview.toIdentifier,
  };
}

export function previewRenameNoteFile(
  filename: string,
  newFilename: string,
  keepExtension = true
): RenameNoteFileResult {
  const note = getLocalProjectNoteOrThrow(filename, 'Rename note file');
  const preview = fileWriter.previewRenameLocalNoteFile(note.filename, newFilename, keepExtension);
  return {
    note,
    ...preview,
  };
}

export function renameNoteFile(
  filename: string,
  newFilename: string,
  keepExtension = true
): RenameNoteFileResult {
  const preview = previewRenameNoteFile(filename, newFilename, keepExtension);
  const nextFilename = fileWriter.renameLocalNoteFile(filename, newFilename, keepExtension);
  const renamedNote = fileReader.readNoteFile(nextFilename);
  if (!renamedNote) {
    throw new Error('Failed to read note after rename');
  }
  invalidateListingCaches();
  return {
    note: renamedNote,
    fromFilename: preview.fromFilename,
    toFilename: preview.toFilename,
  };
}

export function renameSpaceNote(
  identifier: string,
  newTitle: string
): RenameSpaceNoteResult {
  const note = getNoteByIdentifierOrThrow(identifier);
  if (note.source !== 'space') {
    throw new Error('renameSpaceNote is for TeamSpace notes only');
  }
  if (note.type !== 'note') {
    throw new Error('Renaming is supported for project notes only');
  }
  const fromTitle = note.title;
  const writeId = note.id || note.filename;
  sqliteWriter.updateSpaceNoteTitle(writeId, newTitle);
  const renamedNote = sqliteReader.getSpaceNote(writeId);
  if (!renamedNote) {
    throw new Error('Failed to read note after rename');
  }
  invalidateListingCaches();
  return {
    note: renamedNote,
    fromTitle,
    toTitle: newTitle,
  };
}

/**
 * Get today's daily note
 */
export function getTodayNote(space?: string): Note | null {
  const dateStr = getTodayDateString();
  return getCalendarNote(dateStr, space);
}

/**
 * Get a calendar note by date
 */
export function getCalendarNote(date: string, space?: string): Note | null {
  const dateStr = parseFlexibleDate(date);
  const resolvedSpace = resolveSpaceId(space);

  if (resolvedSpace) {
    return sqliteReader.getSpaceCalendarNote(dateStr, resolvedSpace);
  }

  return fileReader.getCalendarNote(dateStr);
}

/**
 * Ensure a calendar note exists, create if not
 */
export function ensureCalendarNote(date: string, space?: string): Note {
  const dateStr = parseFlexibleDate(date);
  const resolvedSpace = resolveSpaceId(space);

  if (resolvedSpace) {
    let note = sqliteReader.getSpaceCalendarNote(dateStr, resolvedSpace);
    if (!note) {
      sqliteWriter.createSpaceCalendarNote(resolvedSpace, dateStr, '');
      note = sqliteReader.getSpaceCalendarNote(dateStr, resolvedSpace);
      invalidateListingCaches();
    }
    if (!note) throw new Error('Failed to create space calendar note');
    return note;
  }

  const filename = fileWriter.ensureCalendarNote(dateStr);
  const note = fileReader.readNoteFile(filename);
  if (!note) throw new Error('Failed to create calendar note');
  invalidateListingCaches();
  return note;
}

/**
 * Add content to today's note
 */
export function addToToday(
  content: string,
  position: 'start' | 'end' = 'end',
  space?: string
): Note {
  const note = ensureCalendarNote('today', space);

  let newContent: string;
  if (position === 'start') {
    const lines = note.content.split('\n');
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
    lines.splice(insertIndex, 0, content);
    newContent = lines.join('\n');
  } else {
    newContent = note.content + (note.content.endsWith('\n') ? '' : '\n') + content;
  }

  const identifier = note.source === 'space' ? (note.id || note.filename) : note.filename;
  return updateNote(identifier, newContent, { source: note.source });
}

/**
 * List all spaces
 */
export function listSpaces(): Space[] {
  return sqliteReader.listSpaces();
}

// Keep old name for backwards compatibility
export const listTeamspaces = listSpaces;

export interface ListFoldersOptions {
  space?: string;
  includeLocal?: boolean;
  includeSpaces?: boolean;
  query?: string;
  maxDepth?: number;
  parentPath?: string;
  recursive?: boolean;
}

export interface LocalFolderCreateResult {
  source: 'local';
  path: string;
  name: string;
}

export interface SpaceFolderCreateResult {
  source: 'space';
  id: string;
  path: string;
  name: string;
  spaceId: string;
  parentId: string;
}

export type FolderCreateResult = LocalFolderCreateResult | SpaceFolderCreateResult;

export interface LocalFolderMoveResult {
  source: 'local';
  fromPath: string;
  toPath: string;
  destinationFolder: string;
  affectedNoteCount?: number;
  affectedFolderCount?: number;
}

export interface SpaceFolderMoveResult {
  source: 'space';
  spaceId: string;
  folderId: string;
  fromPath: string;
  toPath: string;
  destinationParentId: string;
  affectedNoteCount?: number;
  affectedFolderCount?: number;
}

export type FolderMoveResult = LocalFolderMoveResult | SpaceFolderMoveResult;

export interface LocalFolderDeleteResult {
  source: 'local';
  fromPath: string;
  trashedPath: string;
  affectedNoteCount?: number;
  affectedFolderCount?: number;
}

export interface SpaceFolderDeleteResult {
  source: 'space';
  spaceId: string;
  folderId: string;
  fromPath: string;
  trashFolderId: string;
  affectedNoteCount?: number;
  affectedFolderCount?: number;
}

export type FolderDeleteResult = LocalFolderDeleteResult | SpaceFolderDeleteResult;

export interface LocalFolderRenameResult {
  source: 'local';
  fromPath: string;
  toPath: string;
}

export interface SpaceFolderRenameResult {
  source: 'space';
  spaceId: string;
  folderId: string;
  fromPath: string;
  toPath: string;
  previousName: string;
  name: string;
}

export type FolderRenameResult = LocalFolderRenameResult | SpaceFolderRenameResult;

/**
 * List folders with optional source/depth/query filtering
 */
export function listFolders(options: ListFoldersOptions = {}): Folder[] {
  const resolvedSpace = resolveSpaceId(options.space);
  const {
    includeLocal = !resolvedSpace,
    includeSpaces = Boolean(resolvedSpace),
    query,
    maxDepth,
    parentPath,
    recursive = true,
  } = options;
  const space = resolvedSpace;
  const normalizedQuery = query?.trim().toLowerCase() || '';
  const normalizedParentPath = normalizeLocalFolderFilter(parentPath);
  const cacheKey = JSON.stringify({
    space: space || '',
    includeLocal,
    includeSpaces,
    query: normalizedQuery,
    maxDepth: typeof maxDepth === 'number' ? maxDepth : null,
    parentPath: normalizedParentPath || '',
    recursive,
  });
  const cached = getCachedValue(listFoldersCache, cacheKey);
  if (cached) {
    return cached;
  }
  const folders: Folder[] = [];

  if (includeLocal) {
    folders.push(...fileReader.listFolders(maxDepth));
  }

  if (includeSpaces) {
    folders.push(...sqliteReader.listSpaceFolders(space));
  }

  const deduped = folders.filter((folder, index, arr) => {
    const key = `${folder.source}:${folder.spaceId || ''}:${folder.path}`;
    return arr.findIndex((candidate) =>
      `${candidate.source}:${candidate.spaceId || ''}:${candidate.path}` === key
    ) === index;
  });

  let filtered = normalizedQuery
    ? deduped.filter((folder) => {
        const path = folder.path.toLowerCase();
        const name = folder.name.toLowerCase();
        return path.includes(normalizedQuery) || name.includes(normalizedQuery);
      })
    : deduped;

  if (normalizedParentPath) {
    const parentPrefix = `${normalizedParentPath}/`;
    filtered = filtered.filter((folder) => {
      const normalizedPath = folder.path.replace(/\\/g, '/');
      if (!normalizedPath.startsWith(parentPrefix)) return false;
      if (recursive) return true;
      const relative = normalizedPath.slice(parentPrefix.length);
      return relative.length > 0 && !relative.includes('/');
    });
  } else if (!recursive) {
    filtered = filtered.filter((folder) => !folder.path.includes('/'));
  }

  filtered.sort((a, b) => a.path.localeCompare(b.path));
  return setCachedValue(listFoldersCache, cacheKey, filtered, LIST_FOLDERS_CACHE_TTL_MS);
}

function resolveSpaceFolderReference(
  spaceId: string,
  reference: string,
  options: { allowRoot?: boolean; includeTrash?: boolean } = {}
): { id: string; path: string; name: string } {
  const normalized = reference.trim();
  if (!normalized) {
    throw new Error('Folder reference is required');
  }

  const lower = normalized.toLowerCase();
  if (options.allowRoot === true && (lower === 'root' || lower === 'space-root' || normalized === spaceId)) {
    const space = sqliteReader.listSpaces().find((candidate) => candidate.id === spaceId);
    return {
      id: spaceId,
      path: space?.name || spaceId,
      name: space?.name || spaceId,
    };
  }

  const folder = sqliteReader.resolveSpaceFolder(spaceId, normalized, {
    includeTrash: options.includeTrash === true,
  });
  if (!folder?.id) {
    throw new Error(`Folder not found in space: ${reference}`);
  }

  return {
    id: folder.id,
    path: folder.path,
    name: folder.name,
  };
}

export function previewCreateFolder(
  options: { path: string } | { space: string; name: string; parent?: string }
): FolderCreateResult {
  if ('space' in options) {
    const spaceId = resolveSpaceId(options.space.trim());
    if (!spaceId) {
      throw new Error('space is required');
    }
    const name = options.name.trim();
    if (!name) {
      throw new Error('name is required');
    }
    const parent = options.parent?.trim();
    const destination = parent
      ? resolveSpaceFolderReference(spaceId, parent, { allowRoot: true, includeTrash: true })
      : resolveSpaceFolderReference(spaceId, spaceId, { allowRoot: true, includeTrash: true });
    if (destination.name.toLowerCase() === '@trash') {
      throw new Error('Destination parent cannot be @Trash');
    }

    return {
      source: 'space',
      id: '(pending)',
      path: destination.id === spaceId ? name : `${destination.path}/${name}`,
      name,
      spaceId,
      parentId: destination.id,
    };
  }

  const folder = fileWriter.previewCreateFolder(options.path);
  return {
    source: 'local',
    path: folder,
    name: path.basename(folder),
  };
}

export function createFolder(
  options: { path: string } | { space: string; name: string; parent?: string }
): FolderCreateResult {
  const preview = previewCreateFolder(options);
  if ('space' in options) {
    if (preview.source !== 'space') {
      throw new Error('Invalid folder create state');
    }
    const createdId = sqliteWriter.createSpaceFolder(
      preview.spaceId,
      preview.name,
      preview.parentId
    );
    const createdFolder = resolveSpaceFolderReference(preview.spaceId, createdId, {
      allowRoot: false,
      includeTrash: true,
    });
    invalidateListingCaches();
    return {
      source: 'space',
      id: createdFolder.id,
      path: createdFolder.path,
      name: createdFolder.name,
      spaceId: preview.spaceId,
      parentId: preview.parentId,
    };
  }

  const createdPath = fileWriter.createFolder(options.path);
  invalidateListingCaches();
  return {
    source: 'local',
    path: createdPath,
    name: path.basename(createdPath),
  };
}

export function previewMoveFolder(
  options:
    | { sourcePath: string; destinationFolder: string }
    | { space: string; source: string; destination: string }
): FolderMoveResult {
  if ('space' in options) {
    const spaceId = resolveSpaceId(options.space.trim());
    if (!spaceId) {
      throw new Error('space is required');
    }
    const source = resolveSpaceFolderReference(spaceId, options.source, {
      allowRoot: false,
      includeTrash: true,
    });
    const destination = resolveSpaceFolderReference(spaceId, options.destination, {
      allowRoot: true,
      includeTrash: true,
    });
    if (destination.name.toLowerCase() === '@trash') {
      throw new Error('Destination folder cannot be @Trash');
    }

    const counts = sqliteReader.countSpaceFolderContents(source.id);
    return {
      source: 'space',
      spaceId,
      folderId: source.id,
      fromPath: source.path,
      toPath: destination.id === spaceId ? source.name : `${destination.path}/${source.name}`,
      destinationParentId: destination.id,
      affectedNoteCount: counts.noteCount,
      affectedFolderCount: counts.folderCount,
    };
  }

  const preview = fileWriter.previewMoveLocalFolder(options.sourcePath, options.destinationFolder);
  const fullPath = path.join(fileReader.getNotesPath(), preview.fromFolder);
  const counts = fileReader.countNotesInDirectory(fullPath);
  return {
    source: 'local',
    fromPath: preview.fromFolder,
    toPath: preview.toFolder,
    destinationFolder: preview.destinationFolder || options.destinationFolder,
    affectedNoteCount: counts.noteCount,
    affectedFolderCount: counts.folderCount,
  };
}

export function moveFolder(
  options:
    | { sourcePath: string; destinationFolder: string }
    | { space: string; source: string; destination: string }
): FolderMoveResult {
  const preview = previewMoveFolder(options);
  if ('space' in options) {
    if (preview.source !== 'space') {
      throw new Error('Invalid folder move state');
    }
    sqliteWriter.moveSpaceFolder(preview.folderId, preview.destinationParentId);
    const moved = resolveSpaceFolderReference(preview.spaceId, preview.folderId, {
      allowRoot: false,
      includeTrash: true,
    });
    invalidateListingCaches();
    return {
      ...preview,
      toPath: moved.path,
    };
  }

  const moved = fileWriter.moveLocalFolder(options.sourcePath, options.destinationFolder);
  invalidateListingCaches();
  return {
    source: 'local',
    fromPath: moved.fromFolder,
    toPath: moved.toFolder,
    destinationFolder: moved.destinationFolder || options.destinationFolder,
  };
}

export function previewDeleteFolder(
  options: { path: string } | { space: string; source: string }
): FolderDeleteResult {
  if ('space' in options) {
    const spaceId = resolveSpaceId(options.space.trim());
    if (!spaceId) {
      throw new Error('space is required');
    }
    const source = resolveSpaceFolderReference(spaceId, options.source, {
      allowRoot: false,
      includeTrash: true,
    });
    const counts = sqliteReader.countSpaceFolderContents(source.id);
    return {
      source: 'space',
      spaceId,
      folderId: source.id,
      fromPath: source.path,
      trashFolderId: '(pending)',
      affectedNoteCount: counts.noteCount,
      affectedFolderCount: counts.folderCount,
    };
  }

  const normalized = fileWriter.previewDeleteLocalFolder(options.path);
  const fullPath = path.join(fileReader.getNotesPath(), normalized);
  const counts = fileReader.countNotesInDirectory(fullPath);
  return {
    source: 'local',
    fromPath: normalized,
    trashedPath: '(pending)',
    affectedNoteCount: counts.noteCount,
    affectedFolderCount: counts.folderCount,
  };
}

export function deleteFolder(
  options: { path: string } | { space: string; source: string }
): FolderDeleteResult {
  const preview = previewDeleteFolder(options);
  if ('space' in options) {
    if (preview.source !== 'space') {
      throw new Error('Invalid folder delete state');
    }
    const deleted = sqliteWriter.deleteSpaceFolder(preview.folderId);
    invalidateListingCaches();
    return {
      source: 'space',
      spaceId: preview.spaceId,
      folderId: preview.folderId,
      fromPath: preview.fromPath,
      trashFolderId: deleted.trashFolderId,
    };
  }

  const trashedPath = fileWriter.deleteLocalFolder(options.path);
  invalidateListingCaches();
  return {
    source: 'local',
    fromPath: preview.fromPath,
    trashedPath,
  };
}

export function previewRenameFolder(
  options:
    | { sourcePath: string; newName: string }
    | { space: string; source: string; newName: string }
): FolderRenameResult {
  if ('space' in options) {
    const spaceId = resolveSpaceId(options.space.trim());
    if (!spaceId) {
      throw new Error('space is required');
    }
    const source = resolveSpaceFolderReference(spaceId, options.source, {
      allowRoot: false,
      includeTrash: true,
    });
    const newName = options.newName.trim();
    if (!newName) {
      throw new Error('newName is required');
    }
    const separatorIndex = source.path.lastIndexOf('/');
    const parentPath = separatorIndex >= 0 ? source.path.slice(0, separatorIndex) : '';
    return {
      source: 'space',
      spaceId,
      folderId: source.id,
      fromPath: source.path,
      toPath: parentPath ? `${parentPath}/${newName}` : newName,
      previousName: source.name,
      name: newName,
    };
  }

  const preview = fileWriter.previewRenameLocalFolder(options.sourcePath, options.newName);
  return {
    source: 'local',
    fromPath: preview.fromFolder,
    toPath: preview.toFolder,
  };
}

export function renameFolder(
  options:
    | { sourcePath: string; newName: string }
    | { space: string; source: string; newName: string }
): FolderRenameResult {
  const preview = previewRenameFolder(options);
  if ('space' in options) {
    if (preview.source !== 'space') {
      throw new Error('Invalid folder rename state');
    }
    const renamed = sqliteWriter.renameSpaceFolder(preview.folderId, preview.name);
    const folder = resolveSpaceFolderReference(preview.spaceId, renamed.folderId, {
      allowRoot: false,
      includeTrash: true,
    });
    invalidateListingCaches();
    return {
      ...preview,
      toPath: folder.path,
    };
  }

  const renamed = fileWriter.renameLocalFolder(options.sourcePath, options.newName);
  invalidateListingCaches();
  return {
    source: 'local',
    fromPath: renamed.fromFolder,
    toPath: renamed.toFolder,
  };
}

/**
 * List all tags
 */
export function listTags(space?: string): string[] {
  const resolvedSpace = resolveSpaceId(space);
  const tags = new Set<string>();

  if (!resolvedSpace) {
    fileReader.extractAllTags().forEach((tag) => tags.add(tag));
  }

  sqliteReader.extractSpaceTags(resolvedSpace).forEach((tag) => tags.add(tag));

  return Array.from(tags).sort();
}
