import { randomUUID } from 'crypto';
import { isSkipDryRun } from './server-config.js';

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

export type ConfirmationFailureReason = 'missing' | 'invalid' | 'expired' | 'mismatch';

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
  // When NOTEPLAN_SKIP_DRY_RUN is enabled and no token was provided,
  // auto-approve — this eliminates the two-step dryRun → confirm flow.
  if (isSkipDryRun() && (typeof token !== 'string' || token.trim().length === 0)) {
    return { ok: true };
  }

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

/**
 * Render a user-facing message for a confirmation-token failure. Lives here,
 * next to the reason union it renders, so every destructive tool action shares
 * one exhaustive formatting (rather than copy-pasting a per-tool variant).
 * `refreshHint` overrides the default "call with dryRun=true" guidance for
 * tools whose dry-run is reached differently (e.g. an action parameter).
 */
export function confirmationFailureMessage(
  toolName: string,
  reason: ConfirmationFailureReason,
  refreshHint = `Call ${toolName} with dryRun=true to get a new confirmationToken.`
): string {
  switch (reason) {
    case 'missing':
      return `Confirmation token is required for ${toolName}. ${refreshHint}`;
    case 'expired':
      return `Confirmation token is expired for ${toolName}. ${refreshHint}`;
    case 'invalid':
    case 'mismatch':
      return `Confirmation token is invalid for ${toolName}. ${refreshHint}`;
  }
}
