import { AsyncLocalStorage } from 'node:async_hooks';

export type BackendKind = 'bridge' | 'fallback';

interface BackendContext {
  used: Set<BackendKind>;
}

const storage = new AsyncLocalStorage<BackendContext>();

/** Run `fn` inside a fresh backend-tracking scope. `recordBackend` calls
 *  made anywhere in the async tree below `fn` accumulate into the same set,
 *  readable via `getCurrentBackends()` until `fn` resolves. */
export function withBackendTracking<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ used: new Set() }, fn);
}

/** Record that a bridge or fallback path executed. No-op outside a tracking scope. */
export function recordBackend(kind: BackendKind): void {
  storage.getStore()?.used.add(kind);
}

/** Backends touched so far in the current tracking scope. `[]` outside one. */
export function getCurrentBackends(): BackendKind[] {
  const ctx = storage.getStore();
  return ctx ? Array.from(ctx.used) : [];
}
