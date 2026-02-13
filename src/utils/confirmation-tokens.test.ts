import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  issueConfirmationToken,
  validateAndConsumeConfirmationToken,
} from './confirmation-tokens.js';

// A UUID v4 regex for validation
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ISO 8601 date-time regex (simplified but sufficient)
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

// Helper to create a simple context
function ctx(
  tool = 'deleteNote',
  target = '/notes/test.md',
  action = 'delete'
) {
  return { tool, target, action };
}

describe('issueConfirmationToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a UUID token string and an ISO date string', () => {
    const result = issueConfirmationToken(ctx());

    expect(result).toHaveProperty('confirmationToken');
    expect(result).toHaveProperty('confirmationExpiresAt');
    expect(result.confirmationToken).toMatch(UUID_RE);
    expect(result.confirmationExpiresAt).toMatch(ISO_DATE_RE);
  });

  it('returns a unique token on each call', () => {
    const result1 = issueConfirmationToken(ctx());
    const result2 = issueConfirmationToken(ctx());

    expect(result1.confirmationToken).not.toBe(result2.confirmationToken);

    // Consume both so they don't leak into other tests
    validateAndConsumeConfirmationToken(result1.confirmationToken, ctx());
    validateAndConsumeConfirmationToken(result2.confirmationToken, ctx());
  });

  it('defaults to ~10 minutes expiry from now', () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    vi.setSystemTime(now);

    const result = issueConfirmationToken(ctx());
    const expiresAt = new Date(result.confirmationExpiresAt).getTime();
    const expectedExpiry = now.getTime() + 10 * 60 * 1000;

    expect(expiresAt).toBe(expectedExpiry);

    // Clean up
    validateAndConsumeConfirmationToken(result.confirmationToken, ctx());
  });

  it('respects a custom TTL', () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    vi.setSystemTime(now);

    const customTtlMs = 30_000; // 30 seconds
    const result = issueConfirmationToken(ctx(), customTtlMs);
    const expiresAt = new Date(result.confirmationExpiresAt).getTime();
    const expectedExpiry = now.getTime() + customTtlMs;

    expect(expiresAt).toBe(expectedExpiry);

    // Clean up
    validateAndConsumeConfirmationToken(result.confirmationToken, ctx());
  });
});

describe('validateAndConsumeConfirmationToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── missing ──────────────────────────────────────────────────────

  it('returns reason "missing" for undefined token', () => {
    const result = validateAndConsumeConfirmationToken(undefined, ctx());
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('returns reason "missing" for null token', () => {
    const result = validateAndConsumeConfirmationToken(null, ctx());
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('returns reason "missing" for empty string token', () => {
    const result = validateAndConsumeConfirmationToken('', ctx());
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('returns reason "missing" for whitespace-only string token', () => {
    const result = validateAndConsumeConfirmationToken('   \t\n  ', ctx());
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('returns reason "missing" for a number (non-string) token', () => {
    const result = validateAndConsumeConfirmationToken(42, ctx());
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  // ── invalid ──────────────────────────────────────────────────────

  it('returns reason "invalid" for a random UUID that was never issued', () => {
    const result = validateAndConsumeConfirmationToken(
      'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
      ctx()
    );
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  // ── expired ──────────────────────────────────────────────────────

  it('returns a failure reason when token TTL has elapsed', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));

    const { confirmationToken } = issueConfirmationToken(ctx(), 1);

    // Advance time past the 1ms TTL
    vi.advanceTimersByTime(2);

    const result = validateAndConsumeConfirmationToken(
      confirmationToken,
      ctx()
    );
    // cleanupExpired runs before the per-token check and removes expired
    // tokens from the store, so the token is already gone by the time
    // the lookup happens. The result is 'invalid' (token not found)
    // rather than 'expired' (token found but past its TTL).
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('reason');
    // The token must not validate successfully
    expect((result as { ok: false; reason: string }).reason).toMatch(
      /^(expired|invalid)$/
    );
  });

  // ── mismatch ─────────────────────────────────────────────────────

  it('returns reason "mismatch" when tool differs', () => {
    const { confirmationToken } = issueConfirmationToken(
      ctx('deleteNote', '/notes/test.md', 'delete')
    );

    const result = validateAndConsumeConfirmationToken(
      confirmationToken,
      ctx('moveNote', '/notes/test.md', 'delete')
    );
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('returns reason "mismatch" when target differs', () => {
    const { confirmationToken } = issueConfirmationToken(
      ctx('deleteNote', '/notes/alpha.md', 'delete')
    );

    const result = validateAndConsumeConfirmationToken(
      confirmationToken,
      ctx('deleteNote', '/notes/beta.md', 'delete')
    );
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('returns reason "mismatch" when action differs', () => {
    const { confirmationToken } = issueConfirmationToken(
      ctx('deleteNote', '/notes/test.md', 'delete')
    );

    const result = validateAndConsumeConfirmationToken(
      confirmationToken,
      ctx('deleteNote', '/notes/test.md', 'move')
    );
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  // ── success ──────────────────────────────────────────────────────

  it('returns { ok: true } for a valid token with matching context', () => {
    const context = ctx('deleteNote', '/notes/test.md', 'delete');
    const { confirmationToken } = issueConfirmationToken(context);

    const result = validateAndConsumeConfirmationToken(
      confirmationToken,
      context
    );
    expect(result).toEqual({ ok: true });
  });

  // ── consume-once ─────────────────────────────────────────────────

  it('consumes the token on success so a second validation returns "invalid"', () => {
    const context = ctx('deleteNote', '/notes/test.md', 'delete');
    const { confirmationToken } = issueConfirmationToken(context);

    const first = validateAndConsumeConfirmationToken(
      confirmationToken,
      context
    );
    expect(first).toEqual({ ok: true });

    const second = validateAndConsumeConfirmationToken(
      confirmationToken,
      context
    );
    expect(second).toEqual({ ok: false, reason: 'invalid' });
  });

  // ── case-insensitive ─────────────────────────────────────────────

  it('normalizes context case: issuing with mixed case matches lowercase validation', () => {
    const { confirmationToken } = issueConfirmationToken(
      ctx('DeleteNote', '/Notes/Test.MD', 'DELETE')
    );

    const result = validateAndConsumeConfirmationToken(
      confirmationToken,
      ctx('deletenote', '/notes/test.md', 'delete')
    );
    expect(result).toEqual({ ok: true });
  });

  // ── whitespace-tolerant ──────────────────────────────────────────

  it('normalizes context whitespace: issuing with padded strings matches trimmed validation', () => {
    const { confirmationToken } = issueConfirmationToken(
      ctx('  deleteNote  ', '  /notes/test.md  ', '  delete  ')
    );

    const result = validateAndConsumeConfirmationToken(
      confirmationToken,
      ctx('deletenote', '/notes/test.md', 'delete')
    );
    expect(result).toEqual({ ok: true });
  });

  // ── mismatch consumed ────────────────────────────────────────────

  it('deletes the token after a mismatch so a subsequent validation returns "invalid"', () => {
    const { confirmationToken } = issueConfirmationToken(
      ctx('deleteNote', '/notes/test.md', 'delete')
    );

    // First attempt: wrong context -> mismatch
    const mismatch = validateAndConsumeConfirmationToken(
      confirmationToken,
      ctx('moveNote', '/notes/other.md', 'move')
    );
    expect(mismatch).toEqual({ ok: false, reason: 'mismatch' });

    // Second attempt: even with correct context -> invalid (consumed)
    const retry = validateAndConsumeConfirmationToken(
      confirmationToken,
      ctx('deleteNote', '/notes/test.md', 'delete')
    );
    expect(retry).toEqual({ ok: false, reason: 'invalid' });
  });
});
