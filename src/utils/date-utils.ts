// Date utilities for NotePlan filename conversions

import { getFirstDayOfWeekCached } from '../noteplan/preferences.js';

/**
 * Get the start of the week for a given date, respecting NotePlan's firstDayOfWeek setting
 * @param date The reference date
 * @param firstDayOfWeek 0 = Sunday, 1 = Monday, ..., 6 = Saturday
 */
function getStartOfWeekDate(date: Date, firstDayOfWeek: number): Date {
  const day = date.getDay();
  const daysToSubtract = (day - firstDayOfWeek + 7) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysToSubtract);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

/**
 * Get today's date in YYYYMMDD format
 */
export function getTodayDateString(): string {
  const now = new Date();
  return formatDateString(now);
}

/**
 * Format a Date object to YYYYMMDD string
 */
export function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Parse YYYYMMDD string to Date object
 */
export function parseDateString(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

/**
 * Get the calendar note filename for a date
 * Returns path like Calendar/2024/20240115.md
 */
export function getCalendarNotePath(dateStr: string): string {
  const year = dateStr.substring(0, 4);
  return `Calendar/${year}/${dateStr}.md`;
}

/**
 * Get the weekly note filename for a date
 * Returns path like Calendar/2024/2024-W03.md
 */
export function getWeeklyNotePath(date: Date): string {
  const year = date.getFullYear();
  const week = getWeekNumber(date);
  const weekStr = String(week).padStart(2, '0');
  return `Calendar/${year}/${year}-W${weekStr}.md`;
}

/**
 * Get ISO week number for a date
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Get ISO week year for a date (can differ from calendar year at year boundaries)
 * For example: Dec 30, 2024 is in Week 1 of 2025
 */
export function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

/**
 * Get both ISO week number and year
 */
export function getISOWeek(date: Date): { week: number; year: number } {
  return {
    week: getWeekNumber(date),
    year: getISOWeekYear(date),
  };
}

/**
 * Get week number respecting a custom first day of week
 * @param date The date to get the week for
 * @param firstDayOfWeek 0 = Sunday, 1 = Monday, ..., 6 = Saturday
 * @returns Week number and year
 *
 * Week 1 is defined as the week containing January 1
 */
export function getWeekWithFirstDay(
  date: Date,
  firstDayOfWeek: number
): { week: number; year: number } {
  // Find the start of the week containing the given date
  const day = date.getDay();
  const daysToSubtract = (day - firstDayOfWeek + 7) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysToSubtract);
  weekStart.setHours(0, 0, 0, 0);

  // Determine which year this week belongs to
  // A week belongs to the year that contains the majority of its days
  // For simplicity, we use the year of the week's Thursday (or mid-week)
  const midWeek = new Date(weekStart);
  midWeek.setDate(weekStart.getDate() + 3); // Thursday of the week
  const weekYear = midWeek.getFullYear();

  // Find the start of week 1 of that year
  // Week 1 is the week containing January 1
  const jan1 = new Date(weekYear, 0, 1);
  const jan1Day = jan1.getDay();
  const daysToWeekStart = (jan1Day - firstDayOfWeek + 7) % 7;
  const week1Start = new Date(jan1);
  week1Start.setDate(jan1.getDate() - daysToWeekStart);
  week1Start.setHours(0, 0, 0, 0);

  // Calculate the week number
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksDiff = Math.floor((weekStart.getTime() - week1Start.getTime()) / msPerWeek);
  const weekNum = weeksDiff + 1;

  // Handle edge case: if week number is 0 or negative, it's the last week of the previous year
  if (weekNum <= 0) {
    // Recalculate for previous year
    const prevYearDec31 = new Date(weekYear - 1, 11, 31);
    return getWeekWithFirstDay(prevYearDec31, firstDayOfWeek);
  }

  // Handle edge case: check if this might be week 1 of next year
  // (if the week mostly falls in the next year)
  const nextJan1 = new Date(weekYear + 1, 0, 1);
  if (weekStart.getTime() >= nextJan1.getTime() - 3 * 24 * 60 * 60 * 1000) {
    // This week might belong to next year - check if Jan 1 is in this week
    const nextJan1Day = nextJan1.getDay();
    const daysToNextWeekStart = (nextJan1Day - firstDayOfWeek + 7) % 7;
    const nextWeek1Start = new Date(nextJan1);
    nextWeek1Start.setDate(nextJan1.getDate() - daysToNextWeekStart);
    if (weekStart.getTime() === nextWeek1Start.getTime()) {
      return { week: 1, year: weekYear + 1 };
    }
  }

  return { week: weekNum, year: weekYear };
}

/**
 * Get week number and year respecting NotePlan's firstDayOfWeek preference
 */
export function getWeekRespectingPreference(date: Date): { week: number; year: number } {
  const firstDayOfWeek = getFirstDayOfWeekCached();
  return getWeekWithFirstDay(date, firstDayOfWeek);
}

/**
 * Parse a date input string that could be:
 * - YYYYMMDD
 * - YYYY-MM-DD
 * - today
 * - tomorrow
 * - yesterday
 */
