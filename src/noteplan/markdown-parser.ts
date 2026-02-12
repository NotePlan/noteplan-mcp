// NotePlan Markdown Parser

import { Task, TaskStatus, TASK_STATUS_MAP, STATUS_TO_MARKER, ParagraphType, ParagraphMetadata } from './types.js';
import { getTaskPrefix, getTaskMarkerConfigCached } from './preferences.js';

/**
 * Parse a note's content to extract tasks
 */
export function parseTasks(content: string): Task[] {
  const lines = content.split('\n');
  const tasks: Task[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const task = parseTaskLine(line, i);
    if (task) {
      tasks.push(task);
    }
  }

  return tasks;
}

/**
 * Parse a single line to extract task information
 * Handles both checkbox style (e.g., * [ ] task) and plain marker style (e.g., * task)
 */
export function parseTaskLine(line: string, lineIndex: number): Task | null {
  const config = getTaskMarkerConfigCached();

  // First try checkbox-style tasks: * [ ], * [x], * [-], * [>], - [ ], + [ ]
  const checkboxMatch = line.match(/^(\s*)([*+\-])\s*\[(.)\]\s*(.*)$/);
  if (checkboxMatch) {
    const [, indent, marker, statusChar, content] = checkboxMatch;
    const status = TASK_STATUS_MAP[`[${statusChar}]`];
    if (!status) return null;

    return {
      lineIndex,
      content: content.trim(),
      rawLine: line,
      status,
      indentLevel: indent.length,
      hasCheckbox: true,
      marker: marker as '*' | '-' | '+',
      tags: extractTags(content),
      mentions: extractMentions(content),
      scheduledDate: extractScheduledDate(content),
      priority: extractPriority(content),
    };
  }

  // Then try plain marker style tasks (no checkbox): * task, - task
  // Only match if the marker is configured as a task marker
  const plainMatch = line.match(/^(\s*)([*\-])\s+(.+)$/);
  if (plainMatch) {
    const [, indent, marker, content] = plainMatch;

    // Check if this marker is configured as a task marker
    const isTaskMarker =
      (marker === '*' && config.isAsteriskTodo) || (marker === '-' && config.isDashTodo);

    if (isTaskMarker) {
      return {
        lineIndex,
        content: content.trim(),
        rawLine: line,
        status: 'open', // Plain marker tasks are always open
        indentLevel: indent.length,
        hasCheckbox: false,
        marker: marker as '*' | '-',
        tags: extractTags(content),
        mentions: extractMentions(content),
        scheduledDate: extractScheduledDate(content),
        priority: extractPriority(content),
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tag / mention extraction — aligned with Swift DataStore.parseTags behaviour
// ---------------------------------------------------------------------------

/**
 * Strip code fences (``` … ```) from full note content so that tags
 * inside fenced code blocks are not extracted.
 */
function stripCodeFences(content: string): string {
  return content.replace(/```[\s\S]*?```/g, '');
}

/**
 * Strip inline regions that must be ignored during tag extraction:
 *  - Inline code (`…`)
 *  - Markdown link URLs  [text](url) → keeps the link text
 */
function stripInlineExclusions(text: string): string {
  let result = text.replace(/`[^`\n]+`/g, '');
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return result;
}

/**
 * Remove parenthesised attributes from a tag.
 * e.g. #tag(value) → #tag,  @repeat(1/1/2025) → @repeat
 */
function cleanTagAttributes(tag: string): string {
  const idx = tag.indexOf('(');
  return idx > 0 ? tag.substring(0, idx) : tag;
}

/**
 * Expand hierarchical (nested) tags into every intermediate level.
 * Matches Swift DataStore.parseTags which produces:
 *   #parent/child/grandchild → [#parent, #parent/child, #parent/child/grandchild]
 */
function expandHierarchicalTags(tags: string[]): string[] {
  const expanded = new Set<string>();
  for (const tag of tags) {
    const prefix = tag.charAt(0); // # or @
    const parts = tag.substring(1).split('/');
    let current = prefix;
    for (let i = 0; i < parts.length; i++) {
      current += (i > 0 ? '/' : '') + parts[i];
      expanded.add(current);
    }
  }
  return Array.from(expanded);
}

/** Special @-tags excluded from global tag listings (mirrors Swift NoteCache). */
const EXCLUDED_AT_TAGS = ['@done', '@repeat', '@final-repeat'];

function isExcludedTag(tag: string): boolean {
  const lower = tag.toLowerCase();
  // Note: attributes are already stripped by cleanTagAttributes before this is called,
  // so we only need exact match and hierarchy-child match.
  return EXCLUDED_AT_TAGS.some((ex) => lower === ex || lower.startsWith(ex + '/'));
}

// Core regex — mirrors Swift DataStore.tag:
//  Boundary:          start-of-line | whitespace | one of ' ( [ { * _
//  Negative lookahead: reject purely-numeric / purely-punctuation tags (#123, #---)
//  Tag body:          Unicode letters, digits, symbols (incl. emoji) via [^\p{P}\s`],
//                     plus explicitly allowed punctuation: - _ /
//  Optional attribute: (...) at the end
const TAG_PATTERN =
  /(^|[\s'(\[{*_])(?![@#][\d\p{P}]+(?:\s|$))([@#](?:[^\p{P}\s`]|[-_/])+(?:\([^)]*\))?)/gmu;

/**
 * Low-level: extract raw tag strings (# and @) from a text fragment.
 * Handles inline-code and markdown-link exclusion but NOT code fences
 * (the caller must strip those when processing full note content).
 */
function extractRawTags(text: string): string[] {
  const cleaned = stripInlineExclusions(text);
  const tags: string[] = [];
  TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(cleaned)) !== null) {
    // Trim trailing separators to avoid ghost hierarchy levels from typos like #tag/
    const tag = match[2].replace(/\/+$/, '');
    if (tag.length > 1) tags.push(tag); // must have at least one body char after # or @
  }
  return tags;
}

/**
 * Extract hashtags from a single line / content fragment.
 * Attributes are stripped, hierarchies are expanded.
 */
export function extractTags(content: string): string[] {
  const raw = extractRawTags(content)
    .filter((t) => t.startsWith('#'))
    .map(cleanTagAttributes);
  return expandHierarchicalTags(raw);
}

/**
 * Extract @mentions from a single line / content fragment.
 * Attributes are stripped, hierarchies are expanded.
 */
export function extractMentions(content: string): string[] {
  const raw = extractRawTags(content)
    .filter((t) => t.startsWith('@'))
    .map(cleanTagAttributes);
  return expandHierarchicalTags(raw);
}

/**
 * Extract all unique tags (both # and @) from full note content.
 * Handles code fences, inline code, markdown links, boundary checks,
 * Unicode / emoji support, hierarchy expansion, and special-tag filtering.
 * Used by file-reader and sqlite-reader for global tag listing.
 */
export function extractTagsFromContent(content: string): string[] {
  const withoutFences = stripCodeFences(content);
  const raw = extractRawTags(withoutFences).map(cleanTagAttributes);
  const expanded = expandHierarchicalTags(raw);
  return expanded.filter((tag) => !isExcludedTag(tag));
}

/**
 * Extract scheduled date from content (>YYYY-MM-DD pattern)
 */
export function extractScheduledDate(content: string): string | undefined {
  const match = content.match(/>(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : undefined;
}

/**
 * Extract priority from content (! = low, !! = medium, !!! = high)
 */
export function extractPriority(content: string): number | undefined {
  const match = content.match(/(!{1,3})(?!\w)/);
  if (!match) return undefined;
  return match[1].length;
}

/**
 * Extract title from note content (first line, strips # if heading)
 */
export function extractTitle(content: string): string {
  const firstLine = content.split('\n')[0] || '';
  // Remove heading markers
  return firstLine.replace(/^#{1,6}\s*/, '').trim() || 'Untitled';
}

/**
 * Update a task's status in the note content
 * Handles both checkbox-style and plain marker tasks
 */
export function updateTaskStatus(content: string, lineIndex: number, newStatus: TaskStatus): string {
  const lines = content.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error(`Invalid line index: ${lineIndex}`);
  }

  const line = lines[lineIndex];
  const statusMarkers: Record<TaskStatus, string> = {
    open: '[ ]',
    done: '[x]',
    cancelled: '[-]',
    scheduled: '[>]',
  };

  // Check if line has a checkbox
  if (/\[.\]/.test(line)) {
    // Replace the existing status marker
    lines[lineIndex] = line.replace(/\[.\]/, statusMarkers[newStatus]);
  } else {
    // Plain marker task (e.g., "* task") - need to add checkbox
    const match = line.match(/^(\s*)([*\-])\s+(.*)$/);
    if (match) {
      const [, indent, marker, taskContent] = match;
      lines[lineIndex] = `${indent}${marker} ${statusMarkers[newStatus]} ${taskContent}`;
    } else {
      throw new Error(`Line ${lineIndex} is not a task`);
    }
  }

  return lines.join('\n');
}

/**
 * Update a task's content in the note
 * Handles both checkbox-style and plain marker tasks
 */
export function updateTaskContent(content: string, lineIndex: number, newTaskContent: string): string {
  const lines = content.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error(`Invalid line index: ${lineIndex}`);
  }

  const line = lines[lineIndex];

  // First try checkbox-style task: * [ ] task
  const checkboxMatch = line.match(/^(\s*[*+\-]\s*\[.\]\s*)/);
  if (checkboxMatch) {
    lines[lineIndex] = checkboxMatch[1] + newTaskContent;
    return lines.join('\n');
  }

  // Then try plain marker task: * task
  const plainMatch = line.match(/^(\s*[*\-]\s+)/);
  if (plainMatch) {
    lines[lineIndex] = plainMatch[1] + newTaskContent;
    return lines.join('\n');
  }

  throw new Error(`Line ${lineIndex} is not a task`);
}

/**
 * Add a task to note content
 * Uses user's configured task marker format from NotePlan preferences
 */
export function addTask(
  content: string,
  taskContent: string,
  position: 'start' | 'end' | 'after-heading' = 'end',
  heading?: string,
  options?: {
    status?: TaskStatus;
    priority?: number;
    indentLevel?: number;
  }
): string {
  let taskLine: string;
  if (options && (options.status !== undefined || options.priority !== undefined || options.indentLevel !== undefined)) {
    taskLine = buildParagraphLine(taskContent, 'task', {
      taskStatus: options.status ?? 'open',
      priority: options.priority,
      indentLevel: options.indentLevel,
    });
  } else {
    const taskPrefix = getTaskPrefix();
    taskLine = `${taskPrefix}${taskContent}`;
  }
  const lines = content.split('\n');

  if (position === 'start') {
    // Add after frontmatter if present
    let insertIndex = 0;
    if (lines[0]?.trim() === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === '---') {
          insertIndex = i + 1;
          break;
        }
      }
    }
    lines.splice(insertIndex, 0, taskLine);
  } else if (position === 'after-heading' && heading) {
    // Find the heading and insert after it
    const headingIndex = lines.findIndex(
      (line) => line.match(new RegExp(`^#{1,6}\\s*${escapeRegex(heading)}\\s*$`, 'i'))
    );
    if (headingIndex !== -1) {
      lines.splice(headingIndex + 1, 0, taskLine);
    } else {
      // Heading not found, add at end
      lines.push(taskLine);
    }
  } else {
    // Add at end
    lines.push(taskLine);
  }

  return lines.join('\n');
}

/**
 * Extract all headings from content
 */
export function extractHeadings(content: string): { level: number; text: string; lineIndex: number }[] {
  const lines = content.split('\n');
  const headings: { level: number; text: string; lineIndex: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        lineIndex: i,
      });
    }
  }

  return headings;
}

