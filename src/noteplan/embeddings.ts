import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import * as store from './unified-store.js';
import { Note, NoteType } from './types.js';
import { isSqliteAvailable, SqliteDatabase } from './sqlite-loader.js';

export type EmbeddingsProvider = 'openai' | 'mistral' | 'custom';
export type EmbeddingsSource = 'local' | 'space';

export type EmbeddingsConfig = {
  enabled: boolean;
  provider: EmbeddingsProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  dbPath: string;
  chunkChars: number;
  chunkOverlap: number;
  previewChars: number;
  defaultBatchSize: number;
  defaultMaxChunksPerNote: number;
};

type EmbeddingApiData = {
  embedding: number[];
  index: number;
};

type EmbeddingApiResponse = {
  data?: EmbeddingApiData[];
};

type IndexedNoteRow = {
  note_key: string;
  content_hash: string;
};

type EmbeddingChunkRow = {
  note_key: string;
  chunk_index: number;
  chunk_text: string;
  chunk_preview: string;
  embedding_json: string;
  note_id: string;
  filename: string;
  title: string;
  source: string;
  space_id: string | null;
  folder: string | null;
  type: string;
  modified_at: string | null;
};

type EmbeddingsScope = {
  space?: string;
};

export type EmbeddingsSyncParams = {
  space?: string;
  types?: NoteType[];
  noteQuery?: string;
  limit?: number;
  offset?: number;
  forceReembed?: boolean;
  pruneMissing?: boolean;
  batchSize?: number;
  maxChunksPerNote?: number;
};

export type EmbeddingsSearchParams = {
  query: string;
  space?: string;
  source?: EmbeddingsSource;
  types?: NoteType[];
  limit?: number;
  minScore?: number;
  includeText?: boolean;
  previewChars?: number;
  maxChunks?: number;
};

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return defaultValue;
}

