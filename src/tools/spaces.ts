// Space operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';
import {
  issueConfirmationToken,
  validateAndConsumeConfirmationToken,
} from '../utils/confirmation-tokens.js';

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

function normalizeFolderPathInput(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let normalized = value.trim().replace(/\\/g, '/');
  normalized = normalized.replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === 'Notes') return undefined;
  if (normalized.startsWith('Notes/')) {
    normalized = normalized.slice('Notes/'.length);
  }
  return normalized || undefined;
}

function confirmationFailureMessage(toolName: string, reason: string): string {
  const refreshHint = `Call ${toolName} with dryRun=true to get a new confirmationToken.`;
  if (reason === 'missing') {
    return `Confirmation token is required for ${toolName}. ${refreshHint}`;
  }
  if (reason === 'expired') {
    return `Confirmation token is expired for ${toolName}. ${refreshHint}`;
  }
  return `Confirmation token is invalid for ${toolName}. ${refreshHint}`;
}

export const listSpacesSchema = z.object({
  query: z.string().optional().describe('Filter spaces by name/id substring'),
  limit: z.number().min(1).max(200).optional().default(50).describe('Maximum number of spaces to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const listTagsSchema = z.object({
  space: z.string().optional().describe('Space name or ID to list tags from'),
  query: z.string().optional().describe('Filter tags by substring'),
  limit: z.number().min(1).max(500).optional().default(100).describe('Maximum number of tags to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const listFoldersSchema = z.object({
  space: z.string().optional().describe('Space name or ID to list folders from'),
  includeLocal: z
    .boolean()
    .optional()
    .describe('Include local filesystem folders (default: true when space is omitted)'),
  includeSpaces: z
    .boolean()
    .optional()
    .describe('Include space folders (default: true only when space is provided)'),
  query: z.string().optional().describe('Filter folders by name/path substring'),
  parentPath: z
    .string()
    .optional()
    .describe(
      'Optional parent folder path. Use canonical paths like "20 - Areas" (or "Notes/20 - Areas").'
    ),
  recursive: z
    .boolean()
    .optional()
    .describe('When parentPath is set: true = include all descendants, false = only direct children (default: true)'),
  maxDepth: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Max local folder depth (1 = top level, default: 1). If parentPath is provided and maxDepth is omitted, depth auto-expands to include that branch.'
    ),
  limit: z.number().min(1).max(500).optional().default(50).describe('Maximum number of folders to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const findFoldersSchema = z.object({
  query: z.string().describe('Folder query, e.g. "project" or "inbox"'),
  space: z.string().optional().describe('Restrict to a specific space name or ID'),
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
  space: z.string().optional().describe('Restrict to a specific space name or ID'),
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

export const createFolderSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Local folder path under Notes (e.g., "20 - Areas/Marketing")'),
  space: z.string().optional().describe('Space name or ID for TeamSpace folder creation'),
  name: z
    .string()
    .optional()
    .describe('TeamSpace folder name (required when space is provided)'),
  parent: z
    .string()
    .optional()
    .describe('TeamSpace parent folder reference (ID/path/name or "root", default: space root)'),
}).superRefine((input, ctx) => {
  if (input.space) {
    if (!input.name || input.name.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'name is required when space is provided',
        path: ['name'],
      });
    }
    return;
  }

  if (!input.path || input.path.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'path is required for local folder creation',
      path: ['path'],
    });
  }
});

export const moveFolderSchema = z.object({
  sourcePath: z
    .string()
    .optional()
    .describe('Local source folder path under Notes'),
  destinationFolder: z
    .string()
    .optional()
    .describe('Local destination folder path under Notes (or "Notes" for root)'),
  space: z.string().optional().describe('Space name or ID for TeamSpace folder move'),
  source: z
    .string()
    .optional()
    .describe('TeamSpace source folder reference (ID/path/name)'),
  destination: z
    .string()
    .optional()
    .describe('TeamSpace destination folder reference (ID/path/name or "root")'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview move impact and get confirmationToken without mutating folders'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for move execution'),
}).superRefine((input, ctx) => {
  if (input.space) {
    if (!input.source || input.source.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source is required when space is provided',
        path: ['source'],
      });
    }
    if (!input.destination || input.destination.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'destination is required when space is provided',
        path: ['destination'],
      });
    }
    return;
  }

  if (!input.sourcePath || input.sourcePath.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'sourcePath is required for local folder move',
      path: ['sourcePath'],
    });
  }
  if (!input.destinationFolder || input.destinationFolder.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'destinationFolder is required for local folder move',
      path: ['destinationFolder'],
    });
  }
});

