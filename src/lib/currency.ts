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
