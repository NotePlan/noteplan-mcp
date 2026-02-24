// Template documentation search — pre-embedded SQLite database of NotePlan templating docs

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { isSqliteAvailable, SqliteDatabase } from './sqlite-loader.js';
import { cosineSimilarity, fetchEmbeddings, ensureEmbeddingsApiConfigured } from './embeddings.js';
import { runAppleScript, escapeAppleScript, getAppName } from '../utils/applescript.js';
import { getNotePlanVersion, MIN_BUILD_EMBED_TEXT } from '../utils/version.js';

// ── Database ──

let cachedDb: SqliteDatabase | null = null;

function getGzSourcePath(): string {
  return new URL('../../docs/templates.db.gz', import.meta.url).pathname;
}

function getCachedDbPath(): string {
  return path.join(os.homedir(), '.noteplan-mcp', 'templates.db');
}

export function openTemplateDocsDb(): SqliteDatabase {
  if (cachedDb) return cachedDb;

  if (!isSqliteAvailable()) {
    throw new Error('sql.js is not initialized — cannot open template docs database');
  }

  const gzPath = getGzSourcePath();
  const dbPath = getCachedDbPath();

  if (!fs.existsSync(gzPath)) {
    throw new Error(`Template docs database not found at ${gzPath}. The bundled docs may be missing from the installation.`);
  }

  // Decompress if cached file is missing or older than source
  let needsDecompress = !fs.existsSync(dbPath);
  if (!needsDecompress) {
    const gzStat = fs.statSync(gzPath);
    const dbStat = fs.statSync(dbPath);
    needsDecompress = gzStat.mtimeMs > dbStat.mtimeMs;
  }

  if (needsDecompress) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const compressed = fs.readFileSync(gzPath);
    const decompressed = zlib.gunzipSync(compressed);
    fs.writeFileSync(dbPath, decompressed);
  }

  cachedDb = new SqliteDatabase(dbPath, { readonly: true });
  return cachedDb;
}

// ── Dequantization ──

export function dequantizeInt8(blob: Buffer, scale: number): number[] {
  const result = new Array<number>(blob.length);
  for (let i = 0; i < blob.length; i++) {
    result[i] = ((blob[i] - 128) / 127) * scale;
  }
  return result;
}

// ── Chunk loading & caching ──

type TemplateDocsChunkRow = {
  id: string;
  note_id: string;
  note_title: string;
  chunk_index: number;
  content: string;
  embedding: Buffer;
  embedding_scale: number;
};

type CachedChunk = {
  row: Omit<TemplateDocsChunkRow, 'embedding' | 'embedding_scale'>;
  vector: number[];
};

let cachedChunks: CachedChunk[] | null = null;

function loadChunksWithVectors(): CachedChunk[] {
  if (cachedChunks) return cachedChunks;

  const db = openTemplateDocsDb();
  const rows = db
    .prepare('SELECT id, note_id, note_title, chunk_index, content, embedding, embedding_scale FROM chunks')
    .all() as TemplateDocsChunkRow[];

  cachedChunks = rows.map((row) => ({
    row: {
      id: row.id,
      note_id: row.note_id,
      note_title: row.note_title,
      chunk_index: row.chunk_index,
      content: row.content,
    },
    vector: dequantizeInt8(
      Buffer.isBuffer(row.embedding) ? row.embedding : Buffer.from(row.embedding as unknown as Uint8Array),
      row.embedding_scale,
    ),
  }));

  return cachedChunks;
}

type TextOnlyChunkRow = Omit<TemplateDocsChunkRow, 'embedding' | 'embedding_scale'>;

let cachedTextChunks: TextOnlyChunkRow[] | null = null;

function loadTextChunks(): TextOnlyChunkRow[] {
  if (cachedTextChunks) return cachedTextChunks;

  const db = openTemplateDocsDb();
  cachedTextChunks = db
    .prepare('SELECT id, note_id, note_title, chunk_index, content FROM chunks')
    .all() as TextOnlyChunkRow[];

  return cachedTextChunks;
}

// ── Shared helpers ──