/**
 * Count indent level from leading whitespace.
 * Tabs count as 1 each; every 2 leading spaces convert to 1 tab-equivalent.
 */
function countIndentLevel(line: string): number {
  let tabs = 0;
  let spaces = 0;
  for (const ch of line) {
    if (ch === '\t') {
      tabs += 1;
    } else if (ch === ' ') {
      spaces += 1;
    } else {
      break;
    }
  }
  return tabs + Math.floor(spaces / 2);
}

/**
 * Parse a single line and classify it as a paragraph type with metadata.
 * Reuses parseTaskLine() detection patterns and extract* helpers.
 */
export function parseParagraphLine(line: string, lineIndex: number, isFirstLine: boolean): ParagraphMetadata {
  const config = getTaskMarkerConfigCached();
  const trimmed = line.trim();

  // 1. Empty
  if (trimmed === '') {
    return { type: 'empty', indentLevel: 0, tags: [], mentions: [] };
  }

  // 2. Separator (---, ***, ___)
  if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
    return { type: 'separator', indentLevel: 0, tags: [], mentions: [] };
  }

  // Helper to extract optional content metadata and conditionally spread
  function contentMeta(text: string): Pick<ParagraphMetadata, 'tags' | 'mentions'> & { scheduledDate?: string; priority?: number } {
    const scheduledDate = extractScheduledDate(text);
    const priority = extractPriority(text);
    return {
      tags: extractTags(text),
      mentions: extractMentions(text),
      ...(scheduledDate !== undefined && { scheduledDate }),
      ...(priority !== undefined && { priority }),
    };
  }

  // Helper to build a marker-line result (task, checklist, or bullet)
  function markerResult(
    type: ParagraphType,
    text: string,
    indent: string,
    typedMarker: '*' | '-' | '+',
    hasCheckbox: boolean,
    taskStatus?: TaskStatus,
  ): ParagraphMetadata {
    return {
      type,
      indentLevel: countIndentLevel(indent),
      marker: typedMarker,
      hasCheckbox,
      ...(taskStatus && { taskStatus }),
      ...contentMeta(text),
    };
  }

  // 3. Heading (# through ######)
  const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const content = headingMatch[2];
    const type: ParagraphType = isFirstLine ? 'title' : 'heading';
    return {
      type,
      headingLevel: level,
      indentLevel: 0,
      ...contentMeta(content),
    };
  }

  // 4. First line without # → title
  if (isFirstLine) {
    return {
      type: 'title',
      headingLevel: 1,
      indentLevel: 0,
      tags: extractTags(trimmed),
      mentions: extractMentions(trimmed),
    };
  }

  // 5. Quote (> ...)
  if (/^>\s?/.test(trimmed)) {
    const quoteContent = trimmed.replace(/^>\s?/, '');
    const scheduledDate = extractScheduledDate(quoteContent);
    return {
      type: 'quote',
      indentLevel: 0,
      tags: extractTags(quoteContent),
      mentions: extractMentions(quoteContent),
      ...(scheduledDate !== undefined && { scheduledDate }),
    };
  }

  // 6. Checkbox line (* [x], - [ ], + [-])
  const checkboxMatch = line.match(/^(\s*)([*+\-])\s*\[(.)\]\s*(.*)$/);
  if (checkboxMatch) {
    const [, indent, marker, statusChar, content] = checkboxMatch;
    const status = TASK_STATUS_MAP[`[${statusChar}]`] as TaskStatus | undefined;
    const typedMarker = marker as '*' | '-' | '+';
    const type: ParagraphType = typedMarker === '+' ? 'checklist' : 'task';
    return markerResult(type, content, indent, typedMarker, true, status);
  }

  // 7. Plain marker line (* item, - item, + item)
  const plainMatch = line.match(/^(\s*)([*+\-])\s+(.+)$/);
  if (plainMatch) {
    const [, indent, marker, content] = plainMatch;
    const typedMarker = marker as '*' | '-' | '+';

    if (typedMarker === '+') {
      return markerResult('checklist', content, indent, typedMarker, false);
    }

    const isTaskMarkerChar =
      (typedMarker === '*' && config.isAsteriskTodo) || (typedMarker === '-' && config.isDashTodo);

    if (isTaskMarkerChar) {
      return markerResult('task', content, indent, typedMarker, false, 'open');
    }

    // It's a bullet
    return markerResult('bullet', content, indent, typedMarker, false);
  }

  // 8. Everything else → text
  return {
    type: 'text',
    indentLevel: countIndentLevel(line),
    ...contentMeta(trimmed),
  };
}

