"use client";

import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Invoice, InvoiceDirection, InvoiceType, InvoiceStatus, Contract, Counterparty } from '@/lib/types';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Receipt, Plus, AlertTriangle, Clock, Calendar, DollarSign, 
  ArrowUpRight, ArrowDownLeft, Download, Upload, Check, TrendingUp, BarChart3, 
  Sparkles, Save, FileText, Search, Filter, Tag, CheckCircle2, XCircle, FileSpreadsheet, Building2, HelpCircle,
  Terminal, Activity, ShieldCheck, Key, Copy, ExternalLink, Shield, Edit, Trash2, Eye, Users, Share2, RefreshCw, CloudDownload,
  Zap, EyeOff, RotateCcw, Banknote
} from 'lucide-react';
import { DocumentPreviewModal } from '@/components/ui/document-preview-modal';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ClearFiltersControl } from '@/components/ui/grid-filter-controls';
import { formatDate } from '@/lib/date';
import { format } from 'date-fns';
import { calculateContractValuation, calculateInvoiceAmountForPeriod, calculateManHoursCharge, calculateUnbilledProjectCharge } from '@/lib/pricing-engine';
import { buildDraftInvoicePayload, getContractBillingPeriods, vatRateForTreatment } from '@/lib/billing-periods';
import { buildInvoiceLinks, invoiceContractIds, invoiceLinkedContractIds, invoiceProjectIds } from '@/lib/invoice-links';
import { InvoiceLinkPicker, type InvoiceLinkSelection } from '@/components/invoices/invoice-link-picker';
import { ReceiptsPanel } from '@/components/invoices/receipts-panel';
import { INVOICE_CURRENCIES, DEFAULT_CURRENCY, formatMoney } from '@/lib/currency';
import { DatePicker } from '@/components/ui/date-picker';
const InvoicesGrid = dynamic(() => import('@/components/invoices/invoices-grid').then(m => m.InvoicesGrid), { ssr: false });
const BillingActionGrid = dynamic(() => import('@/components/billing/billing-action-grid').then(m => m.BillingActionGrid), { ssr: false });

/** Numbered block inside the register modal — the form reads as a sequence, not a pile of fields. */
const FormSection: React.FC<{ index: string; title: string; hint?: string; children: React.ReactNode }> = ({ index, title, hint, children }) => (
  <section className="space-y-3 pt-4 first:pt-0 border-t border-[var(--line)] first:border-t-0">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-mono text-[10px] font-semibold text-[var(--ink-4)]">{index}</span>
      <h3 className="ui-section-title">{title}</h3>
      {hint && <span className="text-[11px] text-[var(--ink-4)]">{hint}</span>}
    </div>
    {children}
  </section>
);