function parseBoundedInt(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

let cachedConfig: EmbeddingsConfig | null = null;
let db: SqliteDatabase | null = null;
let dbPathForConnection: string | null = null;

function getDefaultModel(provider: EmbeddingsProvider): string {
  if (provider === 'mistral') return 'mistral-embed';
  return 'text-embedding-3-small';
}

function getDefaultBaseUrl(provider: EmbeddingsProvider): string {
  if (provider === 'mistral') return 'https://api.mistral.ai';
  if (provider === 'custom') return 'http://localhost:11434';
  return 'https://api.openai.com';
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function resolveEmbeddingsDbPath(): string {
  const customPath = process.env.NOTEPLAN_EMBEDDINGS_DB_PATH?.trim();
  if (customPath) {
    return path.resolve(customPath);
  }
  return path.join(os.homedir(), '.noteplan-mcp', 'embeddings.db');
}

export function getEmbeddingsConfig(): EmbeddingsConfig {
  if (cachedConfig) return cachedConfig;

  const enabled = parseBoolean(process.env.NOTEPLAN_EMBEDDINGS_ENABLED, false);

  const providerRaw = (process.env.NOTEPLAN_EMBEDDINGS_PROVIDER || 'openai').trim().toLowerCase();
  const provider: EmbeddingsProvider =
    providerRaw === 'mistral'
      ? 'mistral'
      : providerRaw === 'custom'
        ? 'custom'
        : 'openai';

  const model = (process.env.NOTEPLAN_EMBEDDINGS_MODEL || getDefaultModel(provider)).trim();
  const baseUrl = normalizeBaseUrl(
    process.env.NOTEPLAN_EMBEDDINGS_BASE_URL || getDefaultBaseUrl(provider)
  );

  cachedConfig = {
    enabled,
    provider,
    apiKey: (process.env.NOTEPLAN_EMBEDDINGS_API_KEY || '').trim(),
    model,
    baseUrl,
    dbPath: resolveEmbeddingsDbPath(),
    chunkChars: parseBoundedInt(process.env.NOTEPLAN_EMBEDDINGS_CHUNK_CHARS, 1200, 300, 4000),
    chunkOverlap: parseBoundedInt(process.env.NOTEPLAN_EMBEDDINGS_CHUNK_OVERLAP, 200, 0, 1000),
    previewChars: parseBoundedInt(process.env.NOTEPLAN_EMBEDDINGS_PREVIEW_CHARS, 220, 60, 1000),
    defaultBatchSize: parseBoundedInt(process.env.NOTEPLAN_EMBEDDINGS_BATCH_SIZE, 16, 1, 64),
    defaultMaxChunksPerNote: parseBoundedInt(
      process.env.NOTEPLAN_EMBEDDINGS_MAX_CHUNKS_PER_NOTE,
      60,
      1,
      400
    ),
  };

  return cachedConfig;
}

export function areEmbeddingsEnabled(): boolean {
  return getEmbeddingsConfig().enabled;
}

function buildEmbeddingsEndpoint(baseUrl: string): string {
  if (baseUrl.endsWith('/v1/embeddings')) return baseUrl;
  if (baseUrl.endsWith('/v1')) return `${baseUrl}/embeddings`;
  return `${baseUrl}/v1/embeddings`;
}

function ensureEmbeddingsApiConfigured(): { ok: true } | { ok: false; error: string } {
  const config = getEmbeddingsConfig();
  if (!config.enabled) {
    return {
      ok: false,
      error: 'Embeddings are disabled. Set NOTEPLAN_EMBEDDINGS_ENABLED=true to enable embeddings tools.',
    };
  }

  if ((config.provider === 'openai' || config.provider === 'mistral') && !config.apiKey) {
    return {
      ok: false,
      error:
        'Embeddings API key is missing. Set NOTEPLAN_EMBEDDINGS_API_KEY in your MCP server environment.',
    };
  }

  return { ok: true };
}

function openEmbeddingsDb(): SqliteDatabase {
  const config = getEmbeddingsConfig();
  if (db && dbPathForConnection === config.dbPath) {
    return db;
  }

  if (db) {
    db.close();
    db = null;
    dbPathForConnection = null;
  }

  if (!isSqliteAvailable()) {
    throw new Error('sql.js is not initialized — cannot open embeddings database');
  }

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new SqliteDatabase(config.dbPath);
  dbPathForConnection = config.dbPath;
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      note_key TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      space_id TEXT,
      folder TEXT,
      type TEXT NOT NULL,
      modified_at TEXT,
      content_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_key TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      chunk_preview TEXT NOT NULL,
      chunk_hash TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      dim INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(note_key, chunk_index),
      FOREIGN KEY(note_key) REFERENCES notes(note_key) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_note_key ON chunks(note_key);
    CREATE INDEX IF NOT EXISTS idx_notes_space_id ON notes(space_id);
    CREATE INDEX IF NOT EXISTS idx_notes_source ON notes(source);
    CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(type);
    CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
  `);

  return db;
}

function setMetadata(key: string, value: string): void {
  const database = openEmbeddingsDb();
  database
    .prepare(
      `
      INSERT INTO metadata (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
    )
    .run(key, value);
}

function getMetadata(key: string): string | null {
  const database = openEmbeddingsDb();
  const row = database.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function computeHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function toNoteKey(note: Note): string {
  if (note.source === 'space') {
    const idOrFilename = note.id?.trim().length ? note.id.trim() : note.filename;
    return `space:${idOrFilename}`;
  }
  return `local:${note.filename}`;
}

function buildPreview(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxChars - 1))}…`;
}

function chunkContent(
  content: string,
  chunkChars: number,
  chunkOverlap: number,
  maxChunks: number
): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const effectiveOverlap = Math.min(Math.max(0, chunkOverlap), Math.max(0, chunkChars - 1));
  const step = Math.max(1, chunkChars - effectiveOverlap);
  const chunks: string[] = [];

  let start = 0;
  while (start < normalized.length && chunks.length < maxChunks) {
    let end = Math.min(normalized.length, start + chunkChars);
    if (end < normalized.length) {
      const breakAt = normalized.lastIndexOf('\n', end);
      if (breakAt > start + Math.floor(chunkChars * 0.6)) {
        end = breakAt;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - effectiveOverlap);
  }

  return chunks;
}

async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const config = getEmbeddingsConfig();
  const endpoint = buildEmbeddingsEndpoint(config.baseUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const excerpt = body.slice(0, 320);
    throw new Error(`Embeddings request failed (${response.status}): ${excerpt}`);
  }

  const json = (await response.json()) as EmbeddingApiResponse;
  const rows = Array.isArray(json.data) ? json.data : [];
  if (rows.length !== texts.length) {
    throw new Error(
      `Embeddings response mismatch: expected ${texts.length} vectors, got ${rows.length}`
    );
  }

  const sorted = rows
    .slice()
    .sort((a, b) => (Number.isFinite(a.index) ? a.index : 0) - (Number.isFinite(b.index) ? b.index : 0));
  return sorted.map((item) => item.embedding);
}

async function embedInBatches(texts: string[], batchSize: number): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchVectors = await fetchEmbeddings(batch);
    vectors.push(...batchVectors);
  }
  return vectors;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function filterNotesByQuery(notes: Note[], noteQuery?: string): Note[] {
  const query = (noteQuery || '').trim().toLowerCase();
  if (!query) return notes;
  return notes.filter((note) => {
    const haystack = `${note.title} ${note.filename} ${note.folder || ''}`.toLowerCase();
    return haystack.includes(query);
  });
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value as number)));
}

function getScopeWhere(scope: EmbeddingsScope): { whereSql: string; params: unknown[] } {
  if (scope.space && scope.space.trim().length > 0) {
    return {
      whereSql: 'WHERE space_id = ?',
      params: [scope.space.trim()],
    };
  }
  return {
    whereSql: '',
    params: [],
  };
}

export function getEmbeddingsStatus(scope: EmbeddingsScope = {}) {
  const config = getEmbeddingsConfig();
  const apiCheck = ensureEmbeddingsApiConfigured();

  if (!config.enabled) {
    return {
      success: true,
      enabled: false,
      configured: false,
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      dbPath: config.dbPath,
      noteCount: 0,
      chunkCount: 0,
      lastSyncAt: null,
      warning:
        'Embeddings are disabled. Set NOTEPLAN_EMBEDDINGS_ENABLED=true to enable embeddings tools.',
    };
  }

  const database = openEmbeddingsDb();
  const scopeWhere = getScopeWhere(scope);

  const noteCountRow = database
    .prepare(`SELECT COUNT(*) as count FROM notes ${scopeWhere.whereSql}`)
    .get(...scopeWhere.params) as { count: number };

  const chunkCountRow = database
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM chunks c
      JOIN notes n ON n.note_key = c.note_key
      ${scopeWhere.whereSql ? scopeWhere.whereSql.replace(/space_id/g, 'n.space_id') : ''}
    `
    )
    .get(...scopeWhere.params) as { count: number };

  const lastUpdatedRow = database
    .prepare(`SELECT MAX(updated_at) as lastUpdatedAt FROM notes ${scopeWhere.whereSql}`)
    .get(...scopeWhere.params) as { lastUpdatedAt: string | null };

  return {
    success: true,
    enabled: true,
    configured: apiCheck.ok,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    dbPath: config.dbPath,
    hasApiKey: config.apiKey.length > 0,
    chunkChars: config.chunkChars,
    chunkOverlap: config.chunkOverlap,
    previewChars: config.previewChars,
    noteCount: noteCountRow.count,
    chunkCount: chunkCountRow.count,
    lastSyncAt: getMetadata('lastSyncAt'),
    lastIndexedUpdateAt: lastUpdatedRow.lastUpdatedAt,
    ...(apiCheck.ok
      ? {}
      : {
          warning: apiCheck.error,
        }),
  };
}

