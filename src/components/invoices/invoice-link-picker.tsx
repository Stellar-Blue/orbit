"use client";

import React, { useMemo } from 'react';
import { FileText, FolderKanban, X } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { buildInvoiceLinks } from '@/lib/invoice-links';
import type { Contract, Project } from '@/lib/types';

export interface InvoiceLinkSelection {
  contractIds: string[];
  projectIds: string[];
  primaryContractId: string | null;
}

interface InvoiceLinkPickerProps {
  contractIds: string[];
  projectIds: string[];
  contracts: Contract[];
  projects: Project[];
  /** Only this counterparty's agreements (and their projects) can be linked. */
  counterpartyId?: string;
  onChange: (next: InvoiceLinkSelection) => void;
}

/**
 * "What does this invoice bill?" — several agreements and any number of their projects, in any
 * combination. Picking a project brings its parent agreement along, so downstream logic that works
 * on contracts alone (coverage, filters, reports) still sees the whole link set.
 */
export const InvoiceLinkPicker: React.FC<InvoiceLinkPickerProps> = ({
  contractIds,
  projectIds,
  contracts,
  projects,
  counterpartyId,
  onChange,
}) => {
  const offeredContracts = useMemo(
    () => contracts
      .filter(contract => !counterpartyId || contract.counterparty_id === counterpartyId)
      .sort((a, b) => (a.reference || '').localeCompare(b.reference || '')),
    [contracts, counterpartyId]
  );
  const offeredById = useMemo(() => new Map(offeredContracts.map(contract => [contract.id, contract])), [offeredContracts]);

  const offeredProjects = useMemo(
    () => projects
      .filter(project => project.status !== 'archived' && offeredById.has(String(project.contract_id || '')))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(project => ({ project, contract: offeredById.get(String(project.contract_id || '')) })),
    [projects, offeredById]
  );

  const linkedContracts = contractIds
    .map(id => offeredById.get(id) ?? contracts.find(contract => contract.id === id))
    .filter((contract): contract is Contract => Boolean(contract));
  const linkedProjects = projectIds
    .map(id => projects.find(project => project.id === id))
    .filter((project): project is Project => Boolean(project));

  const apply = (next: { contractIds: string[]; projectIds: string[] }) => onChange(buildInvoiceLinks({ ...next, projects }));

  const addToken = (token: string) => {
    const [kind, id] = token.split(':');
    if (!id) return;
    if (kind === 'c' && !contractIds.includes(id)) apply({ contractIds: [...contractIds, id], projectIds });
    if (kind === 'p' && !projectIds.includes(id)) apply({ contractIds, projectIds: [...projectIds, id] });
  };

  const options = [
    ...offeredContracts
      .filter(contract => !contractIds.includes(contract.id))
      .map(contract => ({
        value: `c:${contract.id}`,
        label: contract.reference || contract.product || 'Contract',
        description: contract.id,
        hint: 'Agreement',
        keywords: `${contract.product || ''} ${contract.type || ''} ${contract.direction || ''} agreement contract`,
      })),
    ...offeredProjects
      .filter(entry => !projectIds.includes(entry.project.id))
      .map(({ project, contract }) => ({
        value: `p:${project.id}`,
        label: project.name,
        description: contract ? contract.reference : project.id,
        hint: 'Project',
        keywords: `${project.code || ''} ${contract?.reference || ''} project change request`,
      })),
  ];

  const hasLinks = linkedContracts.length > 0 || linkedProjects.length > 0;

  return (
    <div className="space-y-2">
      <SearchableSelect
        value=""
        onChange={addToken}
        emptyLabel="Link an agreement or project…"
        hideEmptyOption
        placeholder={counterpartyId ? 'Search this counterparty’s agreements and projects…' : 'Search agreements and projects…'}
        options={options}
      />

      {hasLinks && (
        <div className="flex flex-wrap items-center gap-1.5">
          {linkedContracts.map(contract => (
            <span
              key={`c-${contract.id}`}
              title={`Agreement ${contract.reference || contract.id}`}
              className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-bold"
            >
              <FileText className="w-2.5 h-2.5" />
              <span className="max-w-[14rem] truncate">{contract.reference || contract.product || 'Contract'}</span>
              <button
                type="button"
                aria-label={`Unlink ${contract.reference || contract.id}`}
                onClick={() => apply({
                  contractIds: contractIds.filter(id => id !== contract.id),
                  // Unlinking the agreement drops the projects billed under it.
                  projectIds: projectIds.filter(projectId => projects.find(project => project.id === projectId)?.contract_id !== contract.id),
                })}
                className="p-0.5 rounded hover:bg-indigo-100 cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          {linkedProjects.map(project => (
            <span
              key={`p-${project.id}`}
              title={`Project ${project.name}${project.code ? ` (${project.code})` : ''}`}
              className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold"
            >
              <FolderKanban className="w-2.5 h-2.5" />
              <span className="max-w-[14rem] truncate">{project.code ? `${project.code} · ` : ''}{project.name}</span>
              <button
                type="button"
                aria-label={`Unlink ${project.name}`}
                onClick={() => apply({ contractIds, projectIds: projectIds.filter(id => id !== project.id) })}
                className="p-0.5 rounded hover:bg-amber-100 cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
