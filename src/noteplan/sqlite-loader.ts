// sql.js compatibility layer — provides a better-sqlite3-compatible API
// using the pure JS/WASM sql.js library (no native addons).

import initSqlJs from 'sql.js';
import type { Database as SqlJsInternalDb, SqlJsStatic } from 'sql.js';
import * as fs from 'fs';

let SQL: SqlJsStatic | null = null;

/**
 * Initialize the sql.js WASM engine. Must be called once at startup
 * before any database operations.
 */
export async function initSqlite(): Promise<void> {
  if (SQL) return;
  SQL = await initSqlJs();
}

/**
 * Whether sql.js has been initialized.
 */
export function isSqliteAvailable(): boolean {
  return SQL !== null;
}

// ---------------------------------------------------------------------------
// PreparedStatement — mimics better-sqlite3's Statement
// ---------------------------------------------------------------------------

class PreparedStatement {
  constructor(
    private db: SqlJsInternalDb,
    private sql: string,
    private parentDb: SqliteDatabase,
  ) {}

  all(...params: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(this.sql);
    try {
      const bound = toBindParams(params);
      if (bound.length > 0) stmt.bind(bound);
      const results: Record<string, unknown>[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as Record<string, unknown>);
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(this.sql);
    try {
      const bound = toBindParams(params);
      if (bound.length > 0) stmt.bind(bound);
      if (stmt.step()) {
        return stmt.getAsObject() as Record<string, unknown>;
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const bound = toBindParams(params);
    this.db.run(this.sql, bound as unknown[]);

    const changesResult = this.db.exec('SELECT changes()');
    const lastIdResult = this.db.exec('SELECT last_insert_rowid()');

    // Auto-flush writes to disk
    this.parentDb.autoFlush();

    return {
      changes: changesResult.length > 0 ? Number(changesResult[0].values[0][0]) : 0,
      lastInsertRowid: lastIdResult.length > 0 ? Number(lastIdResult[0].values[0][0]) : 0,
    };
  }
}

/**
 * Flatten variadic params into a single array for sql.js bind().
 * better-sqlite3: stmt.all(1, 'hello', 3)
 * sql.js:         stmt.bind([1, 'hello', 3])
 */
function toBindParams(params: unknown[]): unknown[] {
  // Convert undefined to null (sql.js doesn't accept undefined)
  return params.map((p) => (p === undefined ? null : p));
}

// ---------------------------------------------------------------------------
// SqliteDatabase — mimics better-sqlite3's Database
// ---------------------------------------------------------------------------

export interface SqliteDatabaseOptions {
  readonly?: boolean;
}

export class SqliteDatabase {
  private db: SqlJsInternalDb;
  private filePath: string | null;
  private isReadOnly: boolean;
  private inTransaction = false;

  constructor(filePath: string, options?: SqliteDatabaseOptions) {
    if (!SQL) {
      throw new Error('sql.js not initialized. Call initSqlite() first.');
    }

    this.filePath = filePath;
    this.isReadOnly = options?.readonly === true;

    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      this.db = new SQL.Database(buffer);
    } else if (!this.isReadOnly) {
      this.db = new SQL.Database();
    } else {
      throw new Error(`Database file not found: ${filePath}`);
    }
  }

  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(this.db, sql, this);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.autoFlush();
  }

  pragma(pragma: string): unknown {
    try {
      const results = this.db.exec(`PRAGMA ${pragma}`);
      if (results.length === 0) return undefined;
      if (results[0].values.length === 1 && results[0].columns.length === 1) {
        return results[0].values[0][0];
      }
      return results[0].values;
    } catch {
      return undefined;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction<F extends (...args: any[]) => any>(fn: F): F {
    const self = this;
    return ((...args: unknown[]) => {
      self.db.run('BEGIN TRANSACTION');
      self.inTransaction = true;
      try {
        const result = fn(...args);
        self.db.run('COMMIT');
        self.inTransaction = false;
        self.flush();
        return result;
      } catch (err) {
        self.inTransaction = false;
        try {
          self.db.run('ROLLBACK');
        } catch {
          /* ignore rollback errors */
        }
        throw err;
      }
    }) as unknown as F;
  }

  close(): void {
    this.flush();
    this.db.close();
  }

  /** Flush in-memory changes to disk (only if writable). */
  flush(): void {
    if (this.filePath && !this.isReadOnly) {
      try {
        const data = this.db.export();
        fs.writeFileSync(this.filePath, Buffer.from(data));
        console.error(`[noteplan-mcp] Flushed database: ${this.filePath} (${data.byteLength} bytes)`);
      } catch (err) {
        console.error('[noteplan-mcp] Failed to flush database:', err);
      }
    }
  }

  /** Auto-flush: flushes to disk unless inside a transaction. */
  autoFlush(): void {
    if (!this.inTransaction) {
      this.flush();
    }
  }
}
