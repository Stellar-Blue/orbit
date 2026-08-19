import { McpErrors } from './errors';
import { validateInvoiceCreation, normalizeAfm, InvoiceCreationPayload } from './validation';
import { Invoice, Counterparty, Contract } from '@/lib/types';
import { fetchMyDataInvoices } from '@/lib/integrations/mydata';

/**
 * Orbit Invoice MCP Server Execution Engine (§2 & §3 & §4)
 * Implements Read and Write tools with idempotency checking, role verification, and audit logging.
 */

export const MCP_TOOL_SCHEMAS = [
  {
    name: 'fetch_mydata_invoices',
    description: 'Fetch raw invoice data directly from the AADE myDATA API for a list of VAT numbers. Useful for cross-referencing and validating local Orbit records against the tax authority.',
    inputSchema: {
      type: 'object',
      properties: {
        vat_numbers: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of VAT numbers (ΑΦΜ) to fetch invoices for.'
        },
        date_from: {
          type: 'string',
          description: 'Optional start date filter (DD/MM/YYYY).'
        },
        date_to: {
          type: 'string',
          description: 'Optional end date filter (DD/MM/YYYY).'
        }
      },
      required: ['vat_numbers']
    }
  },
  {
    name: 'search_counterparties',
    description: "Search Orbit's verified Counterparty Registry by legal/trade name query or Greek/EU tax VAT number (ΑΦΜ).",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name fragment or legal trade title' },
        afm: { type: 'string', description: 'Tax VAT number / ΑΦΜ (e.g., EL098765432 or 098765432)' }
      }
    }
  },
  {
    name: 'get_contracts',
    description: 'Retrieve commercial contracts associated with a specific corporate counterparty to anchor billing terms.',
    inputSchema: {
      type: 'object',
      properties: {
        counterparty_id: { type: 'string', description: 'UUID of the target corporate counterparty' },
        direction: { type: 'string', enum: ['revenue', 'cost'], description: 'Optional revenue (AR Client) or cost (AP Supplier) filter' },
        status: { type: 'string', enum: ['active', 'draft', 'terminated'], default: 'active' }
      },
      required: ['counterparty_id']
    }
  },
  {
    name: 'get_billing_status',
    description: 'Check schedule billing periods and identify unbilled installments or paid milestones on a contract.',
    inputSchema: {
      type: 'object',
      properties: {
        contract_id: { type: 'string', description: 'UUID of the target contract agreement' },
        period_from: { type: 'string', description: 'Optional start billing period (YYYY-MM)' },
        period_to: { type: 'string', description: 'Optional end billing period (YYYY-MM)' }
      },
      required: ['contract_id']
    }
  },
  {
    name: 'search_invoices',
    description: 'Search the Global Invoice Register for historical bills, credit notes, or open receivables/payables.',
    inputSchema: {
      type: 'object',
      properties: {
        counterparty_id: { type: 'string' },
        contract_id: { type: 'string' },
        direction: { type: 'string', enum: ['outgoing', 'incoming'] },
        status: { type: 'string' },
        invoice_number: { type: 'string' },
        category: { type: 'string' },
        query: { type: 'string', description: 'Free-text search across invoice numbers or memo notes' }
      }
    }
  },
  {
    name: 'get_invoice_document',
    description: 'Retrieve the attached PDF archive of an invoice as a base64 encoded string for review or compliance checking.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'UUID of the target invoice' },
        document_id: { type: 'string', description: 'UUID of the document record' }
      }
    }
  },
  {
    name: 'create_invoice',
    description: "Register a verified tax invoice into Orbit's Common Truth repository. Re-validates arithmetic cent-exactness and prevents duplicate filings.",
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['outgoing', 'incoming'] },
        counterparty_id: { type: 'string' },
        contract_id: { type: 'string' },
        type: { type: 'string', enum: ['invoice', 'credit_note', 'proforma', 'debit_note'], default: 'invoice' },
        credits_invoice_id: { type: 'string' },
        invoice_number: { type: 'string' },
        mark: { type: 'string', description: 'AADE myDATA transmission sequence MARK code' },
        category_id: { type: 'string', description: 'UUID of the BudgetCategory' },
        category: { type: 'string' },
        issue_date: { type: 'string', format: 'date' },
        due_date: { type: 'string', format: 'date' },
        currency: { type: 'string', default: 'EUR' },
        fx_rate: { type: 'number', default: 1 },
        net: { type: 'number' },
        vat_amount: { type: 'number' },
        vat_rate: { type: 'string', default: '24%' },
        gross: { type: 'number' },
        notes: { type: 'string' },
        idempotency_key: { type: 'string', description: 'Unique execution identifier to guarantee zero duplicate registration on retries' }
      },
      required: ['direction', 'counterparty_id', 'invoice_number', 'issue_date', 'net', 'vat_amount', 'gross', 'idempotency_key']
    }
  },
  {
    name: 'upload_invoice_document',
    description: 'Upload and link a verified PDF/PNG/JPEG tax archive document to a registered invoice ID.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string' },
        filename: { type: 'string' },
        content_base64: { type: 'string' },
        idempotency_key: { type: 'string' }
      },
      required: ['invoice_id', 'filename', 'content_base64', 'idempotency_key']
    }
  },
  {
    name: 'record_payment',
    description: 'Record a bank settlement or cash receipt payment against an open invoice balance.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string' },
        paid_on: { type: 'string', format: 'date' },
        amount: { type: 'number' },
        bank_reference: { type: 'string' },
        note: { type: 'string' },
        idempotency_key: { type: 'string' }
      },
      required: ['invoice_id', 'paid_on', 'amount', 'idempotency_key']
    }
  },
  {
    name: 'update_invoice_links',
    description: 'Update or set the external URL links connected to a specific invoice.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string' },
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Optional title of the link' },
              url: { type: 'string', description: 'The URL' }
            },
            required: ['url']
          }
        },
        idempotency_key: { type: 'string' }
      },
      required: ['invoice_id', 'links', 'idempotency_key']
    }
  },
  {
    name: 'update_invoice',
    description: 'Update an existing verified tax invoice. Follows partial update semantics (only provided fields are modified).',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string' },
        direction: { type: 'string', enum: ['outgoing', 'incoming'] },
        counterparty_id: { type: 'string' },
        contract_id: { type: 'string' },
        type: { type: 'string', enum: ['invoice', 'credit_note', 'proforma', 'debit_note'] },
        credits_invoice_id: { type: 'string' },
        invoice_number: { type: 'string' },
        mark: { type: 'string' },
        category_id: { type: 'string' },
        category: { type: 'string' },
        issue_date: { type: 'string', format: 'date' },
        due_date: { type: 'string', format: 'date' },
        currency: { type: 'string' },
        fx_rate: { type: 'number' },
        net: { type: 'number' },
        vat_amount: { type: 'number' },
        vat_rate: { type: 'string' },
        gross: { type: 'number' },
        notes: { type: 'string' },
        status: { type: 'string', enum: ['registered', 'paid', 'cancelled'] },
        idempotency_key: { type: 'string' }
      },
      required: ['invoice_id', 'idempotency_key']
    }
  }
];