/**
 * Build a properly formatted markdown line from structured input.
 * Uses user preferences for task marker style.
 */
export function buildParagraphLine(
  content: string,
  type: ParagraphType,
  options?: {
    headingLevel?: number;
    taskStatus?: TaskStatus;
    indentLevel?: number;
    priority?: number;
    hasCheckbox?: boolean;
  }
): string {
  const config = getTaskMarkerConfigCached();
  const indent = '\t'.repeat(options?.indentLevel ?? 0);
  const prioritySuffix = options?.priority ? ' ' + '!'.repeat(options.priority) : '';

  switch (type) {
    case 'title':
    case 'heading': {
      const level = options?.headingLevel ?? (type === 'title' ? 1 : 2);
      return `${'#'.repeat(level)} ${content}`;
    }
    case 'task': {
      const marker = config.defaultTodoCharacter;
      const status = options?.taskStatus ?? 'open';
      const wantCheckbox = options?.hasCheckbox ?? config.useCheckbox;
      if (wantCheckbox || status !== 'open') {
        return `${indent}${marker} ${STATUS_TO_MARKER[status]} ${content}${prioritySuffix}`;
      }
      return `${indent}${marker} ${content}${prioritySuffix}`;
    }
    case 'checklist': {
      const status = options?.taskStatus ?? 'open';
      const wantCheckbox = options?.hasCheckbox ?? true;
      if (wantCheckbox || status !== 'open') {
        return `${indent}+ ${STATUS_TO_MARKER[status]} ${content}${prioritySuffix}`;
      }
      return `${indent}+ ${content}${prioritySuffix}`;
    }
    case 'bullet':
      return `${indent}- ${content}`;
    case 'quote':
      return `> ${content}`;
    case 'separator':
      return '---';
    case 'empty':
      return '';
    case 'text':
    default:
      return content;
  }
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filter tasks by status
 */
export function filterTasksByStatus(tasks: Task[], status?: TaskStatus | TaskStatus[]): Task[] {
  if (!status) return tasks;

  const statuses = Array.isArray(status) ? status : [status];
  return tasks.filter((task) => statuses.includes(task.status));
}
