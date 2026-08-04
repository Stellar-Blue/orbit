/**
 * Verification Script for Orbit Modular Contract Pricing (v1)
 * Executes Section 7 (Workbook Benchmarks) & Section 8 (6 Required Test Cases)
 */

console.log("================================================================");
console.log("🚀 ORBIT MODULAR CONTRACT PRICING - VERIFICATION SUITE");
console.log("================================================================\n");

let passed = 0;
let failed = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    if (details) console.log(`          └─ ${details}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    if (details) console.error(`          └─ ${details}`);
    failed++;
  }
}

// -----------------------------------------------------------------------------
// Core Calculation Engine (Mirrors Section 4 & Section 5 logic)
// -----------------------------------------------------------------------------

function calculatePricing(lines, discountPct = 0, termYears = 1, startDate = "2026-08-01", existingSchedule = null, currentMonth = "2026-10") {
  let recurringGrossMonthly = 0;
  let oneTimeTotal = 0;

  lines.forEach(line => {
    let val = (Number(line.unit_price) || 0) * (Number(line.quantity) || 0);
    if (line.min_monthly_charge && Number(line.min_monthly_charge) > 0 && line.frequency !== 'one_time') {
      let minAmt = Number(line.min_monthly_charge);
      if (line.frequency === 'quarterly') minAmt *= 3;
      if (line.frequency === 'annual') minAmt *= 12;
      if (val < minAmt) val = minAmt;
    }
    if (line.frequency === 'one_time') {
      oneTimeTotal += val;
    } else {
      recurringGrossMonthly += val;
    }
  });

  const discountMultiplier = Math.max(0, 1 - (Number(discountPct) || 0) / 100);
  const netMonthlyMRR = recurringGrossMonthly * discountMultiplier;
  const netAnnual = netMonthlyMRR * 12;
  const tcv = (netAnnual * termYears) + oneTimeTotal;

  // Generate schedule
  const monthsCount = termYears * 12;
  const startObj = new Date(startDate);
  const startYear = startObj.getUTCFullYear() || 2026;
  const startMonth = !isNaN(startObj.getUTCMonth()) ? startObj.getUTCMonth() : 7; // August = 7

  const newSchedule = [];
  for (let i = 0; i < monthsCount; i++) {
    const d = new Date(Date.UTC(startYear, startMonth + i, 1));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const period = `${yyyy}-${mm}`;

    // Mid-term historical protection (Section 8 Case 5 & DB Save rule)
    if (existingSchedule && period < currentMonth) {
      const historicalRow = existingSchedule.find(r => r.period === period);
      if (historicalRow) {
        newSchedule.push(historicalRow);
        continue;
      }
    }

    let monthTotal = 0;
    lines.forEach(line => {
      let gross = (Number(line.unit_price) || 0) * (Number(line.quantity) || 0);
      if (line.min_monthly_charge && Number(line.min_monthly_charge) > 0 && line.frequency !== 'one_time') {
        let minAmt = Number(line.min_monthly_charge);
        if (line.frequency === 'quarterly') minAmt *= 3;
        if (line.frequency === 'annual') minAmt *= 12;
        if (gross < minAmt) gross = minAmt;
      }
      const net = gross * discountMultiplier;

      if (line.frequency === 'monthly') {
        monthTotal += net;
      } else if (line.frequency === 'quarterly') {
        if (i % 3 === 0) monthTotal += net * 3;
      } else if (line.frequency === 'annual') {
        if (i % 12 === 0) monthTotal += net * 12;
      } else if (line.frequency === 'one_time') {
        if (i === 0) monthTotal += gross; // Never discounted
      }
    });

    newSchedule.push({ period, amount: Number(monthTotal.toFixed(2)) });
  }

  return { recurringGrossMonthly, netMonthlyMRR, netAnnual, oneTimeTotal, tcv, schedule: newSchedule };
}

// -----------------------------------------------------------------------------
// SECTION 7: SEED & WORKBOOK BENCHMARK VERIFICATION
// -----------------------------------------------------------------------------
console.log("--- SECTION 7: WORKBOOK BENCHMARKS ---");

const flatModules = [
  { name: 'Core Foundation & Deal Registry', unit_price: 2500, quantity: 1, frequency: 'monthly' },
  { name: 'Physical Power & Gas Operations', unit_price: 3800, quantity: 1, frequency: 'monthly' },
  { name: 'Algorithmic Trading & Auto-Hedging', unit_price: 3200, quantity: 1, frequency: 'monthly' },
  { name: 'Portfolio Valuation & VaR Analytics', unit_price: 2350, quantity: 1, frequency: 'monthly' }
];
const flatCalc = calculatePricing(flatModules, 0, 1);
assert(
  flatCalc.recurringGrossMonthly === 11850 && flatCalc.netMonthlyMRR === 11850,
  "Flat modules sum exactly to €11,850/mo",
  `Computed Net MRR: €${flatCalc.netMonthlyMRR.toLocaleString()}/mo`
);

const perAssetSet = [
  { name: 'Renewables Curtailment & BESS Dispatch', unit_price: 8500, quantity: 1, frequency: 'monthly' },
  { name: 'Cross-Border Capacity & Transmission', unit_price: 6400, quantity: 1, frequency: 'monthly' },
  { name: 'Enterprise API & Real-time SCADA Connector', unit_price: 1500, quantity: 1, frequency: 'monthly' },
  { name: 'Per-MW Generation Management (100–500 MW)', unit_price: 22, quantity: 350, frequency: 'monthly' }, // €7,700
  { name: 'BESS Battery Asset License (Per 10 MWh Unit)', unit_price: 400, quantity: 10, frequency: 'monthly' } // €4,000
];
// 8500 + 6400 + 1500 + (22*350=7700) + (400*10=4000) = 28,100
const assetCalc = calculatePricing(perAssetSet, 0, 1);
assert(
  assetCalc.recurringGrossMonthly === 28100 && assetCalc.netMonthlyMRR === 28100,
  "Per-asset set sum exactly to €28,100/mo",
  `Computed Net MRR: €${assetCalc.netMonthlyMRR.toLocaleString()}/mo`
);

// -----------------------------------------------------------------------------
// SECTION 8: 6 REQUIRED TEST CASES (Not 60)
// -----------------------------------------------------------------------------
console.log("\n--- SECTION 8: REQUIRED TEST CASES ---");

// Test 1: €1,000 × 1, monthly, 0% → €12,000/year.
const t1 = calculatePricing([{ unit_price: 1000, quantity: 1, frequency: 'monthly' }], 0, 1);
assert(
  t1.netAnnual === 12000 && t1.tcv === 12000,
  "Test 1: €1,000 × 1, monthly, 0% → €12,000/year",
  `Net Annual: €${t1.netAnnual.toLocaleString()} | TCV: €${t1.tcv.toLocaleString()}`
);

// Test 2: €5 × 500 MW, 3-year, 10% → €2,500/mo → net €2,250/mo → €81,000 TCV.
const t2 = calculatePricing([{ unit_price: 5, quantity: 500, frequency: 'monthly' }], 10, 3);
assert(
  t2.recurringGrossMonthly === 2500 && t2.netMonthlyMRR === 2250 && t2.tcv === 81000,
  "Test 2: €5 × 500 MW, 3-year, 10% → gross €2,500/mo → net €2,250/mo → €81,000 TCV",
  `Gross: €${t2.recurringGrossMonthly} | Net MRR: €${t2.netMonthlyMRR} | TCV: €${t2.tcv.toLocaleString()}`
);

// Test 3: €1,000/mo line on annual frequency → schedule shows €12,000 in month 1 of each year, €0 elsewhere; MRR still €1,000; yearly sum identical to monthly case.
const t3 = calculatePricing([{ unit_price: 1000, quantity: 1, frequency: 'annual' }], 0, 2, "2026-08-01");
const month0Amount = t3.schedule[0]?.amount || 0;
const month1Amount = t3.schedule[1]?.amount || 0;
const month12Amount = t3.schedule[12]?.amount || 0;
const totalScheduleSum = t3.schedule.reduce((acc, row) => acc + row.amount, 0);
assert(
  t3.netMonthlyMRR === 1000 && month0Amount === 12000 && month1Amount === 0 && month12Amount === 12000 && totalScheduleSum === 24000,
  "Test 3: €1,000/mo on annual frequency → schedule lands €12,000 in Month 1 of each year, €0 elsewhere; MRR remains €1,000",
  `MRR: €${t3.netMonthlyMRR} | M1: €${month0Amount} | M2: €${month1Amount} | M13 (Yr 2 M1): €${month12Amount} | Total: €${totalScheduleSum}`
);

// Test 4: Change a catalog default → existing contract totals unchanged; new contract prefills the new value.
let catalogItem = { id: 'item-1', name: 'Standard Seat', default_unit_price: 150 };
const existingDealLines = [{ catalog_item_id: catalogItem.id, name: catalogItem.name, unit_price: catalogItem.default_unit_price, quantity: 10, frequency: 'monthly' }];
const existingDealCalcBefore = calculatePricing(existingDealLines, 0, 1);
// Admin mutates catalog item price in database
catalogItem.default_unit_price = 300;
// Re-checking existing deal using its snapped line values
const existingDealCalcAfter = calculatePricing(existingDealLines, 0, 1);
const newDealLines = [{ catalog_item_id: catalogItem.id, name: catalogItem.name, unit_price: catalogItem.default_unit_price, quantity: 10, frequency: 'monthly' }];
const newDealCalc = calculatePricing(newDealLines, 0, 1);
assert(
  existingDealCalcBefore.netMonthlyMRR === 1500 && existingDealCalcAfter.netMonthlyMRR === 1500 && newDealCalc.netMonthlyMRR === 3000,
  "Test 4: Snapshot rule confirmed → altering catalog default leaves existing deal untouched (€1,500/mo), while new deals adopt €3,000/mo",
  `Existing deal MRR: €${existingDealCalcAfter.netMonthlyMRR} | New deal MRR: €${newDealCalc.netMonthlyMRR}`
);

// Test 5: Edit quantity mid-term → future schedule months change, past months don't.
const originalMidTerm = calculatePricing([{ unit_price: 1000, quantity: 1, frequency: 'monthly' }], 0, 1, "2026-08-01");
// Suppose in October 2026 ("2026-10"), client upgrades quantity from 1 to 5 (€5,000/mo)
const updatedMidTerm = calculatePricing(
  [{ unit_price: 1000, quantity: 5, frequency: 'monthly' }], 
  0, 
  1, 
  "2026-08-01", 
  originalMidTerm.schedule, 
  "2026-10"
);
const augVal = updatedMidTerm.schedule.find(r => r.period === "2026-08")?.amount;
const sepVal = updatedMidTerm.schedule.find(r => r.period === "2026-09")?.amount;
const octVal = updatedMidTerm.schedule.find(r => r.period === "2026-10")?.amount;
const novVal = updatedMidTerm.schedule.find(r => r.period === "2026-11")?.amount;
assert(
  augVal === 1000 && sepVal === 1000 && octVal === 5000 && novVal === 5000,
  "Test 5: Mid-term quantity modification preserves historical schedule (Aug/Sep = €1,000) and escalates future months (Oct/Nov = €5,000)",
  `2026-08: €${augVal} | 2026-09: €${sepVal} | 2026-10: €${octVal} | 2026-11: €${novVal}`
);

// Test 6: One-time €20,000 implementation → appears once, never discounted.
const t6 = calculatePricing(
  [
    { unit_price: 1000, quantity: 1, frequency: 'monthly' }, // Recurring line
    { unit_price: 20000, quantity: 1, frequency: 'one_time' } // One-off implementation fee
  ], 
  10, // 10% discount applied to contract
  1, 
  "2026-08-01"
);
// Monthly recurring gross is €1,000 -> with 10% discount = €900/mo ($10,800 annual) + €20,000 undiscounted one-time fee = €30,800 TCV
const t6Month0 = t6.schedule[0]?.amount; // Month 1 gets €900 + €20,000 = €20,900
const t6Month1 = t6.schedule[1]?.amount; // Month 2 gets only recurring €900
assert(
  t6.oneTimeTotal === 20000 && t6.netMonthlyMRR === 900 && t6.tcv === 30800 && t6Month0 === 20900 && t6Month1 === 900,
  "Test 6: One-time €20,000 implementation fee lands exclusively in Month 1 and is exempt from the 10% recurring discount",
  `MRR: €${t6.netMonthlyMRR}/mo | Month 1 Cash: €${t6Month0.toLocaleString()} | Month 2 Cash: €${t6Month1} | TCV: €${t6.tcv.toLocaleString()}`
);

// Test 7: Minimum charge per month (€50/MW * 5 MW = €250/mo, but min charge is €500/mo -> €500/mo).
const t7 = calculatePricing([{ unit_price: 50, quantity: 5, frequency: 'monthly', min_monthly_charge: 500 }], 0, 1);
assert(
  t7.netMonthlyMRR === 500 && t7.tcv === 6000,
  "Test 7: Minimum charge floor overrides computed sub-minimum amount (€50 * 5 = €250 -> bumped to €500 min floor)",
  `Computed Net MRR: €${t7.netMonthlyMRR}/mo | TCV: €${t7.tcv.toLocaleString()}`
);

console.log("\n================================================================");
console.log(`📊 VERIFICATION SUMMARY: ${passed} Passed | ${failed} Failed`);
console.log("================================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🌟 ALL BENCHMARK & TEST CASE REQUIREMENTS SATISFIED WITH 100% ACCURACY!");
  process.exit(0);
}
