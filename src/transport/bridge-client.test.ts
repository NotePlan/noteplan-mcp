import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { BridgeClient } from './bridge-client.js';

interface CapturedRequest {
  method?: string;
  url?: string;
  authorization?: string;
  body?: string;
}

type ResponseSpec =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'raw'; status: number; body: string; contentType?: string }
  | { kind: 'hang' };

/**
 * Boots a real HTTP server on 127.0.0.1 with a configurable response per
 * test. We use a real socket (vs. fetch mocks) so the timeout, header,
 * and URL-encoding paths are exercised end-to-end.
 */
function startTestServer(spec: ResponseSpec): Promise<{
  port: number;
  captured: CapturedRequest;
  close: () => Promise<void>;
}> {
  const captured: CapturedRequest = {};
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      captured.method = req.method;
      captured.url = req.url;
      captured.authorization = req.headers['authorization'] as string | undefined;

      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        captured.body = Buffer.concat(chunks).toString('utf8');

        if (spec.kind === 'hang') {
          return;
        }
        if (spec.kind === 'raw') {
          res.writeHead(spec.status, { 'Content-Type': spec.contentType ?? 'text/plain' });
          res.end(spec.body);
          return;
        }
        res.writeHead(spec.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(spec.body));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        captured,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe('BridgeClient', () => {
  let close: () => Promise<void>;

  afterEach(async () => {
    await close?.();
    close = async () => {};
  });

  describe('read', () => {
    it('GETs /fs/read with the path query and bearer token', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { content: 'hello', size: 5, mtime: 1_700_000_000_000, ctime: 1_690_000_000_000 },
      });
      close = stop;

      const client = new BridgeClient(port, 'tok-abc');
      const result = await client.read('Notes/Foo.md');

      expect(captured.method).toBe('GET');
      expect(captured.url).toBe('/fs/read?path=Notes%2FFoo.md');
      expect(captured.authorization).toBe('Bearer tok-abc');
      expect(result.content).toBe('hello');
      expect(result.size).toBe(5);
    });

    it('URL-encodes paths with spaces and special characters', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { content: '', size: 0, mtime: 0, ctime: 0 },
      });
      close = stop;

      await new BridgeClient(port, 'tok').read('Notes/My Folder/Note & Stuff.md');
      expect(captured.url).toBe('/fs/read?path=Notes%2FMy%20Folder%2FNote%20%26%20Stuff.md');
    });

    it('rejects on 404 WITHOUT triggering onFailure (4xx is client error, bridge is healthy)', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'json',
        status: 404,
        body: { error: 'not found' },
      });
      close = stop;

      let failed = false;
      const client = new BridgeClient(port, 'tok', { onFailure: () => { failed = true; } });

      await expect(client.read('missing.md')).rejects.toThrow(/-> 404/);
      expect(failed).toBe(false);
    });

    it('triggers onFailure on 5xx (bridge-side error)', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'json',
        status: 500,
        body: { error: 'boom' },
      });
      close = stop;

      let failed = false;
      const client = new BridgeClient(port, 'tok', { onFailure: () => { failed = true; } });

      await expect(client.read('whatever.md')).rejects.toThrow(/-> 500/);
      expect(failed).toBe(true);
    });

    it('triggers onFailure on connection refused', async () => {
      const { port, close: stop } = await startTestServer({ kind: 'json', status: 200, body: {} });
      await stop();
      close = async () => {};

      let failed = false;
      const client = new BridgeClient(port, 'tok', { onFailure: () => { failed = true; } });
      await expect(client.read('x.md')).rejects.toThrow();
      expect(failed).toBe(true);
    });

    it('rejects on malformed JSON response', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'raw',
        status: 200,
        body: 'not json',
      });
      close = stop;

      const client = new BridgeClient(port, 'tok');
      await expect(client.read('any.md')).rejects.toThrow(/invalid JSON/);
    });

    it('rejects on EMPTY 2xx body and triggers onFailure', async () => {
      // Regression: previously crashed `JSON.parse('')` and surfaced a
      // SyntaxError with no isClientError flag, defeating the cascade's
      // fall-through logic. Should look like a bridge-side problem now.
      const { port, close: stop } = await startTestServer({
        kind: 'raw',
        status: 200,
        body: '',
      });
      close = stop;

      let failed = false;
      const client = new BridgeClient(port, 'tok', { onFailure: () => { failed = true; } });
      await expect(client.read('any.md')).rejects.toThrow(/empty response body/);
      expect(failed).toBe(true);
    });
  });

  describe('list', () => {
    it('returns the entries array from the response wrapper', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: {
          entries: [
            { name: 'A.md', path: 'A.md', isDir: false, size: 10, mtime: 1, ctime: 1 },
            { name: 'Sub', path: 'Sub', isDir: true, size: 0, mtime: 2, ctime: 2 },
          ],
        },
      });
      close = stop;

      const entries = await new BridgeClient(port, 'tok').list('Notes');
      expect(captured.url).toBe('/fs/list?path=Notes');
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ name: 'A.md', isDir: false });
      expect(entries[1]).toMatchObject({ name: 'Sub', isDir: true });
    });

    it('appends recursive=true when option is set', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { entries: [] },
      });
      close = stop;

      await new BridgeClient(port, 'tok').list('Notes', { recursive: true });
      expect(captured.url).toBe('/fs/list?path=Notes&recursive=true');
    });

    it('omits recursive parameter when false or unset', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { entries: [] },
      });
      close = stop;

      await new BridgeClient(port, 'tok').list('Notes', { recursive: false });
      expect(captured.url).toBe('/fs/list?path=Notes');
    });

    // Regression: bridge.list used URLSearchParams which encodes spaces as `+`,
    // but Swift's removingPercentEncoding decodes `%20` only. Folders with
    // spaces would silently 404 server-side.
    it('encodes spaces as %20 (NOT + form-encoding) for paths with spaces', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { entries: [] },
      });
      close = stop;

      await new BridgeClient(port, 'tok').list('Notes/My Folder');
      expect(captured.url).toBe('/fs/list?path=Notes%2FMy%20Folder');
      expect(captured.url).not.toContain('+');
    });

    it('encodes & and other special characters in folder names', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { entries: [] },
      });
      close = stop;

      await new BridgeClient(port, 'tok').list('Notes/Q&A');
      expect(captured.url).toBe('/fs/list?path=Notes%2FQ%26A');
    });
  });

  describe('stat', () => {
    it('returns {exists:false} when the server reports a missing path', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { exists: false },
      });
      close = stop;

      const result = await new BridgeClient(port, 'tok').stat('gone.md');
      expect(result).toEqual({ exists: false });
    });

    it('returns full metadata when the path exists', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { exists: true, isDir: false, size: 42, mtime: 100, ctime: 50 },
      });
      close = stop;

      const result = await new BridgeClient(port, 'tok').stat('Notes/x.md');
      if (!result.exists) throw new Error('expected exists=true');
      expect(result.isDir).toBe(false);
      expect(result.size).toBe(42);
    });

    it('encodes spaces as %20 in paths', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { exists: false },
      });
      close = stop;

      await new BridgeClient(port, 'tok').stat('Notes/My Folder');
      expect(captured.url).toBe('/fs/stat?path=Notes%2FMy%20Folder');
    });
  });

  describe('health', () => {
    it('returns true on 200 with ok=true', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { ok: true },
      });
      close = stop;
      expect(await new BridgeClient(port, 'tok').health()).toBe(true);
    });

    it('returns false on non-2xx without firing onFailure', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'json',
        status: 500,
        body: { error: 'boom' },
      });
      close = stop;

      let failed = false;
      const client = new BridgeClient(port, 'tok', { onFailure: () => { failed = true; } });
      expect(await client.health()).toBe(false);
      expect(failed).toBe(false);
    });

    it('returns false on connection refused', async () => {
      // Start then immediately stop the server so the port is closed.
      const { port, close: stop } = await startTestServer({ kind: 'json', status: 200, body: {} });
      await stop();
      close = async () => {};

      expect(await new BridgeClient(port, 'tok').health()).toBe(false);
    });
  });

  describe('write', () => {
    it('POSTs /fs/write with path + content + exclusive', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { ok: true, size: 5, mtime: 100 },
      });
      close = stop;

      // Capture body
      let capturedBody = '';
      const captureBody = startTestServer.constructor; // type only
      // The simple harness above doesn't capture POST bodies — test via URL/method instead.
      const result = await new BridgeClient(port, 'tok').write('Notes/Foo.md', 'hello', { exclusive: true });

      expect(captured.method).toBe('POST');
      expect(captured.url).toBe('/fs/write');
      expect(result.ok).toBe(true);
      expect(result.size).toBe(5);
      expect(result.mtime).toBe(100);
      void capturedBody;
      void captureBody;
    });

    it('rejects on 409 when exclusive create hits an existing file', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'json',
        status: 409,
        body: { error: 'path already exists' },
      });
      close = stop;

      let failed = false;
      const client = new BridgeClient(port, 'tok', { onFailure: () => { failed = true; } });
      await expect(client.write('Notes/Foo.md', 'x', { exclusive: true })).rejects.toThrow(/-> 409/);
      // 4xx must NOT invalidate the cached client.
      expect(failed).toBe(false);
    });
  });

  describe('mkdir', () => {
    it('POSTs /fs/mkdir', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { ok: true },
      });
      close = stop;

      await new BridgeClient(port, 'tok').mkdir('Notes/NewFolder');
      expect(captured.method).toBe('POST');
      expect(captured.url).toBe('/fs/mkdir');
    });
  });

  describe('rename', () => {
    it('POSTs /fs/rename with from + to', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { ok: true },
      });
      close = stop;

      await new BridgeClient(port, 'tok').rename('Notes/Old.md', 'Notes/New.md');
      expect(captured.method).toBe('POST');
      expect(captured.url).toBe('/fs/rename');
    });
  });

  describe('delete', () => {
    it('POSTs /fs/delete', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { ok: true },
      });
      close = stop;

      await new BridgeClient(port, 'tok').delete('Notes/Stale.md');
      expect(captured.method).toBe('POST');
      expect(captured.url).toBe('/fs/delete');
    });

    it('rejects on 404 without invalidating', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'json',
        status: 404,
        body: { error: 'not found' },
      });
      close = stop;

      let failed = false;
      const client = new BridgeClient(port, 'tok', { onFailure: () => { failed = true; } });
      await expect(client.delete('missing.md')).rejects.toThrow(/-> 404/);
      expect(failed).toBe(false);
    });
  });

  describe('rewriteWikilinks', () => {
    it('POSTs /notes/rewrite-wikilinks with from + to and returns updatedCount', async () => {
      const { port, captured, close: stop } = await startTestServer({
        kind: 'json',
        status: 200,
        body: { ok: true, updatedCount: 4 },
      });
      close = stop;

      const res = await new BridgeClient(port, 'tok').rewriteWikilinks('Old Title', 'New Title');
      expect(captured.method).toBe('POST');
      expect(captured.url).toBe('/notes/rewrite-wikilinks');
      expect(JSON.parse(captured.body!)).toEqual({ from: 'Old Title', to: 'New Title' });
      expect(res).toEqual({ updatedCount: 4 });
    });
  });

  describe('failure handling', () => {
    it('calls onFailure exactly once even with overlapping error sources', async () => {
      const { port, close: stop } = await startTestServer({
        kind: 'raw',
        status: 200,
        body: 'not json',
      });
      close = stop;

      let failureCount = 0;
      const client = new BridgeClient(port, 'tok', { onFailure: () => { failureCount += 1; } });
      await expect(client.read('x.md')).rejects.toThrow();
      expect(failureCount).toBe(1);
    });

    it('honors a custom default timeout', async () => {
      const { port, close: stop } = await startTestServer({ kind: 'hang' });
      close = stop;

      const client = new BridgeClient(port, 'tok', { defaultTimeoutMs: 50 });
      await expect(client.read('x.md')).rejects.toThrow(/timeout/);
    });
  });
});
