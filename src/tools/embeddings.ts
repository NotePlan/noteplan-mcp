import { z } from 'zod';
import {
  areEmbeddingsEnabled,
  getEmbeddingsStatus,
  previewResetEmbeddings,
  resetEmbeddings,
  searchEmbeddings,
  syncEmbeddings,
} from '../noteplan/embeddings.js';
import {
  issueConfirmationToken,
  validateAndConsumeConfirmationToken,
} from '../utils/confirmation-tokens.js';

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

const noteTypeSchema = z.enum(['calendar', 'note', 'trash']);

export const embeddingsStatusSchema = z.object({
  space: z.string().optional().describe('Optional TeamSpace ID scope for status counts'),
});

export const embeddingsSyncSchema = z.object({
  space: z.string().optional().describe('Optional TeamSpace ID scope'),
  types: z
    .array(noteTypeSchema)
    .optional()
    .describe('Optional note type filter for sync scope'),
  noteQuery: z
    .string()
    .optional()
    .describe('Optional title/filename/folder substring filter for sync scope'),
  limit: z
    .number()
    .min(1)
    .max(5000)
    .optional()
    .default(500)
    .describe('Maximum notes to scan per sync run'),
  offset: z
    .number()
    .min(0)
    .optional()
    .default(0)
    .describe('Pagination offset in note candidate set'),
  forceReembed: z
    .boolean()
    .optional()
    .default(false)
    .describe('Recompute embeddings even if note content hash has not changed'),
  pruneMissing: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, remove index rows for notes missing from the scoped dataset. Only applied for full-scope sync runs.'
    ),
  batchSize: z
    .number()
    .min(1)
    .max(64)
    .optional()
    .describe('Embedding API batch size (default from config)'),
  maxChunksPerNote: z
    .number()
    .min(1)
    .max(400)
    .optional()
    .describe('Maximum chunks indexed per note'),
});

export const embeddingsSearchSchema = z.object({
  query: z.string().describe('Semantic search query text'),
  space: z.string().optional().describe('Optional TeamSpace ID scope'),
  source: z
    .enum(['local', 'space'])
    .optional()
    .describe('Optional source filter'),
  types: z
    .array(noteTypeSchema)
    .optional()
    .describe('Optional note type filter'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .describe('Maximum matches to return'),
  minScore: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.2)
    .describe('Minimum cosine similarity threshold (0-1)'),
  includeText: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include full chunk text in response. Default false returns preview-only payload.'),
  previewChars: z
    .number()
    .min(60)
    .max(1000)
    .optional()
    .describe('Preview length per result when includeText=false'),
  maxChunks: z
    .number()
    .min(1)
    .max(50000)
    .optional()
    .default(8000)
    .describe('Maximum indexed chunks to scan before ranking'),
});

export const embeddingsResetSchema = z.object({
  space: z.string().optional().describe('Optional TeamSpace ID scope for reset'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview reset impact and get confirmationToken without deleting index data'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for reset execution'),
});

export function areEmbeddingsToolsEnabled(): boolean {
  return areEmbeddingsEnabled();
}

export function embeddingsStatus(params?: z.infer<typeof embeddingsStatusSchema>) {
  const parsed = embeddingsStatusSchema.safeParse(params ?? {});
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid arguments',
    };
  }

  return getEmbeddingsStatus({
    space: parsed.data.space,
  });
}

export async function embeddingsSync(params?: z.infer<typeof embeddingsSyncSchema>) {
  const parsed = embeddingsSyncSchema.safeParse(params ?? {});
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid arguments',
    };
  }

  return syncEmbeddings(parsed.data);
}

export async function embeddingsSearch(params?: z.infer<typeof embeddingsSearchSchema>) {
  const parsed = embeddingsSearchSchema.safeParse(params ?? {});
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid arguments',
    };
  }

  const query = parsed.data.query.trim();
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }

  return searchEmbeddings({
    ...parsed.data,
    query,
  });
}

export function embeddingsReset(params?: z.infer<typeof embeddingsResetSchema>) {
  const parsed = embeddingsResetSchema.safeParse(params ?? {});
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid arguments',
    };
  }

  if (!areEmbeddingsEnabled()) {
    return {
      success: false,
      error:
        'Embeddings are disabled. Set NOTEPLAN_EMBEDDINGS_ENABLED=true to enable embeddings tools.',
    };
  }

  const toolName = 'noteplan_embeddings_reset';
  const scopeKey = parsed.data.space?.trim().length
    ? `space:${parsed.data.space?.trim()}`
    : 'scope:all';

  const preview = previewResetEmbeddings({
    space: parsed.data.space,
  });

  if (parsed.data.dryRun === true) {
    const token = issueConfirmationToken({
      tool: toolName,
      target: scopeKey,
      action: 'reset embeddings index',
    });

    return {
      success: true,
      dryRun: true,
      message: `Dry run: this would remove ${preview.noteCount} indexed notes and ${preview.chunkCount} indexed chunks. Re-run with confirmationToken to execute.`,
      ...token,
      noteCount: preview.noteCount,
      chunkCount: preview.chunkCount,
      scope: parsed.data.space ? { space: parsed.data.space } : { scope: 'all' },
    };
  }

  const validation = validateAndConsumeConfirmationToken(parsed.data.confirmationToken, {
    tool: toolName,
    target: scopeKey,
    action: 'reset embeddings index',
  });

  if (!validation.ok) {
    return {
      success: false,
      error: confirmationFailureMessage(toolName, validation.reason),
    };
  }

  const removed = resetEmbeddings({
    space: parsed.data.space,
  });

  return {
    success: true,
    message: `Embeddings index reset complete. Removed ${removed.removedNotes} notes and ${removed.removedChunks} chunks.`,
    removedNotes: removed.removedNotes,
    removedChunks: removed.removedChunks,
    scope: parsed.data.space ? { space: parsed.data.space } : { scope: 'all' },
  };
}
