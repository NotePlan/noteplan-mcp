// Space operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function toOptionalBoundedInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function isDebugTimingsEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

export const listSpacesSchema = z.object({
  query: z.string().optional().describe('Filter spaces by name/id substring'),
  limit: z.number().min(1).max(200).optional().default(50).describe('Maximum number of spaces to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const listTagsSchema = z.object({
  space: z.string().optional().describe('Space ID to list tags from'),
  query: z.string().optional().describe('Filter tags by substring'),
  limit: z.number().min(1).max(500).optional().default(100).describe('Maximum number of tags to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const listFoldersSchema = z.object({
  space: z.string().optional().describe('Space ID to list folders from'),
  includeLocal: z
    .boolean()
    .optional()
    .describe('Include local filesystem folders (default: true when space is omitted)'),
  includeSpaces: z
    .boolean()
    .optional()
    .describe('Include space folders (default: true only when space is provided)'),
  query: z.string().optional().describe('Filter folders by name/path substring'),
  maxDepth: z.number().min(1).max(20).optional().describe('Max local folder depth (1 = top level, default: 1)'),
  limit: z.number().min(1).max(500).optional().default(50).describe('Maximum number of folders to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const findFoldersSchema = z.object({
  query: z.string().describe('Folder query, e.g. "project" or "inbox"'),
  space: z.string().optional().describe('Restrict to a specific space ID'),
  includeLocal: z
    .boolean()
    .optional()
    .describe('Include local filesystem folders (default: true when space is omitted)'),
  includeSpaces: z
    .boolean()
    .optional()
    .describe('Include space folders (default: true only when space is provided)'),
  maxDepth: z.number().min(1).max(20).optional().describe('Max local folder depth (1 = top level, default: 2)'),
  limit: z.number().min(1).max(100).optional().default(10).describe('Maximum matches to return'),
});

export const resolveFolderSchema = z.object({
  query: z.string().describe('Folder text to resolve to one canonical folder path'),
  space: z.string().optional().describe('Restrict to a specific space ID'),
  includeLocal: z
    .boolean()
    .optional()
    .describe('Include local filesystem folders (default: true when space is omitted)'),
  includeSpaces: z
    .boolean()
    .optional()
    .describe('Include space folders (default: true only when space is provided)'),
  maxDepth: z.number().min(1).max(20).optional().describe('Max local folder depth (1 = top level, default: 2)'),
  limit: z.number().min(1).max(20).optional().default(5).describe('Candidate matches to return'),
  minScore: z.number().min(0).max(1).optional().default(0.88).describe('Minimum score for auto-resolution'),
  ambiguityDelta: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.06)
    .describe('If top scores are within this delta, treat as ambiguous'),
});

export function listSpaces(params?: z.infer<typeof listSpacesSchema>) {
  const input = params ?? ({} as z.infer<typeof listSpacesSchema>);
  const spaces = store.listSpaces();
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : undefined;
  const filtered = query
    ? spaces.filter((space) =>
        `${space.name} ${space.id}`.toLowerCase().includes(query)
      )
    : spaces;
  const offset = toBoundedInt(input.cursor ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(input.limit, 50, 1, 200);
  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + page.length < filtered.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  return {
    success: true,
    count: page.length,
    totalCount: filtered.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    spaces: page.map((s) => ({
      id: s.id,
      name: s.name,
      noteCount: s.noteCount,
    })),
  };
}

export function listTags(params?: z.infer<typeof listTagsSchema>) {
  const input = params ?? ({} as z.infer<typeof listTagsSchema>);
  const tags = store.listTags(input.space);
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : undefined;
  const filtered = query ? tags.filter((tag) => tag.toLowerCase().includes(query)) : tags;
  const offset = toBoundedInt(input.cursor ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(input.limit, 100, 1, 500);
  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + page.length < filtered.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  return {
    success: true,
    count: page.length,
    totalCount: filtered.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    tags: page,
  };
}

export function listFolders(params?: z.infer<typeof listFoldersSchema>) {
  const input = params ?? ({} as z.infer<typeof listFoldersSchema>);
  const includeStageTimings = isDebugTimingsEnabled(
    (input as { debugTimings?: unknown }).debugTimings
  );
  const stageTimings: Record<string, number> = {};

  const maxDepth = toOptionalBoundedInt(input.maxDepth, 1, 20) ?? 1;
  const listStart = Date.now();
  const folders = store.listFolders({
    space: input.space,
    includeLocal: toOptionalBoolean(input.includeLocal),
    includeSpaces: toOptionalBoolean(input.includeSpaces),
    query: typeof input.query === 'string' ? input.query : undefined,
    maxDepth,
  });
  if (includeStageTimings) {
    stageTimings.listFoldersMs = Date.now() - listStart;
  }

  const paginateStart = Date.now();
  const offset = toBoundedInt(input.cursor ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(input.limit, 50, 1, 500);
  const page = folders.slice(offset, offset + limit);
  const hasMore = offset + page.length < folders.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;
  if (includeStageTimings) {
    stageTimings.paginateMs = Date.now() - paginateStart;
  }

  const mapStart = Date.now();
  const mappedFolders = page.map((f) => ({
    path: f.path,
    name: f.name,
    source: f.source,
    spaceId: f.spaceId,
  }));
  if (includeStageTimings) {
    stageTimings.mapResultMs = Date.now() - mapStart;
  }

  const result: Record<string, unknown> = {
    success: true,
    count: page.length,
    totalCount: folders.length,
    offset,
    limit,
    maxDepth,
    hasMore,
    nextCursor,
    folders: mappedFolders,
  };

  if (includeStageTimings) {
    result.stageTimings = stageTimings;
  }

  return result;
}

function folderMatchScore(path: string, name: string, query: string): number {
  const pathLower = path.toLowerCase();
  const nameLower = name.toLowerCase();
  const queryLower = query.toLowerCase();

  if (nameLower === queryLower) return 1.0;
  if (pathLower === queryLower) return 0.98;
  if (nameLower.startsWith(queryLower)) return 0.92;
  if (pathLower.includes(`/${queryLower}`) || pathLower.startsWith(queryLower)) return 0.88;
  if (nameLower.includes(queryLower)) return 0.82;
  if (pathLower.includes(queryLower)) return 0.75;
  return 0;
}

export function findFolders(params: z.infer<typeof findFoldersSchema>) {
  const query = typeof params?.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }

  const limit = toBoundedInt(params.limit, 10, 1, 100);
  const maxDepth = toOptionalBoundedInt(params.maxDepth, 1, 20) ?? 2;
  const folders = store.listFolders({
    space: params.space,
    includeLocal: toOptionalBoolean(params.includeLocal),
    includeSpaces: toOptionalBoolean(params.includeSpaces),
    query,
    maxDepth,
  });

  const scored = folders
    .map((folder) => ({
      folder,
      score: folderMatchScore(folder.path, folder.name, query),
      depth: folder.path.split('/').length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
      return a.depth - b.depth;
    })
    .slice(0, limit);

  return {
    success: true,
    query,
    maxDepth,
    count: scored.length,
    matches: scored.map((entry) => ({
      path: entry.folder.path,
      name: entry.folder.name,
      source: entry.folder.source,
      spaceId: entry.folder.spaceId,
      score: Number(entry.score.toFixed(3)),
    })),
  };
}

export function resolveFolder(params: z.infer<typeof resolveFolderSchema>) {
  const query = typeof params?.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }

  const limit = toBoundedInt(params.limit, 5, 1, 20);
  const maxDepth = toOptionalBoundedInt(params.maxDepth, 1, 20) ?? 2;
  const minScore = Math.min(1, Math.max(0, Number(params.minScore ?? 0.88)));
  const ambiguityDelta = Math.min(1, Math.max(0, Number(params.ambiguityDelta ?? 0.06)));
  const includeStageTimings = isDebugTimingsEnabled(
    (params as { debugTimings?: unknown }).debugTimings
  );
  const stageTimings: Record<string, number> = {};

  const listStart = Date.now();
  const folders = store.listFolders({
    space: params.space,
    includeLocal: toOptionalBoolean(params.includeLocal),
    includeSpaces: toOptionalBoolean(params.includeSpaces),
    query,
    maxDepth,
  });
  if (includeStageTimings) {
    stageTimings.listFoldersMs = Date.now() - listStart;
  }

  const scoreStart = Date.now();
  const scored = folders
    .map((folder) => ({
      folder,
      score: folderMatchScore(folder.path, folder.name, query),
      depth: folder.path.split('/').length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
      return a.depth - b.depth;
    });
  if (includeStageTimings) {
    stageTimings.scoreAndSortMs = Date.now() - scoreStart;
  }

  const resolveStart = Date.now();
  const candidates = scored.slice(0, limit);
  const top = candidates[0];
  const second = candidates[1];
  const queryLower = query.toLowerCase();
  const exactMatch =
    top
      ? top.folder.name.toLowerCase() === queryLower || top.folder.path.toLowerCase() === queryLower
      : false;
  const scoreDelta = top && second ? top.score - second.score : 1;
  const confident = Boolean(top) && (exactMatch || top.score >= minScore);
  const ambiguous = Boolean(second) && scoreDelta < ambiguityDelta;
  const resolved = confident && !ambiguous ? top : undefined;
  const mappedCandidates = candidates.map((entry) => ({
    path: entry.folder.path,
    name: entry.folder.name,
    source: entry.folder.source,
    spaceId: entry.folder.spaceId,
    score: Number(entry.score.toFixed(3)),
  }));
  if (includeStageTimings) {
    stageTimings.resolveResultMs = Date.now() - resolveStart;
  }

  const result: Record<string, unknown> = {
    success: true,
    query,
    maxDepth,
    count: candidates.length,
    resolved: resolved
      ? {
          path: resolved.folder.path,
          name: resolved.folder.name,
          source: resolved.folder.source,
          spaceId: resolved.folder.spaceId,
          score: Number(resolved.score.toFixed(3)),
        }
      : null,
    exactMatch,
    ambiguous,
    confidence: top ? Number(top.score.toFixed(3)) : 0,
    confidenceDelta: Number(scoreDelta.toFixed(3)),
    suggestedToolArgs: resolved ? { folder: resolved.folder.path } : null,
    candidates: mappedCandidates,
  };

  if (includeStageTimings) {
    result.stageTimings = stageTimings;
  }

  return result;
}
