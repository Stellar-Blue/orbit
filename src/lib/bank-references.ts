/**
 * Bank references are a LIST on a payment, not a single value: one settlement can arrive as several
 * transfers, each with its own transaction number (Αριθμός συναλλαγής on the receipt). The column is
 * `text[]`.
 *
 * Callers hand over looser shapes, so every read funnels through here:
 *   - a `text[]` from Postgres,
 *   - a comma-separated line typed into the grid or the upload form,
 *   - a single value the model read off a receipt.
 */

/** Normalised, de-duplicated references in the order given. Unusable input yields `[]`. */
export function bankReferences(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;|\n]/)
      : [];

  const seen = new Set<string>();
  const refs: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const ref = entry.trim();
    if (!ref) continue;
    // Case-insensitive: bank portals vary the casing of the same transaction number.
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

/** Display form — `REF-1, REF-2` — or an empty string when there are none. */
export function formatBankReferences(value: unknown, separator = ', '): string {
  return bankReferences(value).join(separator);
}
