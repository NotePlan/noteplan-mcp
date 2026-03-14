/**
 * Normalize filenames to handle Unicode issues in MCP transport.
 *
 * Problems solved:
 * 1. Claude sometimes sends literal \uXXXX escape sequences instead of actual
 *    Unicode characters (e.g., `\u2018` instead of `'`).
 * 2. macOS APFS may store filenames in a different Unicode normalization form
 *    (NFD vs NFC), causing exact string comparisons to fail.
 */

/**
 * Unescape literal `\uXXXX` sequences in a string.
 * Handles both BMP (`\uXXXX`) and surrogate pairs for astral characters.
 */
export function unescapeUnicodeSequences(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

/**
 * Normalize a filename for consistent lookup:
 * 1. Unescape any literal \uXXXX sequences
 * 2. Apply Unicode NFC normalization
 */
export function normalizeFilename(filename: string): string {
  let result = filename;

  // Step 1: Unescape literal Unicode escape sequences (e.g., \u2018 → ')
  if (result.includes('\\u')) {
    result = unescapeUnicodeSequences(result);
  }

  // Step 2: NFC normalize for consistent comparison across platforms
  result = result.normalize('NFC');

  return result;
}
