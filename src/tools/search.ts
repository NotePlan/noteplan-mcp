// Search operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';
import { NoteType } from '../noteplan/types.js';

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function isDebugTimingsEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

export const searchSchema = z.object({
  query: z.string().describe('Search query. Supports OR patterns like "meeting|standup"'),
  types: z
    .array(z.enum(['calendar', 'note', 'trash']))
    .optional()
    .describe('Filter by note types'),
  folders: z.array(z.string()).optional().describe('Filter by folders'),
  space: z.string().optional().describe('Space ID to search in'),
  limit: z.number().min(1).max(200).optional().default(20).describe('Maximum number of results'),
  // Enhanced options
  fuzzy: z
    .boolean()
    .optional()
    .default(false)
    .describe('Enable fuzzy/typo-tolerant matching'),
  caseSensitive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Case-sensitive search (default: case-insensitive)'),
  contextLines: z
    .number()
    .min(0)
    .max(5)
    .optional()
    .default(0)
    .describe('Lines of context around matches'),
  // Date filtering
  modifiedAfter: z
    .string()
    .optional()
    .describe(
      'Filter notes modified after date (ISO date or "today", "yesterday", "this week", "this month")'
    ),
  modifiedBefore: z.string().optional().describe('Filter notes modified before date'),
  createdAfter: z
    .string()
    .optional()
    .describe(
      'Filter notes created after date (ISO date or "today", "yesterday", "this week", "this month")'
    ),
  createdBefore: z.string().optional().describe('Filter notes created before date'),
});

export async function searchNotes(params: z.infer<typeof searchSchema>) {
  const query = typeof params?.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }

  const limit = toBoundedInt(params.limit, 20, 1, 200);
  const includeStageTimings = isDebugTimingsEnabled(
    (params as { debugTimings?: unknown }).debugTimings
  );
  const stageTimings: Record<string, number> = {};

  const searchStart = Date.now();
  const searchExecution = await store.searchNotes(query, {
    types: params.types as NoteType[] | undefined,
    folder: params.folders?.[0], // Currently only supports single folder
    space: params.space,
    limit,
    fuzzy: params.fuzzy,
    caseSensitive: params.caseSensitive,
    contextLines: params.contextLines,
    modifiedAfter: params.modifiedAfter,
    modifiedBefore: params.modifiedBefore,
    createdAfter: params.createdAfter,
    createdBefore: params.createdBefore,
  });
  const results = searchExecution.results;
  const searchStoreMs = Date.now() - searchStart;
  if (includeStageTimings) {
    stageTimings.searchStoreMs = searchStoreMs;
  }

  const mapStart = Date.now();
  const mappedResults = results.map((result) => ({
    note: {
      id: result.note.id, // Important: Use this ID with noteplan_get_note for space notes
      title: result.note.title,
      filename: result.note.filename,
      type: result.note.type,
      source: result.note.source,
      folder: result.note.folder,
      spaceId: result.note.spaceId,
      // Include date metadata in output
      modifiedAt: result.note.modifiedAt?.toISOString(),
      createdAt: result.note.createdAt?.toISOString(),
    },
    score: result.score,
    matchCount: result.matches.length,
    preview: result.matches.slice(0, 3).map((m) => ({
      line: m.lineNumber,
      content: m.lineContent.substring(0, 100) + (m.lineContent.length > 100 ? '...' : ''),
    })),
  }));
  const mapResultMs = Date.now() - mapStart;
  if (includeStageTimings) {
    stageTimings.mapResultMs = mapResultMs;
  }

  const response: Record<string, unknown> = {
    success: true,
    query,
    count: results.length,
    partialResults: searchExecution.partialResults,
    searchBackend: searchExecution.backend,
    warnings: searchExecution.warnings,
    results: mappedResults,
  };

  const performanceHints: string[] = [];
  if (searchStoreMs > 2000) {
    if (!params.space) {
      performanceHints.push('Set space to constrain search to one workspace.');
    }
    if (!params.folders || params.folders.length === 0) {
      performanceHints.push('Set folders to narrow full-text search scope.');
    }
    if (params.fuzzy) {
      performanceHints.push('Disable fuzzy matching when exact search is acceptable.');
    }
    if ((params.contextLines ?? 0) > 0) {
      performanceHints.push('Set contextLines=0 for faster broad searches.');
    }
  }
  if (results.length === limit) {
    performanceHints.push('Increase precision or add filters to reduce ties at the result limit.');
  }
  if (performanceHints.length > 0) {
    response.performanceHints = performanceHints;
  }

  if (includeStageTimings) {
    response.stageTimings = stageTimings;
  }

  return response;
}
