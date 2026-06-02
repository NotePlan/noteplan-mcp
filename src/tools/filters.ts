import { z } from 'zod';
import * as filterStore from '../noteplan/filter-store.js';
import { getBridgeClient } from '../transport/bridge-availability.js';
import { BridgeHttpError } from '../transport/bridge-client.js';
import {
  issueConfirmationToken,
  validateAndConsumeConfirmationToken,
  confirmationFailureMessage,
} from '../utils/confirmation-tokens.js';

const DELETE_FILTER_REFRESH_HINT =
  'Call noteplan_filters with action="delete" and dryRun=true to get a new confirmationToken.';

function toBoundedInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

const BOOLEAN_FILTER_PARAMS = new Set([
  'fp_open',
  'fp_done',
  'fp_scheduled',
  'fp_canceled',
  'fp_event',
  'fp_reminder',
  'fp_noStatus',
  'fp_noteItem',
  'fp_datedNoteItem',
  'fp_calendarItem',
  'fp_sortPastFuture',
  'fp_showMonthly',
  'fp_showWeekly',
  'fp_showTimeBlockedEvents',
  'fp_hidePastEvents',
  'fp_listReminders',
  'fp_checklist',
  'fp_checklistDone',
  'fp_checklistScheduled',
  'fp_checklistCancelled',
  'fp_excludeArchive',
  'fp_excludeTeamspaces',
]);

const FILTER_PARAMETER_DEFINITIONS = [
  { param: 'fp_open', type: 'boolean', description: 'Include open tasks' },
  { param: 'fp_done', type: 'boolean', description: 'Include completed tasks' },
  { param: 'fp_scheduled', type: 'boolean', description: 'Include scheduled tasks' },
  { param: 'fp_canceled', type: 'boolean', description: 'Include cancelled tasks' },
  { param: 'fp_noStatus', type: 'boolean', description: 'Include non-task lines (NotePlan UI behavior)' },
  { param: 'fp_timeframe', type: 'timeframe', description: 'Timeframe key (e.g. fptf_thisWeek, fptf_future)' },
  { param: 'fp_startDate', type: 'string', description: 'Custom timeframe start date (yyyy-MM-dd HH:mm:ss)' },
  { param: 'fp_endDate', type: 'string', description: 'Custom timeframe end date (yyyy-MM-dd HH:mm:ss)' },
  { param: 'fp_keyword', type: 'string', description: 'Keyword search text' },
  { param: 'fp_filename', type: 'string', description: 'Filename filter text' },
  { param: 'fp_underHeading', type: 'string', description: 'Heading constraint for task views' },
  { param: 'fp_noteItem', type: 'boolean', description: 'Include project-note tasks' },
  { param: 'fp_datedNoteItem', type: 'boolean', description: 'Include calendar-note tasks' },
  { param: 'fp_calendarItem', type: 'boolean', description: 'Include calendar note items' },
  { param: 'fp_teamspaces', type: 'string[]', description: 'TeamSpace IDs joined with $$::$$ in storage' },
  { param: 'fp_checklist', type: 'boolean', description: 'Include open checklist items' },
  { param: 'fp_checklistDone', type: 'boolean', description: 'Include completed checklist items' },
  { param: 'fp_checklistScheduled', type: 'boolean', description: 'Include scheduled checklist items' },
  { param: 'fp_checklistCancelled', type: 'boolean', description: 'Include cancelled checklist items' },
];

const FILTER_TIMEFRAME_VALUES = [
  'fptf_allTime',
  'fptf_allTimeCappedPast',
  'fptf_rolling30Days',
  'fptf_today',
  'fptf_pastAndToday',
  'fptf_past',
  'fptf_future',
  'fptf_lastWeek',
  'fptf_thisWeek',
  'fptf_nextWeek',
  'fptf_lastMonth',
  'fptf_thisMonth',
  'fptf_nextMonth',
  'fptf_lastYear',
  'fptf_thisYear',
  'fptf_nextYear',
  'fptf_custom',
];

function parseFilterItemValue(param: string, value: string): unknown {
  if (BOOLEAN_FILTER_PARAMS.has(param)) {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }

  if (param === 'fp_teamspaces') {
    return value.length > 0 ? value.split('$$::$$').filter((entry) => entry.length > 0) : [];
  }

  return value;
}

