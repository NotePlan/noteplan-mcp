import { describe, expect, it } from 'vitest';
import {
  DeprecationNoticeGate,
  deprecationInstructions,
  deprecationNotice,
  hasBuiltInConnector,
  userSteps,
  HELP_ARTICLE_URL,
} from './deprecation.js';

describe('hasBuiltInConnector', () => {
  it('is true from NotePlan 3.22 on', () => {
    expect(hasBuiltInConnector('3.22')).toBe(true);
    expect(hasBuiltInConnector('3.22.1')).toBe(true);
    expect(hasBuiltInConnector('3.23')).toBe(true);
    expect(hasBuiltInConnector('4.0')).toBe(true);
  });

  it('is false before 3.22 and for unknown versions', () => {
    expect(hasBuiltInConnector('3.21.3')).toBe(false);
    expect(hasBuiltInConnector('3.9')).toBe(false);
    expect(hasBuiltInConnector(null)).toBe(false);
    expect(hasBuiltInConnector('unknown')).toBe(false);
  });
});

describe('userSteps', () => {
  it('skips the update step on 3.22 and CloudKit', () => {
    const steps = userSteps({ notePlanVersion: '3.22.1', usesICloudDrive: false });
    expect(steps.join('\n')).not.toMatch(/Update NotePlan/);
    expect(steps.join('\n')).not.toMatch(/CloudKit/);
    expect(steps[0]).toMatch(/Help > AI Connectors \(MCP\)/);
    expect(steps[1]).toMatch(/claude mcp remove noteplan/);
  });

  it('asks for the update on an old NotePlan', () => {
    const steps = userSteps({ notePlanVersion: '3.21.3', usesICloudDrive: false });
    expect(steps[0]).toMatch(/Update NotePlan to version 3\.22 or later \(installed: 3\.21\.3\)/);
  });

  it('does not claim an old version when the version is unknown', () => {
    const steps = userSteps({ notePlanVersion: null, usesICloudDrive: false });
    expect(steps[0]).toMatch(/Make sure NotePlan is version 3\.22 or later/);
  });

  it('asks to switch to CloudKit when the notes sync with iCloud Drive', () => {
    const steps = userSteps({ notePlanVersion: '3.22', usesICloudDrive: true });
    expect(steps[0]).toMatch(/switch to CloudKit sync in Settings > Sync/);
  });
});

describe('deprecation texts', () => {
  it('asks the AI to tell the user and says the tools still work', () => {
    const notice = deprecationNotice({ notePlanVersion: '3.22', usesICloudDrive: false });
    expect(notice).toMatch(/please tell the user once/);
    expect(notice).toMatch(/It still works for now/);
    expect(notice).toContain(HELP_ARTICLE_URL);
    expect(deprecationInstructions()).toContain(HELP_ARTICLE_URL);
  });
});

describe('DeprecationNoticeGate', () => {
  it('shows on the first call, then once a day', () => {
    let now = 0;
    const gate = new DeprecationNoticeGate(() => now);
    expect(gate.shouldShow()).toBe(true);
    now = 60_000;
    expect(gate.shouldShow()).toBe(false);
    now = 23 * 60 * 60 * 1000;
    expect(gate.shouldShow()).toBe(false);
    now = 24 * 60 * 60 * 1000 + 1;
    expect(gate.shouldShow()).toBe(true);
    expect(gate.shouldShow()).toBe(false);
  });
});
