// sql.js compatibility layer — provides a better-sqlite3-compatible API
// using the pure JS/WASM sql.js library (no native addons).
//
// IMPORTANT: sql.js operates entirely in-memory and does not support WAL mode.
// The host app (NotePlan) uses WAL mode, so we MUST NOT overwrite the main
// database file (which would invalidate WAL/SHM and crash the host app).
//
// Strategy:
//  - READS go through sql.js in-memory DB (fast, loaded at startup after
//    checkpointing the WAL).
//  - WRITES go through BOTH the in-memory DB (for read consistency) AND
//    the native `sqlite3` CLI via execFileSync (for WAL-safe on-disk persistence).
//  - flush() is only used for transaction batches as a fallback.

import initSqlJs from 'sql.js';
import type { Database as SqlJsInternalDb, SqlJsStatic } from 'sql.js';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

let SQL: SqlJsStatic | null = null;

/**
 * Checkpoint the WAL file into the main database using the native sqlite3 CLI.
 * This ensures sql.js (which only reads the main .db file) sees all committed
 * data that the host app wrote via WAL mode.
 * Uses execFileSync (not exec) to prevent shell injection.
 */
function checkpointWal(filePath: string): void {
  const walPath = filePath + '-wal';
  if (!fs.existsSync(walPath)) return;
  try {
    execFileSync('sqlite3', [filePath, 'PRAGMA wal_checkpoint(TRUNCATE);'], {
      timeout: 5000,
      stdio: 'pipe',
    });
  } catch (err) {
    console.error('[noteplan-mcp] WAL checkpoint failed (non-fatal):', err);
  }
}

/**
 * Escape a value for embedding in a SQL string.
 * Only used for our own internal parameters (UUIDs, timestamps, content).
 */
function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return String(value);
  // String: escape single quotes by doubling them
  const str = String(value);
  return "'" + str.replace(/'/g, "''") + "'";
}

/**
 * Replace ? placeholders in SQL with escaped literal values.
 * Used to build a complete SQL statement for the sqlite3 CLI.
 */
function buildSqlWithValues(sql: string, params: unknown[]): string {
  let idx = 0;
  return sql.replace(/\?/g, () => {
    if (idx >= params.length) return 'NULL';
    return escapeSqlValue(params[idx++]);
  });
}

/**
 * Execute a SQL write statement via the native sqlite3 CLI (execFileSync).
 * This properly handles WAL mode unlike sql.js's full-file export.
 * Uses execFileSync to avoid shell injection — arguments are passed directly.
 */
function execSqliteWrite(filePath: string, sql: string): void {
  try {
    execFileSync('sqlite3', [filePath], {
      input: sql + ';\n',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error('[noteplan-mcp] sqlite3 CLI write failed:', err);
    throw err;
  }
}

/**
 * Remove WAL and SHM files (used after full-DB flush for transaction batches).
 */
function removeWalFiles(filePath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const p = filePath + suffix;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // Best-effort cleanup
    }
  }
}

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

    // Apply to in-memory sql.js DB for read consistency
    this.db.run(this.sql, bound as unknown[]);

    const changesResult = this.db.exec('SELECT changes()');
    const lastIdResult = this.db.exec('SELECT last_insert_rowid()');

    // Persist to disk via native sqlite3 CLI (WAL-safe).
    // Skip during transactions — flushTransaction() handles the batch.
    const filePath = this.parentDb.getFilePath();
    if (filePath && !this.parentDb.getIsReadOnly() && !this.parentDb.getInTransaction()) {
      const fullSql = buildSqlWithValues(this.sql, bound);
      execSqliteWrite(filePath, fullSql);
    }

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
      // Checkpoint WAL before reading so sql.js (which only reads the main
      // file) sees all committed data from the host app's WAL writes.
      checkpointWal(filePath);
      const buffer = fs.readFileSync(filePath);
      this.db = new SQL.Database(buffer);
    } else if (!this.isReadOnly) {
      this.db = new SQL.Database();
    } else {
      throw new Error(`Database file not found: ${filePath}`);
    }
  }

  getFilePath(): string | null {
    return this.filePath;
  }

  getIsReadOnly(): boolean {
    return this.isReadOnly;
  }

  getInTransaction(): boolean {
    return this.inTransaction;
  }

  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(this.db, sql, this);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    // exec is used for DDL (CREATE TABLE, ALTER TABLE) — persist via CLI
    if (this.filePath && !this.isReadOnly) {
      try {
        execSqliteWrite(this.filePath, sql);
      } catch {
        // DDL failures are non-fatal (e.g. table already exists)
      }
    }
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
        // Persist the transaction's statements via full-DB flush
        self.flushTransaction();
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

  /**
   * After a transaction commits in-memory, persist to disk.
   * Since individual run() calls skip CLI writes during transactions,
   * we flush the full in-memory state here as a fallback.
   */
  private flushTransaction(): void {
    if (this.filePath && !this.isReadOnly) {
      try {
        // Checkpoint WAL first so we don't lose host app's changes
        checkpointWal(this.filePath);
        const data = this.db.export();
        fs.writeFileSync(this.filePath, Buffer.from(data));
        // Remove stale WAL/SHM since we wrote the full DB
        removeWalFiles(this.filePath);
      } catch (err) {
        console.error('[noteplan-mcp] Failed to flush transaction:', err);
      }
    }
  }

  close(): void {
    this.db.close();
  }

  /** @deprecated No longer needed — writes go through sqlite3 CLI. */
  flush(): void {
    // No-op: individual writes are persisted via sqlite3 CLI in run().
  }

  /** @deprecated No longer needed — writes go through sqlite3 CLI. */
  autoFlush(): void {
    // No-op
  }
}
