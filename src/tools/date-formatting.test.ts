import { describe, it, expect } from 'vitest';

/**
 * Extracts the toLocalDateString logic so we can test it in isolation.
 * This mirrors the implementation in reminders.ts and events.ts.
 */
function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * The OLD buggy implementation for comparison — always returned UTC.
 */
function toAppleScriptDate_BUGGY(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

describe('toLocalDateString (timezone-safe date formatting)', () => {
  it('formats a date using local time components, not UTC', () => {
    // Create a date at 15:15 local time
    const d = new Date(2026, 2, 10, 15, 15, 0); // March 10, 2026 15:15:00 local
    const result = toLocalDateString(d);
    expect(result).toBe('2026-03-10T15:15:00');
  });

  it('preserves local midnight correctly', () => {
    const d = new Date(2026, 0, 1, 0, 0, 0); // Jan 1, 2026 00:00:00 local
    const result = toLocalDateString(d);
    expect(result).toBe('2026-01-01T00:00:00');
  });

  it('preserves local end-of-day correctly', () => {
    const d = new Date(2026, 11, 31, 23, 59, 59); // Dec 31, 2026 23:59:59 local
    const result = toLocalDateString(d);
    expect(result).toBe('2026-12-31T23:59:59');
  });

  it('handles single-digit months and days with zero-padding', () => {
    const d = new Date(2026, 0, 5, 9, 3, 7); // Jan 5, 2026 09:03:07 local
    const result = toLocalDateString(d);
    expect(result).toBe('2026-01-05T09:03:07');
  });

  it('matches getHours()/getMinutes() — not getUTCHours()/getUTCMinutes()', () => {
    const d = new Date(2026, 2, 10, 15, 15, 0);
    const result = toLocalDateString(d);
    // Verify the hours/minutes in the output match the local time
    expect(result).toContain(`T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  });

  it('differs from the old buggy toISOString approach when not in UTC', () => {
    // This test documents the bug that was fixed.
    // In any timezone with a non-zero UTC offset, the old approach
    // would produce a different time than what the user intended.
    const d = new Date(2026, 2, 10, 15, 15, 0);
    const localResult = toLocalDateString(d);
    const buggyResult = toAppleScriptDate_BUGGY(d);

    // The local result should always have 15:15
    expect(localResult).toBe('2026-03-10T15:15:00');

    // The buggy result uses UTC — only matches local if offset is 0
    const offsetMinutes = d.getTimezoneOffset();
    if (offsetMinutes !== 0) {
      // In non-UTC timezone, the buggy approach gives a different time
      expect(buggyResult).not.toBe(localResult);
    } else {
      // In UTC, both produce the same result
      expect(buggyResult).toBe(localResult);
    }
  });

  it('correctly formats dates parsed from user input strings', () => {
    // Simulates the MCP flow: user sends "2026-03-10 15:15",
    // code does new Date(params.dueDate.replace(' ', 'T'))
    const userInput = '2026-03-10 15:15';
    const d = new Date(userInput.replace(' ', 'T'));
    const result = toLocalDateString(d);

    // The result should preserve the user's intended time
    expect(result).toBe('2026-03-10T15:15:00');
  });

  it('correctly formats dates parsed from ISO input with timezone', () => {
    // User sends "2026-03-10T15:15:00+02:00" (EET)
    // new Date() correctly parses this to 13:15 UTC = 15:15 EET
    // toLocalDateString should output the local time (which depends on
    // the machine's timezone), but importantly NOT the UTC time
    const d = new Date('2026-03-10T15:15:00+02:00');
    const result = toLocalDateString(d);

    // The output should use local time components
    expect(result).toContain(`T${String(d.getHours()).padStart(2, '0')}:`);
  });
});
