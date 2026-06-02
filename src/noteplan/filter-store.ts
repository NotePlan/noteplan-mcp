import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getNotePlanPath } from './file-reader.js';
import { getBridgeClient } from '../transport/bridge-availability.js';
import { bridgeOrFallback } from '../transport/bridge-cascade.js';
import { BridgeHttpError } from '../transport/bridge-client.js';

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

function toFilterFilePath(name: string): string {
  const safeName = assertFilterName(name);
  return path.join(getFiltersPath(), safeName);
}

/** Read fallback only — used when NotePlan is closed. Writes go through
 *  the bridge so they're immediately reflected in NotePlan's cached
 *  filter list. */
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

function normalizeFilterItems(raw: unknown): FilterItemRecord[] {
  if (!Array.isArray(raw)) {
    throw new Error('Filter file is malformed: expected an array');
  }
  return raw.map((entry) => normalizeFilterItem(entry as Record<string, unknown>));
}

export async function listFilters(): Promise<Array<{ name: string; path: string; modifiedAt?: Date; createdAt?: Date }>> {
  return bridgeOrFallback(
    async (bridge) => {
      const rows = await bridge.listFilters();
      const filtersPath = getFiltersPath();
      return rows
        .filter((r) => isFilterFileName(r.name))
        .map((r) => ({
          name: r.name,
          path: path.join(filtersPath, r.name),
          modifiedAt: r.modifiedAt ? new Date(r.modifiedAt) : undefined,
          createdAt: r.createdAt ? new Date(r.createdAt) : undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    () => {
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
    },
  );
}

export async function getFilter(name: string): Promise<FilterRecord | null> {
  const safeName = assertFilterName(name);
  const filePath = toFilterFilePath(safeName);

  return bridgeOrFallback<FilterRecord | null>(
    async (bridge) => {
      const fetched = await bridge.getFilter(safeName);
      if (!fetched) return null;
      return {
        name: safeName,
        path: filePath,
        items: fetched.items.map((it) => ({
          param: it.param,
          value: it.value,
          display: it.display,
        })),
      };
    },
    () => sqlGetFilterFallback(safeName, filePath),
  );
}

function sqlGetFilterFallback(safeName: string, filePath: string): FilterRecord | null {
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

export async function saveFilter(
  name: string,
  items: Array<{ param?: unknown; value?: unknown; display?: unknown }>,
  options: { overwrite?: boolean } = {}
): Promise<FilterRecord> {
  const safeName = assertFilterName(name);
  const overwrite = options.overwrite !== false;
  const normalizedItems = items.map((item) => normalizeFilterItem(item));
  if (normalizedItems.length === 0) {
    throw new Error('Filter items are required');
  }

  // Filter writes require NotePlan to be running so the change becomes
  // visible to the cached filter list (loaded once at app launch).
  // Writing the plist while NotePlan is closed silently does nothing.
  const bridge = await getBridgeClient();
  if (!bridge) {
    throw new Error('Saving filters requires NotePlan to be running.');
  }

  // FilterHelper.save handles the keyword item itself; strip any keyword
  // item and pass it as the dedicated `keyword` param.
  const keywordItem = normalizedItems.find((it) => it.param === 'fp_keyword');
  const remainingItems = normalizedItems.filter((it) => it.param !== 'fp_keyword');
  try {
    await bridge.saveFilter({
      name: safeName,
      items: remainingItems,
      keyword: keywordItem?.value ?? '',
      overwrite,
    });
  } catch (err) {
    if (err instanceof BridgeHttpError && err.status === 409 && !overwrite) {
      throw new Error(`Filter already exists: ${safeName}`);
    }
    throw err;
  }
  const stored = await getFilter(safeName);
  if (!stored) throw new Error(`Filter save succeeded but reload failed: ${safeName}`);
  return stored;
}

export async function deleteFilter(name: string): Promise<void> {
  const safeName = assertFilterName(name);

  // Same reasoning as saveFilter/renameFilter — deleting the file while
  // NotePlan is closed leaves the in-memory filter list pointing at a
  // file that no longer exists.
  const bridge = await getBridgeClient();
  if (!bridge) {
    throw new Error('Deleting filters requires NotePlan to be running.');
  }

  const existing = await bridge.getFilter(safeName);
  if (!existing) {
    throw new Error(`Filter not found: ${safeName}`);
  }

  await bridge.deleteFilter(safeName);
}

export async function renameFilter(oldName: string, newName: string, overwrite = false): Promise<FilterRecord> {
  const sourceName = assertFilterName(oldName);
  const targetName = assertFilterName(newName);

  // Same reasoning as saveFilter — renaming the file while NotePlan is
  // closed leaves the in-memory filter list pointing at the old name.
  const bridge = await getBridgeClient();
  if (!bridge) {
    throw new Error('Renaming filters requires NotePlan to be running.');
  }

  if (!overwrite) {
    const existing = await bridge.getFilter(targetName);
    if (existing) throw new Error(`Filter already exists: ${targetName}`);
  }
  await bridge.renameFilter(sourceName, targetName);
  const stored = await getFilter(targetName);
  if (!stored) throw new Error(`Filter rename succeeded but reload failed: ${targetName}`);
  return stored;
}
