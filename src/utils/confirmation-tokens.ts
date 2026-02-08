import { randomUUID } from 'crypto';

const DEFAULT_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

type ConfirmationContext = {
  tool: string;
  target: string;
  action: string;
};

type StoredConfirmation = {
  context: ConfirmationContext;
  expiresAt: number;
};

type ConfirmationFailureReason = 'missing' | 'invalid' | 'expired' | 'mismatch';

export type ConfirmationValidationResult =
  | { ok: true }
  | { ok: false; reason: ConfirmationFailureReason };

const confirmationStore = new Map<string, StoredConfirmation>();

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeContext(context: ConfirmationContext): ConfirmationContext {
  return {
    tool: normalize(context.tool),
    target: normalize(context.target),
    action: normalize(context.action),
  };
}

function cleanupExpired(nowMs: number): void {
  for (const [token, stored] of confirmationStore.entries()) {
    if (stored.expiresAt <= nowMs) {
      confirmationStore.delete(token);
    }
  }
}

export function issueConfirmationToken(
  context: ConfirmationContext,
  ttlMs = DEFAULT_CONFIRMATION_TTL_MS
): { confirmationToken: string; confirmationExpiresAt: string } {
  const token = randomUUID();
  const expiresAtMs = Date.now() + ttlMs;
  confirmationStore.set(token, {
    context: normalizeContext(context),
    expiresAt: expiresAtMs,
  });
  return {
    confirmationToken: token,
    confirmationExpiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function validateAndConsumeConfirmationToken(
  token: unknown,
  context: ConfirmationContext
): ConfirmationValidationResult {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return { ok: false, reason: 'missing' };
  }

  const nowMs = Date.now();
  cleanupExpired(nowMs);

  const stored = confirmationStore.get(token);
  if (!stored) {
    return { ok: false, reason: 'invalid' };
  }

  if (stored.expiresAt <= nowMs) {
    confirmationStore.delete(token);
    return { ok: false, reason: 'expired' };
  }

  const expected = normalizeContext(context);
  const matches =
    stored.context.tool === expected.tool &&
    stored.context.target === expected.target &&
    stored.context.action === expected.action;

  if (!matches) {
    confirmationStore.delete(token);
    return { ok: false, reason: 'mismatch' };
  }

  confirmationStore.delete(token);
  return { ok: true };
}
