// Smart folder matching for user-friendly folder resolution

import { Folder } from '../noteplan/types.js';

export interface FolderMatchResult {
  matched: boolean;
  folder: Folder | null;
  score: number;
  alternatives: Folder[];
  ambiguous: boolean; // True if multiple folders match with similar scores
}

/**
 * Strip common prefixes from folder names for matching
 * Handles: numbered (10 - ), emoji (📥 ), special (@)
 * Returns original name if stripping would result in empty string
 */
function stripCommonPrefixes(name: string): string {
  let result = name;

  // Strip numbered prefixes: "10 - ", "01. ", "1) ", "10-", "01.", etc.
  result = result.replace(/^\d+[\s.\-_)]+\s*/, '');

  // Strip emoji prefixes (one or more emojis followed by space)
  result = result.replace(/^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Component}]+\s*/u, '');

  // Strip special prefixes like @
  result = result.replace(/^@/, '');

  result = result.trim();

  // Return original if stripping removed everything
  return result || name;
}

/**
 * Normalize a string for matching (lowercase, strip prefixes)
 */
function normalizeForMatching(name: string): string {
  return stripCommonPrefixes(name).toLowerCase();
}

/**
 * Calculate bigram similarity between two strings
 * Returns a score between 0 and 1
 */
function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const getBigrams = (str: string): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  };

  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);

  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) {
      intersection++;
    }
  }

  // Dice coefficient
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * Calculate depth penalty - prefer shallower folders
 * Depth 1 = no penalty, each additional level reduces score
 */
function getDepthPenalty(folderPath: string): number {
  const depth = folderPath.split('/').length;
  // Depth 1: 1.0, Depth 2: 0.95, Depth 3: 0.90, Depth 4: 0.85, etc.
  return Math.max(0.5, 1.0 - (depth - 1) * 0.05);
}

/**
 * Score a folder against a query
 * Returns a score between 0 and 1
 */
function scoreFolder(query: string, folder: Folder): number {
  const queryLower = query.toLowerCase();
  const nameLower = folder.name.toLowerCase();
  const normalizedName = normalizeForMatching(folder.name);

  // For nested folders, also check the last path segment
  const pathSegments = folder.path.split('/');
  const lastSegment = pathSegments[pathSegments.length - 1];
  const lastSegmentLower = lastSegment.toLowerCase();
  const normalizedLastSegment = normalizeForMatching(lastSegment);

  let baseScore = 0;

  // Exact match on full name (case-insensitive)
  if (nameLower === queryLower || lastSegmentLower === queryLower) {
    baseScore = 1.0;
  }
  // Exact match on normalized name
  else if (normalizedName === queryLower || normalizedLastSegment === queryLower) {
    baseScore = 0.95;
  }
  // Normalized name starts with query
  else if (normalizedName.startsWith(queryLower) || normalizedLastSegment.startsWith(queryLower)) {
    baseScore = 0.90;
  }
  // Query contained in normalized name
  else if (normalizedName.includes(queryLower) || normalizedLastSegment.includes(queryLower)) {
    baseScore = 0.85;
  }
  // Query contained in full name (with prefixes)
  else if (nameLower.includes(queryLower) || lastSegmentLower.includes(queryLower)) {
    baseScore = 0.80;
  }
  // Fuzzy match using bigram similarity
  else {
    const similarity = Math.max(
      bigramSimilarity(queryLower, normalizedName),
      bigramSimilarity(queryLower, normalizedLastSegment)
    );
    baseScore = similarity > 0.5 ? 0.70 + similarity * 0.10 : similarity * 0.50;
  }

  // Apply depth penalty - shallower folders score higher
  const depthPenalty = getDepthPenalty(folder.path);

  return baseScore * depthPenalty;
}

/**
 * Match a user query against available folders
 * Returns the best match with alternatives, flagging ambiguity
 */
export function matchFolder(query: string, folders: Folder[]): FolderMatchResult {
  if (!query || folders.length === 0) {
    return {
      matched: false,
      folder: null,
      score: 0,
      alternatives: [],
      ambiguous: false,
    };
  }

  // Short queries (1-2 chars) need higher threshold
  const minThreshold = query.length <= 2 ? 0.9 : 0.7;

  // Score all folders
  const scored = folders
    .map((folder) => ({
      folder,
      score: scoreFolder(query, folder),
    }))
    .filter((item) => item.score >= minThreshold)
    .sort((a, b) => {
      // Sort by score, then deprioritize special folders
      if (Math.abs(a.score - b.score) > 0.01) {
        return b.score - a.score;
      }
      // Deprioritize @Archive, @Trash
      const aIsSpecial = a.folder.name.startsWith('@');
      const bIsSpecial = b.folder.name.startsWith('@');
      if (aIsSpecial !== bIsSpecial) {
        return aIsSpecial ? 1 : -1;
      }
      return 0;
    });

  if (scored.length === 0) {
    return {
      matched: false,
      folder: null,
      score: 0,
      alternatives: [],
      ambiguous: false,
    };
  }

  const best = scored[0];
  const alternatives = scored.slice(1, 4).map((item) => item.folder);

  // Check for ambiguity: multiple matches with similar scores (within 0.15)
  const ambiguous = scored.length > 1 && (scored[1].score >= best.score - 0.15);

  return {
    matched: true,
    folder: best.folder,
    score: best.score,
    alternatives,
    ambiguous,
  };
}
