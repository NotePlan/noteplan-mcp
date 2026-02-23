// Search operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';
import { matchesFrontmatterProperties } from '../noteplan/unified-store.js';
import { NoteType } from '../noteplan/types.js';
import { parseFlexibleDateFilter, isDateInRange } from '../utils/date-filters.js';

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

function normalizeFolderFilterInput(folder: string): string {
  let normalized = folder.trim().replace(/\\/g, '/');
  normalized = normalized.replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === 'Notes') {
    return '';
  }
  if (normalized.startsWith('Notes/')) {
    normalized = normalized.slice('Notes/'.length);
  }
  return normalized;
}

function tokenizeSearchTerms(query: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'the',
    'or',
    'for',
    'to',
    'of',
    'in',
    'on',
    'with',
    'at',
    'by',
    'from',
    'is',
    'are',
  ]);

  const tokens = query
    .split(/\s+/)
    .map((token) => token.trim())
    .map((token) => token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9._-]+$/g, ''))
    .filter((token) => token.length > 0);

  const unique = new Set<string>();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (stopWords.has(lower)) continue;
    if (lower.length === 1 && !/^\d$/.test(lower)) continue;
    unique.add(lower);
  }

  return Array.from(unique);
}

function countTokenHitsInText(text: string, tokens: string[]): number {
  const lowerText = text.toLowerCase();
  return tokens.reduce((count, token) => (lowerText.includes(token) ? count + 1 : count), 0);
}

function buildTokenAwareQueryMode(
  query: string,
  searchField: 'content' | 'title' | 'filename' | 'title_or_filename',
  queryMode: 'phrase' | 'smart' | 'any' | 'all',
  requestedMinTokenMatches?: number
): {
  effectiveQuery: string;
  tokens: string[];
  minTokenMatches: number;
  active: boolean;
} {
  if (searchField !== 'content' || queryMode === 'phrase') {
    return {
      effectiveQuery: query,
      tokens: [],
      minTokenMatches: 0,
      active: false,
    };
  }

  const tokens = tokenizeSearchTerms(query);
  if (tokens.length < 2 || query.includes('|')) {
    return {
      effectiveQuery: query,
      tokens,
      minTokenMatches: 0,
      active: false,
    };
  }

  const defaultMinMatches =
    queryMode === 'any'
      ? 1
      : queryMode === 'all'
        ? tokens.length
        : Math.max(2, Math.ceil(tokens.length * 0.6));

  const minTokenMatches = Math.min(
    tokens.length,
    Math.max(1, toBoundedInt(requestedMinTokenMatches, defaultMinMatches, 1, 50))
  );

  return {
    effectiveQuery: tokens.join('|'),
    tokens,
    minTokenMatches,
    active: true,
  };
}

