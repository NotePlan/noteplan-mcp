import { describe, it, expect } from 'vitest';
import { insertContentAtPosition } from './frontmatter-parser.js';

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
