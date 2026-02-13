import { describe, it, expect } from 'vitest';
import {
  insertContentAtPosition,
  parseNoteContent,
  serializeFrontmatter,
  reconstructNote,
  setFrontmatterProperty,
  removeFrontmatterProperty,
  deleteLines,
} from './frontmatter-parser.js';

/**
 * Helper: split result into lines for easier assertions.
 * Line numbers in comments are 1-indexed to match tool convention.
 */
function lines(content: string): string[] {
  return content.split('\n');
}

describe('insertContentAtPosition – at-line', () => {
  // The exact scenario that triggered the bug:
  // A note with bold section markers and a blank separator between sections.
  const sectionNote = [
    '# My Note',           // line 1
    '',                     // line 2
    '**Spaces:**',          // line 3
    '- Space Item 1',      // line 4
    '- Space Item 2',      // line 5
    '- Space Item 3',      // line 6
    '',                     // line 7  ← blank separator
    '**General:**',         // line 8
    '- Gen Item 1',        // line 9
  ].join('\n');

  it('inserts before a blank separator line, preserving the gap (1-indexed)', () => {
    // Insert at line 7 (the blank separator) — new item should land at line 7,
    // pushing the blank to line 8 so it remains as the section separator.
    const result = insertContentAtPosition(sectionNote, '- New Item', {
      position: 'at-line',
      line: 7,
    });

    const resultLines = lines(result);
    expect(resultLines[5]).toBe('- Space Item 3');  // line 6 unchanged
    expect(resultLines[6]).toBe('- New Item');       // line 7 = new item
    expect(resultLines[7]).toBe('');                  // line 8 = separator preserved
    expect(resultLines[8]).toBe('**General:**');      // line 9 = next section
  });

  it('uses 1-indexed line numbers (line 1 = first line)', () => {
    const result = insertContentAtPosition(sectionNote, '- Prepended', {
      position: 'at-line',
      line: 1,
    });

    const resultLines = lines(result);
    expect(resultLines[0]).toBe('- Prepended');
    expect(resultLines[1]).toBe('# My Note');
  });

  it('inserts before a non-blank line without consuming it', () => {
    // Insert at line 4 (- Space Item 1)
    const result = insertContentAtPosition(sectionNote, '- Before Item 1', {
      position: 'at-line',
      line: 4,
    });

    const resultLines = lines(result);
    expect(resultLines[3]).toBe('- Before Item 1');
    expect(resultLines[4]).toBe('- Space Item 1');
    // Total line count should increase by 1
    expect(resultLines.length).toBe(lines(sectionNote).length + 1);
  });

  it('pads with empty lines when targeting beyond file end', () => {
    const short = 'Line 1\nLine 2';
    const result = insertContentAtPosition(short, 'Appended', {
      position: 'at-line',
      line: 5,
    });

    const resultLines = lines(result);
    expect(resultLines[0]).toBe('Line 1');
    expect(resultLines[1]).toBe('Line 2');
    expect(resultLines[2]).toBe('');    // padded
    expect(resultLines[3]).toBe('');    // padded
    expect(resultLines[4]).toBe('Appended');
  });

  it('handles multi-line content insertion', () => {
    const result = insertContentAtPosition(sectionNote, '- Item A\n- Item B', {
      position: 'at-line',
      line: 7,
    });

    const resultLines = lines(result);
    expect(resultLines[6]).toBe('- Item A');
    expect(resultLines[7]).toBe('- Item B');
    expect(resultLines[8]).toBe('');                  // separator preserved
    expect(resultLines[9]).toBe('**General:**');
  });

  it('rejects line 0 (must be 1-indexed)', () => {
    expect(() =>
      insertContentAtPosition(sectionNote, 'bad', { position: 'at-line', line: 0 })
    ).toThrow();
  });

  it('rejects negative line numbers', () => {
    expect(() =>
      insertContentAtPosition(sectionNote, 'bad', { position: 'at-line', line: -1 })
    ).toThrow();
  });
});

