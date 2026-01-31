// Search operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';
import { NoteType } from '../noteplan/types.js';

export const searchSchema = z.object({
  query: z.string().describe('Search query string'),
  types: z.array(z.enum(['calendar', 'note', 'trash'])).optional().describe('Filter by note types'),
  folders: z.array(z.string()).optional().describe('Filter by folders'),
  space: z.string().optional().describe('Space ID to search in'),
  limit: z.number().optional().default(20).describe('Maximum number of results'),
});

export function searchNotes(params: z.infer<typeof searchSchema>) {
  const results = store.searchNotes(params.query, {
    types: params.types as NoteType[] | undefined,
    folder: params.folders?.[0], // Currently only supports single folder
    space: params.space,
    limit: params.limit,
  });

  return {
    success: true,
    query: params.query,
    count: results.length,
    results: results.map((result) => ({
      note: {
        title: result.note.title,
        filename: result.note.filename,
        type: result.note.type,
        source: result.note.source,
        folder: result.note.folder,
        spaceId: result.note.spaceId,
      },
      score: result.score,
      matchCount: result.matches.length,
      preview: result.matches.slice(0, 3).map((m) => ({
        line: m.lineNumber,
        content: m.lineContent.substring(0, 100) + (m.lineContent.length > 100 ? '...' : ''),
      })),
    })),
  };
}
