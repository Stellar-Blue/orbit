import type { Contract } from '@/lib/types';

/**
 * Subcontracts — deals where StellarBlue is not the prime contractor.
 *
 * The **counterparty stays the payer** (the prime contractor), because that is the entity we invoice
 * and the one myDATA and receivables ageing point at. These helpers describe the extra context: which
 * end customer the work really serves, the prime's own reference, and the fee the prime retains.
 */

export type SupplyRole = 'prime' | 'subcontractor' | 'intercompany';

type SupplyContract = Pick<Contract, 'supply_role' | 'end_customer' | 'counterparty' | 'prime_fee_pct' | 'prime_contract_ref'>;

export const SUPPLY_ROLES: Array<{ value: SupplyRole; label: string; hint: string }> = [
  { value: 'prime', label: 'Prime contractor', hint: 'We hold the client contract and invoice the client directly.' },
  { value: 'subcontractor', label: 'Subcontractor', hint: 'We deliver under another company’s contract; they pay us, the end customer consumes.' },
  { value: 'intercompany', label: 'Intercompany', hint: 'A group company contracts the client and passes the work to us.' },
];

export const supplyRoleOf = (contract: SupplyContract): SupplyRole =>
  contract.supply_role === 'subcontractor' || contract.supply_role === 'intercompany'
    ? contract.supply_role
    : 'prime';

/** True when the deal is not ours to hold — a subcontract or a group resale. */
export const isSubcontract = (contract: SupplyContract): boolean => supplyRoleOf(contract) !== 'prime';

/** Name of the entity that actually consumes our work; the payer itself when we are prime. */
export function contractEndCustomerName(contract: SupplyContract): string {
  if (isSubcontract(contract)) {
    return contract.end_customer?.legal_name || contract.counterparty?.legal_name || '';
  }
  return contract.counterparty?.legal_name || '';
}

/** The prime contractor's reference, trimmed to something printable. */
export const primeContractRef = (contract: SupplyContract): string =>
  String(contract.prime_contract_ref ?? '').trim();

export const primeFeePct = (contract: SupplyContract): number => {
  const raw = Number(contract.prime_fee_pct);
  if (!isSubcontract(contract) || !Number.isFinite(raw)) return 0;
  return Math.min(Math.max(raw, 0), 100);
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** What the prime retains out of an amount we bill — 0 for prime and unset contracts. */
export function primeFeeAmount(contract: SupplyContract, grossAmount: number): number {
  const amount = Number(grossAmount) || 0;
  const pct = primeFeePct(contract);
  return pct === 0 ? 0 : round2(amount * (pct / 100));
}

/** What actually reaches us after the prime's cut. */
export function netAfterPrimeFee(contract: SupplyContract, grossAmount: number): number {
  return round2((Number(grossAmount) || 0) - primeFeeAmount(contract, grossAmount));
}

/** `10%` — the fee as the UI prints it, or an empty string when there is none. */
export const primeFeeLabel = (contract: SupplyContract): string => {
  const pct = primeFeePct(contract);
  return pct === 0 ? '' : `${Number(pct.toFixed(2))}%`;
};
