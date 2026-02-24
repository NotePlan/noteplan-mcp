// Template listing and rendering operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';
import { runAppleScript, escapeAppleScript, getAppName } from '../utils/applescript.js';
import { getNotePlanVersion, MIN_BUILD_RENDER_TEMPLATE } from '../utils/version.js';
import { tryEmbedQuery, searchTemplateDocs, textSearchTemplateDocs, getDocChunk } from '../noteplan/template-docs.js';

export const templatesSchema = z.object({
  action: z.enum(['list', 'render', 'search_docs', 'get_doc']).describe('Action to perform'),
  templateTitle: z.string().optional().describe('Template title — used by render (loads a saved template by title)'),
  content: z.string().optional().describe('Raw template content string — used by render (renders arbitrary template code for debugging)'),
  folder: z.string().optional().describe('Template subfolder — used by list (default: @Templates)'),
  limit: z.number().min(1).max(200).optional().default(50).describe('Maximum results — used by list'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset — used by list'),
  cursor: z.string().optional().describe('Cursor from previous page — used by list'),
  query: z.string().optional().describe('Search query — used by search_docs'),
  includeContent: z.boolean().optional().describe('Include full chunk text in results — used by search_docs'),
  noteTitle: z.string().optional().describe('Doc note title — used by get_doc (from search_docs results)'),
  chunkIndex: z.number().optional().describe('Chunk index — used by get_doc (from search_docs results, default 0)'),
});

// ── Frontmatter helpers ──

function extractFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const props: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      props[kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }
  return props;
}

function contentPreview(content: string, maxChars = 200): string {
  // Strip frontmatter for preview
  const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  if (stripped.length <= maxChars) return stripped;
  return `${stripped.slice(0, Math.max(0, maxChars - 3))}...`;
}

// ── Generate default template frontmatter ──

const VALID_TEMPLATE_TYPES = new Set(['empty-note', 'meeting-note', 'project-note', 'calendar-note']);

export function generateTemplateFrontmatter(
  title: string,
  templateTypes?: string[],
): string {
  const type = templateTypes?.find((t) => VALID_TEMPLATE_TYPES.has(t)) ?? 'empty-note';
  return `---\ntitle: ${title}\ntype: ${type}\n---`;
}

export function ensureTemplateFrontmatter(
  title: string,
  content: string | undefined,
  templateTypes?: string[],
): string {
  if (!content || content.trim().length === 0) {
    return `${generateTemplateFrontmatter(title, templateTypes)}\n# ${title}\n`;
  }

  // Check if content already has frontmatter
  if (/^---\r?\n/.test(content)) {
    return content;
  }

  // Prepend frontmatter to existing content
  return `${generateTemplateFrontmatter(title, templateTypes)}\n${content}`;
}

// ── List templates ──

export function listTemplates(params: z.infer<typeof templatesSchema>) {
  const folder = params.folder || '@Templates';
  const notes = store.listNotes({ folder });

  const offset = params.cursor ? parseInt(params.cursor, 10) || 0 : (params.offset ?? 0);
  const limit = params.limit ?? 50;
  const page = notes.slice(offset, offset + limit);
  const hasMore = offset + page.length < notes.length;
  const nextCursor = hasMore ? String(offset + page.length) : null;

  return {
    success: true,
    tip: 'Before writing or editing templates, use action "search_docs" with a query to search the built-in documentation for syntax, helpers, DataStore API, and examples.',
    count: page.length,
    totalCount: notes.length,
    offset,
    limit,
    hasMore,
    nextCursor,
    templates: page.map((note) => {
      const fm = extractFrontmatter(note.content);
      return {
        title: fm.title || note.title,
        filename: note.filename,
        folder: note.folder,
        type: fm.type || null,
        frontmatter: fm,
        preview: contentPreview(note.content),
        modifiedAt: note.modifiedAt?.toISOString(),
      };
    }),
  };
}

// ── Render template ──

export function renderTemplate(params: z.infer<typeof templatesSchema>) {
  const { build } = getNotePlanVersion();
  if (build < MIN_BUILD_RENDER_TEMPLATE) {
    return {
      success: false,
      error: `Template rendering requires NotePlan build ${MIN_BUILD_RENDER_TEMPLATE}+. Current build: ${build}. Please update NotePlan.`,
      code: 'ERR_VERSION_GATE',
    };
  }

  const templateTitle = params.templateTitle;
  const content = params.content;

  if (!templateTitle && !content) {
    return {
      success: false,
      error: 'Provide either templateTitle (render saved template) or content (render raw template string)',
    };
  }

  try {
    let script: string;
    if (content) {
      script = `tell application "${getAppName()}" to renderTemplate with content "${escapeAppleScript(content)}"`;
    } else {
      script = `tell application "${getAppName()}" to renderTemplate with title "${escapeAppleScript(templateTitle!)}"`;
    }

    const raw = runAppleScript(script);

    // Try to parse JSON response from the Swift command
    try {
      const parsed = JSON.parse(raw);
      if (parsed.success === true) {
        return {
          success: true,
          tip: 'Use action "search_docs" with a query to search the built-in documentation for template syntax, helpers, DataStore API, and examples.',
          renderedContent: parsed.rendered ?? raw,
          source: content ? 'raw_content' : 'saved_template',
          templateTitle: templateTitle || undefined,
        };
      }
      return {
        success: false,
        error: parsed.error || 'Template rendering failed',
      };
    } catch {
      // If not valid JSON, treat raw output as rendered content
      return {
        success: true,
        renderedContent: raw,
        source: content ? 'raw_content' : 'saved_template',
        templateTitle: templateTitle || undefined,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Template rendering failed',
    };
  }
}

// ── Get full doc chunk ──

export function getDoc(params: z.infer<typeof templatesSchema>) {
  const noteTitle = params.noteTitle?.trim();
  if (!noteTitle) {
    return { success: false, error: 'noteTitle is required for get_doc' };
  }
  const chunkIndex = params.chunkIndex ?? 0;

  const chunk = getDocChunk(noteTitle, chunkIndex);
  if (!chunk) {
    return {
      success: false,
      error: `No doc chunk found for noteTitle="${noteTitle}" chunkIndex=${chunkIndex}`,
    };
  }

  return {
    success: true,
    noteTitle: chunk.noteTitle,
    chunkIndex: chunk.chunkIndex,
    totalChunks: chunk.totalChunks,
    content: chunk.content,
  };
}

// ── Search template docs ──

export async function searchDocs(params: z.infer<typeof templatesSchema>) {
  const query = params.query?.trim();
  if (!query) {
    return {
      success: false,
      error: 'query is required for search_docs',
    };
  }

  const searchOptions = {
    limit: params.limit ?? 5,
    includeContent: params.includeContent,
  };

  try {
    const embedResult = await tryEmbedQuery(query);

    if (embedResult.ok) {
      // Semantic search using embeddings
      const matches = searchTemplateDocs(embedResult.vector, searchOptions);
      return {
        success: true,
        query,
        count: matches.length,
        embeddingSource: embedResult.source,
        matches,
      };
    }

    // No embedding source available — fall back to text search
    const matches = textSearchTemplateDocs(query, searchOptions);
    return {
      success: true,
      query,
      count: matches.length,
      embeddingSource: 'text' as const,
      matches,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Template doc search failed',
    };
  }
}
