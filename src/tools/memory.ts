import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { z } from 'zod';

interface Memory {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface MemoryStore {
  version: number;
  memories: Memory[];
}

const MEMORY_DIR = path.join(os.homedir(), '.noteplan-mcp');
const MEMORY_FILE_PATH = path.join(MEMORY_DIR, 'memories.json');

function generateId(): string {
  return `m_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

function readStore(): MemoryStore {
  try {
    const data = fs.readFileSync(MEMORY_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.memories)) {
      return parsed as MemoryStore;
    }
    return { version: 1, memories: [] };
  } catch {
    return { version: 1, memories: [] };
  }
}

let cachedCount: number | null = null;

function writeStore(store: MemoryStore): void {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  cachedCount = store.memories.length;
}

export function getMemoryCount(): number {
  if (cachedCount !== null) return cachedCount;
  cachedCount = readStore().memories.length;
  return cachedCount;
}

// --- Schemas ---

const saveMemorySchema = z.object({
  content: z.string().min(1).max(2000).describe('The memory content to save (1-2000 characters)'),
  tags: z
    .array(z.string())
    .max(10)
    .optional()
    .describe('Optional tags for categorizing the memory (max 10)'),
});

const listMemoriesSchema = z.object({
  tag: z.string().optional().describe('Filter by exact tag (case-insensitive)'),
  query: z.string().optional().describe('Search content by substring (case-insensitive)'),
  limit: z.number().min(1).max(200).optional().default(50).describe('Maximum memories to return (default: 50)'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset (default: 0)'),
});

const updateMemorySchema = z.object({
  id: z.string().describe('The memory ID to update'),
  content: z.string().min(1).max(2000).optional().describe('New content for the memory'),
  tags: z.array(z.string()).max(10).optional().describe('New tags for the memory'),
});

const deleteMemorySchema = z.object({
  id: z.string().describe('The memory ID to delete'),
});

// --- CRUD functions ---

export function saveMemory(args: unknown): Record<string, unknown> {
  const parsed = saveMemorySchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { content, tags: rawTags } = parsed.data;
  const tags = (rawTags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const now = new Date().toISOString();
  const memory: Memory = {
    id: generateId(),
    content,
    tags,
    createdAt: now,
    updatedAt: now,
  };

  const store = readStore();
  store.memories.push(memory);
  writeStore(store);

  return {
    success: true,
    message: `Memory saved with ID ${memory.id}`,
    memory,
    totalMemories: store.memories.length,
  };
}

export function listMemories(args: unknown): Record<string, unknown> {
  const parsed = listMemoriesSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { tag, query, limit, offset } = parsed.data;
  const store = readStore();
  let filtered = store.memories;

  if (tag) {
    const lowerTag = tag.toLowerCase();
    filtered = filtered.filter((m) => m.tags.some((t) => t.toLowerCase() === lowerTag));
  }

  if (query) {
    const lowerQuery = query.toLowerCase();
    filtered = filtered.filter((m) => m.content.toLowerCase().includes(lowerQuery));
  }

  const totalCount = filtered.length;
  const paged = filtered.slice(offset, offset + limit);

  return {
    success: true,
    count: paged.length,
    totalCount,
    offset,
    limit,
    hasMore: offset + limit < totalCount,
    memories: paged,
  };
}

export function updateMemory(args: unknown): Record<string, unknown> {
  const parsed = updateMemorySchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { id, content, tags: rawTags } = parsed.data;
  if (content === undefined && rawTags === undefined) {
    return { success: false, error: 'At least one of content or tags must be provided' };
  }

  const store = readStore();
  const memory = store.memories.find((m) => m.id === id);
  if (!memory) {
    return { success: false, error: `Memory not found: ${id}` };
  }

  if (content !== undefined) {
    memory.content = content;
  }
  if (rawTags !== undefined) {
    memory.tags = rawTags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  }
  memory.updatedAt = new Date().toISOString();
  writeStore(store);

  return {
    success: true,
    message: `Memory ${id} updated`,
    memory,
  };
}

export function deleteMemory(args: unknown): Record<string, unknown> {
  const parsed = deleteMemorySchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { id } = parsed.data;
  const store = readStore();
  const index = store.memories.findIndex((m) => m.id === id);
  if (index === -1) {
    return { success: false, error: `Memory not found: ${id}` };
  }

  store.memories.splice(index, 1);
  writeStore(store);

  return {
    success: true,
    message: `Memory ${id} deleted`,
    deletedId: id,
    remainingCount: store.memories.length,
  };
}
