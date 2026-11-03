/**
 * Shared helpers so every search bar in the app (Chats, Friends, Discover,
 * Groups, CreateGroup, GroupInfo's "add member" search, ...) matches names
 * and usernames the exact same, accurate way instead of each screen having
 * its own slightly different `.toLowerCase().includes(...)` one-liner.
 */

/**
 * Normalizes a raw search-box value before matching: trims surrounding
 * whitespace and strips a single leading "@" — so typing "@mnasir" to look
 * someone up by their handle works the same as typing "mnasir" everywhere
 * in the app, not just in places that happen to handle it.
 */
export function normalizeSearchQuery(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed;
}

/**
 * True if the (normalized, case-insensitive) query is a substring of any of
 * `fields` — e.g. `matchesQuery(searchQuery, profile.full_name,
 * profile.username)`. Falsy/undefined fields (not every user has set a
 * username) are skipped rather than throwing. An empty/whitespace-only
 * query always matches everything, so callers don't need a separate
 * "no query yet, show it all" branch.
 */
export function matchesQuery(query: string, ...fields: Array<string | undefined | null>): boolean {
  const q = normalizeSearchQuery(query).toLowerCase();
  if (!q) return true;
  return fields.some((field) => !!field && field.toLowerCase().includes(q));
}
