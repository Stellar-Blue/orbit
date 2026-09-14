/**
 * Greek (el-GR) date formatting — the single source of truth for every date shown in Orbit.
 *
 * Display format is always DD/MM/YYYY (14/09/2026) with a 24-hour clock, never the
 * ambient-locale (US) MM/DD/YYYY that `toLocaleString()`/`toLocaleDateString()` produce.
 * Use these helpers instead of those APIs everywhere a date or timestamp is rendered.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const GREEK_MONTHS_SHORT = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Parses a Date, an ISO timestamp or a `YYYY-MM-DD` string — date-only values keep their calendar day. */
function toDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (!s) return null;
  const m = DATE_ONLY.exec(s);
  // Construct from local parts so a date-only value can never shift by a timezone.
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** `DD/MM/YYYY` — Greek date. Falls back when the value is missing or unparseable. */
export function formatDate(value?: string | Date | null, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `DD/MM/YYYY HH:mm` — Greek date + 24h time, for timestamps/log lines. */
export function formatDateTime(value?: string | Date | null, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `14 Σεπ` — compact Greek day + month abbreviation, for tight labels such as week headers. */
export function formatDayMonth(value?: string | Date | null): string {
  const d = toDate(value);
  if (!d) return '';
  return `${d.getDate()} ${GREEK_MONTHS_SHORT[d.getMonth()]}`;
}
