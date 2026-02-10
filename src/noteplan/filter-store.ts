import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getNotePlanPath } from './file-reader.js';

export interface FilterItemRecord {
  param: string;
  value: string;
  display: boolean;
}

export interface FilterRecord {
  name: string;
  path: string;
  items: FilterItemRecord[];
  createdAt?: Date;
  modifiedAt?: Date;
}

function sanitizeFilterName(name: string): string {
  return name.trim().replace(/[\\/]/g, '-');
}

function assertFilterName(name: string): string {
  const sanitized = sanitizeFilterName(name);
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error('Filter name is required');
  }
  return sanitized;
}

function normalizeFilterItem(input: {
  param?: unknown;
  value?: unknown;
  display?: unknown;
}): FilterItemRecord {
  const rawParam = typeof input.param === 'string' ? input.param.trim() : '';
  if (!rawParam) {
    throw new Error('Each filter item must include a non-empty param');
  }

  let storedValue = '';
  if (typeof input.value === 'string') {
    storedValue = input.value;
  } else if (typeof input.value === 'boolean' || typeof input.value === 'number') {
    storedValue = String(input.value);
  } else if (Array.isArray(input.value)) {
    const tokens = input.value
      .map((value) => (typeof value === 'string' ? value.trim() : String(value ?? '').trim()))
      .filter((value) => value.length > 0);
    storedValue = tokens.join('$$::$$');
  } else if (input.value === null || input.value === undefined) {
    storedValue = '';
  } else {
    storedValue = String(input.value);
  }

  const display = input.display === undefined ? true : input.display === true;

  return {
    param: rawParam,
    value: storedValue,
    display,
  };
}

function getFiltersPath(): string {
  return path.join(getNotePlanPath(), 'Filters');
}

function isFilterFileName(name: string): boolean {
  if (!name || name.startsWith('.')) return false;
  const lower = name.toLowerCase();
  if (lower.endsWith('.view') || lower.endsWith('.views')) return false;
  return true;
}

function ensureFiltersPath(): string {
  const filtersPath = getFiltersPath();
  if (!fs.existsSync(filtersPath)) {
    fs.mkdirSync(filtersPath, { recursive: true });
  }
  return filtersPath;
}

function toFilterFilePath(name: string): string {
  const safeName = assertFilterName(name);
  return path.join(getFiltersPath(), safeName);
}

function toJsonViaPlutil(filePath: string): unknown {
  try {
    const output = execFileSync('plutil', ['-convert', 'json', '-o', '-', filePath], {
      encoding: 'utf-8',
    });
    return JSON.parse(output);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to read filter plist via plutil: ${reason}`);
  }
}

function toBinaryPlistViaPlutil(jsonPath: string, outputPath: string): void {
  try {
    execFileSync('plutil', ['-convert', 'binary1', '-o', outputPath, jsonPath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to write filter plist via plutil: ${reason}`);
  }
}

function normalizeFilterItems(raw: unknown): FilterItemRecord[] {
  if (!Array.isArray(raw)) {
    throw new Error('Filter file is malformed: expected an array');
  }
  return raw.map((entry) => normalizeFilterItem(entry as Record<string, unknown>));
}

export function listFilters(): Array<{ name: string; path: string; modifiedAt?: Date; createdAt?: Date }> {
  const filtersPath = getFiltersPath();
  if (!fs.existsSync(filtersPath)) return [];

  const entries = fs.readdirSync(filtersPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isFilterFileName(entry.name))
    .map((entry) => {
      const fullPath = path.join(filtersPath, entry.name);
      const stats = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        modifiedAt: stats.mtime,
        createdAt: stats.birthtime,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getFilter(name: string): FilterRecord | null {
  const safeName = assertFilterName(name);
  const filePath = toFilterFilePath(safeName);
  if (!fs.existsSync(filePath)) return null;

  const stats = fs.statSync(filePath);
  const raw = toJsonViaPlutil(filePath);
  const items = normalizeFilterItems(raw);

  return {
    name: safeName,
    path: filePath,
    items,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
  };
}

export function saveFilter(
  name: string,
  items: Array<{ param?: unknown; value?: unknown; display?: unknown }>,
  options: { overwrite?: boolean } = {}
): FilterRecord {
  const safeName = assertFilterName(name);
  const overwrite = options.overwrite !== false;
  const normalizedItems = items.map((item) => normalizeFilterItem(item));
  if (normalizedItems.length === 0) {
    throw new Error('Filter items are required');
  }

  const filtersPath = ensureFiltersPath();
  const outputPath = path.join(filtersPath, safeName);
  if (!overwrite && fs.existsSync(outputPath)) {
    throw new Error(`Filter already exists: ${safeName}`);
  }

  const tempPath = path.join(
    os.tmpdir(),
    `noteplan-filter-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  try {
    fs.writeFileSync(tempPath, JSON.stringify(normalizedItems), { encoding: 'utf-8' });
    toBinaryPlistViaPlutil(tempPath, outputPath);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }

  const stored = getFilter(safeName);
  if (!stored) {
    throw new Error(`Filter save succeeded but reload failed: ${safeName}`);
  }

  return stored;
}

export function renameFilter(oldName: string, newName: string, overwrite = false): FilterRecord {
  const sourceName = assertFilterName(oldName);
  const targetName = assertFilterName(newName);

  const sourcePath = toFilterFilePath(sourceName);
  const targetPath = toFilterFilePath(targetName);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Filter not found: ${sourceName}`);
  }
  if (!overwrite && fs.existsSync(targetPath)) {
    throw new Error(`Filter already exists: ${targetName}`);
  }

  fs.renameSync(sourcePath, targetPath);

  const stored = getFilter(targetName);
  if (!stored) {
    throw new Error(`Filter rename succeeded but reload failed: ${targetName}`);
  }

  return stored;
}