export const listFiltersSchema = z.object({
  query: z.string().optional().describe('Filter names by substring'),
  limit: z.number().min(1).max(200).optional().default(50).describe('Maximum filters to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
});

export const getFilterSchema = z.object({
  name: z.string().describe('Filter name'),
});

export const saveFilterSchema = z.object({
  name: z.string().describe('Filter name'),
  overwrite: z.boolean().optional().default(true).describe('Overwrite existing filter with the same name'),
  items: z
    .array(
      z.object({
        param: z.string().describe('Filter parameter key, e.g. fp_open, fp_keyword'),
        value: z
          .union([z.string(), z.boolean(), z.number(), z.array(z.string())])
          .describe('Stored filter value. Arrays are joined using $$::$$ for teamspaces'),
        display: z.boolean().optional().describe('Whether this item is shown in UI (default: true)'),
      })
    )
    .min(1)
    .describe('Filter items to persist'),
});

export const renameFilterSchema = z.object({
  oldName: z.string().describe('Existing filter name'),
  newName: z.string().describe('New filter name'),
  overwrite: z.boolean().optional().default(false).describe('Allow replacing an existing target name'),
});

export const deleteFilterSchema = z.object({
  name: z.string().describe('Filter name to delete'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Preview deletion impact and get a confirmationToken without deleting'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token issued by dryRun for delete execution'),
});

export const getFilterTasksSchema = z.object({
  name: z.string().describe('Filter name to execute against note tasks'),
  limit: z.number().min(1).max(300).optional().default(30).describe('Maximum matches to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
});

export async function listFilters(params: z.infer<typeof listFiltersSchema>) {
  try {
    const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : '';
    const all = await filterStore.listFilters();
    const filtered = query
      ? all.filter((entry) => entry.name.toLowerCase().includes(query))
      : all;

    const offset = toBoundedInt(params.cursor ?? params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = toBoundedInt(params.limit, 50, 1, 200);
    const page = filtered.slice(offset, offset + limit);
    const hasMore = offset + page.length < filtered.length;
    const nextCursor = hasMore ? String(offset + page.length) : null;

    return {
      success: true,
      count: page.length,
      totalCount: filtered.length,
      offset,
      limit,
      hasMore,
      nextCursor,
      filters: page.map((entry) => ({
        name: entry.name,
        createdAt: entry.createdAt?.toISOString(),
        modifiedAt: entry.modifiedAt?.toISOString(),
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list filters',
    };
  }
}

export async function getFilter(params: z.infer<typeof getFilterSchema>) {
  try {
    const filter = await filterStore.getFilter(params.name);
    if (!filter) {
      return {
        success: false,
        error: `Filter not found: ${params.name}`,
      };
    }

    return {
      success: true,
      filter: {
        name: filter.name,
        createdAt: filter.createdAt?.toISOString(),
        modifiedAt: filter.modifiedAt?.toISOString(),
        itemCount: filter.items.length,
        items: filter.items.map((item) => ({
          param: item.param,
          value: item.value,
          parsedValue: parseFilterItemValue(item.param, item.value),
          display: item.display,
        })),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get filter',
    };
  }
}

export async function saveFilter(params: z.infer<typeof saveFilterSchema>) {
  try {
    const stored = await filterStore.saveFilter(params.name, params.items, {
      overwrite: params.overwrite !== false,
    });

    return {
      success: true,
      message: `Filter saved: ${stored.name}`,
      filter: {
        name: stored.name,
        createdAt: stored.createdAt?.toISOString(),
        modifiedAt: stored.modifiedAt?.toISOString(),
        itemCount: stored.items.length,
        items: stored.items,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save filter',
    };
  }
}

export async function renameFilter(params: z.infer<typeof renameFilterSchema>) {
  try {
    const stored = await filterStore.renameFilter(
      params.oldName,
      params.newName,
      params.overwrite === true
    );
    return {
      success: true,
      message: `Filter renamed to ${stored.name}`,
      filter: {
        name: stored.name,
        createdAt: stored.createdAt?.toISOString(),
        modifiedAt: stored.modifiedAt?.toISOString(),
        itemCount: stored.items.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to rename filter',
    };
  }
}

export async function deleteFilter(params: z.infer<typeof deleteFilterSchema>) {
  try {
    const existing = await filterStore.getFilter(params.name);
    if (!existing) {
      return { success: false, error: `Filter not found: ${params.name}` };
    }

    if (params.dryRun === true) {
      const token = issueConfirmationToken({
        tool: 'noteplan_filters',
        target: existing.name,
        action: 'delete_filter',
      });
      const itemCount = existing.items.length;
      return {
        success: true,
        dryRun: true,
        message: `Dry run: filter "${existing.name}" (${itemCount} item${itemCount !== 1 ? 's' : ''}) would be deleted`,
        filter: { name: existing.name, itemCount },
        ...token,
      };
    }

    const confirmation = validateAndConsumeConfirmationToken(params.confirmationToken, {
      tool: 'noteplan_filters',
      target: existing.name,
      action: 'delete_filter',
    });
    if (!confirmation.ok) {
      return {
        success: false,
        error: confirmationFailureMessage('noteplan_filters', confirmation.reason, DELETE_FILTER_REFRESH_HINT),
      };
    }

    await filterStore.deleteFilter(params.name);
    return {
      success: true,
      message: `Filter deleted: ${existing.name}`,
      filter: { name: existing.name },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete filter',
    };
  }
}

export async function getFilterTasks(params: z.infer<typeof getFilterTasksSchema>) {
  try {
    // Filter execution requires NotePlan to be running so SearchHelper
    // can apply every rule (timeframe, underHeading, noStatus, events,
    // reminders, exclude archive, ...) the way the UI does. There's no
    // reasonable offline approximation — the previous mapping fallback
    // silently dropped most rules.
    const bridge = await getBridgeClient();
    if (!bridge) {
      return {
        success: false,
        error: 'Filter execution requires NotePlan to be running. Open NotePlan and retry.',
      };
    }

    try {
      const matches = await bridge.filterTasks(params.name, { limit: params.limit });
      const offset = params.offset ?? 0;
      const page = matches.slice(offset, offset + (params.limit ?? matches.length));
      return {
        success: true,
        count: page.length,
        totalCount: matches.length,
        offset,
        limit: params.limit,
        hasMore: offset + page.length < matches.length,
        nextCursor: offset + page.length < matches.length ? String(offset + page.length) : null,
        matches: page,
        filter: { name: params.name },
        executionBackend: 'bridge',
      };
    } catch (err) {
      if (err instanceof BridgeHttpError && err.status === 404) {
        return { success: false, error: `Filter not found: ${params.name}` };
      }
      throw err;
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute filter tasks',
    };
  }
}

export function listFilterParameters() {
  return {
    success: true,
    count: FILTER_PARAMETER_DEFINITIONS.length,
    parameters: FILTER_PARAMETER_DEFINITIONS,
    timeframeValues: FILTER_TIMEFRAME_VALUES,
  };
}
