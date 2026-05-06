import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BridgeHttpError } from './bridge-client.js';

// Mock bridge-availability so each test controls what `getBridgeClient`
// returns. The cascade helper imports it via dynamic resolution; vi.mock
// hoists above the import below.
vi.mock('./bridge-availability.js', () => ({
  getBridgeClient: vi.fn(),
}));

import { bridgeOrFallback } from './bridge-cascade.js';
import { getBridgeClient } from './bridge-availability.js';

const mockedGetBridgeClient = vi.mocked(getBridgeClient);

beforeEach(() => {
  mockedGetBridgeClient.mockReset();
});

// A minimal stand-in for BridgeClient. The cascade only ever passes it
// to the caller's bridgeOp, which we control in each test.
const fakeClient = {} as never;

function transportError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('bridgeOrFallback', () => {
  describe('happy path', () => {
    it('returns the bridge result when the bridge succeeds', async () => {
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const result = await bridgeOrFallback(
        async () => 'from-bridge',
        () => 'from-fallback',
      );
      expect(result).toBe('from-bridge');
    });

    it('treats a bridgeOp resolving with `null` as success (not fall through)', async () => {
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const fallback = vi.fn(() => 'fallback-was-called');
      const result = await bridgeOrFallback<string | null>(async () => null, fallback);
      expect(result).toBeNull();
      expect(fallback).not.toHaveBeenCalled();
    });

    it('treats a bridgeOp resolving with `undefined` as success (not fall through)', async () => {
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const fallback = vi.fn(() => 'fallback-was-called');
      const result = await bridgeOrFallback<string | undefined>(async () => undefined, fallback);
      expect(result).toBeUndefined();
      expect(fallback).not.toHaveBeenCalled();
    });
  });

  describe('no bridge available', () => {
    it('runs the fallback when getBridgeClient resolves null', async () => {
      mockedGetBridgeClient.mockResolvedValue(null);
      const result = await bridgeOrFallback(
        async () => 'from-bridge',
        () => 'from-fallback',
      );
      expect(result).toBe('from-fallback');
    });

    it('runs the fallback even when getBridgeClient itself throws', async () => {
      mockedGetBridgeClient.mockRejectedValue(new Error('discovery exploded'));
      const result = await bridgeOrFallback(
        async () => 'from-bridge',
        () => 'from-fallback',
      );
      expect(result).toBe('from-fallback');
    });

    it('supports a sync fallback', async () => {
      mockedGetBridgeClient.mockResolvedValue(null);
      const result = await bridgeOrFallback(
        async () => 'from-bridge',
        () => 'sync-fallback',
      );
      expect(result).toBe('sync-fallback');
    });

    it('supports an async fallback', async () => {
      mockedGetBridgeClient.mockResolvedValue(null);
      const result = await bridgeOrFallback(
        async () => 'from-bridge',
        async () => 'async-fallback',
      );
      expect(result).toBe('async-fallback');
    });
  });

  describe('error policy', () => {
    it('propagates a 4xx BridgeHttpError WITHOUT calling the fallback', async () => {
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const fallback = vi.fn();
      await expect(
        bridgeOrFallback(
          async () => {
            throw new BridgeHttpError('bad request', 400);
          },
          fallback,
        ),
      ).rejects.toBeInstanceOf(BridgeHttpError);
      expect(fallback).not.toHaveBeenCalled();
    });

    it('propagates a 404 BridgeHttpError WITHOUT calling the fallback', async () => {
      // 404 is the most common 4xx and the one callers usually special-case.
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const fallback = vi.fn();
      await expect(
        bridgeOrFallback(
          async () => {
            throw new BridgeHttpError('not found', 404);
          },
          fallback,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(fallback).not.toHaveBeenCalled();
    });

    it('falls back on a 5xx BridgeHttpError', async () => {
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const result = await bridgeOrFallback(
        async () => {
          throw new BridgeHttpError('server error', 500);
        },
        () => 'fallback',
      );
      expect(result).toBe('fallback');
    });

    it('falls back on ECONNREFUSED (bridge crashed or port changed)', async () => {
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const result = await bridgeOrFallback(
        async () => {
          throw transportError('ECONNREFUSED');
        },
        () => 'fallback',
      );
      expect(result).toBe('fallback');
    });

    it('falls back on ETIMEDOUT', async () => {
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const result = await bridgeOrFallback(
        async () => {
          throw transportError('ETIMEDOUT');
        },
        () => 'fallback',
      );
      expect(result).toBe('fallback');
    });

    it('falls back on ECONNRESET / ENOTFOUND / EHOSTUNREACH', async () => {
      for (const code of ['ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']) {
        mockedGetBridgeClient.mockResolvedValue(fakeClient);
        const result = await bridgeOrFallback(
          async () => {
            throw transportError(code);
          },
          () => `fallback-after-${code}`,
        );
        expect(result).toBe(`fallback-after-${code}`);
      }
    });

    it('PROPAGATES non-BridgeHttpError, non-transport errors thrown by bridgeOp', async () => {
      // E.g. caller throws `new Error("Filter already exists")` after seeing a 409.
      // That's a logical error, not a transport problem — the fallback would mask it.
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const fallback = vi.fn();
      await expect(
        bridgeOrFallback(
          async () => {
            throw new Error('Filter already exists');
          },
          fallback,
        ),
      ).rejects.toThrow('Filter already exists');
      expect(fallback).not.toHaveBeenCalled();
    });

    it('PROPAGATES TypeError thrown inside bridgeOp', async () => {
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const fallback = vi.fn();
      await expect(
        bridgeOrFallback(
          async () => {
            throw new TypeError('cannot read property of undefined');
          },
          fallback,
        ),
      ).rejects.toBeInstanceOf(TypeError);
      expect(fallback).not.toHaveBeenCalled();
    });
  });

  describe('integration with BridgeHttpError.isClientError', () => {
    it.each([
      [400, true],
      [401, true],
      [404, true],
      [409, true],
      [499, true],
      [500, false],
      [502, false],
      [503, false],
    ])('status %i → propagates=%s', async (status, shouldPropagate) => {
      mockedGetBridgeClient.mockResolvedValue(fakeClient);
      const fallback = vi.fn(() => 'fallback');
      const op = async (): Promise<string> => {
        throw new BridgeHttpError(`status ${status}`, status);
      };
      if (shouldPropagate) {
        await expect(bridgeOrFallback(op, fallback)).rejects.toMatchObject({ status });
        expect(fallback).not.toHaveBeenCalled();
      } else {
        const result = await bridgeOrFallback(op, fallback);
        expect(result).toBe('fallback');
        expect(fallback).toHaveBeenCalledOnce();
      }
    });
  });
});
