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
  position: 'start' | 'end' | 'after-heading' | 'at-line' | 'in-section';
  heading?: string;
  line?: number;
}

/**
 * Return the number of lines occupied by frontmatter (including both `---`
 * delimiters).  Returns 0 when the note has no valid frontmatter.
 * This is used to prevent edits to frontmatter lines — callers validate
 * that user-supplied line numbers fall after the frontmatter boundary.
 */
export function getFrontmatterLineCount(content: string): number {
  const parsed = parseNoteContent(content);
  if (!parsed.hasFrontmatter) return 0;
  const lines = content.split('\n');
  // Find closing --- index
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      return i + 1; // include the closing ---
    }
  }
  return 0;
}

/**
 * Find the closing --- delimiter index for frontmatter.
 * Returns the line index of the closing ---, or -1 if not found.
 *
 * Lenient scanning: allows blank lines, indented lines (YAML arrays/nested
 * values), comment lines (starting with #), and key:value pairs between
 * delimiters.  Stops on lines that don't look like YAML (e.g. markdown
 * list items with * at column 0, plain text paragraphs) — this prevents
 * a thematic break --- later in the note body from being mistaken for a
 * frontmatter closer.
 */
function findClosingDelimiterIndex(lines: string[]): number {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      return i;
    }
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    // Allow valid YAML constructs between delimiters:
    if (
      trimmed === '' ||           // blank lines
      /^\s/.test(line) ||         // indented lines (arrays, nested values)
      trimmed.startsWith('#') ||  // YAML comments
      /^\S+:\s*/.test(line)       // key: value pairs (including bare key:)
    ) {
      continue;
    }
    // Unrecognized line — not YAML, stop scanning
    break;
  }
  return -1;
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

  const closingIndex = findClosingDelimiterIndex(lines);
  if (closingIndex === -1) {
    // No closing delimiter found, treat as no frontmatter
    return {
      frontmatter: null,
      body: content,
      hasFrontmatter: false,
    };
  }

  // Parse key:value pairs from frontmatter (non-kv lines like indented
  // array items or comments are skipped — they are preserved by the
  // text-level set/remove functions but not represented in this Record)
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
 * Set a frontmatter property, creating frontmatter if needed.
 * Uses text-level manipulation to preserve YAML arrays, comments,
 * and other constructs that the simple key:value parser doesn't model.
 */
export function setFrontmatterProperty(content: string, key: string, value: string): string {
  const lines = content.split('\n');

  if (lines[0]?.trim() !== '---') {
    // No frontmatter — prepend a new block
    return `---\n${key}: ${value}\n---\n${content}`;
  }

  const closingIndex = findClosingDelimiterIndex(lines);
  if (closingIndex === -1) {
    // Unclosed/invalid frontmatter — prepend a new block
    return `---\n${key}: ${value}\n---\n${content}`;
  }

  // Find existing key line within frontmatter
  const prefix = key + ':';
  let keyLineIndex = -1;
  for (let i = 1; i < closingIndex; i++) {
    const line = lines[i];
    if (line === prefix || line.startsWith(prefix + ' ') || line.startsWith(prefix + '\t')) {
      keyLineIndex = i;
      break;
    }
  }

  if (keyLineIndex !== -1) {
    // Replace existing key line and remove any indented continuation lines
    // (e.g. YAML array items belonging to this key)
    let endIndex = keyLineIndex + 1;
    while (endIndex < closingIndex && /^\s/.test(lines[endIndex])) {
      endIndex++;
    }
    lines.splice(keyLineIndex, endIndex - keyLineIndex, `${key}: ${value}`);
  } else {
    // Add new key before closing ---
    lines.splice(closingIndex, 0, `${key}: ${value}`);
  }

  return lines.join('\n');
}

/**
 * Remove a frontmatter property.
 * Uses text-level manipulation to preserve other YAML constructs.
 */
