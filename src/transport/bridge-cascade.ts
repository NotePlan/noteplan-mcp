import { getBridgeClient } from './bridge-availability.js';
import { BridgeHttpError, type BridgeClient } from './bridge-client.js';

/**
 * Run `bridgeOp` against the live bridge when one is available; otherwise
 * fall through to `fallback`.
 *
 * Note: `bridgeOp` resolving with `undefined` is treated as "success",
 * not "fall back" — throw to fall back.
 *
 * Error policy:
 *  - 4xx HTTP from bridge → propagate (bridge is healthy, the request is
 *    invalid; running the fallback would mask the real error).
 *  - 5xx / malformed JSON / empty body / timeout / connection refused
 *    → silently fall back (transport problem, not a logic error).
 *  - Any other thrown error from `bridgeOp` → propagate (it's a logical
 *    error the caller turned into an exception).
 */
export async function bridgeOrFallback<T>(
  bridgeOp: (client: BridgeClient) => Promise<T>,
  fallback: () => Promise<T> | T,
): Promise<T> {
  let client: BridgeClient | null = null;
  try {
    client = await getBridgeClient();
  } catch {
    // Defensive: getBridgeClient should never throw, but if discovery
    // raises a previously-unseen exception, fall back rather than fail.
  }
  if (client) {
    try {
      return await bridgeOp(client);
    } catch (err) {
      if (err instanceof BridgeHttpError) {
        if (err.isClientError) throw err;
        // 5xx / malformed JSON / empty body — fall through.
      } else if (isTransportError(err)) {
        // ECONNREFUSED / ECONNRESET / ETIMEDOUT / ENOTFOUND / EHOSTUNREACH
        // — bridge crashed or port changed; let the fallback have it.
      } else {
        throw err;
      }
    }
  }
  return fallback();
}

const TRANSPORT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

function isTransportError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code);
}