export type TemplateDocsMatch = {
  score: number;
  noteTitle: string;
  chunkIndex: number;
  preview: string;
  content?: string;
};

function toMatch(
  row: { note_title: string; chunk_index: number; content: string },
  score: number,
  includeContent: boolean,
): TemplateDocsMatch {
  const preview = row.content.length <= 300
    ? row.content
    : `${row.content.slice(0, 297)}...`;

  return {
    score: Number(score.toFixed(4)),
    noteTitle: row.note_title,
    chunkIndex: row.chunk_index,
    preview,
    ...(includeContent ? { content: row.content } : {}),
  };
}

// ── Direct chunk lookup ──

export function getDocChunk(
  noteTitle: string,
  chunkIndex: number,
): { noteTitle: string; chunkIndex: number; content: string; totalChunks: number } | null {
  const rows = loadTextChunks();
  const match = rows.find(
    (r) => r.note_title === noteTitle && r.chunk_index === chunkIndex,
  );
  if (!match) return null;
  const totalChunks = rows.filter((r) => r.note_title === noteTitle).length;
  return {
    noteTitle: match.note_title,
    chunkIndex: match.chunk_index,
    content: match.content,
    totalChunks,
  };
}

// ── Semantic search ──

export function searchTemplateDocs(
  queryVector: number[],
  options?: { limit?: number; includeContent?: boolean },
): TemplateDocsMatch[] {
  const limit = options?.limit ?? 5;
  const includeContent = options?.includeContent === true;
  const chunks = loadChunksWithVectors();

  return chunks
    .map((chunk) => ({
      row: chunk.row,
      score: cosineSimilarity(queryVector, chunk.vector),
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => toMatch(entry.row, entry.score, includeContent));
}

// ── Text search fallback (no embeddings needed) ──

export function textSearchTemplateDocs(
  query: string,
  options?: { limit?: number; includeContent?: boolean },
): TemplateDocsMatch[] {
  const limit = options?.limit ?? 5;
  const includeContent = options?.includeContent === true;
  const rows = loadTextChunks();

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);

  return rows
    .map((row) => {
      const contentLower = row.content.toLowerCase();
      const titleLower = (row.note_title || '').toLowerCase();
      const haystack = `${titleLower} ${contentLower}`;

      let score = 0;
      for (const term of queryTerms) {
        if (haystack.includes(term)) {
          score += 1;
          if (titleLower.includes(term)) score += 0.5;
        }
      }
      if (queryTerms.length > 0) score /= queryTerms.length * 1.5;

      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => toMatch(entry.row, entry.score, includeContent));
}

// ── Embedding via AppleScript ──

export function embedViaAppleScript(text: string): number[] {
  const script = `tell application "${getAppName()}" to embedText for "${escapeAppleScript(text)}"`;
  const raw = runAppleScript(script);
  const parsed = JSON.parse(raw);
  if (parsed.success === true && Array.isArray(parsed.embedding)) {
    return parsed.embedding as number[];
  }
  throw new Error(parsed.error || 'Unexpected embedText response: missing embedding array');
}

// ── Query embedding fallback chain ──

export type EmbedQueryResult =
  | { ok: true; vector: number[]; source: 'applescript' | 'api' }
  | { ok: false; source: 'none' };

export async function tryEmbedQuery(text: string): Promise<EmbedQueryResult> {
  // 1. Try NotePlan AppleScript embedText first (uses the app's built-in key, no user config needed)
  const { build } = getNotePlanVersion();
  if (build >= MIN_BUILD_EMBED_TEXT) {
    try {
      const vector = embedViaAppleScript(text);
      return { ok: true, vector, source: 'applescript' };
    } catch {
      // AppleScript failed — fall through to API
    }
  }

  // 2. Try user's configured embeddings API
  const apiCheck = ensureEmbeddingsApiConfigured();
  if (apiCheck.ok) {
    const vectors = await fetchEmbeddings([text]);
    return { ok: true, vector: vectors[0], source: 'api' };
  }

  // 3. No embedding source available — caller should fall back to text search
  return { ok: false, source: 'none' };
}
