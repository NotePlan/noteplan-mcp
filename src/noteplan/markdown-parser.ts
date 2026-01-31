// NotePlan Markdown Parser

import { Task, TaskStatus, TASK_STATUS_MAP } from './types.js';
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

/**
 * Extract hashtags from content
 */
export function extractTags(content: string): string[] {
  const matches = content.match(/#[\w-/]+/g);
  return matches || [];
}

/**
 * Extract @mentions from content
 */
export function extractMentions(content: string): string[] {
  const matches = content.match(/@[\w-]+/g);
  return matches || [];
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
  heading?: string
): string {
  const taskPrefix = getTaskPrefix();
  const taskLine = `${taskPrefix}${taskContent}`;
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
