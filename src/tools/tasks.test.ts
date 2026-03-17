import { describe, it, expect } from 'vitest';
import { stripRepeatTags, hasRepeatTag } from './tasks.js';

describe('stripRepeatTags', () => {
  it('strips @repeat(X/Y) from a task line', () => {
    expect(stripRepeatTags('* [ ] Buy groceries @repeat(1/10)')).toBe('* [ ] Buy groceries');
  });

  it('strips @repeat(X/Y) with various counts', () => {
    expect(stripRepeatTags('* [ ] Buy groceries @repeat(5/10)')).toBe('* [ ] Buy groceries');
    expect(stripRepeatTags('* [ ] Buy groceries @repeat(10/10)')).toBe('* [ ] Buy groceries');
  });

  it('strips @repeat with date-style values', () => {
    expect(stripRepeatTags('* [ ] Weekly review @repeat(1/1/2025)')).toBe('* [ ] Weekly review');
  });

  it('strips @repeat(daily) style values', () => {
    expect(stripRepeatTags('* [ ] Morning routine @repeat(daily)')).toBe('* [ ] Morning routine');
  });

  it('handles lines without @repeat', () => {
    expect(stripRepeatTags('* [ ] Normal task')).toBe('* [ ] Normal task');
  });

  it('handles multiple @repeat tags', () => {
    expect(stripRepeatTags('* [ ] Task @repeat(1/5) @repeat(2/5)')).toBe('* [ ] Task');
  });

  it('trims surrounding whitespace', () => {
    expect(stripRepeatTags('  * [ ] Task @repeat(1/3)  ')).toBe('* [ ] Task');
  });

  it('preserves other @ tags', () => {
    expect(stripRepeatTags('* [ ] Task @done(2025-01-01) @repeat(1/5)')).toBe('* [ ] Task @done(2025-01-01)');
  });

  it('preserves hashtags', () => {
    expect(stripRepeatTags('* [ ] Task #project @repeat(3/10)')).toBe('* [ ] Task #project');
  });
});

describe('hasRepeatTag', () => {
  it('detects @repeat(X/Y)', () => {
    expect(hasRepeatTag('* [ ] Buy groceries @repeat(1/10)')).toBe(true);
  });

  it('detects @repeat(daily)', () => {
    expect(hasRepeatTag('* [ ] Morning routine @repeat(daily)')).toBe(true);
  });

  it('returns false for lines without @repeat', () => {
    expect(hasRepeatTag('* [ ] Normal task')).toBe(false);
  });

  it('returns false for @repeat without parentheses', () => {
    expect(hasRepeatTag('* [ ] Task @repeat')).toBe(false);
  });

  it('detects @repeat with various content in parentheses', () => {
    expect(hasRepeatTag('- [x] Done task @repeat(3/7)')).toBe(true);
    expect(hasRepeatTag('* [ ] Task @repeat(weekly)')).toBe(true);
  });
});
