// Date filtering utilities for search

import { getFirstDayOfWeekCached } from '../noteplan/preferences.js';

/**
 * Get the start of the week for a given date, respecting NotePlan's firstDayOfWeek setting
 * @param date The reference date
 * @param firstDayOfWeek 0 = Sunday, 1 = Monday, ..., 6 = Saturday
 */
function getStartOfWeek(date: Date, firstDayOfWeek: number): Date {
  const day = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
  // Calculate days to subtract to get to the first day of the week
  const daysToSubtract = (day - firstDayOfWeek + 7) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysToSubtract);
  return startOfDay(weekStart);
}

/**
 * Parse flexible date strings like "today", "yesterday", "this week"
 * Returns a Date object representing the start of the period
 */
export function parseFlexibleDateFilter(input: string): Date | null {
  const lower = input.toLowerCase().trim();
  const now = new Date();

  switch (lower) {
    case 'today':
      return startOfDay(now);

    case 'yesterday':
      return startOfDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));

    case 'this week': {
      const firstDayOfWeek = getFirstDayOfWeekCached();
      return getStartOfWeek(now, firstDayOfWeek);
    }

    case 'last week': {
      const firstDayOfWeek = getFirstDayOfWeekCached();
      const thisWeekStart = getStartOfWeek(now, firstDayOfWeek);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      return lastWeekStart;
    }

    case 'this month':
      return new Date(now.getFullYear(), now.getMonth(), 1);

    case 'last month':
      return new Date(now.getFullYear(), now.getMonth() - 1, 1);

    case 'this year':
      return new Date(now.getFullYear(), 0, 1);

    case 'last year':
      return new Date(now.getFullYear() - 1, 0, 1);

    default:
      // Try ISO date parse (YYYY-MM-DD)
      const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) {
        return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
      }

      // Try YYYYMMDD format
      const yyyymmdd = input.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (yyyymmdd) {
        return new Date(parseInt(yyyymmdd[1]), parseInt(yyyymmdd[2]) - 1, parseInt(yyyymmdd[3]));
      }

      // Try general Date parse
      const parsed = new Date(input);
      return isNaN(parsed.getTime()) ? null : parsed;
  }
}

/**
 * Get the start of a day (midnight)
 */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Check if a date falls within the specified range
 */
export function isDateInRange(
  date: Date | undefined,
  after?: Date | null,
  before?: Date | null
): boolean {
  if (!date) return false;
  if (after && date < after) return false;
  if (before && date > before) return false;
  return true;
}

/**
 * Get the end of the week for a given date, respecting NotePlan's firstDayOfWeek setting
 * @param date The reference date
 * @param firstDayOfWeek 0 = Sunday, 1 = Monday, ..., 6 = Saturday
 */
function getEndOfWeek(date: Date, firstDayOfWeek: number): Date {
  const weekStart = getStartOfWeek(date, firstDayOfWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6); // Week is 7 days, end is start + 6
  return endOfDay(weekEnd);
}

/**
 * Get the end date for a period filter (for "before" comparisons)
 * For example, "this week" should include all of today
 */
export function getFilterEndDate(input: string): Date | null {
  const lower = input.toLowerCase().trim();
  const now = new Date();

  switch (lower) {
    case 'today':
      return endOfDay(now);

    case 'yesterday':
      return endOfDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));

    case 'this week': {
      const firstDayOfWeek = getFirstDayOfWeekCached();
      return getEndOfWeek(now, firstDayOfWeek);
    }

    case 'last week': {
      const firstDayOfWeek = getFirstDayOfWeekCached();
      const thisWeekStart = getStartOfWeek(now, firstDayOfWeek);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      return getEndOfWeek(lastWeekStart, firstDayOfWeek);
    }

    case 'this month':
      return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    case 'last month':
      return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    default:
      return null;
  }
}

/**
 * Get the end of a day (23:59:59.999)
 */
function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}
