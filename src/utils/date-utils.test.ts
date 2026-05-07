import { describe, expect, it } from 'vitest';
import { normalizePeriodicTitle, isPeriodicCalendarTitle, isCanonicalPeriodicTitle } from './date-utils.js';

describe('normalizePeriodicTitle', () => {
  describe('daily', () => {
    it('keeps already-canonical YYYYMMDD as-is', () => {
      expect(normalizePeriodicTitle('20260507')).toBe('20260507');
    });
    it('normalizes YYYY-MM-DD to YYYYMMDD', () => {
      expect(normalizePeriodicTitle('2026-05-07')).toBe('20260507');
    });
    it('rejects sloppy daily formats (would clobber other matches)', () => {
      // 2026-5-7 is ambiguous (could be partial monthly + day suffix). Reject
      // to keep the rule "either YYYY-MM-DD or YYYYMMDD" predictable.
      expect(normalizePeriodicTitle('2026-5-7')).toBeNull();
    });
  });

  describe('weekly', () => {
    it('zero-pads single-digit weeks', () => {
      expect(normalizePeriodicTitle('2026-W4')).toBe('2026-W04');
    });
    it('uppercases lowercase w', () => {
      expect(normalizePeriodicTitle('2026-w16')).toBe('2026-W16');
    });
    it('keeps double-digit weeks intact', () => {
      expect(normalizePeriodicTitle('2026-W16')).toBe('2026-W16');
    });
  });

  describe('monthly', () => {
    it('zero-pads single-digit months', () => {
      expect(normalizePeriodicTitle('2026-5')).toBe('2026-05');
    });
    it('keeps double-digit months intact', () => {
      expect(normalizePeriodicTitle('2026-05')).toBe('2026-05');
    });
  });

  describe('quarterly', () => {
    it('uppercases lowercase q', () => {
      expect(normalizePeriodicTitle('2026-q2')).toBe('2026-Q2');
    });
    it('keeps Q2 intact', () => {
      expect(normalizePeriodicTitle('2026-Q2')).toBe('2026-Q2');
    });
    it('rejects out-of-range quarters', () => {
      expect(normalizePeriodicTitle('2026-Q5')).toBeNull();
      expect(normalizePeriodicTitle('2026-Q0')).toBeNull();
    });
  });

  describe('yearly', () => {
    it('keeps YYYY as-is', () => {
      expect(normalizePeriodicTitle('2026')).toBe('2026');
    });
  });

  describe('non-periodic', () => {
    it('returns null for project-note titles', () => {
      expect(normalizePeriodicTitle('My Plan for Q2')).toBeNull();
      expect(normalizePeriodicTitle('Untitled')).toBeNull();
    });
    it('returns null for empty / whitespace', () => {
      expect(normalizePeriodicTitle('')).toBeNull();
      expect(normalizePeriodicTitle('   ')).toBeNull();
    });
    it('returns null for short year-like strings', () => {
      expect(normalizePeriodicTitle('202')).toBeNull();
    });
  });

  describe('whitespace tolerance', () => {
    it('trims surrounding whitespace before matching', () => {
      expect(normalizePeriodicTitle('  2026-W4  ')).toBe('2026-W04');
    });
  });
});

describe('isPeriodicCalendarTitle', () => {
  it('matches every canonical form', () => {
    expect(isPeriodicCalendarTitle('20260507')).toBe(true);
    expect(isPeriodicCalendarTitle('2026-05-07')).toBe(true);
    expect(isPeriodicCalendarTitle('2026-W04')).toBe(true);
    expect(isPeriodicCalendarTitle('2026-05')).toBe(true);
    expect(isPeriodicCalendarTitle('2026-Q2')).toBe(true);
    expect(isPeriodicCalendarTitle('2026')).toBe(true);
  });
  it('matches sloppy variants too', () => {
    expect(isPeriodicCalendarTitle('2026-W4')).toBe(true);
    expect(isPeriodicCalendarTitle('2026-q2')).toBe(true);
    expect(isPeriodicCalendarTitle('2026-5')).toBe(true);
  });
  it('rejects project-note titles', () => {
    expect(isPeriodicCalendarTitle('My Project')).toBe(false);
  });
});

describe('isCanonicalPeriodicTitle', () => {
  it('returns true only for already-canonical forms', () => {
    expect(isCanonicalPeriodicTitle('2026-W16')).toBe(true);
    expect(isCanonicalPeriodicTitle('20260507')).toBe(true);
    expect(isCanonicalPeriodicTitle('2026-05')).toBe(true);
    expect(isCanonicalPeriodicTitle('2026-Q2')).toBe(true);
    expect(isCanonicalPeriodicTitle('2026')).toBe(true);
  });
  it('returns false for sloppy variants — these need an explicit calendar signal', () => {
    expect(isCanonicalPeriodicTitle('2026-W4')).toBe(false);
    expect(isCanonicalPeriodicTitle('2026-q2')).toBe(false);
    expect(isCanonicalPeriodicTitle('2026-5')).toBe(false);
    expect(isCanonicalPeriodicTitle('2026-05-07')).toBe(false); // normalizes to YYYYMMDD
  });
  it('returns false for non-periodic strings', () => {
    expect(isCanonicalPeriodicTitle('My Project')).toBe(false);
    expect(isCanonicalPeriodicTitle('')).toBe(false);
  });
});