export function previewResetEmbeddings(scope: EmbeddingsScope = {}): {
  noteCount: number;
  chunkCount: number;
} {
  const database = openEmbeddingsDb();
  const scopeWhere = getScopeWhere(scope);

  const noteCountRow = database
    .prepare(`SELECT COUNT(*) as count FROM notes ${scopeWhere.whereSql}`)
    .get(...scopeWhere.params) as { count: number };

  const chunkCountRow = database
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM chunks c
      JOIN notes n ON n.note_key = c.note_key
      ${scopeWhere.whereSql ? scopeWhere.whereSql.replace(/space_id/g, 'n.space_id') : ''}
    `
    )
    .get(...scopeWhere.params) as { count: number };

  return {
    noteCount: noteCountRow.count,
    chunkCount: chunkCountRow.count,
  };
}

export function resetEmbeddings(scope: EmbeddingsScope = {}): {
  removedNotes: number;
  removedChunks: number;
} {
  const database = openEmbeddingsDb();
  const preview = previewResetEmbeddings(scope);
  const scopeWhere = getScopeWhere(scope);

  const tx = database.transaction(() => {
    if (!scopeWhere.whereSql) {
      database.prepare('DELETE FROM chunks').run();
      database.prepare('DELETE FROM notes').run();
    } else {
      database
        .prepare(
          `
          DELETE FROM chunks
          WHERE note_key IN (
            SELECT note_key FROM notes ${scopeWhere.whereSql}
          )
        `
        )
        .run(...scopeWhere.params);
      database.prepare(`DELETE FROM notes ${scopeWhere.whereSql}`).run(...scopeWhere.params);
    }
  });
  tx();

  if (!scope.space) {
    setMetadata('lastSyncAt', '');
  }

  return {
    removedNotes: preview.noteCount,
    removedChunks: preview.chunkCount,
  };
}

export async function syncEmbeddings(params: EmbeddingsSyncParams = {}) {
  const apiCheck = ensureEmbeddingsApiConfigured();
  if (!apiCheck.ok) {
    return {
      success: false,
      error: apiCheck.error,
    };
  }

  const config = getEmbeddingsConfig();
  const database = openEmbeddingsDb();

  const requestedLimit = clampNumber(params.limit, 500, 1, 5000);
  const requestedOffset = clampNumber(params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const batchSize = clampNumber(params.batchSize, config.defaultBatchSize, 1, 64);
  const maxChunksPerNote = clampNumber(
    params.maxChunksPerNote,
    config.defaultMaxChunksPerNote,
    1,
    400
  );

  const typeFilter = params.types && params.types.length > 0 ? new Set(params.types) : null;

  const allNotes = store.listNotes({
    space: params.space,
  });

  const filteredByType = typeFilter
    ? allNotes.filter((note) => typeFilter.has(note.type))
    : allNotes.filter((note) => note.type !== 'trash');

  const queryFiltered = filterNotesByQuery(filteredByType, params.noteQuery);
  const pagedNotes = queryFiltered.slice(requestedOffset, requestedOffset + requestedLimit);

  const existingRows = database.prepare('SELECT note_key, content_hash FROM notes').all() as IndexedNoteRow[];
  const existingByKey = new Map(existingRows.map((row) => [row.note_key, row.content_hash]));

  let indexedNotes = 0;
  let unchangedNotes = 0;
  let addedNotes = 0;
  let updatedNotes = 0;
  let indexedChunks = 0;
  const warnings: string[] = [];

  const upsertNote = database.prepare(`
    INSERT INTO notes (
      note_key, note_id, filename, title, source, space_id, folder, type,
      modified_at, content_hash, chunk_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(note_key) DO UPDATE SET
      note_id = excluded.note_id,
      filename = excluded.filename,
      title = excluded.title,
      source = excluded.source,
      space_id = excluded.space_id,
      folder = excluded.folder,
      type = excluded.type,
      modified_at = excluded.modified_at,
      content_hash = excluded.content_hash,
      chunk_count = excluded.chunk_count,
      updated_at = excluded.updated_at
  `);

  const deleteChunksByNoteKey = database.prepare('DELETE FROM chunks WHERE note_key = ?');

  const insertChunk = database.prepare(`
    INSERT INTO chunks (
      note_key, chunk_index, chunk_text, chunk_preview, chunk_hash, embedding_json, dim, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const writeNoteTransaction = database.transaction((payload: {
    note: Note;
    noteKey: string;
    contentHash: string;
    chunks: string[];
    embeddings: number[][];
  }) => {
    deleteChunksByNoteKey.run(payload.noteKey);

    const timestamp = nowIso();
    upsertNote.run(
      payload.noteKey,
      payload.note.id,
      payload.note.filename,
      payload.note.title,
      payload.note.source,
      payload.note.spaceId ?? null,
      payload.note.folder ?? null,
      payload.note.type,
      payload.note.modifiedAt ? payload.note.modifiedAt.toISOString() : null,
      payload.contentHash,
      payload.chunks.length,
      timestamp
    );

    for (let i = 0; i < payload.chunks.length; i += 1) {
      const chunkText = payload.chunks[i];
      const vector = payload.embeddings[i] || [];
      insertChunk.run(
        payload.noteKey,
        i,
        chunkText,
        buildPreview(chunkText, config.previewChars),
        computeHash(chunkText),
        JSON.stringify(vector),
        vector.length,
        timestamp
      );
    }
  });

  for (const note of pagedNotes) {
    const noteKey = toNoteKey(note);
    const contentHash = computeHash(note.content);
    const existingHash = existingByKey.get(noteKey);

    if (!params.forceReembed && existingHash === contentHash) {
      unchangedNotes += 1;
      continue;
    }

    const chunks = chunkContent(
      note.content,
      config.chunkChars,
      config.chunkOverlap,
      maxChunksPerNote
    );

    if (chunks.length === 0) {
      writeNoteTransaction({
        note,
        noteKey,
        contentHash,
        chunks: [],
        embeddings: [],
      });
    } else {
      const vectors = await embedInBatches(chunks, batchSize);
      if (vectors.length !== chunks.length) {
        throw new Error(
          `Embedding mismatch for ${note.filename}: ${chunks.length} chunks but ${vectors.length} vectors`
        );
      }

      writeNoteTransaction({
        note,
        noteKey,
        contentHash,
        chunks,
        embeddings: vectors,
      });
      indexedChunks += chunks.length;
    }

    indexedNotes += 1;
    if (existingHash) {
      updatedNotes += 1;
    } else {
      addedNotes += 1;
    }
  }

  let prunedNotes = 0;
  let prunedChunks = 0;

  const canPruneAllScope =
    params.pruneMissing === true &&
    requestedOffset === 0 &&
    pagedNotes.length === queryFiltered.length &&
    !typeFilter &&
    !(params.noteQuery && params.noteQuery.trim().length > 0);

  if (params.pruneMissing === true && !canPruneAllScope) {
    warnings.push(
      'pruneMissing=true was ignored because prune is only safe for full-scope sync (offset=0, full result set, no type/query filters).'
    );
  }

  if (canPruneAllScope) {
    const validKeys = new Set(pagedNotes.map((note) => toNoteKey(note)));
    const scopeWhere = getScopeWhere({ space: params.space });

    const scopedRows = database
      .prepare(`SELECT note_key FROM notes ${scopeWhere.whereSql}`)
      .all(...scopeWhere.params) as { note_key: string }[];

    const staleKeys = scopedRows
      .map((row) => row.note_key)
      .filter((noteKey) => !validKeys.has(noteKey));

    if (staleKeys.length > 0) {
      const deleteStale = database.transaction((keys: string[]) => {
        const selectChunkCount = database.prepare('SELECT COUNT(*) as count FROM chunks WHERE note_key = ?');
        const deleteChunks = database.prepare('DELETE FROM chunks WHERE note_key = ?');
        const deleteNote = database.prepare('DELETE FROM notes WHERE note_key = ?');

        for (const noteKey of keys) {
          const chunkRow = selectChunkCount.get(noteKey) as { count: number };
          prunedChunks += chunkRow.count;
          prunedNotes += 1;
          deleteChunks.run(noteKey);
          deleteNote.run(noteKey);
        }
      });

      deleteStale(staleKeys);
    }
  }

  setMetadata('lastSyncAt', nowIso());
  setMetadata('lastSyncProvider', config.provider);
  setMetadata('lastSyncModel', config.model);

  return {
    success: true,
    provider: config.provider,
    model: config.model,
    scope: params.space ? { space: params.space } : { scope: 'all' },
    totalCandidates: queryFiltered.length,
    scannedNotes: pagedNotes.length,
    indexedNotes,
    unchangedNotes,
    addedNotes,
    updatedNotes,
    indexedChunks,
    prunedNotes,
    prunedChunks,
    offset: requestedOffset,
    limit: requestedLimit,
    hasMore: requestedOffset + pagedNotes.length < queryFiltered.length,
    nextCursor:
      requestedOffset + pagedNotes.length < queryFiltered.length
        ? String(requestedOffset + pagedNotes.length)
        : null,
    warnings,
  };
}

export async function searchEmbeddings(params: EmbeddingsSearchParams) {
  const apiCheck = ensureEmbeddingsApiConfigured();
  if (!apiCheck.ok) {
    return {
      success: false,
      error: apiCheck.error,
    };
  }

  const config = getEmbeddingsConfig();
  const database = openEmbeddingsDb();

  const query = params.query.trim();
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }

  const includeText = params.includeText === true;
  const previewChars = clampNumber(params.previewChars, config.previewChars, 60, 1000);
  const limit = clampNumber(params.limit, 10, 1, 100);
  const minScore = Math.min(1, Math.max(0, Number(params.minScore ?? 0.2)));
  const maxChunks = clampNumber(params.maxChunks, 8000, 1, 50000);

  const queryVector = (await fetchEmbeddings([query]))[0];

  const whereParts: string[] = [];
  const whereParams: unknown[] = [];

  if (params.space && params.space.trim().length > 0) {
    whereParts.push('n.space_id = ?');
    whereParams.push(params.space.trim());
  }

  if (params.source) {
    whereParts.push('n.source = ?');
    whereParams.push(params.source);
  }

  if (params.types && params.types.length > 0) {
    const placeholders = params.types.map(() => '?').join(',');
    whereParts.push(`n.type IN (${placeholders})`);
    whereParams.push(...params.types);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const rows = database
    .prepare(
      `
      SELECT
        c.note_key,
        c.chunk_index,
        c.chunk_text,
        c.chunk_preview,
        c.embedding_json,
        n.note_id,
        n.filename,
        n.title,
        n.source,
        n.space_id,
        n.folder,
        n.type,
        n.modified_at
      FROM chunks c
      JOIN notes n ON n.note_key = c.note_key
      ${whereSql}
      ORDER BY n.updated_at DESC, c.note_key ASC, c.chunk_index ASC
      LIMIT ?
    `
    )
    .all(...whereParams, maxChunks) as EmbeddingChunkRow[];

  const scored = rows
    .map((row) => {
      let chunkVector: number[];
      try {
        chunkVector = JSON.parse(row.embedding_json) as number[];
      } catch {
        chunkVector = [];
      }

      const score = cosineSimilarity(queryVector, chunkVector);
      return { row, score };
    })
    .filter((entry) => Number.isFinite(entry.score) && entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    success: true,
    query,
    provider: config.provider,
    model: config.model,
    includeText,
    minScore,
    scannedChunks: rows.length,
    count: scored.length,
    matches: scored.map((entry) => ({
      score: Number(entry.score.toFixed(4)),
      note: {
        id: entry.row.note_id,
        filename: entry.row.filename,
        title: entry.row.title,
        source: entry.row.source,
        spaceId: entry.row.space_id,
        folder: entry.row.folder,
        type: entry.row.type,
        modifiedAt: entry.row.modified_at,
      },
      chunk: {
        index: entry.row.chunk_index,
        preview: buildPreview(entry.row.chunk_preview, previewChars),
        ...(includeText ? { text: entry.row.chunk_text } : {}),
      },
    })),
  };
}
