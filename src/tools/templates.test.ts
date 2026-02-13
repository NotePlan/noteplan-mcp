import { describe, it, expect } from 'vitest';
import { generateTemplateFrontmatter, ensureTemplateFrontmatter } from './templates.js';

describe('generateTemplateFrontmatter', () => {
  it('generates frontmatter with default type when no templateTypes given', () => {
    const result = generateTemplateFrontmatter('My Template');
    expect(result).toBe('---\ntitle: My Template\ntype: empty-note\n---');
  });

  it('uses first valid template type from array', () => {
    const result = generateTemplateFrontmatter('Meeting', ['meeting-note', 'project-note']);
    expect(result).toBe('---\ntitle: Meeting\ntype: meeting-note\n---');
  });

  it('falls back to empty-note for invalid types', () => {
    const result = generateTemplateFrontmatter('Test', ['invalid-type' as any]);
    expect(result).toBe('---\ntitle: Test\ntype: empty-note\n---');
  });

  it('supports all valid template types', () => {
    for (const type of ['empty-note', 'meeting-note', 'project-note', 'calendar-note']) {
      const result = generateTemplateFrontmatter('T', [type as any]);
      expect(result).toContain(`type: ${type}`);
    }
  });
});

describe('ensureTemplateFrontmatter', () => {
  it('generates default content when content is empty', () => {
    const result = ensureTemplateFrontmatter('My Template', undefined);
    expect(result).toBe('---\ntitle: My Template\ntype: empty-note\n---\n# My Template\n');
  });

  it('generates default content when content is blank', () => {
    const result = ensureTemplateFrontmatter('My Template', '   ');
    expect(result).toBe('---\ntitle: My Template\ntype: empty-note\n---\n# My Template\n');
  });

  it('preserves existing frontmatter', () => {
    const content = '---\ntitle: Custom\ntype: meeting-note\n---\n# Custom Template';
    const result = ensureTemplateFrontmatter('Ignored', content);
    expect(result).toBe(content);
  });

  it('prepends frontmatter to content without it', () => {
    const content = '# My Content\nSome body text';
    const result = ensureTemplateFrontmatter('My Template', content, ['project-note']);
    expect(result).toBe('---\ntitle: My Template\ntype: project-note\n---\n# My Content\nSome body text');
  });

  it('respects templateTypes parameter', () => {
    const result = ensureTemplateFrontmatter('Cal Template', undefined, ['calendar-note']);
    expect(result).toContain('type: calendar-note');
    expect(result).toContain('title: Cal Template');
  });
});
