import { describe, it, expect } from 'vitest';
import { normalizeFilename, unescapeUnicodeSequences } from './filename-normalize.js';

describe('unescapeUnicodeSequences', () => {
  it('unescapes curly single quotes', () => {
    expect(unescapeUnicodeSequences('The \\u2018Law Code\\u2019')).toBe(
      'The \u2018Law Code\u2019'
    );
  });

  it('unescapes en-dash', () => {
    expect(unescapeUnicodeSequences('Hammurabi \\u2013 Tyndale')).toBe(
      'Hammurabi \u2013 Tyndale'
    );
  });

  it('unescapes em-dash', () => {
    expect(unescapeUnicodeSequences('A \\u2014 B')).toBe('A \u2014 B');
  });

  it('unescapes bullet character', () => {
    expect(unescapeUnicodeSequences('\\u2022 Item')).toBe('\u2022 Item');
  });

  it('unescapes curly double quotes', () => {
    expect(unescapeUnicodeSequences('\\u201CHello\\u201D')).toBe(
      '\u201CHello\u201D'
    );
  });

  it('leaves strings without escape sequences unchanged', () => {
    expect(unescapeUnicodeSequences('Normal text')).toBe('Normal text');
  });

  it('handles multiple escape sequences in one string', () => {
    const input = 'The \\u2018Law Code\\u2019 of Hammurabi \\u2013 Tyndale House';
    const expected = 'The \u2018Law Code\u2019 of Hammurabi \u2013 Tyndale House';
    expect(unescapeUnicodeSequences(input)).toBe(expected);
  });

  it('handles uppercase hex digits', () => {
    expect(unescapeUnicodeSequences('\\u00E9')).toBe('\u00e9');
  });
});

describe('normalizeFilename', () => {
  it('normalizes filename with escaped curly quotes', () => {
    const input = 'Notes/The \\u2018Law Code\\u2019 of Hammurabi \\u2013 Tyndale House.md';
    const expected = 'Notes/The \u2018Law Code\u2019 of Hammurabi \u2013 Tyndale House.md';
    expect(normalizeFilename(input)).toBe(expected);
  });

  it('normalizes filename with escaped bullet', () => {
    const input = 'Notes/\\u2022 My List.md';
    const expected = 'Notes/\u2022 My List.md';
    expect(normalizeFilename(input)).toBe(expected);
  });

  it('leaves normal filenames unchanged', () => {
    expect(normalizeFilename('Notes/My Note.md')).toBe('Notes/My Note.md');
  });

  it('normalizes Unicode NFC form', () => {
    const nfd = 'Notes/Caf\u0065\u0301.md'; // e + combining accent (NFD)
    const nfc = 'Notes/Caf\u00e9.md';       // precomposed é (NFC)
    expect(normalizeFilename(nfd)).toBe(nfc);
  });

  it('handles pipe character in filenames', () => {
    const input = 'Notes/A | B.md';
    expect(normalizeFilename(input)).toBe('Notes/A | B.md');
  });

  it('handles the full reported filename', () => {
    const input = 'Notes/The \\u2018Law Code\\u2019 of Hammurabi \\u2013 Tyndale House.md';
    const result = normalizeFilename(input);
    expect(result).toContain('\u2018');
    expect(result).toContain('\u2019');
    expect(result).toContain('\u2013');
    expect(result).not.toContain('\\u');
  });
});