describe('insertContentAtPosition – in-section', () => {
  const sectionNote = [
    '# My Note',
    '',
    '**Spaces**',
    '- Space Item 1',
    '- Space Item 2',
    '',
    '**General**',
    '- Gen Item 1',
  ].join('\n');

  it('appends to a bold section before the trailing blank', () => {
    const result = insertContentAtPosition(sectionNote, '- Space Item 3', {
      position: 'in-section',
      heading: 'Spaces',
    });

    const resultLines = lines(result);
    expect(resultLines[4]).toBe('- Space Item 2');
    expect(resultLines[5]).toBe('- Space Item 3');    // new item
    expect(resultLines[6]).toBe('');                   // separator preserved
    expect(resultLines[7]).toBe('**General**');
  });
});

// ---------------------------------------------------------------------------
// parseNoteContent
// ---------------------------------------------------------------------------
describe('parseNoteContent', () => {
  it('parses standard frontmatter with multiple properties', () => {
    const content = '---\ntitle: My Note\ntags: work\n---\nBody text here';
    const result = parseNoteContent(content);
    expect(result.frontmatter).toEqual({ title: 'My Note', tags: 'work' });
    expect(result.body).toBe('Body text here');
    expect(result.hasFrontmatter).toBe(true);
  });

  it('returns null frontmatter when no --- markers', () => {
    const content = 'Just a plain note\nwith two lines';
    const result = parseNoteContent(content);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
    expect(result.hasFrontmatter).toBe(false);
  });

  it('returns null when only opening --- with no close', () => {
    const content = '---\ntitle: Oops\nNo closing delimiter';
    const result = parseNoteContent(content);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
    expect(result.hasFrontmatter).toBe(false);
  });

  it('handles empty frontmatter block (just ---\\n---)', () => {
    const content = '---\n---\nBody after empty frontmatter';
    const result = parseNoteContent(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('Body after empty frontmatter');
    expect(result.hasFrontmatter).toBe(true);
  });

  it('trims whitespace from values', () => {
    const content = '---\ntitle:   spaced out   \n---\nBody';
    const result = parseNoteContent(content);
    expect(result.frontmatter!.title).toBe('spaced out');
  });

  it('body does not include frontmatter', () => {
    const content = '---\nkey: val\n---\nLine 1\nLine 2';
    const result = parseNoteContent(content);
    expect(result.body).toBe('Line 1\nLine 2');
    expect(result.body).not.toContain('---');
    expect(result.body).not.toContain('key: val');
  });

  it('hasFrontmatter is true when frontmatter exists', () => {
    const withFm = '---\na: b\n---\nbody';
    const withoutFm = 'no frontmatter';
    expect(parseNoteContent(withFm).hasFrontmatter).toBe(true);
    expect(parseNoteContent(withoutFm).hasFrontmatter).toBe(false);
  });

  it('handles content with no body after frontmatter', () => {
    const content = '---\ntitle: Only FM\n---';
    const result = parseNoteContent(content);
    expect(result.frontmatter).toEqual({ title: 'Only FM' });
    expect(result.body).toBe('');
    expect(result.hasFrontmatter).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// serializeFrontmatter
// ---------------------------------------------------------------------------
describe('serializeFrontmatter', () => {
  it('serializes key-value pairs with --- delimiters', () => {
    const result = serializeFrontmatter({ title: 'Test' });
    expect(result).toBe('---\ntitle: Test\n---');
  });

  it('handles multiple properties', () => {
    const result = serializeFrontmatter({ title: 'Test', tags: 'work' });
    const resultLines = result.split('\n');
    expect(resultLines[0]).toBe('---');
    expect(resultLines).toContain('title: Test');
    expect(resultLines).toContain('tags: work');
    expect(resultLines[resultLines.length - 1]).toBe('---');
  });

  it('handles empty object', () => {
    const result = serializeFrontmatter({});
    expect(result).toBe('---\n---');
  });
});

// ---------------------------------------------------------------------------
// reconstructNote
// ---------------------------------------------------------------------------
describe('reconstructNote', () => {
  it('reconstructs note with frontmatter', () => {
    const result = reconstructNote({
      frontmatter: { title: 'Hello' },
      body: 'Some body text',
      hasFrontmatter: true,
    });
    expect(result).toBe('---\ntitle: Hello\n---\nSome body text');
  });

  it('returns body only when frontmatter is null', () => {
    const result = reconstructNote({
      frontmatter: null,
      body: 'Just the body',
      hasFrontmatter: false,
    });
    expect(result).toBe('Just the body');
  });

  it('returns body only when frontmatter is empty object', () => {
    const result = reconstructNote({
      frontmatter: {},
      body: 'Body with empty fm',
      hasFrontmatter: true,
    });
    expect(result).toBe('Body with empty fm');
  });

  it('round-trips: parse then reconstruct preserves content', () => {
    const original = '---\ntitle: Round Trip\ntags: test\n---\n# Heading\n\nBody paragraph.';
    const parsed = parseNoteContent(original);
    const reconstructed = reconstructNote(parsed);
    expect(reconstructed).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// setFrontmatterProperty
// ---------------------------------------------------------------------------
describe('setFrontmatterProperty', () => {
  it('sets property on note with existing frontmatter', () => {
    const content = '---\ntitle: Existing\n---\nBody';
    const result = setFrontmatterProperty(content, 'tags', 'work');
    const parsed = parseNoteContent(result);
    expect(parsed.frontmatter!.tags).toBe('work');
    expect(parsed.frontmatter!.title).toBe('Existing');
  });

  it('creates frontmatter when none exists', () => {
    const content = 'Plain body text';
    const result = setFrontmatterProperty(content, 'title', 'New Title');
    const parsed = parseNoteContent(result);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.frontmatter!.title).toBe('New Title');
    expect(parsed.body).toBe('Plain body text');
  });

  it('overwrites existing property value', () => {
    const content = '---\ntitle: Old\n---\nBody';
    const result = setFrontmatterProperty(content, 'title', 'New');
    const parsed = parseNoteContent(result);
    expect(parsed.frontmatter!.title).toBe('New');
  });

  it('preserves other properties when setting a new one', () => {
    const content = '---\ntitle: Keep\nauthor: Alice\n---\nBody';
    const result = setFrontmatterProperty(content, 'tags', 'added');
    const parsed = parseNoteContent(result);
    expect(parsed.frontmatter!.title).toBe('Keep');
    expect(parsed.frontmatter!.author).toBe('Alice');
    expect(parsed.frontmatter!.tags).toBe('added');
  });

  it('preserves the note body', () => {
    const content = '---\ntitle: T\n---\nLine 1\nLine 2';
    const result = setFrontmatterProperty(content, 'key', 'val');
    const parsed = parseNoteContent(result);
    expect(parsed.body).toBe('Line 1\nLine 2');
  });
});

// ---------------------------------------------------------------------------
// removeFrontmatterProperty
// ---------------------------------------------------------------------------
describe('removeFrontmatterProperty', () => {
  it('removes existing property', () => {
    const content = '---\ntitle: Remove Me\ntags: keep\n---\nBody';
    const result = removeFrontmatterProperty(content, 'title');
    const parsed = parseNoteContent(result);
    expect(parsed.frontmatter!.title).toBeUndefined();
    expect(parsed.frontmatter!.tags).toBe('keep');
  });

  it('returns unchanged content when no frontmatter', () => {
    const content = 'No frontmatter here';
    const result = removeFrontmatterProperty(content, 'title');
    expect(result).toBe(content);
  });

  it('returns unchanged structure when property does not exist', () => {
    const content = '---\ntitle: Keep\n---\nBody';
    const result = removeFrontmatterProperty(content, 'nonexistent');
    const parsed = parseNoteContent(result);
    expect(parsed.frontmatter!.title).toBe('Keep');
  });

  it('preserves other properties after removal', () => {
    const content = '---\na: 1\nb: 2\nc: 3\n---\nBody';
    const result = removeFrontmatterProperty(content, 'b');
    const parsed = parseNoteContent(result);
    expect(parsed.frontmatter!.a).toBe('1');
    expect(parsed.frontmatter!.b).toBeUndefined();
    expect(parsed.frontmatter!.c).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// insertContentAtPosition – start
// ---------------------------------------------------------------------------
describe('insertContentAtPosition – start', () => {
  it('inserts at beginning when no frontmatter', () => {
    const content = 'Line 1\nLine 2';
    const result = insertContentAtPosition(content, 'Inserted', {
      position: 'start',
    });
    const resultLines = lines(result);
    expect(resultLines[0]).toBe('Inserted');
    expect(resultLines[1]).toBe('Line 1');
    expect(resultLines[2]).toBe('Line 2');
  });

  it('inserts after frontmatter when present', () => {
    const content = '---\ntitle: Test\n---\nBody line';
    const result = insertContentAtPosition(content, 'After FM', {
      position: 'start',
    });
    const resultLines = lines(result);
    expect(resultLines[0]).toBe('---');
    expect(resultLines[1]).toBe('title: Test');
    expect(resultLines[2]).toBe('---');
    expect(resultLines[3]).toBe('After FM');
    expect(resultLines[4]).toBe('Body line');
  });

  it('works with empty content', () => {
    const result = insertContentAtPosition('', 'First line', {
      position: 'start',
    });
    const resultLines = lines(result);
    expect(resultLines[0]).toBe('First line');
  });

  it('handles multi-line insertion at start', () => {
    const content = 'Existing';
    const result = insertContentAtPosition(content, 'A\nB\nC', {
      position: 'start',
    });
    const resultLines = lines(result);
    expect(resultLines[0]).toBe('A');
    expect(resultLines[1]).toBe('B');
    expect(resultLines[2]).toBe('C');
    expect(resultLines[3]).toBe('Existing');
  });
});

// ---------------------------------------------------------------------------
// insertContentAtPosition – end
// ---------------------------------------------------------------------------
describe('insertContentAtPosition – end', () => {
  it('appends to end of content', () => {
    const content = 'Line 1\nLine 2';
    const result = insertContentAtPosition(content, 'Line 3', {
      position: 'end',
    });
    expect(result).toBe('Line 1\nLine 2\nLine 3');
  });

  it('handles content with trailing newline', () => {
    const content = 'Line 1\n';
    const result = insertContentAtPosition(content, 'Appended', {
      position: 'end',
    });
    expect(result).toBe('Line 1\nAppended');
  });

  it('appends multi-line content', () => {
    const content = 'Start';
    const result = insertContentAtPosition(content, 'A\nB', {
      position: 'end',
    });
    expect(result).toBe('Start\nA\nB');
  });

  it('inserts at end of section when position=end + heading are both provided', () => {
    const content = [
      '# Daily Note',
      '',
      '## Tasks',
      '* Existing task',
      '',
      '## NotePlan',
      '* Existing item',
      '',
      '## Other',
      '* Other item',
    ].join('\n');

    const result = insertContentAtPosition(content, '* New item', {
      position: 'end',
      heading: 'NotePlan',
    });

    const resultLines = lines(result);
    // Should be at the end of the NotePlan section, NOT at the end of the note
    const notePlanIdx = resultLines.indexOf('## NotePlan');
    const otherIdx = resultLines.indexOf('## Other');
    const newItemIdx = resultLines.indexOf('* New item');
    expect(newItemIdx).toBeGreaterThan(notePlanIdx);
    expect(newItemIdx).toBeLessThan(otherIdx);
  });

  it('still appends to end of note when position=end with no heading', () => {
    const content = '# Title\n\nSome text';
    const result = insertContentAtPosition(content, '* Bottom', {
      position: 'end',
    });
    expect(result).toBe('# Title\n\nSome text\n* Bottom');
  });
});

// ---------------------------------------------------------------------------
// insertContentAtPosition – after-heading
// ---------------------------------------------------------------------------
describe('insertContentAtPosition – after-heading', () => {
  it('inserts after ATX heading (# Heading)', () => {
    const content = '# Title\n\nSome text';
    const result = insertContentAtPosition(content, 'Inserted', {
      position: 'after-heading',
      heading: 'Title',
    });
    const resultLines = lines(result);
    expect(resultLines[0]).toBe('# Title');
    expect(resultLines[1]).toBe('Inserted');
    expect(resultLines[2]).toBe('');
    expect(resultLines[3]).toBe('Some text');
  });

  it('inserts after bold heading (**Heading**:)', () => {
    const content = '**Tasks**:\n- Task 1';
    const result = insertContentAtPosition(content, '- Task 0', {
      position: 'after-heading',
      heading: 'Tasks',
    });
    const resultLines = lines(result);
    expect(resultLines[0]).toBe('**Tasks**:');
    expect(resultLines[1]).toBe('- Task 0');
    expect(resultLines[2]).toBe('- Task 1');
  });

  it('matches headings case-insensitively', () => {
    const content = '# My Title\nBody';
    const result = insertContentAtPosition(content, 'Inserted', {
      position: 'after-heading',
      heading: 'my title',
    });
    const resultLines = lines(result);
    expect(resultLines[0]).toBe('# My Title');
    expect(resultLines[1]).toBe('Inserted');
  });

  it('throws with suggestions when heading not found', () => {
    const content = '# Alpha\n## Beta\nText';
    expect(() =>
      insertContentAtPosition(content, 'X', {
        position: 'after-heading',
        heading: 'Gamma',
      })
    ).toThrow(/not found/);
    expect(() =>
      insertContentAtPosition(content, 'X', {
        position: 'after-heading',
        heading: 'Gamma',
      })
    ).toThrow(/Available headings/);
  });

  it('inserts after correct heading when multiple headings exist', () => {
    const content = '# First\nFirst body\n## Second\nSecond body';
    const result = insertContentAtPosition(content, 'After Second', {
      position: 'after-heading',
      heading: 'Second',
    });
    const resultLines = lines(result);
    expect(resultLines[2]).toBe('## Second');
    expect(resultLines[3]).toBe('After Second');
    expect(resultLines[4]).toBe('Second body');
  });
});

// ---------------------------------------------------------------------------
// deleteLines
// ---------------------------------------------------------------------------
describe('deleteLines', () => {
  const fiveLines = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';

  it('deletes a single line', () => {
    const result = deleteLines(fiveLines, 3, 3);
    const resultLines = lines(result);
    expect(resultLines).toEqual(['Line 1', 'Line 2', 'Line 4', 'Line 5']);
  });

  it('deletes a range of lines', () => {
    const result = deleteLines(fiveLines, 2, 4);
    const resultLines = lines(result);
    expect(resultLines).toEqual(['Line 1', 'Line 5']);
  });

  it('throws when startLine < 1', () => {
    expect(() => deleteLines(fiveLines, 0, 2)).toThrow(/Invalid line range/);
  });

  it('throws when startLine > endLine', () => {
    expect(() => deleteLines(fiveLines, 3, 1)).toThrow(/Invalid line range/);
  });

  it('throws when startLine exceeds content length', () => {
    expect(() => deleteLines(fiveLines, 10, 12)).toThrow(/exceeds content length/);
  });

  it('clamps endLine to content length', () => {
    const result = deleteLines(fiveLines, 4, 100);
    const resultLines = lines(result);
    expect(resultLines).toEqual(['Line 1', 'Line 2', 'Line 3']);
  });
});

// ── Issue A: position "start" + heading should insert after the heading ──

describe('insertContentAtPosition – start + heading (Issue A)', () => {
  const noteWithFM = [
    '---',
    'bg-color: amber-50',
    '---',
    '# Daily Note',
    '',
    '## Tasks',
    '* Existing task',
    '',
    '## NotePlan',
    '* Existing item',
  ].join('\n');

  it('inserts after the heading when position=start + heading are both provided', () => {
    // The AI agent expected position="start" + heading="NotePlan" to insert
    // under ## NotePlan. Instead it went to start-of-note (after frontmatter).
    const result = insertContentAtPosition(noteWithFM, '* New item', {
      position: 'start',
      heading: 'NotePlan',
    });

    const resultLines = lines(result);
    // Should be right after ## NotePlan, NOT after frontmatter
    const headingIdx = resultLines.indexOf('## NotePlan');
    expect(headingIdx).toBeGreaterThan(-1);
    expect(resultLines[headingIdx + 1]).toBe('* New item');
  });

  it('still inserts after frontmatter when position=start with no heading', () => {
    // Existing behavior should be preserved when no heading is given
    const result = insertContentAtPosition(noteWithFM, '* Top item', {
      position: 'start',
    });

    const resultLines = lines(result);
    // Should go right after the frontmatter closing ---
    expect(resultLines[3]).toBe('* Top item');
    expect(resultLines[4]).toBe('# Daily Note');
  });
});

// ── Issue B: Fragile frontmatter parsing with thematic breaks ──

describe('insertContentAtPosition – broken frontmatter with thematic break (Issue B)', () => {
  // Scenario: the closing --- of frontmatter was accidentally deleted,
  // but a thematic break --- exists later in the note body.
  const brokenFM = [
    '---',
    'bg-color: amber-50',
    'bg-pattern: dotted',
    // Missing closing ---
    '',
    '## Today\'s Goals',
    '* Goal 1',
    '',
    '---',              // This is a thematic break, NOT frontmatter
    '',
    '## Other Section',
    '* Item A',
  ].join('\n');

  it('does not treat a thematic break as a frontmatter closer', () => {
    // position=start should insert at the top of the note (since frontmatter is broken/unclosed)
    // NOT after the thematic break on line 9
    const result = insertContentAtPosition(brokenFM, '* Inserted', {
      position: 'start',
    });

    const resultLines = lines(result);
    // The inserted content should be near the top, not after the thematic break
    const insertedIdx = resultLines.indexOf('* Inserted');
    const thematicBreakIdx = resultLines.indexOf('---', 1); // skip first ---
    expect(insertedIdx).toBeLessThan(thematicBreakIdx);
  });

  it('correctly inserts at start when frontmatter has no closing delimiter', () => {
    const unclosedFM = [
      '---',
      'title: My Note',
      '',
      '# Content',
      'Some text',
    ].join('\n');

    // No closing --- at all. Should treat as no valid frontmatter,
    // insert at the very top.
    const result = insertContentAtPosition(unclosedFM, '* Top', {
      position: 'start',
    });

    const resultLines = lines(result);
    expect(resultLines[0]).toBe('* Top');
  });

  it('only treats --- as frontmatter closer when it has valid YAML content between delimiters', () => {
    // Frontmatter with valid YAML, then a thematic break later
    const validFMWithBreak = [
      '---',
      'title: Note',
      '---',
      '# Content',
      '',
      '---',  // thematic break
      '',
      '## Section 2',
    ].join('\n');

    const result = insertContentAtPosition(validFMWithBreak, '* Inserted', {
      position: 'start',
    });

    const resultLines = lines(result);
    // Should insert after the real frontmatter (line 3), not after thematic break
    expect(resultLines[3]).toBe('* Inserted');
    expect(resultLines[4]).toBe('# Content');
  });
});
