import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

const env = fs.readFileSync('.env.local', 'utf8').split('\n');
const envMap: Record<string, string> = {};
for (const line of env) {
  if (line.includes('=')) {
    const [k, ...v] = line.split('=');
    envMap[k] = v.join('=').replace(/^"/, '').replace(/"$/, '');
  }
}

const supabaseUrl = envMap['NEXT_PUBLIC_SUPABASE_URL']!;
const supabaseKey = envMap['SUPABASE_SERVICE_ROLE_KEY']!;
const admin = createClient(supabaseUrl, supabaseKey);

const USE_DEV = envMap['MYDATA_DEV'] === 'true';
const endpoint = USE_DEV ? 'https://mydataapidev.aade.gr/RequestTransmittedDocs' : 'https://mydatapi.aade.gr/myDATA/RequestTransmittedDocs';

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
  processEntities: {
    enabled: true,
    maxTotalExpansions: 1_000_000,
    maxExpandedLength: 50_000_000,
  },
});

async function main() {
  const { data: userSecret } = await admin.rpc('vault_get_secret', { p_name: 'mydata:username' });
  const { data: keySecret } = await admin.rpc('vault_get_secret', { p_name: 'mydata:subscription_key' });
  
  if (!userSecret || !keySecret) {
    console.log("No credentials");
    return;
  }
  
  const headers = {
    'aade-user-id': userSecret,
    'ocp-apim-subscription-key': keySecret,
    Accept: 'application/xml',
  };

  const url = new URL(endpoint);
  url.searchParams.set('mark', '0');

  console.log("Fetching myDATA invoices...", url.toString());
  const res = await fetch(url.toString(), { headers });
  const xml = await res.text();
  
  const parsed = parser.parse(xml);
  const first = parsed;
  const wrapped = typeof first.string === 'string' ? first.string : null;
  const root = wrapped ? parser.parse(wrapped) : first;
  
  const invoices = root.RequestedDoc?.invoicesDoc?.invoice || root.invoicesDoc?.invoice || [];
  const invArray = Array.isArray(invoices) ? invoices : [invoices];
  
  // Fetch Orbit invoices
  const { data: orbitInvoices } = await admin.from('invoices').select('id, invoice_number, mark, net, gross, issue_date, counterparty:counterparties(afm, vat_number, legal_name)');
  const orbitMarks = new Set((orbitInvoices || []).filter(i => i.mark).map(i => String(i.mark)));
  
  const missingInvoices: any[] = [];
  
  for (const inv of invArray) {
    const mark = String(inv.mark);
    if (!orbitMarks.has(mark)) {
      const invData: any = {
        mark: mark,
        series: inv.invoiceHeader?.series || '',
        aa: inv.invoiceHeader?.aa || '',
        issueDate: inv.invoiceHeader?.issueDate || '',
        netValue: inv.invoiceSummary?.totalNetValue || 0,
        grossValue: inv.invoiceSummary?.totalGrossValue || 0,
        vatNumber: inv.counterpart?.vatNumber || '',
        name: inv.counterpart?.name || 'Unknown',
      };
      // Let's also check if there's an invoice in Orbit without a mark that matches this
      // Usually matching by invoice_number = series + aa
      const orbitMatch = orbitInvoices?.find(oi => {
         if (!oi.invoice_number) return false;
         const expected = `${invData.series}${invData.aa}`;
         const expected2 = `${invData.series}-${invData.aa}`;
         const expected3 = String(invData.aa);
         return oi.invoice_number === expected || oi.invoice_number === expected2 || oi.invoice_number === expected3;
      });
      if (orbitMatch) {
         invData.orbitMatch = orbitMatch;
      }
      missingInvoices.push(invData);
    }
  }
  
  console.log(`Found ${missingInvoices.length} missing invoices in Orbit out of ${invArray.length} in myDATA.`);
  
  let md = `# Missing Invoices Report\n\n`;
  md += `Found ${missingInvoices.length} invoices transmitted to myDATA that are missing a corresponding 'mark' in Orbit.\n\n`;
  md += `| myDATA MARK | Series / AA | Issue Date | Net | Gross | Counterparty VAT | Orbit Match Suggestion |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  
  for (const inv of missingInvoices) {
    let suggestion = '';
    if (inv.orbitMatch) {
      suggestion = `Found in Orbit without mark (ID: ${inv.orbitMatch.id}, Inv: ${inv.orbitMatch.invoice_number})`;
    }
    md += `| ${inv.mark} | ${inv.series} ${inv.aa} | ${inv.issueDate} | ${inv.netValue} | ${inv.grossValue} | ${inv.vatNumber} (${inv.name}) | ${suggestion} |\n`;
  }
  
  fs.writeFileSync('/Users/zafeirisbampos/.gemini/antigravity-ide/brain/d74822a6-3755-4422-9557-8b24ad922a8c/missing_invoices.md', md);
  console.log("Wrote artifact to missing_invoices.md");
}

main().catch(console.error);