const STAT_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function InvoicesRegistryPage() {
  const { 
    currentUser, invoices, invoiceCategories, counterparties, contracts, 
    addInvoice, updateInvoice, deleteInvoice, updateInvoiceStatus, recordInvoicePayment, addInvoiceDocument, saveInvoiceAllocation, salaries, refreshInvoices,
    timesheets, catalogModules, catalogItems, projects, timeEntries, receipts
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';
  const params = useParams();
  const router = useRouter();
  const urlId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; invoice: Invoice } | null>(null);

  const copyToClipboard = (text: string, label: string, id?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    if (id) setCopiedId(id);
    setCopyFeedback(label);
    setTimeout(() => {
      if (id) setCopiedId(null);
      setCopyFeedback(null);
    }, 2500);
  };

  const handleUploadDocument = async (invId: string, file: File) => {
    const supabase = getSupabaseBrowserClient();
    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const path = `invoices/${invId}_${Date.now()}_${cleanName}`;
    try {
      // The invoices bucket is private, so no URL is stored: readers sign storage_path on load.
      let documentUrl = '';
      const { error } = await supabase.storage.from('invoices').upload(path, file, { cacheControl: '3600', upsert: true });
      if (error) {
        console.warn('Storage upload failed -> using Data URL representation.');
        documentUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string) || '');
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
        });
      }
      await addInvoiceDocument(invId, { invoice_id: invId, storage_path: path, file_name: file.name, version: 1, url: documentUrl });
      notifySuccess('Invoice attachment linked.');
    } catch (err: any) {
      console.error('Document upload error:', err);
    }
  };

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('scroll', handleClickOutside, true);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('scroll', handleClickOutside, true);
    };
  }, []);



  // Filters for Register
  const [directionFilter, setDirectionFilter] = useState<'all' | 'outgoing' | 'incoming'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCpId, setSelectedCpId] = useState<string>('all');
  const [selectedContractId, setSelectedContractId] = useState<string>('all');

  // Modal State for Registering / Editing Invoice
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ name: string; url?: string; storagePath?: string; subtitle?: string } | null>(null);
  const [newDirection, setNewDirection] = useState<InvoiceDirection>('outgoing');
  const [newType, setNewType] = useState<InvoiceType>('invoice');
  const [newStatus, setNewStatus] = useState<InvoiceStatus>('sent_received');
  const [newCpId, setNewCpId] = useState<string>('');
  const [newContractId, setNewContractId] = useState<string>('');
  /** An invoice can bill several agreements and projects at once; `newContractId` is the primary. */
  const [newContractIds, setNewContractIds] = useState<string[]>([]);
  const [newProjectIds, setNewProjectIds] = useState<string[]>([]);
  const [newCatName, setNewCatName] = useState<string>('');
  const [newInvNumber, setNewInvNumber] = useState<string>('');
  const [newMark, setNewMark] = useState<string>('');
  const [newIssueDate, setNewIssueDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [newDueDate, setNewDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [newPeriodFrom, setNewPeriodFrom] = useState<string>(new Date().toISOString().split('T')[0].slice(0, 7) + '-01');
  const [newPeriodTo, setNewPeriodTo] = useState<string>(new Date().toISOString().split('T')[0]);
  const [newReferencePeriod, setNewReferencePeriod] = useState<string>(new Date().toISOString().slice(0, 7));
  const [newNet, setNewNet] = useState<number>(1000);
  const [newVatRate, setNewVatRate] = useState<string>('24%');
  const [newCurrency, setNewCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [newFxRate, setNewFxRate] = useState<number>(1);
  const [newNotes, setNewNotes] = useState<string>('');
  const [newLinks, setNewLinks] = useState<{title: string, url: string}[]>([]);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string>('');

  // Sync Modal State
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [syncVatNumber, setSyncVatNumber] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  // Payment Record Modal
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [payBankRef, setPayBankRef] = useState<string>('');
  const [payNote, setPayNote] = useState<string>('');

  // AR/AP reporting period selector (default: current month & year; month 0 = All Year)
  const [statYear, setStatYear] = useState<number>(new Date().getFullYear());
  const statYears = useMemo(() => Array.from(new Set((invoices || []).map(i => parseInt(i.issue_date.split("-")[0])))).concat(new Date().getFullYear()).sort((a, b) => b - a), [invoices]);
  const [statMonth, setStatMonth] = useState<number>(new Date().getMonth() + 1);


  const openInvoiceModal = (inv: Invoice) => {
    setEditingInvoiceId(inv.id);
    setNewDirection(inv.direction);
    setNewType(inv.type || 'invoice');
    setNewStatus(inv.status || 'sent_received');
    setNewCpId(inv.counterparty_id || '');
    setNewContractId(inv.contract_id || '');
    setNewContractIds(invoiceContractIds(inv));
    setNewProjectIds(invoiceProjectIds(inv));
    setNewCatName(inv.category || '');
    setNewInvNumber(inv.invoice_number || '');
    setNewMark(inv.mark || '');
    setNewIssueDate(inv.issue_date || new Date().toISOString().split('T')[0]);
    setNewDueDate(inv.due_date || new Date().toISOString().split('T')[0]);
    setNewPeriodFrom(inv.period_from || '');
    setNewPeriodTo(inv.period_to || '');
    setNewReferencePeriod(inv.reference_period || '');
    setNewNet(inv.net || 0);
    setNewVatRate((inv.vat_rate as any) || '24%');
    setNewCurrency(inv.currency || DEFAULT_CURRENCY);
    setNewFxRate(inv.fx_rate || 1);
    setNewNotes(inv.notes || '');
    setNewLinks(inv.links?.map(l => ({ title: l.title || '', url: l.url })) || []);
    setDuplicateWarning('');
    setIsRegisterModalOpen(true);
  };

  // Sync initial selection from URL ID
  useEffect(() => {
    if (urlId && invoices.length > 0 && !editingInvoiceId && !payingInvoice) {
      const target = invoices.find(i => i.id === urlId || i.invoice_number.toLowerCase() === urlId.toLowerCase());
      if (target) {
        openInvoiceModal(target);
      }
    }
  }, [urlId, invoices]);

  // Sync address bar when invoice modal is opened or closed
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const activeId = editingInvoiceId || payingInvoice?.id;
    if (activeId) {
      window.history.pushState(null, '', `/invoices/${activeId}`);
    } else if (window.location.pathname.startsWith('/invoices/')) {
      window.history.pushState(null, '', '/invoices');
    }
  }, [editingInvoiceId, payingInvoice]);



  // Auto-calculate VAT & Gross for Modal
  const calculatedVat = useMemo(() => {
    if (newVatRate === '24%') return newNet * 0.24;
    if (newVatRate === '13%') return newNet * 0.13;
    if (newVatRate === '6%') return newNet * 0.06;
    return 0;
  }, [newNet, newVatRate]);

  const calculatedGross = useMemo(() => newNet + calculatedVat, [newNet, calculatedVat]);

  // EUR reporting amount. Mirrors the MCP rule (`gross_eur = gross * fx_rate`, lib/mcp/engine.ts),
  // so a UI-registered invoice lands in the ledger exactly like an agent-registered one.
  const calculatedGrossEur = useMemo(
    () => Number((calculatedGross * (newFxRate || 0)).toFixed(2)),
    [calculatedGross, newFxRate]
  );

  // Adopting an agreement pulls in its terms, currency and default billing day.
  const applyContractDefaults = (contractId: string) => {
    const cnt = contracts.find(c => c.id === contractId);
    if (cnt) {
      if (cnt.counterparty_id) setNewCpId(cnt.counterparty_id);
      // A contract bills in its own currency; adopt it only while registering a new invoice.
      if (!editingInvoiceId && cnt.currency) setNewCurrency(cnt.currency);
      const terms = cnt.payment_terms_days ?? 30;
      if (newIssueDate) {
        const idate = new Date(newIssueDate);
        idate.setDate(idate.getDate() + terms);
        setNewDueDate(idate.toISOString().split('T')[0]);
      }
    }
  };

  /** Link picker → state. The first agreement stays the invoice's primary link. */
  const handleLinksChange = (next: InvoiceLinkSelection) => {
    const addedContractId = next.contractIds.find(id => !newContractIds.includes(id));
    setNewContractIds(next.contractIds);
    setNewProjectIds(next.projectIds);
    setNewContractId(next.primaryContractId || '');
    if (addedContractId) applyContractDefaults(addedContractId);
  };

  // Check duplicate invoice numbers on the fly
  const handleNumberChange = (num: string, cpId: string, dir: InvoiceDirection) => {
    setNewInvNumber(num);
    setDuplicateWarning('');
    if (!num.trim() || !cpId) return;
    const isDup = invoices.some(i => i.id !== editingInvoiceId && i.counterparty_id === cpId && i.direction === dir && i.invoice_number.trim().toLowerCase() === num.trim().toLowerCase());
    if (isDup) {
      setDuplicateWarning(`An ${dir === 'outgoing' ? 'issued (AR)' : 'incoming (AP)'} invoice with number "${num}" is already registered for this corporate entity!`);
    }
  };

  // Deep link from a contract's Projects tab: /invoices?new=1&contract=<id>&project=<id>
  // and from the contract dossier: /invoices?new=1&contract=<id>&period=<key>&from=&to=&net=
  // Waits for the referenced rows to load, then opens the register modal pre-filled and strips the
  // query so a refresh (or a realtime reload) cannot reopen it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') !== '1') return;

    const contractId = params.get('contract') || '';
    const projectId = params.get('project') || '';
    // Wait for the slices to arrive before deciding what can be pre-filled.
    if (contractId && contracts.length === 0) return;
    if (projectId && projects.length === 0) return;

    const contract = contracts.find(c => c.id === contractId);
    const project = projects.find(pr => pr.id === projectId);
    const unbilled = project ? calculateUnbilledProjectCharge(timeEntries, project.id) : null;

    // An explicit billing period (from the dossier's fast-create rows) wins over the defaults.
    const periodKey = params.get('period') || '';
    const periodFrom = params.get('from') || '';
    const periodTo = params.get('to') || '';
    const periodNet = Number(params.get('net') || 0);

    const todayStr = new Date().toISOString().split('T')[0];
    const due = new Date();
    due.setDate(due.getDate() + 30);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep-link prefill once the referenced rows have loaded
    setEditingInvoiceId(null);
    setNewDirection(contract?.direction === 'cost' ? 'incoming' : 'outgoing');
    setNewType('invoice');
    setNewStatus('draft');
    setNewCpId(contract?.counterparty_id || '');
    setNewContractId(contractId);
    const deepLinks = buildInvoiceLinks({ contractIds: [contractId || ''], projectIds: [projectId || ''], projects });
    setNewContractIds(deepLinks.contractIds);
    setNewProjectIds(deepLinks.projectIds);
    setNewCatName('');
    setNewInvNumber('');
    setNewMark('');
    setNewIssueDate(todayStr);
    setNewDueDate(due.toISOString().split('T')[0]);
    if (periodFrom) {
      setNewPeriodFrom(periodFrom);
      setNewPeriodTo(periodTo || periodFrom);
    } else if (unbilled?.from) {
      setNewPeriodFrom(unbilled.from);
      setNewPeriodTo(unbilled.to || todayStr);
    } else {
      setNewPeriodFrom(todayStr.slice(0, 7) + '-01');
      setNewPeriodTo(todayStr);
    }
    setNewReferencePeriod(periodKey || (unbilled?.from || todayStr).slice(0, 7));
    // A project draft always carries an explicit amount: the caller (project billing bar) sends `net`,
    // and when nothing can be priced we open at 0 with a note instead of the register's default 1,000.
    const explicitNet = params.get('net');
    if (explicitNet !== null && explicitNet !== '') setNewNet(Number(explicitNet) || 0);
    else if (periodNet > 0) setNewNet(periodNet);
    else if (unbilled && unbilled.amount > 0) setNewNet(unbilled.amount);
    else if (project) setNewNet(0);
    setNewVatRate('24%');
    setNewCurrency(contract?.currency || DEFAULT_CURRENCY);
    setNewFxRate(1);
    setNewNotes(
      project
        ? `Timesheet billing — project ${project.name}${unbilled && unbilled.amount > 0 ? ` (${unbilled.hours}h approved, billable work)` : ''}` +
          (explicitNet !== null && Number(explicitNet) === 0
            ? ' — no billing rate or project value recorded yet, confirm the amount'
            : '')
        : `Contract ${contract?.reference || contractId}${periodKey ? ` — billing period ${periodKey}` : ''}`
    );
    setNewLinks([]);
    setDuplicateWarning('');
    setIsRegisterModalOpen(true);
    window.history.replaceState(null, '', '/invoices');
  }, [contracts, projects, timeEntries]);

  // Filtered Register Invoices
  const filteredInvoices = useMemo(() => {
    return (invoices || []).filter(inv => {
      if (directionFilter !== 'all' && inv.direction !== directionFilter) return false;
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (selectedCpId !== 'all' && inv.counterparty_id !== selectedCpId) return false;
      if (selectedContractId !== 'all' && !invoiceLinkedContractIds(inv, projects || []).includes(selectedContractId)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const numMatch = inv.invoice_number.toLowerCase().includes(q);
        const markMatch = inv.mark?.toLowerCase().includes(q);
        const noteMatch = inv.notes?.toLowerCase().includes(q);
        const cpMatch = inv.counterparty?.legal_name.toLowerCase().includes(q) || inv.counterparty?.trade_name?.toLowerCase().includes(q);
        const refMatch = inv.reference_period?.toLowerCase().includes(q);
        if (!numMatch && !markMatch && !noteMatch && !cpMatch && !refMatch) return false;
      }
      return true;
    });
  }, [invoices, directionFilter, statusFilter, selectedCpId, selectedContractId, searchQuery]);

  // Month M Close Drift Rollups (Current Month)


  // ==========================================================================
  // CONTRACT INVOICING & REVENUE ACTION CENTER  (moved here from the Home page)
  // ==========================================================================
  const [activeTab, setActiveTab] = useState<'ledger' | 'billing_actions' | 'receipts'>('ledger');
  const [generatedDraftIds, setGeneratedDraftIds] = useState<Record<string, string>>({});

  /**
   * Dismissed suggestions — "this period will not be invoiced, stop asking".
   * Kept per user in localStorage: it is a reminder state, not data of record, and every row is
   * derived again from contracts + invoices on load. Restorable from the dismissed list.
   */
  const dismissalKey = `orbit:billing-suggestions-dismissed:${currentUser.id}`;
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    let stored: string[] = [];
    try {
      const raw = window.localStorage.getItem(dismissalKey);
      stored = raw ? JSON.parse(raw) : [];
    } catch {
      stored = [];
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of persisted UI state after mount (window does not exist while rendering)
    setDismissedKeys(stored);
  }, [dismissalKey]);

  const persistDismissals = (next: string[]) => {
    setDismissedKeys(next);
    try {
      window.localStorage.setItem(dismissalKey, JSON.stringify(next));
    } catch {
      /* private mode / quota — the session still hides them */
    }
  };
  const dismissSuggestion = (item: { contractId: string; periodKey: string; counterpartyName: string; periodLabel: string }) => {
    const key = `${item.contractId}::${item.periodKey}`;
    if (!dismissedKeys.includes(key)) persistDismissals([...dismissedKeys, key]);
    notifySuccess(`Suggestion dismissed — ${item.counterpartyName} ${item.periodLabel}.`);
  };
  const restoreSuggestion = (key: string) => persistDismissals(dismissedKeys.filter(k => k !== key));

  const pendingInvoicesQueue = useMemo(() => {
    const results: Array<{
      contractId: string;
      reference: string;
      counterpartyId: string;
      counterpartyName: string;
      direction: 'revenue' | 'cost';
      cadence: string;
      timing: string;
      periodLabel: string;
      periodKey: string; // machine-comparable, cycle start date e.g. "2026-01-15"
      periodFrom: string;
      periodTo: string;
      expectedAmount: number;
      currency: string;
      /** Drives the draft's VAT rate: domestic supplies carry 24%, everything else is zero-rated. */
      vatTreatment?: string | null;
      /** The date this period's invoice should be raised — period start in advance, period end in arrears. */
      billingDate: string;
      status: 'unbilled' | 'draft_created' | 'billed';
      invoiceId?: string;
    }> = [];

    // Period walk + expected amounts live in @/lib/billing-periods (shared with the contract dossier).
    (contracts || []).forEach(cnt => {
      if (cnt.status !== 'active' && cnt.status !== 'in_negotiation') return;

      const cadence = cnt.billing_cadence || 'monthly';
      getContractBillingPeriods(cnt, {
        catalogModules: catalogModules || [],
        catalogItems: catalogItems || [],
        groups: cnt.groups || [],
        timesheets: timesheets || [],
        invoices: invoices || [],
        generatedDraftIds,
      }).forEach(period => {
        results.push({
          contractId: cnt.id,
          reference: cnt.reference,
          counterpartyId: cnt.counterparty_id,
          counterpartyName: cnt.counterparty?.legal_name || 'Unknown Counterparty',
          direction: cnt.direction,
          cadence,
          timing: period.timing,
          periodLabel: period.label,
          periodKey: period.key,
          periodFrom: period.from,
          periodTo: period.to,
          expectedAmount: period.expectedAmount,
          currency: cnt.currency || 'EUR',
          vatTreatment: cnt.vat_treatment,
          billingDate: period.billingDate,
          status: period.status,
          invoiceId: period.invoiceId
        });
      });
    });

    return results.sort((a, b) => {
      const statusScore = { unbilled: 0, draft_created: 1, billed: 2 };
      if (statusScore[a.status] !== statusScore[b.status]) return statusScore[a.status] - statusScore[b.status];
      if (a.direction !== b.direction) return a.direction === 'revenue' ? -1 : 1;
      if (a.periodKey < b.periodKey) return -1;
      if (a.periodKey > b.periodKey) return 1;
      return b.expectedAmount - a.expectedAmount;
    });
  }, [contracts, invoices, catalogModules, catalogItems, generatedDraftIds, timesheets]);

  /** Suggestion identity — one row per contract + billing period. */
  const suggestionId = (item: { contractId: string; periodKey: string }) => `${item.contractId}::${item.periodKey}`;
  /** Dismissed rows are dropped from the working queue; `showDismissed` pulls them back for restore. */
  const activeQueue = useMemo(
    () => pendingInvoicesQueue.filter(i => showDismissed || !dismissedKeys.includes(suggestionId(i))),
    [pendingInvoicesQueue, dismissedKeys, showDismissed]
  );
  const dismissedCount = pendingInvoicesQueue.filter(i => dismissedKeys.includes(suggestionId(i))).length;

  const handleQuickCreateInvoice = async (item: typeof pendingInvoicesQueue[0]) => {
    if (!addInvoice) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const dueStr = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
    const year = (item.periodFrom || todayStr).slice(0, 4);
    const invNumber = `INV-${year}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newInv = await addInvoice(buildDraftInvoicePayload({
      period: { key: item.periodKey, label: item.periodLabel, from: item.periodFrom, to: item.periodTo },
      contractId: item.contractId,
      counterpartyId: item.counterpartyId,
      direction: item.direction,
      currency: item.currency,
      netAmount: item.expectedAmount,
      vatRate: vatRateForTreatment(item.vatTreatment),
      reference: item.reference,
      timing: item.timing,
      invoiceNumber: invNumber,
      issueDate: todayStr,
      dueDate: dueStr,
    }));

    if (newInv) {
      setGeneratedDraftIds(prev => ({ ...prev, [suggestionId(item)]: newInv.id }));
      notifySuccess(`Draft invoice #${invNumber} created for ${item.counterpartyName} (${item.periodLabel}).`);
    }
  };

  const [actionSearchQuery, setActionSearchQuery] = useState<string>('');
  const [actionFilterStatus, setActionFilterStatus] = useState<string>('all');
  const [actionFilterDirection, setActionFilterDirection] = useState<string>('all');
  const [actionSortBy, setActionSortBy] = useState<'period' | 'amount_desc' | 'amount_asc' | 'counterparty'>('period');

  const filteredActionQueue = useMemo(() => {
    let list = [...activeQueue];
    if (actionSearchQuery.trim()) {
      const q = actionSearchQuery.toLowerCase();
      list = list.filter(item =>
        item.counterpartyName.toLowerCase().includes(q) ||
        (item.reference || '').toLowerCase().includes(q) ||
        item.periodLabel.toLowerCase().includes(q)
      );
    }
    if (actionFilterStatus !== 'all') {
      list = list.filter(item => item.status === actionFilterStatus);
    }
    if (actionFilterDirection !== 'all') {
      list = list.filter(item => item.direction === actionFilterDirection);
    }
    list.sort((a, b) => {
      if (actionSortBy === 'amount_desc') return b.expectedAmount - a.expectedAmount;
      if (actionSortBy === 'amount_asc') return a.expectedAmount - b.expectedAmount;
      if (actionSortBy === 'counterparty') return a.counterpartyName.localeCompare(b.counterpartyName);
      if (a.status !== b.status) {
        if (a.status === 'unbilled') return -1;
        if (b.status === 'unbilled') return 1;
      }
      return b.periodKey.localeCompare(a.periodKey);
    });
    return list;
  }, [activeQueue, actionSearchQuery, actionFilterStatus, actionFilterDirection, actionSortBy]);

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center">
        <Card className="p-8 border-red-200 bg-red-50 text-red-900 rounded-2xl">
          <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold">Admin Authorization Required</h2>
          <p className="text-xs text-red-700 mt-2">
            Invoice archives, corporate banking references, and real-time cashflow schedules are restricted to authenticated executive administrators under strict Row-Level Security (RLS).
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-150">

      {/* Header — command bar: where you are, then the actions you actually take here. */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 border-b border-[var(--line-strong)] pb-3">
        <div className="min-w-0">
          <p className="ui-eyebrow">Operations · Invoice register</p>
          <h1 className="ui-title mt-1">Invoices</h1>
          <p className="text-[12.5px] text-[var(--ink-3)] mt-1 max-w-xl">
            Issued and received invoices, allocations, payments and myDATA archives.
          </p>
        </div>
        {activeTab === 'ledger' && (
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button 
                onClick={() => {
                  setSyncVatNumber('');
                  setIsSyncModalOpen(true);
                }} 
                variant="secondary"
                size="sm"
              >
                <CloudDownload className="w-4 h-4" />
                Sync myDATA
              </Button>
              <Button 
                onClick={() => refreshInvoices()} 
                variant="secondary"
                size="sm"
              >
                <RefreshCw className="w-4 h-4" />
                Reload
              </Button>
              <Button 
                onClick={() => {
                  setEditingInvoiceId(null);
                  setNewDirection('outgoing');
                  setNewType('invoice');
                  setNewStatus('sent_received');
                  setNewCpId('');
                  setNewContractId('');
                  setNewContractIds([]);
                  setNewProjectIds([]);
                  setNewCatName('');
                  setNewInvNumber('');
                  setNewMark('');
                  setNewIssueDate(new Date().toISOString().split('T')[0]);
                  const d = new Date();
                  d.setDate(d.getDate() + 30);
                  setNewDueDate(d.toISOString().split('T')[0]);
                  setNewPeriodFrom(new Date().toISOString().split('T')[0].slice(0, 7) + '-01');
                  setNewPeriodTo(new Date().toISOString().split('T')[0]);
                  setNewReferencePeriod(new Date().toISOString().slice(0, 7));
                  setNewNet(1000);
                  setNewVatRate('24%');
                  setNewCurrency(DEFAULT_CURRENCY);
                  setNewFxRate(1);
                  setNewNotes('');
                  setNewLinks([]);
                  setDuplicateWarning('');
                  setIsRegisterModalOpen(true);
                }} 
                variant="primary"
                size="sm"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                Register invoice
              </Button>
            </div>
        )}
      </div>

      {/* Tabs — the same machined switch as the contract registry, so screens stay one system. */}
      <div className="ui-segmented" role="group" aria-label="Invoice views">
        <button type="button" onClick={() => setActiveTab('ledger')} aria-pressed={activeTab === 'ledger'}>
          <FileSpreadsheet className="w-3.5 h-3.5" /> Invoice ledger
          <span className="font-mono text-[10px] font-semibold text-[var(--ink-4)]">{filteredInvoices.length}</span>
        </button>
        <button type="button" onClick={() => setActiveTab('billing_actions')} aria-pressed={activeTab === 'billing_actions'}>
          <Zap className="w-3.5 h-3.5" /> Invoicing queue
          {pendingInvoicesQueue.filter(i => i.status === 'unbilled' && !dismissedKeys.includes(suggestionId(i))).length > 0 && (
            <span className="font-mono text-[10px] font-semibold text-[var(--warning)]">
              {pendingInvoicesQueue.filter(i => i.status === 'unbilled' && !dismissedKeys.includes(suggestionId(i))).length}
            </span>
          )}
        </button>
        <button type="button" onClick={() => setActiveTab('receipts')} aria-pressed={activeTab === 'receipts'}>
          <Banknote className="w-3.5 h-3.5" /> Receipts
          <span className="font-mono text-[10px] font-semibold text-[var(--ink-4)]">{receipts.length}</span>
        </button>
      </div>

      {activeTab === 'ledger' && (
        <>
          {/* Filters */}
          <div className="ui-card p-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-[var(--ink-4)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search invoice number, MARK or counterparty"
                className="w-full h-7 pl-8 pr-3 text-[12px] font-medium border border-[var(--line-strong)] rounded-[var(--radius-control)] bg-white text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
              />
            </div>
            <select
              value={directionFilter}
              onChange={(e: any) => setDirectionFilter(e.target.value)}
              className="h-7 px-2 text-[12px] font-medium border border-[var(--line-strong)] rounded-[var(--radius-control)] bg-white text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
            >
              <option value="all">All directions</option>
              <option value="outgoing">Client (AR)</option>
              <option value="incoming">Supplier (AP)</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="h-7 px-2 text-[12px] font-medium border border-[var(--line-strong)] rounded-[var(--radius-control)] bg-white text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="registered">Registered</option>
              <option value="sent_received">Sent or received</option>
              <option value="partially_paid">Partially paid</option>
              <option value="paid">Paid</option>
              <option value="disputed">Disputed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={selectedCpId}
              onChange={(e: any) => setSelectedCpId(e.target.value)}
              className="h-8 px-2 text-[12px] font-medium border border-[var(--line-strong)] rounded-[var(--radius-control)] bg-white text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)] cursor-pointer max-w-[220px]"
            >
              <option value="all">All counterparties</option>
              {counterparties.map(cp => (
                <option key={cp.id} value={cp.id}>{cp.legal_name} {cp.trade_name ? `(${cp.trade_name})` : ''}</option>
              ))}
            </select>
          </div>

          {/* Table View (AG Grid) */}
          <InvoicesGrid
            invoices={filteredInvoices}
            externalFilters={{
              active: searchQuery.trim().length > 0 || directionFilter !== 'all' || statusFilter !== 'all' || selectedCpId !== 'all' || selectedContractId !== 'all',
              onClear: () => {
                setSearchQuery('');
                setDirectionFilter('all');
                setStatusFilter('all');
                setSelectedCpId('all');
                setSelectedContractId('all');
              }
            }}
            onOpen={(inv) => openInvoiceModal(inv)}
            onStatusChange={(inv, status) => updateInvoiceStatus(inv.id, status)}
            onMassStatusChange={async (selectedInvoices, status) => {
              if (selectedInvoices.length === 0) return;
              if (!confirm(`Are you sure you want to change the status of ${selectedInvoices.length} invoices to "${status.replace('_', ' ')}"?`)) return;
              
              let successCount = 0;
              for (const inv of selectedInvoices) {
                const ok = await updateInvoiceStatus(inv.id, status);
                if (ok) successCount++;
              }
              if (successCount === selectedInvoices.length) {
                notifySuccess(`Successfully updated ${successCount} invoices.`);
              } else {
                alert(`Warning: Only updated ${successCount} out of ${selectedInvoices.length} invoices.`);
              }
            }}
            onMarkPaid={(inv, remaining) => {
              setPayingInvoice(inv);
              setPayAmount(remaining);
              setPayDate(new Date().toISOString().split('T')[0]);
              setPayBankRef('');
              setPayNote(`Payment for ${inv.invoice_number}`);
            }}
            onDelete={(inv) => {
              if (confirm(`Are you sure you want to delete invoice ${inv.invoice_number}? This action cannot be undone and will remove all linked document archives and payment records.`)) {
                deleteInvoice(inv.id);
              }
            }}
            onUploadDocument={(inv, file) => handleUploadDocument(inv.id, file)}
            onPreviewDocument={(inv) => {
              if (inv.documents && inv.documents[0]) {
                setPreviewDoc({
                  name: inv.documents[0].file_name,
                  url: inv.documents[0].url,
                  storagePath: inv.documents[0].storage_path,
                  subtitle: `Invoice #${inv.invoice_number} · ${inv.counterparty?.legal_name || 'Counterparty'}`
                });
              }
            }}
            onPreviewAade={(inv) => {
              if (inv.qr_url) {
                setPreviewDoc({
                  name: `AADE Verification — ${inv.invoice_number}`,
                  url: inv.qr_url,
                  subtitle: `myDATA ${inv.mark} · ${inv.counterparty?.legal_name || 'Counterparty'}`
                });
              }
            }}
            onOpenCounterparty={(inv) => {
              if (inv.counterparty_id) router.push(`/counterparties/${inv.counterparty_id}`);
            }}
          />
        </>
      )}

      {activeTab === 'billing_actions' && (
        <Card
          title="Invoicing queue"
          subtitle="Periods the contracts already owe. Create the draft here, or open the register pre-filled."
          action={
            <div className="flex items-center gap-3">
              {activeQueue.filter(i => i.status === 'unbilled').length > 0 && (
                <Badge variant="warning">
                  {activeQueue.filter(i => i.status === 'unbilled').length} unbilled
                </Badge>
              )}
              {dismissedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDismissed(v => !v)}
                  className="text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)] inline-flex items-center gap-1 cursor-pointer"
                  title="Show or hide the suggestions you dismissed"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  {showDismissed ? 'Hide' : 'Show'} dismissed ({dismissedCount})
                </button>
              )}
            </div>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
              <input
                type="text"
                placeholder="Search counterparty, reference or period"
                value={actionSearchQuery}
                onChange={(e) => setActionSearchQuery(e.target.value)}
                className="h-8 px-2.5 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-4)] focus:outline-none focus:border-[var(--accent)] flex-1 min-w-[180px]"
              />
              <select
                value={actionFilterStatus}
                onChange={(e) => setActionFilterStatus(e.target.value)}
                className="h-8 px-2 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[12px] text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                <option value="all">All statuses</option>
                <option value="unbilled">Unbilled only</option>
                <option value="draft_created">Draft created</option>
                <option value="billed">Invoiced</option>
              </select>
              <select
                value={actionFilterDirection}
                onChange={(e) => setActionFilterDirection(e.target.value)}
                className="h-8 px-2 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[12px] text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                <option value="all">All directions</option>
                <option value="revenue">Revenue only</option>
                <option value="cost">Spend only</option>
              </select>
              <ClearFiltersControl
                active={actionSearchQuery.trim().length > 0 || actionFilterStatus !== 'all' || actionFilterDirection !== 'all'}
                onClear={() => { setActionSearchQuery(''); setActionFilterStatus('all'); setActionFilterDirection('all'); }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">Sort:</span>
              <select
                value={actionSortBy}
                onChange={(e) => setActionSortBy(e.target.value as 'period' | 'amount_desc' | 'amount_asc' | 'counterparty')}
                className="h-8 px-2 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] text-[12px] text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                <option value="period">Urgency and period</option>
                <option value="amount_desc">Amount, high to low</option>
                <option value="amount_asc">Amount, low to high</option>
                <option value="counterparty">Counterparty name</option>
              </select>
            </div>
          </div>

          <div className="h-[calc(100vh-400px)] min-h-[440px] border border-[var(--line)] rounded-[var(--radius-control)] overflow-hidden">
            <BillingActionGrid
              items={filteredActionQueue}
              onQuickCreate={(item) => handleQuickCreateInvoice(item as unknown as (typeof pendingInvoicesQueue)[number])}
              onDismiss={showDismissed ? undefined : dismissSuggestion}
            />
          </div>

          {dismissedCount > 0 && (
            <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-extrabold text-slate-700 inline-flex items-center gap-1.5">
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" /> Dismissed suggestions ({dismissedCount})
                </span>
                <span className="text-[11px] text-slate-400">
                  Dismissing only hides the reminder — the contract period stays unbilled until an invoice exists.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {pendingInvoicesQueue.filter(i => dismissedKeys.includes(suggestionId(i))).map(item => (
                  <span key={suggestionId(item)} className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-600">
                    <span className="truncate max-w-[280px]">{item.counterpartyName} · {item.periodLabel}</span>
                    <button
                      type="button"
                      onClick={() => restoreSuggestion(suggestionId(item))}
                      className="inline-flex items-center gap-1 text-[#2f6fa3] hover:underline cursor-pointer"
                      title="Bring this suggestion back into the queue"
                    >
                      <RotateCcw className="w-3 h-3" /> Restore
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'receipts' && <ReceiptsPanel />}

      {/* REGISTRATION / EDIT MODAL */}
      {isRegisterModalOpen && (
        <Modal
          isOpen={true}
          size="full"
          eyebrow="Corporate tax invoice · common truth"
          title={editingInvoiceId ? 'Edit invoice' : 'Register invoice'}
          onClose={() => { setIsRegisterModalOpen(false); setEditingInvoiceId(null); }}
        >
          <div className="space-y-4 max-h-[78vh] overflow-y-auto px-1">
            {duplicateWarning && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center gap-2 animate-bounce">
                <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>{duplicateWarning}</span>
              </div>
            )}

            <FormSection index="01" title="Document & party" hint="Who bills whom, and under which document">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="ui-label block mb-1.5">Direction</label>
                <select
                  value={newDirection}
                  onChange={(e: any) => setNewDirection(e.target.value)}
                  className="ui-input font-semibold bg-[var(--surface-muted)]"
                >
                  <option value="outgoing">Outgoing Client Bill (AR)</option>
                  <option value="incoming">Incoming Supplier Bill (AP)</option>
                </select>
              </div>

              <div>
                <label className="ui-label block mb-1.5">Document Type</label>
                <select
                  value={newType}
                  onChange={(e: any) => setNewType(e.target.value)}
                  className="ui-input font-semibold bg-[var(--surface-muted)]"
                >
                  <option value="invoice">Official Tax Invoice</option>
                  <option value="credit_note">Credit Note (Negative Refund)</option>
                  <option value="proforma">Proforma (Non-tax estimate)</option>
                  <option value="debit_note">Debit Note</option>
                </select>
              </div>

              <div>
                <label className="ui-label block mb-1.5">Invoice Status</label>
                <select
                  value={newStatus}
                  onChange={(e: any) => setNewStatus(e.target.value)}
                  className="ui-input font-semibold bg-[var(--surface-muted)]"
                >
                  <option value="draft">Draft</option>
                  <option value="registered">Registered</option>
                  <option value="sent_received">Sent / Received</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="paid">Paid in Full</option>
                  <option value="disputed">Disputed</option>
                  <option value="resolved">Resolved</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="ui-label block mb-1.5">Corporate Counterparty</label>
                <SearchableSelect
                  value={newCpId}
                  onChange={setNewCpId}
                  emptyLabel="Select corporate entity…"
                  placeholder="Search by legal name, ΑΦΜ, domain…"
                  options={counterparties.map(cp => ({
                    value: cp.id,
                    label: cp.legal_name,
                    hint: cp.vat_number ? `ΑΦΜ ${cp.vat_number}` : '',
                    keywords: `${cp.trade_name || ''} ${cp.vat_number || ''} ${cp.afm || ''} ${cp.website_domain || ''}`,
                  }))}
                />
              </div>

              <div>
                <label className="ui-label block mb-1.5">Linkage: Agreements &amp; Projects</label>
                <InvoiceLinkPicker
                  contractIds={newContractIds}
                  projectIds={newProjectIds}
                  contracts={contracts || []}
                  projects={projects || []}
                  counterpartyId={newCpId}
                  onChange={handleLinksChange}
                />
              </div>
            </div>

            {newContractIds.length === 0 && (
              <div>
                <label className="ui-label block mb-1.5">Expense & Budget Category (For unlinked bills)</label>
                <SearchableSelect
                  value={newCatName}
                  onChange={setNewCatName}
                  emptyLabel="Select budget expenditure tag…"
                  placeholder="Search category…"
                  options={(invoiceCategories || []).map(cat => ({
                    value: cat.name,
                    label: cat.name,
                    hint: cat.description || 'Budget tag',
                    keywords: cat.description || '',
                  }))}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="ui-label block mb-1.5">Invoice Number *</label>
                <input
                  type="text"
                  value={newInvNumber}
                  onChange={(e) => handleNumberChange(e.target.value, newCpId, newDirection)}
                  placeholder="e.g., TIM-2026-0089 or INV-892"
                  className="ui-input font-mono font-semibold bg-[var(--surface-muted)]"
                />
              </div>

              <div>
                <label className="ui-label block mb-1.5">AADE myDATA MARK Code (Optional)</label>
                <input
                  type="text"
                  value={newMark}
                  onChange={(e) => setNewMark(e.target.value)}
                  placeholder="e.g., 4009281729013"
                  className="ui-input font-mono bg-[var(--surface-muted)]"
                />
              </div>
            </div>
            </FormSection>

            <FormSection index="02" title="Amounts" hint="Net is what the contract charges — VAT is added on top">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="ui-label block mb-1.5">Invoice Currency</label>
                <select
                  value={newCurrency}
                  onChange={(e) => {
                    const code = e.target.value;
                    setNewCurrency(code);
                    // Only the EUR → EUR rate is knowable without an FX feed; non-EUR needs a manual rate.
                    if (code === DEFAULT_CURRENCY) setNewFxRate(1);
                  }}
                  className="ui-input font-semibold bg-[var(--surface-muted)]"
                >
                  {INVOICE_CURRENCIES.map(c => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="ui-label block mb-1.5">FX Rate — 1 {newCurrency} = ? EUR</label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={newFxRate}
                  disabled={newCurrency === DEFAULT_CURRENCY}
                  onChange={(e) => setNewFxRate(parseFloat(e.target.value) || 0)}
                  className="ui-input font-semibold bg-[var(--surface-muted)] disabled:bg-[var(--surface-sunken)] disabled:text-[var(--ink-4)] disabled:cursor-not-allowed"
                />
                <p className="text-[10px] mt-1">
                  {newCurrency === DEFAULT_CURRENCY ? (
                    <span className="text-slate-400">Domestic invoice — booked 1:1 in EUR.</span>
                  ) : (
                    <span className="text-slate-500">
                      EUR reporting amount:{' '}
                      <span className="font-bold text-emerald-700">{formatMoney(calculatedGrossEur)}</span>
                      {!(newFxRate > 0) && <span className="text-rose-600 font-bold"> · rate required</span>}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="ui-label block mb-1.5">Net Amount ({newCurrency}) *</label>
                <input
                  type="number"
                  value={newNet}
                  onChange={(e) => setNewNet(parseFloat(e.target.value) || 0)}
                  className="ui-input font-semibold bg-[var(--surface-muted)]"
                />
              </div>

              <div>
                <label className="ui-label block mb-1.5">VAT Rate</label>
                <select
                  value={newVatRate}
                  onChange={(e) => setNewVatRate(e.target.value)}
                  className="ui-input font-semibold bg-[var(--surface-muted)]"
                >
                  <option value="24%">Standard 24% (Domestic)</option>
                  <option value="13%">Reduced 13% (Hospitality/Dining)</option>
                  <option value="6%">Super-Reduced 6% (Books/Rx)</option>
                  <option value="0%">0% Reverse Charge / Non-EU</option>
                </select>
              </div>

              <div>
                <label className="ui-label block mb-1.5">Total Gross ({newCurrency})</label>
                <input
                  type="text"
                  value={formatMoney(calculatedGross, newCurrency)}
                  disabled
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-100 font-black text-emerald-700 cursor-not-allowed"
                />
              </div>
            </div>

            </FormSection>

            <FormSection index="03" title="Dates & billing period" hint="When it is raised, and what it covers">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="ui-label block mb-1.5">Issue Date</label>
                <DatePicker value={newIssueDate} onChange={next => setNewIssueDate(next)} className="w-full" />
              </div>

              <div>
                <label className="ui-label block mb-1.5">Due Date</label>
                <DatePicker value={newDueDate} onChange={next => setNewDueDate(next)} className="w-full" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-[6px] border border-[var(--line)] bg-[var(--surface-muted)] p-3">
              <div>
                <label className="ui-label block mb-1.5">Reference Period</label>
                <input
                  type="text"
                  placeholder="e.g. 2026-08, 2026-Q3"
                  value={newReferencePeriod}
                  onChange={(e) => setNewReferencePeriod(e.target.value)}
                  className="ui-input font-mono font-semibold text-[var(--ink)]"
                />
                <span className="text-[10px] text-slate-500 block mt-1 leading-tight">Used for contract schedules & missing invoice checks</span>
              </div>
              <div>
                <label className="ui-label block mb-1.5">Period From</label>
                <DatePicker value={newPeriodFrom} onChange={next => setNewPeriodFrom(next)} className="w-full" />
              </div>
              <div>
                <label className="ui-label block mb-1.5">Period To</label>
                <DatePicker value={newPeriodTo} onChange={next => setNewPeriodTo(next)} className="w-full" />
              </div>
            </div>

            </FormSection>

            <FormSection index="04" title="Notes, archive & links">
            <div>
              <label className="ui-label block mb-1.5">Notes & Description (Optional)</label>
              <textarea
                rows={2}
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="e.g., Quarterly SaaS Subscription billing or server hosting fee"
                className="ui-input bg-[var(--surface-muted)] resize-none py-2 h-auto"
              />
            </div>

            {editingInvoiceId && (
              <div className="pt-4 border-t border-slate-200/80">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-[#2f6fa3]" />
                      Attached Invoice Documents & Receipts
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">AADE digital vouchers and tax receipt attachments linked to this invoice</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(() => {
                      const inv = invoices.find(i => i.id === editingInvoiceId);
                      return inv?.qr_url ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewDoc({
                              name: `AADE Verification — ${inv.invoice_number}`,
                              url: inv.qr_url || undefined,
                              subtitle: `myDATA ${inv.mark} · ${inv.counterparty?.legal_name || 'Counterparty'}`
                            });
                          }}
                          className="inline-flex items-center gap-1.5 bg-sky-50 text-[#2f6fa3] border border-sky-200 hover:bg-sky-100 font-bold text-[11px] px-3 py-1.5 rounded-xl cursor-pointer transition-colors shadow-2xs"
                          title="Open the public ΑΑΔΕ verification page for this invoice"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> View on AADE
                        </button>
                      ) : null;
                    })()}
                    <label className="inline-flex items-center gap-1.5 bg-[#2f6fa3]/10 text-[#2f6fa3] border border-[#2f6fa3]/20 hover:bg-[#2f6fa3]/20 font-bold text-[11px] px-3 py-1.5 rounded-xl cursor-pointer transition-colors shadow-2xs">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Attach PDF / Receipt</span>
                      <input
                        type="file"
                        accept="application/pdf,image/*,.doc,.docx"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleUploadDocument(editingInvoiceId, e.target.files[0]);
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>

                {(() => {
                  const currentInv = invoices.find(i => i.id === editingInvoiceId);
                  const docs = currentInv?.documents || [];
                  if (docs.length === 0) {
                    return (
                      <div className="p-5 rounded-xl bg-slate-50 border-2 border-dashed border-slate-200 text-center text-xs text-slate-500 space-y-2">
                        <FileText className="w-7 h-7 mx-auto text-slate-400" />
                        <p className="font-extrabold text-slate-700">No PDF documents attached yet</p>
                        <p className="text-[11px]">Click &ldquo;Attach PDF / Receipt&rdquo; above to upload digital receipts for this bill.</p>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {docs.map((doc, idx) => (
                        <div key={doc.id || idx} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs hover:bg-slate-100/70 transition-colors">
                          <div className="flex items-center gap-3 truncate min-w-0">
                            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg shrink-0">
                              <CheckCircle2 className="w-4 h-4" />
                            </div>
                            <div className="truncate min-w-0">
                              <p className="font-extrabold text-slate-900 truncate">{doc.file_name}</p>
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                                Path: {doc.storage_path || 'Supabase Enterprise Storage'} &bull; v{doc.version || 1}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewDoc({
                                  name: doc.file_name,
                                  url: doc.url,
                                  storagePath: doc.storage_path,
                                  subtitle: `Invoice #${currentInv?.invoice_number} · ${currentInv?.counterparty?.legal_name || 'Counterparty'}`
                                });
                              }}
                              className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-bold text-[11px] flex items-center gap-1 px-2.5 transition-colors cursor-pointer shadow-2xs"
                            >
                              <Eye className="w-3.5 h-3.5" /> Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (doc.url && (doc.url.startsWith('http') || doc.url.startsWith('data:'))) {
                                  const a = document.createElement('a');
                                  a.href = doc.url;
                                  a.download = doc.file_name || 'invoice_receipt.pdf';
                                  a.click();
                                } else {
                                  alert(`Downloading ${doc.file_name}...`);
                                }
                              }}
                              className="p-1.5 bg-white hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg font-bold text-[11px] flex items-center gap-1 px-2.5 transition-colors cursor-pointer shadow-2xs"
                            >
                              <Download className="w-3.5 h-3.5 text-blue-600" /> Download
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Links UI */}
            <div className="space-y-3 pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#2f6fa3]" />
                  <h3 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">Associated Links</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setNewLinks([...newLinks, { title: '', url: '' }])}
                  className="text-[11px] font-bold text-[#2f6fa3] hover:text-blue-700 bg-sky-50 hover:bg-sky-100 px-2 py-1 rounded transition-colors"
                >
                  + Add Link
                </button>
              </div>
              {newLinks.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic">No links attached.</p>
              ) : (
                <div className="space-y-2">
                  {newLinks.map((link, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Title (Optional)"
                        value={link.title}
                        onChange={(e) => {
                          const updated = [...newLinks];
                          updated[idx].title = e.target.value;
                          setNewLinks(updated);
                        }}
                        className="w-1/3 text-xs p-1.5 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#2f6fa3]"
                      />
                      <input
                        type="url"
                        placeholder="URL (Required)"
                        value={link.url}
                        onChange={(e) => {
                          const updated = [...newLinks];
                          updated[idx].url = e.target.value;
                          setNewLinks(updated);
                        }}
                        className="flex-1 text-xs p-1.5 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#2f6fa3]"
                      />
                      <button
                        type="button"
                        onClick={() => setNewLinks(newLinks.filter((_, i) => i !== idx))}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            </FormSection>

            <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-[var(--surface)] border-t border-[var(--line-strong)] flex items-center justify-end gap-2">
              <Button onClick={() => setIsRegisterModalOpen(false)} variant="outline" className="px-4 py-2 text-xs font-bold">
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!newCpId || !newInvNumber.trim()) {
                    alert('Please choose a counterparty entity and input an invoice number.');
                    return;
                  }
                  if (duplicateWarning) {
                    if (!confirm('Warning: Possible duplicate invoice number detected! Are you certain you want to proceed?')) {
                      return;
                    }
                  }
                  // A missing rate would silently file the invoice as €0 in the EUR ledger.
                  if (newCurrency !== DEFAULT_CURRENCY && !(newFxRate > 0)) {
                    alert(`Enter the FX rate (1 ${newCurrency} = ? EUR) before saving.`);
                    return;
                  }
                  if (editingInvoiceId) {
                    const res = await updateInvoice(editingInvoiceId, {
                      direction: newDirection,
                      counterparty_id: newCpId,
                      contract_id: newContractId || null,
                      contract_ids: newContractIds,
                      project_ids: newProjectIds,
                      type: newType,
                      invoice_number: newInvNumber.trim(),
                      mark: newMark.trim() || null,
                      category: newCatName || (newContractIds.length > 0 ? null : 'Other Operational'),
                      issue_date: newIssueDate,
                      due_date: newDueDate,
                      period_from: newPeriodFrom || null,
                      period_to: newPeriodTo || null,
                      reference_period: newReferencePeriod.trim() || null,
                      currency: newCurrency,
                      fx_rate: newFxRate,
                      net: newNet,
                      vat_amount: calculatedVat,
                      vat_rate: newVatRate,
                      gross: calculatedGross,
                      gross_eur: calculatedGrossEur,
                      status: newStatus,
                      notes: newNotes.trim() || null,
                      links: newLinks as any
                    });
                    if (res) {
                      setIsRegisterModalOpen(false);
                      setEditingInvoiceId(null);
                      setNewInvNumber('');
                      setNewNotes('');
                      notifySuccess('Invoice updated.');
                    }
                    return;
                  }
                  const res = await addInvoice({
                    direction: newDirection,
                    counterparty_id: newCpId,
                    contract_id: newContractId || null,
                    contract_ids: newContractIds,
                    project_ids: newProjectIds,
                    type: newType,
                    invoice_number: newInvNumber.trim(),
                    mark: newMark.trim() || null,
                    category: newCatName || (newContractIds.length > 0 ? null : 'Other Operational'),
                    issue_date: newIssueDate,
                    due_date: newDueDate,
                    period_from: newPeriodFrom,
                    period_to: newPeriodTo,
                    reference_period: newReferencePeriod.trim() || null,
                    currency: newCurrency,
                    fx_rate: newFxRate,
                    net: newNet,
                    vat_amount: calculatedVat,
                    vat_rate: newVatRate,
                    gross: calculatedGross,
                    gross_eur: calculatedGrossEur,
                    status: newStatus,
                    missing_document: true,
                    notes: newNotes.trim() || null,
                    links: newLinks as any
                  });
                  if (res) {
                    setIsRegisterModalOpen(false);
                    setNewInvNumber('');
                    setNewNotes('');
                    notifySuccess('Invoice recorded in the archive.');
                  }
                }}
                variant="primary"
                className="px-5 py-2 text-xs font-bold"
              >
                {editingInvoiceId ? "Save changes" : "Register invoice"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 1-CLICK FAST PATH PAYMENT MODAL */}
      {payingInvoice && (
        <Modal isOpen={true} title={`Record Settlement for ${payingInvoice.invoice_number}`} onClose={() => setPayingInvoice(null)}>
          <div className="space-y-4 px-1">
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs flex items-center justify-between">
              <div>
                <span className="font-extrabold block">Total Gross: {formatMoney(payingInvoice.gross_eur)}</span>
                <span className="text-[11px] text-emerald-700">Entity: {payingInvoice.counterparty?.legal_name}</span>
                {payingInvoice.currency !== DEFAULT_CURRENCY && (
                  <span className="text-[10px] text-emerald-700/80 block">
                    Issued as {formatMoney(payingInvoice.gross, payingInvoice.currency)} @ {payingInvoice.fx_rate}
                  </span>
                )}
              </div>
              <Badge variant="success" className="font-bold text-xs">Awaiting Settlement</Badge>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="ui-label block mb-1.5">Amount Paid (€) *</label>
                <input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(parseFloat(e.target.value) || 0)}
                  className="ui-input font-semibold bg-[var(--surface-muted)]"
                />
              </div>

              <div>
                <label className="ui-label block mb-1.5">Payment Date *</label>
                <DatePicker value={payDate} onChange={next => setPayDate(next)} className="w-full" />
              </div>
            </div>

            <div>
              <label className="ui-label block mb-1.5">Bank / SEPA Reference Code (Optional)</label>
              <input
                type="text"
                value={payBankRef}
                onChange={(e) => setPayBankRef(e.target.value)}
                placeholder="e.g., EUR-SEPA-ALPHA-992182093"
                className="ui-input font-mono bg-[var(--surface-muted)]"
              />
            </div>

            <div>
              <label className="ui-label block mb-1.5">Settlement Note</label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="e.g. Paid via Alpha Bank business account"
                className="ui-input bg-[var(--surface-muted)]"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <Button onClick={() => setPayingInvoice(null)} variant="outline" className="px-5 py-2.5 text-xs font-bold">
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (payAmount <= 0) {
                    alert('Please enter a valid payment amount greater than 0.');
                    return;
                  }
                  await recordInvoicePayment(payingInvoice.id, payDate, payAmount, payBankRef, payNote);
                  setPayingInvoice(null);
                  notifySuccess('Payment milestone recorded. Invoice status updated.');
                }}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold px-6 py-2.5 rounded-xl text-xs shadow-md shadow-emerald-600/20"
              >
                Confirm & Settle
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {previewDoc && (
        <DocumentPreviewModal
          isOpen={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          documentName={previewDoc.name}
          documentUrl={previewDoc.url}
          storagePath={previewDoc.storagePath}
          subtitle={previewDoc.subtitle}
        />
      )}

      {/* RIGHT-CLICK CUSTOM CONTEXT MENU FOR INVOICES */}
      {contextMenu && (
        <div 
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 text-xs overflow-hidden animate-in fade-in zoom-in-95 duration-150 font-sans"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 mb-1">
            <div className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">⚡ Quick Copy Menu</div>
            <div className="font-extrabold text-slate-800 truncate text-sm">INV: {contextMenu.invoice.invoice_number} &mdash; {contextMenu.invoice.counterparty?.legal_name || 'Entity'}</div>
          </div>

          <div className="py-1 space-y-0.5">
            <button
              type="button"
              onClick={() => {
                copyToClipboard(contextMenu.invoice.id, `Invoice UUID (${contextMenu.invoice.id.slice(0,8)}...)`, contextMenu.invoice.id);
                setContextMenu(null);
              }}
              className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 text-[#2f6fa3]" /> Copy Invoice UUID
              </span>
              <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{contextMenu.invoice.id.slice(0, 6)}...</span>
            </button>

            <button
              type="button"
              onClick={() => {
                copyToClipboard(contextMenu.invoice.counterparty_id || 'N/A', `Counterparty UUID`, undefined);
                setContextMenu(null);
              }}
              className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-blue-600" /> Copy Counterparty UUID
              </span>
              <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{contextMenu.invoice.counterparty_id?.slice(0, 6) || 'None'}...</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const val = `€${contextMenu.invoice.gross_eur.toLocaleString() || '0'} (Net: €${contextMenu.invoice.net || '0'} + VAT: €${contextMenu.invoice.vat_amount || '0'})`;
                copyToClipboard(val, `Invoice Gross (€${contextMenu.invoice.gross_eur.toLocaleString()})`, undefined);
                setContextMenu(null);
              }}
              className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Copy Gross & VAT Breakdown
              </span>
              <span className="text-[10px] font-bold text-emerald-700">€{contextMenu.invoice.gross_eur.toLocaleString()}</span>
            </button>
          </div>

          <div className="border-t border-slate-100 my-1 pt-1">
            <button
              type="button"
              onClick={() => {
                const inv = contextMenu.invoice;
                const report = [
                  `🧾 INVOICE FAST REPORT: ${inv.invoice_number}`,
                  `=========================================`,
                  `• Counterparty: ${inv.counterparty?.legal_name || 'Unmapped Entity'} (CP UUID: ${inv.counterparty_id || 'N/A'})`,
                  `• Invoice UUID: ${inv.id}`,
                  `• Invoice # & MARK: ${inv.invoice_number} (AADE MARK: ${inv.mark || 'Pending Sync'})`,
                  `• Direction & Status: ${inv.direction.toUpperCase()} - ${inv.status.toUpperCase()}`,
                  `• Reference Period: ${inv.reference_period || 'N/A / Standalone'} (Period: ${inv.period_from || 'N/A'} to ${inv.period_to || 'N/A'})`,
                  `• Financial Breakdown: Net €${(inv.net || 0).toLocaleString()} + VAT (${inv.vat_rate || '24%'}): €${(inv.vat_amount || 0).toLocaleString()} = Total Gross €${(inv.gross_eur || 0).toLocaleString()}`,
                  `• Timelines: Issued on ${formatDate(inv.issue_date)} | Due by ${formatDate(inv.due_date)}`,
                  `• Linked agreements: ${invoiceContractIds(inv).join(', ') || 'standalone (no contract)'}` +
                    (invoiceProjectIds(inv).length > 0 ? ` · projects: ${invoiceProjectIds(inv).join(', ')}` : ''),
                  `• Notes: ${inv.notes || 'No additional settlement caveats reported.'}`
                ].join('\n');
                copyToClipboard(report, `Invoice Fast Report (${inv.invoice_number})`, undefined);
                setContextMenu(null);
              }}
              className="w-full px-3.5 py-2 text-left text-slate-800 hover:bg-emerald-50 hover:text-emerald-900 font-bold flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 text-emerald-700">
                <Share2 className="w-4 h-4 text-emerald-600" /> Copy Fast Report (For Colleague)
              </span>
              <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded uppercase border border-emerald-200">Text</span>
            </button>
          </div>
        </div>
      )}

      {/* FLOATING TOAST FEEDBACK FOR COPIED VALUES */}
      {copyFeedback && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-3 animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div className="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
            <Check className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-100">Copied to Clipboard!</div>
            <div className="text-[11px] text-slate-400 font-mono truncate max-w-xs">{copyFeedback}</div>
          </div>
        </div>
      )}
      {/* Sync myDATA Modal */}
      <Modal isOpen={isSyncModalOpen} onClose={() => setIsSyncModalOpen(false)} title="Sync myDATA Invoices" size="md">
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-500">
            Enter the VAT number of the counterparty you want to sync invoices for. This will fetch all invoices issued by your company to this VAT number, or received by your company from this VAT number.
          </p>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Counterparty VAT Number</label>
            <input 
              type="text" 
              value={syncVatNumber} 
              onChange={e => setSyncVatNumber(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              placeholder="e.g. 801431008"
            />
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 rounded-b-2xl">
          <Button onClick={() => setIsSyncModalOpen(false)} variant="outline" className="px-5 py-2.5 text-xs font-bold">
            Cancel
          </Button>
          <Button
            disabled={!syncVatNumber.trim() || isSyncing}
            onClick={async () => {
              setIsSyncing(true);
              try {
                const res = await fetch('/api/integrations/mydata/sync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ vatNumber: syncVatNumber.trim() })
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => null);
                  throw new Error(data?.error || `HTTP ${res.status}`);
                }
                const result = await res.json();
                notifySuccess(`Successfully synced ${result.docsImported} documents from myDATA.`);
                setIsSyncModalOpen(false);
              } catch (e) {
                alert(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
              } finally {
                setIsSyncing(false);
              }
            }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 rounded-xl shadow-sm text-xs flex items-center gap-2"
          >
            {isSyncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </Button>
        </div>
      </Modal>

    </div>
  );
}
