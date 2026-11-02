import type { InvoiceLine, Project } from '@/lib/types';

/**
 * Invoice → what it bills.
 *
 * An invoice can reference several agreements and any number of projects (change requests), in any
 * combination. The link set lives in two arrays on the invoice; `contract_id` mirrors the first
 * contract so legacy readers, exports and the AADE sync keep seeing a single primary link.
 */

type ProjectContractLookup = ReadonlyArray<Pick<Project, 'id' | 'contract_id'>>;

/** Anything that carries a contract/project link set — invoices and receipts share the shape. */
export type InvoiceLinkSource = {
  contract_id?: string | null;
  contract_ids?: string[] | null;
  project_ids?: string[] | null;
};

type InvoiceLinks = InvoiceLinkSource;

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

/**
 * The invoice's lines that bill something: a non-zero amount against a project or an agreement.
 * An invoice with at least one is matched line by line; one without falls back to its link set.
 */
export function invoiceLines(invoice: { lines?: InvoiceLine[] | null }): InvoiceLine[] {
  return (invoice.lines ?? []).filter(line => {
    const targets = invoiceLineTargets(line);
    return (Number(line.amount) || 0) !== 0 && targets.contractIds.length + targets.projectIds.length > 0;
  });
}

/** What a line bills: the agreements whose own fee it covers, and the projects it covers. */
export function invoiceLineTargets(line: InvoiceLine): { contractIds: string[]; projectIds: string[] } {
  const contractIds = normalizeLinkIds(line.contract_ids);
  const projectIds = normalizeLinkIds(line.project_ids);
  if (contractIds.length > 0 || projectIds.length > 0) return { contractIds, projectIds };
  // A line saved before lines could bill several things names one target; a project line also
  // carried its agreement in contract_id, which is not a fee it bills.
  if (line.project_id) return { contractIds: [], projectIds: normalizeLinkIds([line.project_id]) };
  return { contractIds: normalizeLinkIds([line.contract_id]), projectIds: [] };
}

/** What a set of lines adds up to: the net, the months they span, and the agreements / projects they bill. */
export function summarizeInvoiceLines(
  lines: InvoiceLine[],
  projects: ProjectContractLookup = []
): { net: number; periodFrom: string | null; periodTo: string | null; contractIds: string[]; projectIds: string[] } {
  const froms = lines.map(line => line.period_from || '').filter(Boolean).sort();
  const tos = lines.map(line => line.period_to || '').filter(Boolean).sort();
  const links = buildInvoiceLinks({
    contractIds: lines.flatMap(line => invoiceLineTargets(line).contractIds),
    projectIds: lines.flatMap(line => invoiceLineTargets(line).projectIds),
    projects,
  });
  return {
    net: Math.round(lines.reduce((total, line) => total + (Number(line.amount) || 0), 0) * 100) / 100,
    periodFrom: froms[0] ?? null,
    periodTo: tos[tos.length - 1] ?? null,
    contractIds: links.contractIds,
    projectIds: links.projectIds,
  };
}