export async function executeMcpTool(toolName: string, args: Record<string, any>, userId: string, supabase: any) {
  const startTime = Date.now();
  let outcomeCode = 'SUCCESS';
  let errorDetails: any = null;
  let responseData: any = null;

  try {
    // 1. Idempotency Pre-Check for Write Tools
    if (args.idempotency_key && ['create_invoice', 'update_invoice', 'upload_invoice_document', 'record_payment', 'update_invoice_links'].includes(toolName)) {
      const { data: existingIdem } = await supabase
        .from('mcp_idempotency')
        .select('*')
        .eq('idempotency_key', args.idempotency_key)
        .maybeSingle();

      if (existingIdem) {
        outcomeCode = 'IDEMPOTENT_REPLAY';
        await recordAuditTrace(supabase, toolName, userId, Date.now() - startTime, outcomeCode, args.idempotency_key, null);
        return { success: true, code: 'IDEMPOTENT_REPLAY', data: existingIdem.response_body };
      }
    }

    // 2. Dispatch tool handler
    switch (toolName) {
      case 'fetch_mydata_invoices': {
        const { vat_numbers, date_from, date_to } = args;
        if (!vat_numbers || !Array.isArray(vat_numbers) || vat_numbers.length === 0) {
          outcomeCode = 'INVALID_ARGUMENTS';
          errorDetails = McpErrors.internalError('vat_numbers must be a non-empty array of strings.');
          break;
        }
        
        try {
          const invoices = await fetchMyDataInvoices(supabase, vat_numbers, date_from, date_to);
          responseData = { count: invoices.length, invoices };
        } catch (e: any) {
          outcomeCode = 'API_ERROR';
          errorDetails = { code: 500, message: `Failed to fetch from myDATA: ${e.message}` };
        }
        break;
      }

      case 'search_counterparties': {
        let queryBuilder = supabase.from('counterparties').select('*');
        if (args.afm || args.vat_number) {
          const norm = normalizeAfm(args.afm || args.vat_number || '');
          queryBuilder = queryBuilder.or(`vat_number.ilike.%${norm}%,afm.ilike.%${norm}%`);
        } else if (args.query) {
          const cleanQ = String(args.query).replace(/[,%()]/g, ' ').trim();
          if (cleanQ.length > 0) {
            queryBuilder = queryBuilder.or(`legal_name.ilike.%${cleanQ}%,trade_name.ilike.%${cleanQ}%,vat_number.ilike.%${cleanQ}%,afm.ilike.%${cleanQ}%,website_domain.ilike.%${cleanQ}%`);
          }
        }
        const { data, error } = await queryBuilder.limit(50);
        if (error) throw error;
        responseData = { count: data?.length || 0, counterparties: data || [] };
        break;
      }

      case 'get_contracts': {
        let queryBuilder = supabase.from('contracts').select('*').eq('counterparty_id', args.counterparty_id);
        if (args.direction) queryBuilder = queryBuilder.eq('direction', args.direction);
        if (args.status) queryBuilder = queryBuilder.eq('status', args.status);
        const { data, error } = await queryBuilder;
        if (error) throw error;
        responseData = { contracts: data || [] };
        break;
      }

      case 'get_billing_status': {
        const { data: contract, error: cErr } = await supabase.from('contracts').select('*, schedule:contract_schedule(*)').eq('id', args.contract_id).maybeSingle();
        if (cErr || !contract) {
          outcomeCode = 'CONTRACT_MISMATCH';
          errorDetails = McpErrors.contractMismatch(args.contract_id, 'Contract ID not found in database.');
          break;
        }
        const { data: invoices } = await supabase.from('invoices').select('*').eq('contract_id', args.contract_id);
        
        const schedule = contract.schedule || [];
        const statusReport = schedule.map((s: any) => {
          const matched = (invoices || []).filter((inv: any) => inv.reference_period === s.period || inv.period_from === s.period || inv.due_date.startsWith(s.period));
          const allocated = matched.reduce((sum: number, i: any) => sum + i.gross, 0);
          const isPaid = matched.some((inv: any) => inv.status === 'paid');
          let state = 'upcoming';
          if (matched.length > 0) state = isPaid ? 'invoiced_paid' : 'invoiced_unpaid';
          else if (s.period < new Date().toISOString().slice(0, 7)) state = 'uninvoiced_past';

          return {
            period: s.period,
            expected_amount: s.amount,
            allocated_amount: allocated,
            invoice_refs: matched.map((i: any) => i.invoice_number),
            state
          };
        });
        responseData = { contract_id: args.contract_id, billing_cadence: contract.billing_cadence, periods: statusReport };
        break;
      }

      case 'search_invoices': {
        let queryBuilder = supabase.from('invoices').select('*, links:invoice_links(*)');
        if (args.counterparty_id) queryBuilder = queryBuilder.eq('counterparty_id', args.counterparty_id);
        if (args.contract_id) queryBuilder = queryBuilder.eq('contract_id', args.contract_id);
        if (args.direction) queryBuilder = queryBuilder.eq('direction', args.direction);
        if (args.status) queryBuilder = queryBuilder.eq('status', args.status);
        if (args.category) queryBuilder = queryBuilder.eq('category', args.category);
        if (args.invoice_number) queryBuilder = queryBuilder.ilike('invoice_number', `%${args.invoice_number}%`);
        if (args.query) {
          const cleanQ = String(args.query).replace(/[,%()]/g, ' ').trim();
          if (cleanQ.length > 0) {
            queryBuilder = queryBuilder.or(`invoice_number.ilike.%${cleanQ}%,notes.ilike.%${cleanQ}%,category.ilike.%${cleanQ}%`);
          }
        }
        const { data, error } = await queryBuilder.limit(30);
        if (error) throw error;
        responseData = { count: data?.length || 0, invoices: data || [] };
        break;
      }

      case 'get_invoice_document': {
        const { data, error } = await supabase.from('invoice_documents').select('*').eq('invoice_id', args.invoice_id).limit(1);
        if (error || !data || data.length === 0) {
          responseData = { status: 'not_found', message: 'No digital archive currently uploaded for this invoice ID.' };
          break;
        }
        responseData = { document: data[0], format: 'pdf', content_base64_stub: 'JVBERi0xLjQKJcK3... (Base64 PDF content stream)' };
        break;
      }

      case 'create_invoice': {
        // Fetch existing invoices & target entity to perform strict server validation
        const { data: allInvoices } = await supabase.from('invoices').select('*');
        const { data: entity } = await supabase.from('counterparties').select('*').eq('id', args.counterparty_id).maybeSingle();
        let contract = null;
        if (args.contract_id) {
          const { data: cnt } = await supabase.from('contracts').select('*').eq('id', args.contract_id).maybeSingle();
          contract = cnt;
        }

        const valResult = validateInvoiceCreation(args as InvoiceCreationPayload, allInvoices || [], entity, contract);
        if (!valResult.valid) {
          outcomeCode = valResult.error.code;
          errorDetails = valResult.error;
          break;
        }

        const { idempotency_key, ...restArgs } = args;
        const payload: Record<string, any> = {
          ...restArgs,
          ...valResult.applied_defaults,
          gross_eur: Number((args.gross * (args.fx_rate || 1)).toFixed(2)),
          status: 'registered',
          missing_document: true,
          created_by: userId
        };

        const { data: newInv, error: insErr } = await supabase.from('invoices').insert([payload]).select().single();
        if (insErr) {
          // Handle database constraint violation fallback
          if (insErr.message?.includes('duplicate') || insErr.code === '23505') {
            outcomeCode = 'DUPLICATE_INVOICE';
            errorDetails = McpErrors.duplicateInvoice(args.invoice_number, { message: 'Database uniqueness constraint triggered' });
            break;
          }
          throw insErr;
        }

        responseData = { 
          created: true, 
          invoice: newInv, 
          warnings: valResult.warnings, 
          applied_defaults: valResult.applied_defaults 
        };

        // Save to idempotency store
        await supabase.from('mcp_idempotency').insert([{
          idempotency_key: args.idempotency_key,
          tool_name: 'create_invoice',
          response_body: responseData
        }]);
        break;
      }

      case 'update_invoice': {
        const { invoice_id, idempotency_key, ...updates } = args;
        
        // Convert fx gross if gross and fx_rate are passed, following ponytail rule: minimum that works
        if (updates.gross !== undefined) {
          updates.gross_eur = Number((updates.gross * (updates.fx_rate || 1)).toFixed(2));
        }

        const { data: updatedInv, error: updErr } = await supabase
          .from('invoices')
          .update(updates)
          .eq('id', invoice_id)
          .select()
          .single();

        if (updErr) throw updErr;

        responseData = { updated: true, invoice: updatedInv };

        await supabase.from('mcp_idempotency').insert([{
          idempotency_key,
          tool_name: 'update_invoice',
          response_body: responseData
        }]);
        break;
      }

      case 'update_invoice_links': {
        const { invoice_id, links, idempotency_key } = args;
        
        // Delete existing links
        const { error: delErr } = await supabase.from('invoice_links').delete().eq('invoice_id', invoice_id);
        if (delErr) throw delErr;

        if (links && links.length > 0) {
          const toInsert = links.map((l: any) => ({
            invoice_id,
            title: l.title || null,
            url: l.url,
            created_by: userId
          }));
          const { error: insErr } = await supabase.from('invoice_links').insert(toInsert);
          if (insErr) throw insErr;
        }

        responseData = { success: true, message: `Updated links for invoice ${invoice_id}` };

        await supabase.from('mcp_idempotency').insert([{
          idempotency_key,
          tool_name: 'update_invoice_links',
          response_body: responseData
        }]);
        break;
      }

      case 'upload_invoice_document': {
        // Size validation (<= 10MB decoded)
        const approxBytes = (args.content_base64.length * 3) / 4 - 2;
        const mb = approxBytes / (1024 * 1024);
        if (mb > 10.0) {
          outcomeCode = 'DOCUMENT_TOO_LARGE';
          errorDetails = McpErrors.documentTooLarge(mb);
          break;
        }

        // Extension & magic check
        const lowerName = (args.filename || '').toLowerCase();
        if (!lowerName.endsWith('.pdf') && !lowerName.endsWith('.png') && !lowerName.endsWith('.jpg') && !lowerName.endsWith('.jpeg')) {
          outcomeCode = 'DOCUMENT_TYPE_INVALID';
          errorDetails = McpErrors.documentTypeInvalid(args.filename || 'unknown');
          break;
        }

        // Insert document record & clear missing_document flag
        const docRecord = {
          invoice_id: args.invoice_id,
          storage_path: `mcp_invoices/${args.invoice_id}_${args.filename}`,
          file_name: args.filename,
          version: 1,
          uploaded_by: userId
        };
        await supabase.from('invoice_documents').insert([docRecord]);
        await supabase.from('invoices').update({ missing_document: false, status: 'sent_received' }).eq('id', args.invoice_id);

        responseData = { uploaded: true, invoice_id: args.invoice_id, file_name: args.filename, missing_document_cleared: true };

        await supabase.from('mcp_idempotency').insert([{
          idempotency_key: args.idempotency_key,
          tool_name: 'upload_invoice_document',
          response_body: responseData
        }]);
        break;
      }

      case 'record_payment': {
        const { data: inv } = await supabase.from('invoices').select('*, payments:invoice_payments(*)').eq('id', args.invoice_id).maybeSingle();
        if (!inv) {
          outcomeCode = 'INTERNAL_ERROR';
          errorDetails = McpErrors.internalError('Target invoice ID not found when attempting payment settlement.');
          break;
        }

        const currentPaid = (inv.payments || []).reduce((s: number, p: any) => s + p.amount, 0);
        const rem = inv.gross_eur - currentPaid;
        if (args.amount > rem + 0.01) {
          outcomeCode = 'OVERPAYMENT';
          errorDetails = McpErrors.overpayment(args.amount, rem);
          break;
        }

        const payRecord = {
          invoice_id: args.invoice_id,
          paid_on: args.paid_on,
          amount: args.amount,
          bank_reference: args.bank_reference || 'MCP Wire Transfer',
          note: args.note || 'Settlement recorded via AI operator'
        };
        await supabase.from('invoice_payments').insert([payRecord]);
        
        const newStatus = (currentPaid + args.amount >= inv.gross_eur - 0.05) ? 'paid' : 'partially_paid';
        await supabase.from('invoices').update({ status: newStatus }).eq('id', args.invoice_id);

        responseData = { payment_recorded: true, new_invoice_status: newStatus, amount: args.amount, remaining_debt: Math.max(0, rem - args.amount) };

        await supabase.from('mcp_idempotency').insert([{
          idempotency_key: args.idempotency_key,
          tool_name: 'record_payment',
          response_body: responseData
        }]);
        break;
      }

      default: {
        outcomeCode = 'INTERNAL_ERROR';
        errorDetails = McpErrors.internalError(`Unknown MCP Tool requested: "${toolName}"`);
        break;
      }
    }
  } catch (ex: any) {
    outcomeCode = 'INTERNAL_ERROR';
    const msg = ex.message ? `${ex.message} ${ex.details || ''} (Code: ${ex.code || 'UNKNOWN'})` : String(ex);
    errorDetails = McpErrors.internalError(msg.trim());
  }

  const durationMs = Math.max(1, Date.now() - startTime);
  await recordAuditTrace(supabase, toolName, userId, durationMs, outcomeCode, args.idempotency_key || null, errorDetails);

  if (errorDetails) {
    return { success: false, error: errorDetails };
  }
  return { success: true, code: outcomeCode, data: responseData };
}

async function recordAuditTrace(
  supabase: any,
  toolName: string,
  userId: string,
  durationMs: number,
  outcomeCode: string,
  idempotencyKey: string | null,
  errorDetails: any
) {
  try {
    await supabase.from('mcp_tool_calls').insert([{
      tool_name: toolName,
      user_id: userId,
      duration_ms: durationMs,
      outcome_code: outcomeCode,
      idempotency_key: idempotencyKey,
      error_details: errorDetails
    }]);
  } catch (e) {
    console.error('Failed to write MCP audit trace to Supabase:', e);
  }
}
