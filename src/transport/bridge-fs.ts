import * as fs from 'fs';
import * as path from 'path';
import { getNotePlanPath } from '../noteplan/file-reader.js';
import { bridgeOrFallback } from './bridge-cascade.js';

export interface StatInfo {
  exists: boolean;
  isDir: boolean;
  size: number;
  mtime: Date;
  ctime: Date;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

const ZERO_DATE = new Date(0);
const MISSING: StatInfo = { exists: false, isDir: false, size: 0, mtime: ZERO_DATE, ctime: ZERO_DATE };

export function toRelative(absolutePath: string): string {
  const rel = path.relative(getNotePlanPath(), absolutePath);
  return rel === '' ? '.' : rel;
}

export async function readFileUtf8(absolutePath: string): Promise<string | null> {
  try {
    return await bridgeOrFallback(
      async (c) => (await c.read(toRelative(absolutePath))).content,
      async () => fs.promises.readFile(absolutePath, 'utf-8'),
    );
  } catch {
    return null;
  }
}

export async function statPath(absolutePath: string): Promise<StatInfo> {
  try {
    return await bridgeOrFallback(
      async (c) => {
        const res = await c.stat(toRelative(absolutePath));
        if (!res.exists) return MISSING;
        return {
          exists: true,
          isDir: res.isDir,
          size: res.size,
          mtime: new Date(res.mtime),
          ctime: new Date(res.ctime),
        };
      },
      async () => {
        const stats = await fs.promises.stat(absolutePath);
        return {
          exists: true,
          isDir: stats.isDirectory(),
          size: stats.size,
          mtime: stats.mtime,
          ctime: stats.birthtime,
        };
      },
    );
  } catch {
    return MISSING;
  }
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  return (await statPath(absolutePath)).exists;
}

export async function readDir(absolutePath: string): Promise<DirEntry[]> {
  try {
    return await bridgeOrFallback(
      async (c) => {
        const entries = await c.list(toRelative(absolutePath));
        return entries.map((e) => ({ name: e.name, isDir: e.isDir }));
      },
      async () => {
        const entries = await fs.promises.readdir(absolutePath, { withFileTypes: true });
        return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
      },
    );
  } catch {
    return [];
  }
}

export async function writeFileUtf8(
  absolutePath: string,
  content: string,
  options: { exclusive?: boolean } = {},
): Promise<void> {
  await bridgeOrFallback(
    async (c) => {
      await c.write(toRelative(absolutePath), content, options);
    },
    async () => {
      await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      if (options.exclusive) {
        try {
          await fs.promises.writeFile(absolutePath, content, { encoding: 'utf-8', flag: 'wx' });
          return;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'EEXIST' && code !== 'EPERM') throw err;
        }
      }
      await fs.promises.writeFile(absolutePath, content, 'utf-8');
    },
  );
}

export async function makeDirectory(absolutePath: string, recursive = true): Promise<void> {
  await bridgeOrFallback(
    async (c) => {
      await c.mkdir(toRelative(absolutePath), recursive);
    },
    async () => {
      await fs.promises.mkdir(absolutePath, { recursive });
    },
  );
}

export async function removePath(absolutePath: string): Promise<void> {
  await bridgeOrFallback(
    async (c) => {
      await c.delete(toRelative(absolutePath));
    },
    async () => {
      await fs.promises.rm(absolutePath, { recursive: true, force: false });
    },
  );
}

export async function readFileBinary(absolutePath: string): Promise<Buffer | null> {
  try {
    return await bridgeOrFallback(
      async (c) => (await c.readBinary(toRelative(absolutePath))).data,
      async () => fs.promises.readFile(absolutePath),
    );
  } catch {
    return null;
  }
}

export async function writeFileBinary(absolutePath: string, data: Buffer): Promise<void> {
  await bridgeOrFallback(
    async (c) => {
      await c.writeBinary(toRelative(absolutePath), data);
    },
    async () => {
      await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.promises.writeFile(absolutePath, data);
    },
  );
}

export async function moveFile(source: string, destination: string): Promise<void> {
  await bridgeOrFallback(
    async (c) => {
      await c.rename(toRelative(source), toRelative(destination));
    },
    async () => {
      try {
        await fs.promises.rename(source, destination);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EXDEV') throw err;
        await fs.promises.copyFile(source, destination);
        await fs.promises.unlink(source);
      }
    },
  );
}
