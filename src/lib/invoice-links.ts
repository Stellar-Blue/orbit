import type { Invoice, Project } from '@/lib/types';

/**
 * Invoice → what it bills.
 *
 * An invoice can reference several agreements and any number of projects (change requests), in any
 * combination. The link set lives in two arrays on the invoice; `contract_id` mirrors the first
 * contract so legacy readers, exports and the AADE sync keep seeing a single primary link.
 */

type ProjectContractLookup = ReadonlyArray<Pick<Project, 'id' | 'contract_id'>>;

type InvoiceLinks = Pick<Invoice, 'contract_id' | 'contract_ids' | 'project_ids'>;

/** Trimmed, de-duplicated ids — the shape the register stores. Order is preserved. */
export function normalizeLinkIds(ids?: Array<string | null | undefined> | null): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  (ids ?? []).forEach(id => {
    const value = String(id || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
}

/**
 * Contracts the invoice bills. Rows written before the multi-link columns (or by an integration that
 * only knows `contract_id`) fall back to the single legacy link.
 */
export function invoiceContractIds(invoice: InvoiceLinks): string[] {
  const linked = normalizeLinkIds(invoice.contract_ids);
  return linked.length > 0 ? linked : normalizeLinkIds([invoice.contract_id]);
}

export function invoiceProjectIds(invoice: InvoiceLinks): string[] {
  return normalizeLinkIds(invoice.project_ids);
}

/** Enough context to resolve project links back to the agreement they belong to. */
const parentsOf = (projectIds: string[], projects: ProjectContractLookup): string[] =>
  projectIds
    .map(projectId => projects.find(project => project.id === projectId)?.contract_id)
    .filter((id): id is string => Boolean(id));

/** Every contract the invoice's money belongs to, project links expanded to their parent agreement. */
export function invoiceLinkedContractIds(invoice: InvoiceLinks, projects: ProjectContractLookup = []): string[] {
  return normalizeLinkIds([...invoiceContractIds(invoice), ...parentsOf(invoiceProjectIds(invoice), projects)]);
}

/** True when the invoice bills this agreement, directly or through one of its projects. */
export function invoiceLinksContract(
  invoice: InvoiceLinks,
  contractId: string | null | undefined,
  projects: ProjectContractLookup = []
): boolean {
  if (!contractId) return false;
  return invoiceLinkedContractIds(invoice, projects).includes(contractId);
}

/** True when the invoice bills this change request. */
export function invoiceLinksProject(invoice: InvoiceLinks, projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  return invoiceProjectIds(invoice).includes(projectId);
}

/**
 * The link set to persist from a pick in the register: a linked project always brings its parent
 * agreement along, so coverage, filters and reports can match on contracts alone.
 */
export function buildInvoiceLinks(args: {
  contractIds?: Array<string | null | undefined> | null;
  projectIds?: Array<string | null | undefined> | null;
  projects?: ProjectContractLookup;
}): { contractIds: string[]; projectIds: string[]; primaryContractId: string | null } {
  const projectIds = normalizeLinkIds(args.projectIds);
  const contractIds = normalizeLinkIds([
    ...normalizeLinkIds(args.contractIds),
    ...parentsOf(projectIds, args.projects ?? []),
  ]);
  return { contractIds, projectIds, primaryContractId: contractIds[0] ?? null };
}
