import { describe, it, expect } from 'vitest';
import { tokenizeSearchTerms } from './search.js';

describe('tokenizeSearchTerms', () => {
  it('splits on whitespace', () => {
    expect(tokenizeSearchTerms('meeting notes')).toEqual(['meeting', 'notes']);
  });

  it('splits on the regex alternation operator', () => {
    // Bug observed in manual testing: an explicit OR query like
    // `meeting|standup` would surface in the response as the single
    // token `["meeting|standup"]` because the tokenizer only split
    // on whitespace. The bridge always handled the regex correctly;
    // this just keeps `tokenTerms` faithful to the user's query.
    expect(tokenizeSearchTerms('meeting|standup')).toEqual(['meeting', 'standup']);
  });

  it('handles whitespace and pipe mixed', () => {
    expect(tokenizeSearchTerms('meeting | standup review')).toEqual([
      'meeting',
      'standup',
      'review',
    ]);
  });

  it('drops stop words and dedupes', () => {
    expect(tokenizeSearchTerms('the meeting and the standup')).toEqual([
      'meeting',
      'standup',
    ]);
  });

  it('is case-insensitive in the deduped output', () => {
    expect(tokenizeSearchTerms('Meeting MEETING meeting')).toEqual(['meeting']);
  });

  it('returns empty for empty input', () => {
    expect(tokenizeSearchTerms('')).toEqual([]);
    expect(tokenizeSearchTerms('   ')).toEqual([]);
    expect(tokenizeSearchTerms('|')).toEqual([]);
  });
});
