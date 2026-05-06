import * as http from 'http';

export interface BridgeConfig {
  storagePath: string;
  fileExtension: string; // e.g. ".txt" or ".md"
  hasYearSubfolders: boolean;
  appVersion: string;
  appBuild: number;
  appName: string;
  isUsingCloudKit: boolean;
}

export interface BridgeFsEntry {
  /** Filename only (last path component). */
  name: string;
  /** Path relative to the listed directory. For non-recursive listings this equals name. */
  path: string;
  isDir: boolean;
  size: number;
  /** ms since epoch. 0 if unavailable. */
  mtime: number;
  /** ms since epoch. 0 if unavailable. */
  ctime: number;
}

export interface BridgeReadResult {
  /** UTF-8 decoded file content. */
  content: string;
  size: number;
  mtime: number;
  ctime: number;
}

export type BridgeStatResult =
  | { exists: false }
  | {
      exists: true;
      isDir: boolean;
      size: number;
      mtime: number;
      ctime: number;
    };

export interface BridgeListOptions {
  recursive?: boolean;
}

export interface BridgeWriteResult {
  ok: true;
  size: number;
  /** ms since epoch. */
  mtime: number;
}

export interface BridgeWriteOptions {
  /** Fail with 409 if the path already exists (matches `wx` flag in fs.writeFile). */
  exclusive?: boolean;
}

/** A `FilterItem` in NotePlan's plist shape. `value` is always a string
 *  (the on-disk format); FilterHelper parses it back into the typed value
 *  client-side via `parseValue()`. */
export interface BridgeFilterItem {
  param: string;
  value: string;
  display: boolean;
}

export interface BridgeFilterEntry {
  name: string;
  modifiedAt?: number;
  createdAt?: number;
}

