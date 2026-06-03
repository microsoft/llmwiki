/**
 * Slugify a filename: lowercase, strip extension, replace non-alphanumeric
 * sequences with hyphens, trim leading/trailing hyphens.
 */
export function slugify(filename: string): string {
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  return nameWithoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract an excerpt from page body (first N characters).
 */
export function excerpt(body: string, maxLen = 200): string {
  const cleaned = body.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + '…';
}
