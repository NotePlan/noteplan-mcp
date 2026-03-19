import { describe, it, expect, afterEach } from 'vitest';
import { isReadOnly, isSkipDryRun } from './server-config.js';

describe('server-config', () => {
  afterEach(() => {
    delete process.env.NOTEPLAN_READ_ONLY;
    delete process.env.NOTEPLAN_SKIP_DRY_RUN;
  });

  describe('isReadOnly', () => {
    it('returns false by default', () => {
      expect(isReadOnly()).toBe(false);
    });

    it('returns true when NOTEPLAN_READ_ONLY=true', () => {
      process.env.NOTEPLAN_READ_ONLY = 'true';
      expect(isReadOnly()).toBe(true);
    });

    it('returns true when NOTEPLAN_READ_ONLY=TRUE (case-insensitive)', () => {
      process.env.NOTEPLAN_READ_ONLY = 'TRUE';
      expect(isReadOnly()).toBe(true);
    });

    it('returns true when NOTEPLAN_READ_ONLY=1', () => {
      process.env.NOTEPLAN_READ_ONLY = '1';
      expect(isReadOnly()).toBe(true);
    });

    it('returns false for other values', () => {
      process.env.NOTEPLAN_READ_ONLY = 'false';
      expect(isReadOnly()).toBe(false);

      process.env.NOTEPLAN_READ_ONLY = 'yes';
      expect(isReadOnly()).toBe(false);

      process.env.NOTEPLAN_READ_ONLY = '0';
      expect(isReadOnly()).toBe(false);
    });
  });

  describe('isSkipDryRun', () => {
    it('returns false by default', () => {
      expect(isSkipDryRun()).toBe(false);
    });

    it('returns true when NOTEPLAN_SKIP_DRY_RUN=true', () => {
      process.env.NOTEPLAN_SKIP_DRY_RUN = 'true';
      expect(isSkipDryRun()).toBe(true);
    });

    it('returns true when NOTEPLAN_SKIP_DRY_RUN=1', () => {
      process.env.NOTEPLAN_SKIP_DRY_RUN = '1';
      expect(isSkipDryRun()).toBe(true);
    });

    it('returns false for other values', () => {
      process.env.NOTEPLAN_SKIP_DRY_RUN = 'false';
      expect(isSkipDryRun()).toBe(false);
    });
  });
});
