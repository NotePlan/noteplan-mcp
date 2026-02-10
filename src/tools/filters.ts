import { z } from 'zod';
import { NoteType, TaskStatus } from '../noteplan/types.js';
import * as filterStore from '../noteplan/filter-store.js';
import * as taskTools from './tasks.js';

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

function boolParam(items: Array<{ param: string; value: string }>, param: string): boolean | undefined {
  const raw = items.find((item) => item.param === param)?.value;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function stringParam(items: Array<{ param: string; value: string }>, param: string): string | undefined {
  const raw = items.find((item) => item.param === param)?.value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function mapFilterToTaskQuery(items: Array<{ param: string; value: string }>): {
  query: string;
  status?: TaskStatus[];
  noteTypes?: NoteType[];
  preferCalendar: boolean;
  periodicOnly: boolean;
  unsupportedRules: string[];
} {
  const unsupportedRules: string[] = [];

  const statuses: TaskStatus[] = [];
  if (boolParam(items, 'fp_open') === true) statuses.push('open');
  if (boolParam(items, 'fp_done') === true) statuses.push('done');
  if (boolParam(items, 'fp_scheduled') === true) statuses.push('scheduled');
  if (boolParam(items, 'fp_canceled') === true) statuses.push('cancelled');

  const includeProject = boolParam(items, 'fp_noteItem');
  const includeCalendar = boolParam(items, 'fp_datedNoteItem') === true || boolParam(items, 'fp_calendarItem') === true;

  const noteTypes: NoteType[] = [];
  if (includeProject === true) noteTypes.push('note');
  if (includeCalendar) noteTypes.push('calendar');

  const keyword = stringParam(items, 'fp_keyword');
  const query = keyword ?? '*';

  const periodicOnly = boolParam(items, 'fp_showWeekly') === true || boolParam(items, 'fp_showMonthly') === true;
  const preferCalendar = includeCalendar || periodicOnly;

  const timeframe = stringParam(items, 'fp_timeframe');
  if (timeframe && timeframe !== 'fptf_allTime' && timeframe !== 'fptf_custom') {
    unsupportedRules.push(`timeframe (${timeframe}) is not fully mapped yet`);
  }
  if (stringParam(items, 'fp_underHeading')) {
    unsupportedRules.push('underHeading is not mapped in global task search');
  }
  if (boolParam(items, 'fp_noStatus') === true) {
    unsupportedRules.push('noStatus includes non-task lines in NotePlan UI and is not represented in MCP task search');
  }
  if (boolParam(items, 'fp_event') === true || boolParam(items, 'fp_reminder') === true || boolParam(items, 'fp_listReminders') === true) {
    unsupportedRules.push('event/reminder filter rules are not included in noteplan_get_filter_tasks');
  }

  return {
    query,
    status: statuses.length > 0 ? statuses : undefined,
    noteTypes: noteTypes.length > 0 ? noteTypes : undefined,
    preferCalendar,
    periodicOnly,
    unsupportedRules,
  };
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

export const getFilterTasksSchema = z.object({
  name: z.string().describe('Filter name to execute against note tasks'),
  maxNotes: z.number().min(1).max(2000).optional().default(500).describe('Maximum notes to scan'),
  limit: z.number().min(1).max(300).optional().default(30).describe('Maximum matches to return'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
  cursor: z.string().optional().describe('Cursor token from previous page (preferred over offset)'),
  space: z.string().optional().describe('Optional space ID scope'),
  folder: z.string().optional().describe('Optional folder scope'),
});

export function listFilters(params: z.infer<typeof listFiltersSchema>) {
  try {
    const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : '';
    const all = filterStore.listFilters();
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

export function getFilter(params: z.infer<typeof getFilterSchema>) {
  try {
    const filter = filterStore.getFilter(params.name);
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

export function saveFilter(params: z.infer<typeof saveFilterSchema>) {
  try {
    const stored = filterStore.saveFilter(params.name, params.items, {
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

export function renameFilter(params: z.infer<typeof renameFilterSchema>) {
  try {
    const stored = filterStore.renameFilter(
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

export function getFilterTasks(params: z.infer<typeof getFilterTasksSchema>) {
  try {
    const filter = filterStore.getFilter(params.name);
    if (!filter) {
      return {
        success: false,
        error: `Filter not found: ${params.name}`,
      };
    }

    const mapped = mapFilterToTaskQuery(filter.items);
    const searchResult = taskTools.searchTasksGlobal({
      query: mapped.query,
      status: mapped.status,
      noteTypes: mapped.noteTypes,
      preferCalendar: mapped.preferCalendar,
      periodicOnly: mapped.periodicOnly,
      maxNotes: params.maxNotes,
      limit: params.limit,
      offset: params.offset,
      cursor: params.cursor,
      space: params.space,
      folder: params.folder,
    } as any) as Record<string, unknown>;

    return {
      ...searchResult,
      filter: {
        name: filter.name,
        itemCount: filter.items.length,
      },
      mappedQuery: {
        query: mapped.query,
        status: mapped.status,
        noteTypes: mapped.noteTypes,
        preferCalendar: mapped.preferCalendar,
        periodicOnly: mapped.periodicOnly,
      },
      unsupportedRules: mapped.unsupportedRules,
    };
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