export function removeFrontmatterProperty(content: string, key: string): string {
  const lines = content.split('\n');

  if (lines[0]?.trim() !== '---') {
    return content;
  }

  const closingIndex = findClosingDelimiterIndex(lines);
  if (closingIndex === -1) {
    return content;
  }

  // Find the key line
  const prefix = key + ':';
  let keyLineIndex = -1;
  for (let i = 1; i < closingIndex; i++) {
    const line = lines[i];
    if (line === prefix || line.startsWith(prefix + ' ') || line.startsWith(prefix + '\t')) {
      keyLineIndex = i;
      break;
    }
  }

  if (keyLineIndex === -1) {
    return content; // Key not found
  }

  // Remove the key line and any indented continuation lines
  let endIndex = keyLineIndex + 1;
  while (endIndex < closingIndex && /^\s/.test(lines[endIndex])) {
    endIndex++;
  }
  lines.splice(keyLineIndex, endIndex - keyLineIndex);

  // Check if frontmatter is now empty (only --- delimiters remain)
  const newClosingIndex = closingIndex - (endIndex - keyLineIndex);
  const hasRemainingKeys = lines.slice(1, newClosingIndex).some(l => /^\S+:\s*/.test(l));

  if (!hasRemainingKeys) {
    // Remove entire frontmatter block (opening ---, content, closing ---)
    lines.splice(0, newClosingIndex + 1);
  }

  return lines.join('\n');
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

  // Split newContent into individual lines so splice inserts one element per
  // line.  Strip a single trailing newline first — trailing \n in the content
  // string is almost never intentional and would otherwise create an extra
  // blank line after join('\n').  Callers who need an explicit blank line
  // should insert content="" separately.
  const newLines = newContent.replace(/\n$/, '').split('\n');

  switch (position) {
    case 'start': {
      // When heading is provided, delegate to after-heading so that
      // position="start" + heading="X" inserts right after the heading.
      if (heading) {
        return insertContentAtPosition(content, newContent, {
          position: 'after-heading',
          heading,
        });
      }

      // Insert after frontmatter if present.
      // Use parseNoteContent to validate that frontmatter actually exists
      // (has both opening and closing ---) before scanning for the closer.
      // This prevents a thematic break (---) in the note body from being
      // mistaken for the frontmatter closing delimiter.
      const parsed = parseNoteContent(content);
      let insertIndex = 0;
      if (parsed.hasFrontmatter && lines[0]?.trim() === '---') {
        for (let i = 1; i < lines.length; i++) {
          if (lines[i]?.trim() === '---') {
            insertIndex = i + 1;
            break;
          }
        }
      }
      lines.splice(insertIndex, 0, ...newLines);
      break;
    }

    case 'end': {
      // When heading is provided, delegate to in-section so that
      // position="end" + heading="X" appends at the end of that section.
      if (heading) {
        return insertContentAtPosition(content, newContent, {
          position: 'in-section',
          heading,
        });
      }

      // Append at end — use original newContent (no trailing-\n strip)
      // because appending doesn't go through splice+join.
      if (content.endsWith('\n')) {
        return content + newContent;
      }
      return content + '\n' + newContent;
    }

    case 'after-heading': {
      if (!heading) {
        throw new Error('Heading is required for after-heading position');
      }
      const targetHeading = normalizeHeadingForMatch(heading);
      const headingIndex = lines.findIndex((lineValue) => {
        const lineHeading = extractSectionBoundaryText(lineValue);
        if (!lineHeading) return false;
        return normalizeHeadingForMatch(lineHeading) === targetHeading;
      });

      if (headingIndex === -1) {
        const availableHeadings = lines
          .map((lineValue) => extractSectionBoundaryText(lineValue))
          .filter((value): value is string => Boolean(value))
          .slice(0, 15);
        if (availableHeadings.length > 0) {
          throw new Error(
            `Heading "${heading}" not found. Available headings include: ${availableHeadings.join(
              ' | '
            )}`
          );
        }
        throw new Error(`Heading "${heading}" not found`);
      }

      // Insert after the heading
      lines.splice(headingIndex + 1, 0, ...newLines);
      break;
    }

    case 'at-line': {
      if (line === undefined || line < 1) {
        throw new Error('Valid line number is required for at-line position');
      }
      // Line numbers are absolute (1-indexed), matching get_notes/getParagraphs
      const lineIndex = Number(line) - 1;
      // Ensure we have enough lines
      while (lines.length <= lineIndex) {
        lines.push('');
      }
      lines.splice(lineIndex, 0, ...newLines);
      break;
    }

    case 'in-section': {
      if (!heading) {
        throw new Error('Heading is required for in-section position');
      }
      const targetSectionHeading = normalizeHeadingForMatch(heading);
      const sectionHeadingIndex = lines.findIndex((lineValue) => {
        const lineHeading = extractSectionBoundaryText(lineValue);
        if (!lineHeading) return false;
        return normalizeHeadingForMatch(lineHeading) === targetSectionHeading;
      });

      if (sectionHeadingIndex === -1) {
        const availableSectionHeadings = lines
          .map((lineValue) => extractSectionBoundaryText(lineValue))
          .filter((value): value is string => Boolean(value))
          .slice(0, 15);
        if (availableSectionHeadings.length > 0) {
          throw new Error(
            `Heading "${heading}" not found. Available headings include: ${availableSectionHeadings.join(
              ' | '
            )}`
          );
        }
        throw new Error(`Heading "${heading}" not found`);
      }

      // Find end of section: next heading/section marker or end of file
      let sectionEndIndex = lines.length;
      for (let i = sectionHeadingIndex + 1; i < lines.length; i++) {
        if (isSectionBoundary(lines[i])) {
          sectionEndIndex = i;
          break;
        }
      }

      // Walk backward from section end to skip trailing blank lines
      let insertIndex = sectionEndIndex;
      while (insertIndex > sectionHeadingIndex + 1 && lines[insertIndex - 1].trim() === '') {
        insertIndex--;
      }

      lines.splice(insertIndex, 0, ...newLines);
      break;
    }

    default:
      throw new Error(`Unknown position: ${position}`);
  }

  return lines.join('\n');
}

