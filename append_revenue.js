const fs = require('fs');
let reports = fs.readFileSync('src/app/reports/page.tsx', 'utf8');
let revenueTab = fs.readFileSync('revenue_tab.tsx', 'utf8');

reports = reports.replace("    </div>\n  );\n}\n", "\n" + revenueTab + "\n    </div>\n  );\n}\n");

fs.writeFileSync('src/app/reports/page.tsx', reports);