export function parseFlexibleDate(input: string): string {
  const lower = input.toLowerCase().trim();
  const now = new Date();

  if (lower === 'today') {
    return formatDateString(now);
  }

  if (lower === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateString(tomorrow);
  }

  if (lower === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return formatDateString(yesterday);
  }

  // YYYY-MM-DD format
  const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  }

  // Already YYYYMMDD format
  if (/^\d{8}$/.test(input)) {
    return input;
  }

  // Default to input as-is
  return input;
}

/**
 * Format a date string for display
 */
export function formatDateForDisplay(dateStr: string): string {
  const date = parseDateString(dateStr);
  if (!date) return dateStr;

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Check if a filename is a calendar note
 */
export function isCalendarNoteFilename(filename: string): boolean {
  // Match patterns like 20240115.txt, 20240115.md, 2024-W03.txt, 2024-W03.md
  return /^\d{8}\.\w+$/.test(filename) || /^\d{4}-W\d{2}\.\w+$/.test(filename);
}

/**
 * Extract date from calendar note filename
 */
export function extractDateFromFilename(filename: string): string | null {
  // Match YYYYMMDD with any extension
  const dailyMatch = filename.match(/(\d{8})\.\w+$/);
  if (dailyMatch) return dailyMatch[1];

  // Match YYYY-Www (weekly) with any extension
  const weeklyMatch = filename.match(/(\d{4}-W\d{2})\.\w+$/);
  if (weeklyMatch) return weeklyMatch[1];

  // Match YYYY-MM (monthly) with any extension
  const monthlyMatch = filename.match(/(\d{4}-\d{2})\.\w+$/);
  if (monthlyMatch) return monthlyMatch[1];

  // Match YYYY-Qq (quarterly) with any extension
  const quarterlyMatch = filename.match(/(\d{4}-Q[1-4])\.\w+$/);
  if (quarterlyMatch) return quarterlyMatch[1];

  // Match YYYY (yearly) with any extension
  const yearlyMatch = filename.match(/(\d{4})\.\w+$/);
  if (yearlyMatch) return yearlyMatch[1];

  return null;
}

/**
 * Calendar note types
 */
export type CalendarNoteType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * Get the type of calendar note from its filename
 */
export function getCalendarNoteType(filename: string): CalendarNoteType | null {
  if (/\d{8}\.\w+$/.test(filename)) return 'daily';
  if (/\d{4}-W\d{2}\.\w+$/.test(filename)) return 'weekly';
  if (/\d{4}-\d{2}\.\w+$/.test(filename)) return 'monthly';
  if (/\d{4}-Q[1-4]\.\w+$/.test(filename)) return 'quarterly';
  if (/\d{4}\.\w+$/.test(filename)) return 'yearly';
  return null;
}

/**
 * Get the monthly note filename for a date
 * Returns path like Calendar/2024/2024-01.md
 */
export function getMonthlyNotePath(date: Date, hasYearSubfolders: boolean = true): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const filename = `${year}-${month}.md`;
  return hasYearSubfolders ? `Calendar/${year}/${filename}` : `Calendar/${filename}`;
}

/**
 * Get the quarterly note filename for a date
 * Returns path like Calendar/2024/2024-Q1.md
 */
export function getQuarterlyNotePath(date: Date, hasYearSubfolders: boolean = true): string {
  const year = date.getFullYear();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  const filename = `${year}-Q${quarter}.md`;
  return hasYearSubfolders ? `Calendar/${year}/${filename}` : `Calendar/${filename}`;
}

/**
 * Get the yearly note filename for a date
 * Returns path like Calendar/2024/2024.md
 */
export function getYearlyNotePath(date: Date, hasYearSubfolders: boolean = true): string {
  const year = date.getFullYear();
  const filename = `${year}.md`;
  return hasYearSubfolders ? `Calendar/${year}/${filename}` : `Calendar/${filename}`;
}

/**
 * Get a date range for a period
 */
export function getDateRange(
  period: 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month' | 'last-month' | string,
  customStart?: string,
  customEnd?: string
): { start: Date; end: Date } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  switch (period) {
    case 'today':
      return { start: now, end: now };

    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: yesterday, end: yesterday };
    }

    case 'this-week': {
      const firstDayOfWeek = getFirstDayOfWeekCached();
      const start = getStartOfWeekDate(now, firstDayOfWeek);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start, end };
    }

    case 'last-week': {
      const firstDayOfWeek = getFirstDayOfWeekCached();
      const thisWeekStart = getStartOfWeekDate(now, firstDayOfWeek);
      const start = new Date(thisWeekStart);
      start.setDate(start.getDate() - 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start, end };
    }

    case 'this-month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start, end };
    }

    case 'last-month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start, end };
    }

    default:
      // Custom range
      if (customStart && customEnd) {
        return {
          start: new Date(customStart),
          end: new Date(customEnd),
        };
      }
      return { start: now, end: now };
  }
}

/**
 * Generate all dates in a range
 */
export function getDatesInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(start);

  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}