export const searchSchema = z.object({
  query: z.string().describe('Search query. Supports OR patterns like "meeting|standup"'),
  searchField: z
    .enum(['content', 'title', 'filename', 'title_or_filename'])
    .optional()
    .default('content')
    .describe(
      'Search scope: content (full-text), title, filename, or title_or_filename. Use title/title_or_filename for faster note discovery by version/name.'
    ),
  queryMode: z
    .enum(['phrase', 'smart', 'any', 'all'])
    .optional()
    .default('smart')
    .describe(
      'How multi-word content queries are interpreted: phrase (exact phrase), smart (token OR with relevance threshold), any (any token), all (all tokens)'
    ),
  minTokenMatches: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .describe('When queryMode is smart/any/all, minimum token matches required per note (auto by default)'),
  types: z
    .array(z.enum(['calendar', 'note', 'trash']))
    .optional()
    .describe('Filter by note types'),
  folders: z
    .array(z.string())
    .optional()
    .describe(
      'Filter by folders (canonical paths like "20 - Areas"; "Notes/20 - Areas" is accepted). If multiple folders are provided, the first is used for full-text scope.'
    ),
  space: z.string().optional().describe('Space name or ID to search in'),
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
  propertyFilters: z
    .record(z.string())
    .optional()
    .describe(
      'Exact frontmatter property filters (all must match), e.g. {"category":"marketing","status":"Doing"}'
    ),
  propertyCaseSensitive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Case-sensitive frontmatter property matching (default: false)'),
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

  let rawFolders: any = params.folders ?? [];
  if (typeof rawFolders === 'string') {
    try { rawFolders = JSON.parse(rawFolders); } catch { rawFolders = [rawFolders]; }
  }
  const normalizedFolders = (rawFolders as string[])
    .map((folder) => normalizeFolderFilterInput(folder))
    .filter((folder) => folder.length > 0);
  const searchField = (params.searchField ?? 'content') as
    | 'content'
    | 'title'
    | 'filename'
    | 'title_or_filename';
  const queryMode = (params.queryMode ?? 'smart') as 'phrase' | 'smart' | 'any' | 'all';
  const tokenPlan = buildTokenAwareQueryMode(
    query,
    searchField,
    queryMode,
    params.minTokenMatches
  );

  const isWildcardQuery = query === '*';
  if (isWildcardQuery) {
    const allNotes = normalizedFolders.length > 0
      ? normalizedFolders.flatMap((folder) =>
          store.listNotes({
            folder,
            space: params.space,
          })
        )
      : store.listNotes({ space: params.space });

    const uniqueByKey = new Map<string, ReturnType<typeof store.listNotes>[number]>();
    for (const note of allNotes) {
      const key = note.id?.trim().length > 0 ? `id:${note.id}` : `file:${note.filename}`;
      if (!uniqueByKey.has(key)) {
        uniqueByKey.set(key, note);
      }
    }

    let filtered = Array.from(uniqueByKey.values());

    if ((params.types?.length ?? 0) > 0) {
      filtered = filtered.filter((note) =>
        (params.types as Array<'calendar' | 'note' | 'trash'>).includes(note.type)
      );
    }

    // Apply propertyFilters (frontmatter matching)
    if (params.propertyFilters && Object.keys(params.propertyFilters).length > 0) {
      const filterEntries = Object.entries(params.propertyFilters) as ReadonlyArray<readonly [string, string]>;
      const caseSensitive = params.propertyCaseSensitive ?? false;
      filtered = filtered.filter((note) =>
        matchesFrontmatterProperties(note, filterEntries, caseSensitive)
      );
    }

    // Apply date filters
    const modifiedAfter = params.modifiedAfter ? parseFlexibleDateFilter(params.modifiedAfter) : null;
    const modifiedBefore = params.modifiedBefore ? parseFlexibleDateFilter(params.modifiedBefore) : null;
    const createdAfter = params.createdAfter ? parseFlexibleDateFilter(params.createdAfter) : null;
    const createdBefore = params.createdBefore ? parseFlexibleDateFilter(params.createdBefore) : null;
    if (modifiedAfter || modifiedBefore || createdAfter || createdBefore) {
      filtered = filtered.filter((note) => {
        const modifiedOk = isDateInRange(note.modifiedAt, modifiedAfter, modifiedBefore);
        const createdOk = isDateInRange(note.createdAt, createdAfter, createdBefore);
        if ((modifiedAfter || modifiedBefore) && (createdAfter || createdBefore)) {
          return modifiedOk && createdOk;
        }
        if (modifiedAfter || modifiedBefore) return modifiedOk;
        if (createdAfter || createdBefore) return createdOk;
        return true;
      });
    }

    const limit = toBoundedInt(params.limit, 20, 1, 200);
    const page = filtered.slice(0, limit);

    const response: Record<string, unknown> = {
      success: true,
      query,
      searchField,
      queryMode,
      count: page.length,
      propertyFilters: params.propertyFilters,
      propertyCaseSensitive: params.propertyCaseSensitive ?? false,
      partialResults: false,
      searchBackend: 'browse',
      warnings: [
        'Wildcard query "*" runs in browse mode (metadata listing) and does not perform text matching.',
      ],
      results: page.map((note) => ({
        note: {
          id: note.id,
          title: note.title,
          filename: note.filename,
          type: note.type,
          source: note.source,
          folder: note.folder,
          spaceId: note.spaceId,
          modifiedAt: note.modifiedAt?.toISOString(),
          createdAt: note.createdAt?.toISOString(),
        },
        score: 0,
        matchCount: 0,
        preview: [],
      })),
      performanceHints: [
        'Use noteplan_list_folders to discover folder trees and subfolders.',
        'Use a text query instead of "*" to run full-text search.',
      ],
    };

    return response;
  }

  const limit = toBoundedInt(params.limit, 20, 1, 200);
  const includeStageTimings = isDebugTimingsEnabled(
    (params as { debugTimings?: unknown }).debugTimings
  );
  const stageTimings: Record<string, number> = {};

  const searchStart = Date.now();
  const searchExecution = await store.searchNotes(tokenPlan.effectiveQuery, {
    searchField,
    types: params.types as NoteType[] | undefined,
    folder: normalizedFolders[0], // Single-folder scope in search backend
    space: params.space,
    limit,
    fuzzy: params.fuzzy,
    caseSensitive: params.caseSensitive,
    contextLines: params.contextLines,
    propertyFilters: params.propertyFilters,
    propertyCaseSensitive: params.propertyCaseSensitive,
    modifiedAfter: params.modifiedAfter,
    modifiedBefore: params.modifiedBefore,
    createdAfter: params.createdAfter,
    createdBefore: params.createdBefore,
  });
  let results = searchExecution.results;
  let appliedMinTokenMatches = tokenPlan.active ? tokenPlan.minTokenMatches : undefined;
  if (tokenPlan.active) {
    const rankByTokens = (minTokenMatches: number) =>
      results
        .map((result) => {
          const searchable = `${result.note.title}\n${result.note.filename}\n${result.note.content}`;
          const tokenHits = countTokenHitsInText(searchable, tokenPlan.tokens);
          if (tokenHits < minTokenMatches) return null;
          return {
            ...result,
            score: result.score + tokenHits * 20,
            tokenHits,
          };
        })
        .filter(
          (entry): entry is (typeof results)[number] & { tokenHits: number } => entry !== null
        )
        .sort((a, b) => {
          if (b.tokenHits !== a.tokenHits) return b.tokenHits - a.tokenHits;
          return b.score - a.score;
        })
        .slice(0, limit)
        .map(({ tokenHits: _tokenHits, ...result }) => result);

    const ranked = rankByTokens(tokenPlan.minTokenMatches);
    if (ranked.length > 0 || queryMode !== 'smart' || tokenPlan.minTokenMatches <= 1) {
      results = ranked;
    } else {
      // Safety fallback for smart mode: if strict threshold returns zero, relax to one-token match.
      appliedMinTokenMatches = 1;
      results = rankByTokens(1);
    }
  }
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
    searchField,
    queryMode,
    effectiveQuery: tokenPlan.active ? tokenPlan.effectiveQuery : query,
    tokenTerms: tokenPlan.tokens,
    minTokenMatches: appliedMinTokenMatches,
    count: results.length,
    propertyFilters: params.propertyFilters,
    propertyCaseSensitive: params.propertyCaseSensitive ?? false,
    partialResults: searchExecution.partialResults,
    searchBackend: searchExecution.backend,
    warnings: searchExecution.warnings,
    results: mappedResults,
  };
  if ((params.folders?.length ?? 0) > 1) {
    const existingWarnings = Array.isArray(response.warnings)
      ? (response.warnings as string[])
      : [];
    response.warnings = [
      ...existingWarnings,
      'Multiple folders were provided; only the first folder is currently used for full-text search scope.',
    ];
  }

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
  if (tokenPlan.active) {
    performanceHints.push(
      `queryMode=${queryMode} used token-aware matching (${appliedMinTokenMatches}/${tokenPlan.tokens.length} token threshold).`
    );
  }
  if (performanceHints.length > 0) {
    response.performanceHints = performanceHints;
  }

  if (includeStageTimings) {
    response.stageTimings = stageTimings;
  }

  return response;
}