/**
 * Delete lines from content (1-indexed, inclusive).
 * Line numbers are absolute — line 1 is the first line of the file,
 * matching get_notes/getParagraphs numbering.
 */
export function deleteLines(content: string, startLine: number, endLine: number): string {
  if (startLine < 1 || endLine < startLine) {
    throw new Error(`Invalid line range: ${startLine}-${endLine}`);
  }

  const lines = content.split('\n');

  if (startLine > lines.length) {
    throw new Error(`Start line ${startLine} exceeds content length (${lines.length} lines)`);
  }

  // Convert to 0-indexed (absolute, no frontmatter offset)
  const startIndex = startLine - 1;
  const endIndex = Math.min(endLine, lines.length);

  // Remove the lines
  lines.splice(startIndex, endIndex - startIndex);

  return lines.join('\n');
}

function extractAtxHeadingText(line: string): string | null {
  const match = line.match(/^\s{0,3}(#{1,6})\s*(.*?)\s*#*\s*$/);
  if (!match) return null;
  const text = match[2]?.trim() || '';
  if (!text) return null;
  return text;
}

function extractBoldSectionMarker(line: string): string | null {
  const match = line.match(/^\s*\*\*(.+?)\*\*:?\s*$/);
  if (!match) return null;
  return match[1].trim() || null;
}

function extractSectionBoundaryText(line: string): string | null {
  return extractAtxHeadingText(line) ?? extractBoldSectionMarker(line);
}

function isSectionBoundary(line: string): boolean {
  return extractSectionBoundaryText(line) !== null;
}

function normalizeHeadingForMatch(value: string): string {
  let normalized = value.trim();
  normalized = normalized.replace(/^\s{0,3}#{1,6}\s*/, '');
  normalized = normalized.replace(/\s+#+\s*$/, '');
  normalized = normalized.replace(/^\*\*(.+?)\*\*:?\s*$/, '$1');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized.toLowerCase();
}