export const renameFolderSchema = z.object({
  sourcePath: z
    .string()
    .optional()
    .describe('Local source folder path under Notes'),
  newName: z.string().describe('New folder name'),
  space: z.string().optional().describe('Space name or ID for TeamSpace folder rename'),
  source: z
    .string()
    .optional()
    .describe('TeamSpace source folder reference (ID/path/name)'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview rename impact and get confirmationToken without mutating folders'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for rename execution'),
}).superRefine((input, ctx) => {
  if (input.space) {
    if (!input.source || input.source.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source is required when space is provided',
        path: ['source'],
      });
    }
    return;
  }

  if (!input.sourcePath || input.sourcePath.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'sourcePath is required for local folder rename',
      path: ['sourcePath'],
    });
  }
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

  const parentPath = normalizeFolderPathInput((input as { parentPath?: unknown }).parentPath);
  const recursive = toOptionalBoolean((input as { recursive?: unknown }).recursive) ?? true;
  const requestedMaxDepth = toOptionalBoundedInt(input.maxDepth, 1, 20);
  const parentDepth = parentPath ? parentPath.split('/').filter(Boolean).length : 0;
  const maxDepth = requestedMaxDepth
    ?? (parentPath
      ? (recursive ? 20 : Math.min(20, parentDepth + 1))
      : 1);
  const listStart = Date.now();
  const folders = store.listFolders({
    space: input.space,
    includeLocal: toOptionalBoolean(input.includeLocal),
    includeSpaces: toOptionalBoolean(input.includeSpaces),
    query: typeof input.query === 'string' ? input.query : undefined,
    maxDepth,
    parentPath,
    recursive,
  });
  const listFoldersMs = Date.now() - listStart;
  if (includeStageTimings) {
    stageTimings.listFoldersMs = listFoldersMs;
  }

  const paginateStart = Date.now();
  const offset = toBoundedInt(input.cursor ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = toBoundedInt(input.limit, 50, 1, 500);
  const page = folders.slice(offset, offset + limit);
  const hasMore = offset + page.length < folders.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;
  const paginateMs = Date.now() - paginateStart;
  if (includeStageTimings) {
    stageTimings.paginateMs = paginateMs;
  }

  const mapStart = Date.now();
  const mappedFolders = page.map((f) => ({
    id: f.id,
    path: f.path,
    name: f.name,
    source: f.source,
    spaceId: f.spaceId,
  }));
  const mapResultMs = Date.now() - mapStart;
  if (includeStageTimings) {
    stageTimings.mapResultMs = mapResultMs;
  }

  const result: Record<string, unknown> = {
    success: true,
    count: page.length,
    totalCount: folders.length,
    offset,
    limit,
    maxDepth,
    parentPath: parentPath ?? null,
    recursive,
    hasMore,
    nextCursor,
    folders: mappedFolders,
  };

  const performanceHints: string[] = [];
  if (listFoldersMs > 1200) {
    if (!input.query) {
      performanceHints.push('Set query to narrow folder results before listing full trees.');
    }
    if (!input.space) {
      performanceHints.push('Set space to scope folder listing to one workspace.');
    }
    if (maxDepth > 1 && requestedMaxDepth !== undefined) {
      performanceHints.push('Lower maxDepth (for example 1) to reduce local folder traversal.');
    }
    if (!parentPath) {
      performanceHints.push('Set parentPath to scope folder traversal to one branch.');
    }
  }
  if (hasMore && limit > 100) {
    performanceHints.push('Use a smaller limit (for example 25-50) and paginate with nextCursor.');
  }
  if (parentPath && recursive) {
    performanceHints.push('Set recursive=false to return only direct subfolders of parentPath.');
  }
  if (parentPath && requestedMaxDepth !== undefined && requestedMaxDepth <= parentDepth) {
    performanceHints.push(
      `maxDepth=${requestedMaxDepth} may be too shallow for parentPath depth ${parentDepth}; set maxDepth>=${parentDepth + 1} to include children.`
    );
  }
  if (performanceHints.length > 0) {
    result.performanceHints = performanceHints;
  }

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
      id: entry.folder.id,
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
  const listFoldersMs = Date.now() - listStart;
  if (includeStageTimings) {
    stageTimings.listFoldersMs = listFoldersMs;
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
  const scoreAndSortMs = Date.now() - scoreStart;
  if (includeStageTimings) {
    stageTimings.scoreAndSortMs = scoreAndSortMs;
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
    id: entry.folder.id,
    path: entry.folder.path,
    name: entry.folder.name,
    source: entry.folder.source,
    spaceId: entry.folder.spaceId,
    score: Number(entry.score.toFixed(3)),
  }));
  const resolveResultMs = Date.now() - resolveStart;
  if (includeStageTimings) {
    stageTimings.resolveResultMs = resolveResultMs;
  }

  const result: Record<string, unknown> = {
    success: true,
    query,
    maxDepth,
    count: candidates.length,
    resolved: resolved
      ? {
          path: resolved.folder.path,
          id: resolved.folder.id,
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

  const performanceHints: string[] = [];
  if (listFoldersMs > 1200) {
    if (!params.space) {
      performanceHints.push('Set space to narrow folder resolution to one workspace.');
    }
    if (params.includeLocal === false && params.includeSpaces === false) {
      performanceHints.push('Enable includeLocal or includeSpaces to avoid empty scans.');
    }
    if (maxDepth > 1) {
      performanceHints.push('Lower maxDepth (for example 1) for faster resolution.');
    }
  }
  if (candidates.length === 0) {
    performanceHints.push('Try noteplan_find_folders first to inspect likely folder matches.');
  }
  if (performanceHints.length > 0) {
    result.performanceHints = performanceHints;
  }

  if (includeStageTimings) {
    result.stageTimings = stageTimings;
  }

  return result;
}

export function createFolder(params: z.infer<typeof createFolderSchema>) {
  const input = params ?? ({} as z.infer<typeof createFolderSchema>);
  try {
    if (input.space) {
      const created = store.createFolder({
        space: input.space,
        name: input.name || '',
        parent: input.parent,
      });
      if (created.source !== 'space') {
        throw new Error('Invalid TeamSpace folder creation state');
      }
      return {
        success: true,
        message: `TeamSpace folder created at ${created.path}`,
        source: created.source,
        spaceId: created.spaceId,
        id: created.id,
        path: created.path,
        name: created.name,
        parentId: created.parentId,
      };
    }

    const created = store.createFolder({
      path: input.path || '',
    });
    return {
      success: true,
      message: `Folder created at ${created.path}`,
      source: created.source,
      path: created.path,
      name: created.name,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create folder',
    };
  }
}

export function moveFolder(params: z.infer<typeof moveFolderSchema>) {
  const input = params ?? ({} as z.infer<typeof moveFolderSchema>);
  try {
    const preview = input.space
      ? store.previewMoveFolder({
          space: input.space,
          source: input.source || '',
          destination: input.destination || '',
        })
      : store.previewMoveFolder({
          sourcePath: input.sourcePath || '',
          destinationFolder: input.destinationFolder || '',
        });

    const confirmationTarget = `${preview.fromPath}=>${preview.toPath}`;
    if (input.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_move_folder',
        target: confirmationTarget,
        action: 'move_folder',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: folder ${preview.fromPath} would move to ${preview.toPath}`,
        ...preview,
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(input.confirmationToken, {
      tool: 'noteplan_move_folder',
      target: confirmationTarget,
      action: 'move_folder',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_move_folder', confirmation.reason),
      };
    }

    const moved = input.space
      ? store.moveFolder({
          space: input.space,
          source: input.source || '',
          destination: input.destination || '',
        })
      : store.moveFolder({
          sourcePath: input.sourcePath || '',
          destinationFolder: input.destinationFolder || '',
        });

    return {
      success: true,
      message:
        moved.source === 'space'
          ? `TeamSpace folder moved to ${moved.toPath}`
          : `Folder moved to ${moved.toPath}`,
      ...moved,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to move folder',
    };
  }
}

export function renameFolder(params: z.infer<typeof renameFolderSchema>) {
  const input = params ?? ({} as z.infer<typeof renameFolderSchema>);
  try {
    const preview = input.space
      ? store.previewRenameFolder({
          space: input.space,
          source: input.source || '',
          newName: input.newName || '',
        })
      : store.previewRenameFolder({
          sourcePath: input.sourcePath || '',
          newName: input.newName || '',
        });

    const confirmationTarget = `${preview.fromPath}=>${preview.toPath}`;
    if (input.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_rename_folder',
        target: confirmationTarget,
        action: 'rename_folder',
      });
      return {
        success: true,
        dryRun: true,
        message: `Dry run: folder ${preview.fromPath} would rename to ${preview.toPath}`,
        ...preview,
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(input.confirmationToken, {
      tool: 'noteplan_rename_folder',
      target: confirmationTarget,
      action: 'rename_folder',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_rename_folder', confirmation.reason),
      };
    }

    const renamed = input.space
      ? store.renameFolder({
          space: input.space,
          source: input.source || '',
          newName: input.newName || '',
        })
      : store.renameFolder({
          sourcePath: input.sourcePath || '',
          newName: input.newName || '',
        });

    return {
      success: true,
      message:
        renamed.source === 'space'
          ? `TeamSpace folder renamed to ${renamed.toPath}`
          : `Folder renamed to ${renamed.toPath}`,
      ...renamed,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to rename folder',
    };
  }
}
