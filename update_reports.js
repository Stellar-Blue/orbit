const fs = require('fs');

let content = fs.readFileSync('src/app/reports/page.tsx', 'utf8');

// 1. Imports
content = content.replace(
  "import { CashflowBarChart } from '@/components/invoices/cashflow-chart';",
  "import { CashflowBarChart } from '@/components/invoices/cashflow-chart';\nimport { calculateContractValuation } from '@/lib/pricing-engine';"
);

content = content.replace(
  "const InvoicesGrid = dynamic(() => import('@/components/invoices/invoices-grid').then(m => m.InvoicesGrid), { ssr: false });",
  "const InvoicesGrid = dynamic(() => import('@/components/invoices/invoices-grid').then(m => m.InvoicesGrid), { ssr: false });\nconst RevenueGrid = dynamic(() => import('@/components/contracts/revenue-grid').then(m => m.RevenueGrid), { ssr: false });"
);

// 2. useAuth
content = content.replace(
  "addInvoice, updateInvoice, deleteInvoice, updateInvoiceStatus, recordInvoicePayment, addInvoiceDocument, saveInvoiceAllocation, salaries, refreshInvoices",
  "addInvoice, updateInvoice, deleteInvoice, updateInvoiceStatus, recordInvoicePayment, addInvoiceDocument, saveInvoiceAllocation, salaries, refreshInvoices, catalogModules, catalogItems, deleteContract"
);

// 3. activeTab
content = content.replace(
  "const [activeTab, setActiveTab] = useState<'ar_ap_aging' | 'cashflow' | 'accountant'>('ar_ap_aging');",
  "const [activeTab, setActiveTab] = useState<'ar_ap_aging' | 'cashflow' | 'accountant' | 'revenue'>('ar_ap_aging');"
);

// 4. Tabs
const tabsBlock = `
        <button
          onClick={() => setActiveTab('revenue')}
          className={\`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer \${
            activeTab === 'revenue'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }\`}
        >
          <Sparkles className="w-4 h-4 text-emerald-600" />
          <span>Revenue Schedule & MRR</span>
        </button>
      </div>`;
content = content.replace("</div>", tabsBlock); // this might replace the first </div>, let's be more specific.

fs.writeFileSync('src/app/reports/page.tsx', content);
