// Frontmatter parsing and content manipulation utilities

/**
 * Parsed note structure
 */
export interface ParsedNote {
  frontmatter: Record<string, string> | null;
  body: string;
  hasFrontmatter: boolean;
}

/**
 * Options for inserting content
 */
export interface InsertOptions {
  position: 'start' | 'end' | 'after-heading' | 'at-line';
  heading?: string;
  line?: number;
}

/**
 * Parse a note's content into frontmatter and body
 */
export function parseNoteContent(content: string): ParsedNote {
  const lines = content.split('\n');

  // Check if content starts with frontmatter delimiter
  if (lines[0]?.trim() !== '---') {
    return {
      frontmatter: null,
      body: content,
      hasFrontmatter: false,
    };
  }

  // Find closing delimiter
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    // No closing delimiter found, treat as no frontmatter
    return {
      frontmatter: null,
      body: content,
      hasFrontmatter: false,
    };
  }

  // Parse frontmatter
  const frontmatterLines = lines.slice(1, closingIndex);
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterLines) {
    const match = line.match(/^(\S+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      frontmatter[key] = value.trim();
    }
  }

  // Extract body (everything after closing delimiter)
  const body = lines.slice(closingIndex + 1).join('\n');

  return {
    frontmatter,
    body,
    hasFrontmatter: true,
  };
}

/**
 * Serialize frontmatter back to YAML format
 */
export function serializeFrontmatter(frontmatter: Record<string, string>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Reconstruct note from parsed parts
 */
export function reconstructNote(parsed: ParsedNote): string {
  if (!parsed.frontmatter || Object.keys(parsed.frontmatter).length === 0) {
    return parsed.body;
  }
  return serializeFrontmatter(parsed.frontmatter) + '\n' + parsed.body;
}

/**
 * Set a frontmatter property, creating frontmatter if needed
 */
export function setFrontmatterProperty(content: string, key: string, value: string): string {
  const parsed = parseNoteContent(content);

  if (!parsed.frontmatter) {
    // Create new frontmatter
    parsed.frontmatter = {};
  }

  parsed.frontmatter[key] = value;

  return reconstructNote(parsed);
}

/**
 * Remove a frontmatter property
 */
export function removeFrontmatterProperty(content: string, key: string): string {
  const parsed = parseNoteContent(content);

  if (!parsed.frontmatter) {
    // No frontmatter, nothing to remove
    return content;
  }

  delete parsed.frontmatter[key];

  return reconstructNote(parsed);
}

/**
 * Insert content at a specified position
 */
export function insertContentAtPosition(
  content: string,
  newContent: string,
  options: InsertOptions
): string {
  const { position, heading, line } = options;
  const lines = content.split('\n');

  switch (position) {
    case 'start': {
      // Insert after frontmatter if present
      let insertIndex = 0;
      if (lines[0]?.trim() === '---') {
        for (let i = 1; i < lines.length; i++) {
          if (lines[i]?.trim() === '---') {
            insertIndex = i + 1;
            break;
          }
        }
      }
      lines.splice(insertIndex, 0, newContent);
      break;
    }

    case 'end': {
      // Append at end
      if (content.endsWith('\n')) {
        return content + newContent;
      }
      return content + '\n' + newContent;
    }

    case 'after-heading': {
      if (!heading) {
        throw new Error('Heading is required for after-heading position');
      }
      // Find the heading (case-insensitive)
      const headingPattern = new RegExp(`^#{1,6}\\s*${escapeRegex(heading)}\\s*$`, 'i');
      const headingIndex = lines.findIndex((l) => headingPattern.test(l));

      if (headingIndex === -1) {
        throw new Error(`Heading "${heading}" not found`);
      }

      // Insert after the heading
      lines.splice(headingIndex + 1, 0, newContent);
      break;
    }

    case 'at-line': {
      if (line === undefined || line < 0) {
        throw new Error('Valid line number is required for at-line position');
      }
      // Ensure we have enough lines
      while (lines.length < line) {
        lines.push('');
      }
      lines.splice(line, 0, newContent);
      break;
    }

    default:
      throw new Error(`Unknown position: ${position}`);
  }

  return lines.join('\n');
}

/**
 * Delete lines from content (1-indexed, inclusive)
 */
export function deleteLines(content: string, startLine: number, endLine: number): string {
  if (startLine < 1 || endLine < startLine) {
    throw new Error(`Invalid line range: ${startLine}-${endLine}`);
  }

  const lines = content.split('\n');

  if (startLine > lines.length) {
    throw new Error(`Start line ${startLine} exceeds content length (${lines.length} lines)`);
  }

  // Convert to 0-indexed
  const startIndex = startLine - 1;
  const endIndex = Math.min(endLine, lines.length);

  // Remove the lines
  lines.splice(startIndex, endIndex - startIndex);

  return lines.join('\n');
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
