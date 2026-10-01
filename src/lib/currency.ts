/**
 * Invoice currency helpers.
 *
 * Every monetary column on `invoices` (net, vat_amount, gross) is stored in the invoice's own
 * `currency`; `gross_eur` is the EUR reporting amount produced by `gross * fx_rate`. The MCP
 * create/update tools already follow this rule — the UI must produce the same shape.
 */

/** Currencies Orbit can register invoices in. Add a code only when a counterparty actually bills in it. */
export const INVOICE_CURRENCIES = [
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'SEK', label: 'SEK — Swedish Krona' },
  { code: 'NOK', label: 'NOK — Norwegian Krone' },
  { code: 'DKK', label: 'DKK — Danish Krone' },
  { code: 'PLN', label: 'PLN — Polish Złoty' },
  { code: 'AED', label: 'AED — UAE Dirham' },
  { code: 'SAR', label: 'SAR — Saudi Riyal' },
  { code: 'QAR', label: 'QAR — Qatari Riyal' },
] as const;

export const DEFAULT_CURRENCY = 'EUR';

/**
 * `€1,234.56` / `$1,234.56` — narrow-symbol formatting for the amount in its own currency.
 * Guards against a bad code (Intl throws on non-ISO-4217 input) so the ledger never crashes on data.
 */
export function formatMoney(amount: number | null | undefined, currency: string = DEFAULT_CURRENCY): string {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(value);
  } catch {
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency}`;
  }
}

/** `1785.12` → `1.785,12` — the convention the app displays money in (el-GR / de-DE style). */
export function formatAmountInput(amount: number | null | undefined, decimals = 2): string {
  return (Number(amount) || 0).toLocaleString('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Parse an amount typed or pasted in **either** separator convention:
 * `1.785,12` (el/de/fr) and `1,785.12` (en) both mean one thousand seven hundred eighty-five twelve.
 *
 * Needed because `type="number"` silently drops the comma: pasting `1.785,12` turned into `1.78512`
 * and saved €1.79. Currency symbols, spaces, NBSPs, apostrophes and a leading minus are tolerated.
 *
 * Returns `null` when nothing numeric is present, so callers can keep their own empty/zero semantics.
 */
export function parseAmountInput(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^\d.,-]/g, '');
  if (!/\d/.test(cleaned)) return null;

  const negative = cleaned.trimStart().startsWith('-');
  const digits = cleaned.replace(/-/g, '');

  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  const dotCount = (digits.match(/\./g) || []).length;
  const commaCount = (digits.match(/,/g) || []).length;

  let decimalAt = -1;
  if (dotCount > 0 && commaCount > 0) {
    // Both separators present: the trailing one is the decimal point, the other groups thousands.
    decimalAt = Math.max(lastDot, lastComma);
  } else if (dotCount + commaCount === 1) {
    // A single separator: 3 digits behind it means thousands (`1.785`), anything else is a decimal.
    const at = dotCount ? lastDot : lastComma;
    const behind = digits.length - at - 1;
    if (behind > 0 && behind !== 3) decimalAt = at;
  }
  // Two or more of the same separator (`1.234.567`) are all thousands separators — decimalAt stays -1.

  const normalised = decimalAt === -1
    ? digits.replace(/[.,]/g, '')
    : `${digits.slice(0, decimalAt).replace(/[.,]/g, '')}.${digits.slice(decimalAt + 1).replace(/[.,]/g, '')}`;

  const parsed = Number(normalised);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}