export interface BridgeFilterTaskMatch {
  file: string;
  line: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

/** Mirrors the MCP's `SQLiteNoteRow`: same field names, same shapes,
 *  so the existing `rowToNote` converter can consume bridge responses. */
export interface BridgeSpaceRow {
  id: string;
  content: string;
  note_type: number;
  title: string;
  filename: string;
  parent: string | null;
  is_dir: number;
  created_at?: string;
  modified_at?: string;
}

export interface BridgeClientOptions {
  defaultTimeoutMs?: number;
  /** Called when a request fails fatally (connection refused, 401, timeout) so the discoverer can drop its cache. */
  onFailure?: () => void;
}

export class BridgeHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BridgeHttpError';
    this.status = status;
  }
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export class BridgeClient {
  readonly host = '127.0.0.1';
  readonly port: number;
  private readonly token: string;
  private readonly defaultTimeoutMs: number;
  private readonly onFailure?: () => void;

  constructor(port: number, token: string, options: BridgeClientOptions = {}) {
    this.port = port;
    this.token = token;
    // 30s default — full-text search across thousands of notes can run
    // several seconds on a cold cache. Reads/stats finish in <100ms so
    // the higher timeout doesn't slow the typical case.
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.onFailure = options.onFailure;
  }

  async config(): Promise<BridgeConfig> {
    return this.requestJson<BridgeConfig>('GET', '/config');
  }

  /** Reachability probe — does NOT trigger onFailure since callers expect false on failure. */
  async health(): Promise<boolean> {
    try {
      const res = await this.requestJson<{ ok: boolean }>('GET', '/health', undefined, 2_000, false);
      return res.ok === true;
    } catch {
      return false;
    }
  }

  /** Read a UTF-8 text file relative to NotePlan's storage root. */
  async read(relativePath: string): Promise<BridgeReadResult> {
    return this.requestJson<BridgeReadResult>(
      'GET',
      `/fs/read?path=${encodeURIComponent(relativePath)}`
    );
  }

  /** Read arbitrary bytes (e.g. attachment images/PDFs) as a Buffer. */
  async readBinary(relativePath: string): Promise<{ data: Buffer; size: number; mtime: number; ctime: number }> {
    const res = await this.requestJson<{ data: string; size: number; mtime: number; ctime: number }>(
      'GET',
      `/fs/read-binary?path=${encodeURIComponent(relativePath)}`,
    );
    return {
      data: Buffer.from(res.data, 'base64'),
      size: res.size,
      mtime: res.mtime,
      ctime: res.ctime,
    };
  }

  /** List a directory relative to NotePlan's storage root. */
  async list(relativePath: string, options: BridgeListOptions = {}): Promise<BridgeFsEntry[]> {
    // encodeURIComponent (spaces → %20), not URLSearchParams (spaces → +) — Swift's removingPercentEncoding doesn't decode +.
    let path = `/fs/list?path=${encodeURIComponent(relativePath)}`;
    if (options.recursive) path += '&recursive=true';
    const res = await this.requestJson<{ entries: BridgeFsEntry[] }>('GET', path);
    return res.entries;
  }

  /** Probe a path's existence and metadata without reading content. */
  async stat(relativePath: string): Promise<BridgeStatResult> {
    return this.requestJson<BridgeStatResult>(
      'GET',
      `/fs/stat?path=${encodeURIComponent(relativePath)}`
    );
  }

  /** Server-side tag scan over Notes/ + Calendar/. One round-trip instead of N. */
  async tags(): Promise<string[]> {
    const res = await this.requestJson<{ tags: string[] }>('GET', '/notes/tags');
    return res.tags;
  }

  /** Write `content` to `relativePath` as UTF-8. Creates parent dirs. */
  async write(
    relativePath: string,
    content: string,
    options: BridgeWriteOptions = {}
  ): Promise<BridgeWriteResult> {
    return this.requestJson<BridgeWriteResult>('POST', '/fs/write', {
      path: relativePath,
      content,
      exclusive: options.exclusive ?? false,
    });
  }

  /** Write raw bytes to `relativePath`. Used for attachment uploads. */
  async writeBinary(relativePath: string, data: Buffer): Promise<BridgeWriteResult> {
    return this.requestJson<BridgeWriteResult>('POST', '/fs/write-binary', {
      path: relativePath,
      data: data.toString('base64'),
    });
  }

  /** Create a directory (recursively by default). */
  async mkdir(relativePath: string, recursive = true): Promise<void> {
    await this.requestJson<{ ok: true }>('POST', '/fs/mkdir', {
      path: relativePath,
      recursive,
    });
  }

  /** Rename or move a file/directory. */
  async rename(fromRelativePath: string, toRelativePath: string): Promise<void> {
    await this.requestJson<{ ok: true }>('POST', '/fs/rename', {
      from: fromRelativePath,
      to: toRelativePath,
    });
  }

  /** Delete a file or directory (recursive for directories). */
  async delete(relativePath: string): Promise<void> {
    await this.requestJson<{ ok: true }>('POST', '/fs/delete', {
      path: relativePath,
    });
  }

  /**
   * Rewrite every `[[from]]` wikilink across the vault to `[[to]]`. Uses
   * NotePlan's indexed reverse-link lookup and posts `.noteTitleChanged`,
   * matching what the in-app rename does. Returns the number of distinct
   * notes updated.
   */
  async rewriteWikilinks(from: string, to: string): Promise<{ updatedCount: number }> {
    const res = await this.requestJson<{ ok: true; updatedCount: number }>(
      'POST',
      '/notes/rewrite-wikilinks',
      { from, to },
    );
    return { updatedCount: res.updatedCount };
  }

  /**
   * Server-side full-text search via NotePlan's SearchHelper (the same
   * engine used by the app's UI and JS plugin bridge). All-words match,
   * case-insensitive, multi-threaded, supports inline operators like
   * `[is:open] meeting`. Returns ripgrep-compatible match records.
   */
  async search(
    pattern: string,
    options: { limit?: number } = {}
  ): Promise<Array<{ file: string; line: number; content: string; matchStart: number; matchEnd: number }>> {
    let path = `/notes/search?q=${encodeURIComponent(pattern)}`;
    if (options.limit !== undefined) path += `&limit=${options.limit}`;
    const res = await this.requestJson<{
      matches: Array<{ file: string; line: number; content: string; matchStart: number; matchEnd: number }>;
    }>('GET', path);
    return res.matches;
  }

  /** Teamspace metadata pulled via NotePlan's `LocalSupabaseDatabase`. The
   *  rows match the MCP's `SQLiteNoteRow` shape so the existing converter
   *  consumes them unchanged.
   */
  async listTeamspaces(): Promise<BridgeSpaceRow[]> {
    const res = await this.requestJson<{ rows: BridgeSpaceRow[] }>('GET', '/spaces/teamspaces');
    return res.rows;
  }

  /** Returns notes AND folders (including @Trash) so the MCP can filter
   *  trash descendants client-side without running SQL. */
  async listSpaceNoteRows(options: { spaceId?: string } = {}): Promise<BridgeSpaceRow[]> {
    const path = options.spaceId
      ? `/spaces/notes?spaceId=${encodeURIComponent(options.spaceId)}`
      : '/spaces/notes';
    const res = await this.requestJson<{ rows: BridgeSpaceRow[] }>('GET', path);
    return res.rows;
  }

  async getSpaceNoteRow(by: { id?: string; filename?: string }): Promise<BridgeSpaceRow | null> {
    const parts: string[] = [];
    if (by.id) parts.push(`id=${encodeURIComponent(by.id)}`);
    if (by.filename) parts.push(`filename=${encodeURIComponent(by.filename)}`);
    if (!parts.length) throw new Error('getSpaceNoteRow requires id or filename');
    try {
      const res = await this.requestJson<{ row: BridgeSpaceRow }>('GET', `/spaces/note?${parts.join('&')}`);
      return res.row;
    } catch (err) {
      if (err instanceof BridgeHttpError && err.status === 404) return null;
      throw err;
    }
  }

  async getSpaceParentRows(id: string): Promise<BridgeSpaceRow[]> {
    const res = await this.requestJson<{ rows: BridgeSpaceRow[] }>(
      'GET',
      `/spaces/parents?id=${encodeURIComponent(id)}`,
    );
    return res.rows;
  }

  async searchSpaceNoteRows(
    pattern: string,
    options: { spaceId?: string; limit?: number } = {},
  ): Promise<BridgeSpaceRow[]> {
    const parts = [`q=${encodeURIComponent(pattern)}`];
    if (options.spaceId) parts.push(`spaceId=${encodeURIComponent(options.spaceId)}`);
    if (options.limit !== undefined) parts.push(`limit=${options.limit}`);
    const res = await this.requestJson<{ rows: BridgeSpaceRow[] }>(
      'GET',
      `/spaces/search?${parts.join('&')}`,
    );
    return res.rows;
  }

  /** Filter file ops — wrap NotePlan's FilterHelper.shared so we never have
   *  to read or write the binary plist directly. */
  async listFilters(): Promise<BridgeFilterEntry[]> {
    const res = await this.requestJson<{ filters: BridgeFilterEntry[] }>('GET', '/filters/list');
    return res.filters;
  }

  async getFilter(name: string): Promise<{ name: string; items: BridgeFilterItem[] } | null> {
    try {
      return await this.requestJson<{ name: string; items: BridgeFilterItem[] }>(
        'GET',
        `/filters/get?name=${encodeURIComponent(name)}`,
      );
    } catch (err) {
      if (err instanceof BridgeHttpError && err.status === 404) return null;
      throw err;
    }
  }

  async saveFilter(input: {
    name: string;
    items: BridgeFilterItem[];
    keyword?: string;
    overwrite?: boolean;
  }): Promise<{ name: string; items: BridgeFilterItem[] }> {
    return this.requestJson<{ name: string; items: BridgeFilterItem[] }>('POST', '/filters/save', input);
  }

  async renameFilter(oldName: string, newName: string): Promise<void> {
    await this.requestJson<{ ok: true }>('POST', '/filters/rename', { oldName, newName });
  }

  async deleteFilter(name: string): Promise<void> {
    await this.requestJson<{ ok: true }>('POST', '/filters/delete', { name });
  }

  /** Run NotePlan's SearchHelper with the named filter and return ripgrep-
   *  shaped task matches. Replaces the MCP's mapFilterToTaskQuery hack. */
  async filterTasks(name: string, options: { limit?: number } = {}): Promise<BridgeFilterTaskMatch[]> {
    const parts = [`name=${encodeURIComponent(name)}`];
    if (options.limit !== undefined) parts.push(`limit=${options.limit}`);
    const res = await this.requestJson<{ filter: string; matches: BridgeFilterTaskMatch[] }>(
      'GET',
      `/filters/tasks?${parts.join('&')}`,
    );
    return res.matches;
  }

  private requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs?: number,
    notifyFailure: boolean = true
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      // 4xx = bridge healthy, request invalid — don't drop the cached client.
      // 5xx / connection / malformed JSON = bridge problem — invalidate.
      const failBridgeUnreachable = (err: Error) => {
        if (settled) return;
        settled = true;
        if (notifyFailure) this.onFailure?.();
        reject(err);
      };
      const failClient = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const succeed = (value: T) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf-8');
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          method,
          path,
          headers: {
            authorization: `Bearer ${this.token}`,
            ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) {
              if (text.length === 0) {
                // 204 / empty body — `T` callers all expect an object,
                // so treat as a bridge bug rather than crashing the JSON parse.
                failBridgeUnreachable(new Error(`bridge ${method} ${path}: empty response body`));
                return;
              }
              try {
                succeed(JSON.parse(text) as T);
              } catch {
                failBridgeUnreachable(new Error(`bridge ${method} ${path}: invalid JSON response`));
              }
              return;
            }
            const err = new BridgeHttpError(
              `bridge ${method} ${path} -> ${status}: ${text.slice(0, 200)}`,
              status,
            );
            if (err.isClientError) {
              failClient(err);
            } else {
              failBridgeUnreachable(err);
            }
          });
        }
      );
      req.on('error', failBridgeUnreachable);
      req.setTimeout(timeoutMs ?? this.defaultTimeoutMs, () => {
        req.destroy(new Error(`bridge ${method} ${path}: timeout`));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }
}
