const prisma = require('./prisma');
const relevanceEngine = require('./relevanceEngine');

const DAY_MS = 86400000;
const MONTH_NAMES_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Every insight's message names the exact months/dates and figures behind the
// decision — not just "ירד באחוז X" but which months were compared and what the
// actual revenue/quantity/day-count was, so the number can be traced back by hand.
function fmtMonthYear(t) { const d = new Date(t); return MONTH_NAMES_HE[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtMonthYearKey(mk) { const [y, m] = mk.split('-'); return MONTH_NAMES_HE[+m - 1] + ' ' + y; }
function fmtDateHe(t) { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); }
function fmtMoneyHe(n) { return Math.round(n || 0).toLocaleString('he-IL') + '₪'; }
function quarterLabel(t) { const d = new Date(t); return 'רבעון ' + (Math.floor(d.getMonth() / 3) + 1) + ' ' + d.getFullYear(); }

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function groupBy(arr, keyFn) {
  const m = {};
  arr.forEach((x) => { const k = keyFn(x); (m[k] = m[k] || []).push(x); });
  return m;
}
function isInactive(cust) {
  return !!(cust && String(cust.status || '').trim().indexOf('לא') === 0);
}
function isProductInactive(prod) {
  return !!(prod && String(prod.status || '').trim().indexOf('לא') === 0);
}
function dayKey(t) {
  const d = new Date(t);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function monthKey(t) {
  const d = new Date(t);
  const mm = d.getMonth() + 1;
  return d.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm);
}
function prevMonthKeyOf(mk) {
  const parts = mk.split('-');
  let y = +parts[0], m = +parts[1] - 1;
  if (m < 1) { m = 12; y -= 1; }
  return y + '-' + (m < 10 ? '0' + m : m);
}
function quarterOf(d) { return Math.floor(d.getMonth() / 3); }

// Sales only carry month-level precision (every row is stored on the 1st of its
// month), but holiday/season windows are real dates that rarely start or end on the
// 1st. Comparing a sale's exact (fabricated) timestamp against those exact date
// boundaries would arbitrarily drop or keep whole months depending on where the
// window edge happens to fall — so "does this window overlap this calendar month"
// is the only honest test, and the entire month's revenue/quantity counts if it does.
function monthRangeMs(mk) {
  const [y, m] = mk.split('-');
  return [new Date(+y, +m - 1, 1).getTime(), new Date(+y, +m, 1).getTime()];
}
function overlappingMonths(start, end) {
  const months = [];
  let cursor = new Date(new Date(start).getFullYear(), new Date(start).getMonth(), 1);
  const endDate = new Date(end);
  while (cursor.getTime() < end && (cursor.getFullYear() < endDate.getFullYear() || (cursor.getFullYear() === endDate.getFullYear() && cursor.getMonth() <= endDate.getMonth()))) {
    const mk = monthKey(cursor.getTime());
    const [ms, me] = monthRangeMs(mk);
    if (ms < end && me > start) months.push(mk);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    if (months.length > 36) break; // safety valve against malformed date ranges
  }
  return months;
}
function monthOverlapsWindow(mk, start, end) {
  const [ms, me] = monthRangeMs(mk);
  return ms < end && me > start;
}

// General policy 5: a product with a defined substitute is treated as one combined
// entity for insight purposes (in either direction — a substitute relationship means
// the two fill the same need, whichever way the suggestion points). Union-find groups
// every product into a family; a family with no substitute relation is just itself.
function buildProductFamilies(substitutes) {
  const parent = {};
  function find(x) { parent[x] = parent[x] || x; while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  substitutes.forEach((s) => union(s.productCode, s.substituteCode));
  return { famKey: (pid) => find(pid) };
}

// Mirrors the artifact's editable RULE_PARAM_DEFS — same names, same defaults.
const DEFAULT_PARAMS = {
  churn_minPurchases: 3, churn_dayFloor: 35, churn_gapMultiplier: 1.3, churn_highMultiplier: 1.6,
  decline_currentWindowDays: 90, decline_priorWindowDays: 90, decline_pctThreshold: 30, decline_highPct: 50, decline_minBaseRevenue: 100,
  dropoff_minPurchases: 3, dropoff_recentActivityDays: 60, dropoff_dayFloor: 45, dropoff_gapMultiplier: 2, dropoff_highGapMultiplier: 3,
  lookalike_minGroupSize: 3, lookalike_pctOfAvg: 50, lookalike_highPctOfAvg: 25,
  upsell_popularityPct: 50,
  anomaly_minMonths: 4, anomaly_pctThreshold: 40, anomaly_highPct: 70,
  freq_minTotalDrops: 4, freq_windowDays: 30, freq_minPrevDrops: 2, freq_pctThreshold: 40, freq_highPct: 60,
  monthlyBreak_recentActivityDays: 90, monthlyBreak_establishedMonthsNeeded: 3, monthlyBreak_totalMonthsChecked: 5, monthlyBreak_highMonthsNeeded: 4,
  variety_minGroupSize: 3, variety_popularityPct: 50,
  monthly_pctThreshold: 30, monthly_highPct: 50, monthly_minBaseRevenue: 100, monthly_topN: 3,
  seasonal_pctThreshold: 40, seasonal_highPct: 70, seasonal_minBaseRevenue: 100,
  substOpp_lookbackDays: 90,
  hierarchyUpsell_minGroupSize: 3, hierarchyUpsell_popularityPct: 50,
  standingOrder_minMonthsActive: 4, standingOrder_windowMonths: 8, standingOrder_dayOfMonthGate: 20,
  cumulativeYoy_pctThreshold: 5, cumulativeYoy_highPct: 15, cumulativeYoy_minBaseRevenue: 100,
  varietyNarrowing_windowDays: 90, varietyNarrowing_minPriorProducts: 3, varietyNarrowing_pctThreshold: 40, varietyNarrowing_highPct: 60,
  decliningTrend_monthsRequired: 3, decliningTrend_pctPerMonth: 10,
  quarterlyDecline_pctThreshold: 20, quarterlyDecline_highPct: 35, quarterlyDecline_minBaseRevenue: 100,
  centralCross_minGroupSize: 2, centralCross_popularityPct: 50,
  marketingUnderperf_lookbackMonths: 3, marketingUnderperf_maxUnits: 0,
  upcomingEvent_daysAhead: 21,
  productQty_windowDays: 90, productQty_pctThreshold: 40, productQty_highPct: 60, productQty_minPriorQty: 5,
  productFreqYoy_pctThreshold: 40, productFreqYoy_highPct: 60, productFreqYoy_minPriorMonths: 2,
  irregularity_minPurchases: 4, irregularity_cvThreshold: 70, irregularity_minRevenueShare: 5,
  newProduct_lookbackDays: 90, newProduct_minRevenue: 150,
  concentration_topN: 2, concentration_pctThreshold: 70, concentration_minRevenue: 500
};

async function loadParams(organizationId) {
  const rows = await prisma.ruleSetting.findMany({ where: { organizationId } });
  const params = Object.assign({}, DEFAULT_PARAMS);
  rows.forEach((r) => { params[r.paramId] = r.value; });
  return params;
}

// Computes insights fresh from the current database state every call — there is
// no cached/stored insight list, so a resolved issue (e.g. a customer who just
// bought again) simply stops appearing the next time this runs. No cleanup step
// is ever needed.
async function computeInsights(organizationId) {
  const [customers, products, sales, inventory, substitutes, relCtx] = await Promise.all([
    prisma.customer.findMany({ where: { organizationId } }),
    prisma.product.findMany({ where: { organizationId } }),
    prisma.sale.findMany({ where: { organizationId } }),
    prisma.inventoryRecord.findMany({ where: { organizationId } }),
    prisma.productSubstitute.findMany({ where: { organizationId } }),
    relevanceEngine.loadContext(organizationId)
  ]);
  const params = await loadParams(organizationId);
  const now = Date.now();
  const nowDate = new Date(now);

  const custIndex = {};
  customers.forEach((c) => { custIndex[c.customerNumber] = c; });
  const prodIndex = {};
  products.forEach((p) => { prodIndex[p.itemCode] = p; });
  const invIndex = {};
  inventory.forEach((r) => { if (r.sku && !(r.sku in invIndex)) invIndex[r.sku] = r; });
  function isOutOfStock(pid) {
    const row = invIndex[pid];
    const stock = row ? row.stock : null;
    return stock !== null && stock <= 0;
  }

  const s = sales.map((r) => ({
    cid: r.customerNumber, pid: r.productCode, t: new Date(r.date).getTime(), qty: r.quantity, rev: r.revenue
  }));
  const byCustomer = groupBy(s, (x) => x.cid);
  const byPair = groupBy(s, (x) => x.cid + '|' + x.pid);
  const byProduct = groupBy(s, (x) => x.pid);

  const insights = [];
  const custLabel = (cid) => (custIndex[cid] && custIndex[cid].name) || cid;
  const prodLabel = (pid) => (prodIndex[pid] && prodIndex[pid].name) || pid;

  // General policy 5: substitute-product union. `famKey(pid)` maps any product to its
  // family's canonical key; a family with no substitute relation is just itself. Every
  // rule that asks "did the customer buy product X" checks the whole family instead —
  // switching to a substitute during a shortage shouldn't look like abandoning X.
  const { famKey } = buildProductFamilies(substitutes);
  const familyMembers = {};
  Object.keys(prodIndex).forEach((pid) => { (familyMembers[famKey(pid)] = familyMembers[famKey(pid)] || new Set()).add(pid); });
  function familyLabel(pid) {
    const members = Array.from(familyMembers[famKey(pid)] || [pid]);
    return members.map(prodLabel).join(' / ');
  }
  function isFamilyOutOfStock(pid) {
    const members = Array.from(familyMembers[famKey(pid)] || [pid]);
    return members.every((m) => isOutOfStock(m));
  }
  function isFamilyInactive(pid) {
    const members = Array.from(familyMembers[famKey(pid)] || [pid]);
    return members.every((m) => isProductInactive(prodIndex[m]));
  }
  const byCustomerFamily = groupBy(s, (x) => x.cid + '|' + famKey(x.pid));

  // 1. churn
  Object.keys(byCustomer).forEach((cid) => {
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    const events = byCustomer[cid].slice().sort((a, b) => a.t - b.t);
    if (events.length < params.churn_minPurchases) return;
    const gaps = [];
    for (let i = 1; i < events.length; i++) gaps.push((events[i].t - events[i - 1].t) / DAY_MS);
    const typicalGap = median(gaps) || 30;
    const lastT = events[events.length - 1].t;
    const daysSince = (now - lastT) / DAY_MS;
    const threshold = Math.max(params.churn_dayFloor, typicalGap * params.churn_gapMultiplier);
    if (daysSince > threshold) {
      insights.push({
        type: 'churn',
        severity: daysSince > threshold * params.churn_highMultiplier ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `רכישה אחרונה בוצעה ב-${fmtMonthYear(lastT)} (${fmtDateHe(lastT)}) — לפני ${Math.round(daysSince)} ימים מהיום. קצב הרכישה הרגיל של הלקוח, לפי חציון המרווחים בין ${events.length} הרכישות ההיסטוריות שלו, הוא כ-${Math.round(typicalGap)} ימים; סף ההתראה נקבע ל-${Math.round(threshold)} ימים (המקסימום בין ${params.churn_dayFloor} ימים לבין פי ${params.churn_gapMultiplier} מהקצב הרגיל).`,
        metric: Math.round(daysSince)
      });
    }
  });

  // 2. decline (quarterly / YoY)
  Object.keys(byCustomer).forEach((cid) => {
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    const events = byCustomer[cid];
    const curFrom = now - params.decline_currentWindowDays * DAY_MS;
    const cur = events.filter((e) => e.t > curFrom && e.t <= now);
    if (!cur.length) return;
    const curRev = cur.reduce((a, e) => a + e.rev, 0);
    const yoyFrom = now - (365 + params.decline_currentWindowDays) * DAY_MS;
    const yoyTo = now - 365 * DAY_MS;
    const yoy = events.filter((e) => e.t > yoyFrom && e.t <= yoyTo);
    let basis, baseRev, baseFrom, baseTo;
    if (yoy.length) {
      basis = 'לתקופה המקבילה אשתקד';
      baseRev = yoy.reduce((a, e) => a + e.rev, 0);
      baseFrom = yoyFrom; baseTo = yoyTo;
    } else {
      const prevFrom = now - (params.decline_currentWindowDays + params.decline_priorWindowDays) * DAY_MS;
      const prevTo = curFrom;
      const prev = events.filter((e) => e.t > prevFrom && e.t <= prevTo);
      basis = 'לתקופה הקודמת';
      baseRev = prev.reduce((a, e) => a + e.rev, 0);
      baseFrom = prevFrom; baseTo = prevTo;
    }
    if (baseRev < params.decline_minBaseRevenue) return;
    const delta = (curRev - baseRev) / baseRev;
    if (delta <= -params.decline_pctThreshold / 100) {
      insights.push({
        type: 'decline',
        severity: delta <= -params.decline_highPct / 100 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `מחזור הלקוח בין ${fmtDateHe(curFrom)} ל-${fmtDateHe(now)} (${params.decline_currentWindowDays} הימים האחרונים) עמד על ${fmtMoneyHe(curRev)} — ירידה של ${Math.round(-delta * 100)}% ${basis} (${fmtDateHe(baseFrom)}–${fmtDateHe(baseTo)}, ${fmtMoneyHe(baseRev)}).`,
        metric: Math.round(delta * 100)
      });
    }
  });

  // 3. product-family dropoff (general policy 5: a substitute purchase counts as still
  // buying the family, so this only fires if the customer stopped buying EVERY member).
  // Suppressed if every member is currently out of stock (general policy 3, applied to
  // the current moment — see the note on historical inventory at the top of this file).
  Object.keys(byCustomerFamily).forEach((key) => {
    const idx = key.indexOf('|');
    const cid = key.slice(0, idx), fam = key.slice(idx + 1);
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    const events = byCustomerFamily[key].slice().sort((a, b) => a.t - b.t);
    const pid = events[events.length - 1].pid; // most recently purchased family member, for labeling/stock-checks
    if (isFamilyInactive(pid)) return;
    if (isFamilyOutOfStock(pid)) return;
    const recentAny = (byCustomer[cid] || []).some((e) => e.t > now - params.dropoff_recentActivityDays * DAY_MS);
    if (!recentAny) return;
    if (events.length < params.dropoff_minPurchases) return;
    const gaps = [];
    for (let i = 1; i < events.length; i++) gaps.push((events[i].t - events[i - 1].t) / DAY_MS);
    const typicalGap = median(gaps) || 30;
    const lastT = events[events.length - 1].t;
    const daysSince = (now - lastT) / DAY_MS;
    if (daysSince > Math.max(params.dropoff_dayFloor, typicalGap * params.dropoff_gapMultiplier)) {
      const label = familyLabel(pid);
      insights.push({
        type: 'dropoff',
        severity: daysSince > typicalGap * params.dropoff_highGapMultiplier ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הלקוח פעיל, אך לא רכש את ${label} מאז ${fmtMonthYear(lastT)} (${fmtDateHe(lastT)}) — ${Math.round(daysSince)} ימים ללא רכישה. קצב הרכישה הרגיל שלו למוצר זה, מתוך ${events.length} רכישות עבר, הוא כ-${Math.round(typicalGap)} ימים.${label.includes('/') ? ' (נספר כיחידה אחת עם המוצר התחליפי שלו.)' : ''}`,
        metric: Math.round(daysSince),
        breakdown: [{ label: 'ימים ללא רכישה', value: Math.round(daysSince) }, { label: 'קצב רגיל (ימים)', value: Math.round(typicalGap) }]
      });
    }
  });

  // 4+5. lookalike growth potential + upsell (segmented by סיווג ראשי לקוח)
  const activeCustomers = customers.filter((c) => !isInactive(c));
  const segGroups = groupBy(activeCustomers, (c) => c.primaryClass || 'כללי');
  const custRevenue = {};
  Object.keys(byCustomer).forEach((cid) => { custRevenue[cid] = byCustomer[cid].reduce((a, e) => a + e.rev, 0); });
  const custProducts = {};
  Object.keys(byPair).forEach((key) => {
    const idx = key.indexOf('|');
    const cid = key.slice(0, idx), pid = key.slice(idx + 1);
    (custProducts[cid] = custProducts[cid] || {})[pid] = true;
  });

  // custFamilyProducts[cid][famKey] is true if the customer bought ANY member of that
  // substitute family — used by every "does this customer own product X" opportunity
  // rule below, so buying the substitute counts as already owning it (policy 5).
  const custFamilyProducts = {};
  Object.keys(custProducts).forEach((cid) => {
    const fams = {};
    Object.keys(custProducts[cid]).forEach((pid) => { fams[famKey(pid)] = true; });
    custFamilyProducts[cid] = fams;
  });

  const lookalikeMinGroup = params.lookalike_minGroupSize;
  const lookalikePct = params.lookalike_pctOfAvg / 100;
  const lookalikeHighPct = params.lookalike_highPctOfAvg / 100;
  const upsellPopPct = params.upsell_popularityPct / 100;
  Object.keys(segGroups).forEach((seg) => {
    const members = segGroups[seg];
    if (members.length < lookalikeMinGroup) return;
    const ids = members.map((c) => c.customerNumber).filter(Boolean);
    const revs = ids.map((id) => custRevenue[id] || 0);
    const avgRev = revs.reduce((a, b) => a + b, 0) / (revs.length || 1);
    const famCounts = {}, famRepPid = {};
    ids.forEach((id) => { Object.keys(custProducts[id] || {}).forEach((pid) => { const f = famKey(pid); famCounts[f] = (famCounts[f] || 0) + 1; famRepPid[f] = pid; }); });
    const popularFams = Object.keys(famCounts).filter((f) => famCounts[f] >= Math.ceil(ids.length * upsellPopPct) && !isFamilyInactive(famRepPid[f]) && !isFamilyOutOfStock(famRepPid[f]));

    ids.forEach((id) => {
      const rev = custRevenue[id] || 0;
      if (avgRev > 0 && rev > 0 && rev < avgRev * lookalikePct) {
        insights.push({
          type: 'lookalike',
          severity: rev < avgRev * lookalikeHighPct ? 'high' : 'medium',
          customerId: id,
          customerName: custLabel(id),
          message: `מחזור הלקוח בסך הכול (${fmtMoneyHe(rev)}) נמוך משמעותית מהממוצע בקבוצת "${seg}" — ${fmtMoneyHe(avgRev)}, מחושב לפי ${ids.length} לקוחות פעילים באותה קבוצת סיווג ראשי — פוטנציאל צמיחה לא ממומש.`,
          metric: Math.round((rev / avgRev) * 100),
          breakdown: [{ label: 'מחזור הלקוח', value: Math.round(rev) }, { label: 'ממוצע הקבוצה', value: Math.round(avgRev) }]
        });
      }
      const owned = custFamilyProducts[id] || {};
      popularFams.forEach((fam) => {
        if (owned[fam]) return;
        const pid = famRepPid[fam];
        const label = familyLabel(pid);
        insights.push({
          type: 'upsell',
          severity: 'low',
          customerId: id,
          customerName: custLabel(id),
          productCode: pid,
          message: `${famCounts[fam]} מתוך ${ids.length} הלקוחות בקבוצת הסיווג הראשי "${seg}" רכשו אי-פעם את ${label}, אך לקוח זה לא רכש אותו כלל — הזדמנות ל-Upsell.`,
          metric: famCounts[fam],
          breakdown: [{ label: 'קונים בקבוצה', value: famCounts[fam] }, { label: 'סה"כ בקבוצה', value: ids.length }]
        });
      });
    });
  });

  // 6. anomaly (product-level, seasonality-aware)
  Object.keys(byProduct).forEach((pid) => {
    if (isProductInactive(prodIndex[pid])) return;
    const events = byProduct[pid];
    const byMonth = groupBy(events, (e) => monthKey(e.t));
    const months = Object.keys(byMonth).sort();
    if (months.length < params.anomaly_minMonths) return;
    const lastMonth = months[months.length - 1];
    const lastQty = byMonth[lastMonth].reduce((a, e) => a + e.qty, 0);
    const priorMonths = months.slice(Math.max(0, months.length - 4), months.length - 1);
    const priorQtys = priorMonths.map((mk) => byMonth[mk].reduce((a, e) => a + e.qty, 0));
    const baseline = priorQtys.length ? priorQtys.reduce((a, b) => a + b, 0) / priorQtys.length : 0;
    if (baseline <= 0) return;
    const delta = (lastQty - baseline) / baseline;
    if (Math.abs(delta) < params.anomaly_pctThreshold / 100) return;

    let explained = false;
    function checkWindows(rows, source) {
      rows.forEach((r) => {
        const name = String(r.name || '').trim();
        if (!name) return;
        const before = source === 'holiday' ? (r.daysBefore || 0) : 0;
        const after = source === 'holiday' ? (r.daysAfter || 0) : 0;
        const start = new Date(r.fromDate).getTime() - before * DAY_MS;
        const end = new Date(r.toDate).getTime() + after * DAY_MS;
        if (monthOverlapsWindow(lastMonth, start, end)) {
          const rel = relevanceEngine.isRelevant(relCtx, pid, source, name);
          if (rel.value) explained = true;
        }
      });
    }
    checkWindows(relCtx.holidays, 'holiday');
    checkWindows(relCtx.seasons, 'season');
    if (explained) return;

    insights.push({
      type: 'anomaly',
      severity: Math.abs(delta) >= params.anomaly_highPct / 100 ? 'high' : 'medium',
      productCode: pid,
      message: `${delta > 0 ? 'עלייה חדה' : 'ירידה חדה'} של ${Math.round(Math.abs(delta) * 100)}% בכמות המכירה של ${prodLabel(pid)} ב-${fmtMonthYearKey(lastMonth)} (${Math.round(lastQty)} יח') לעומת הממוצע ב-${priorMonths.length} החודשים שלפני כן — ${priorMonths.map(fmtMonthYearKey).join(', ')} (ממוצע ${Math.round(baseline)} יח'), ללא הסבר עונתי/חג ידוע.`,
      metric: Math.round(delta * 100),
      breakdown: [{ label: fmtMonthYearKey(lastMonth), value: Math.round(lastQty) }, { label: 'ממוצע קודם', value: Math.round(baseline) }]
    });
  });

  // 7. purchase frequency decline (drops = distinct purchase dates)
  Object.keys(byCustomer).forEach((cid) => {
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    const events = byCustomer[cid];
    const dropSet = {};
    events.forEach((e) => { dropSet[dayKey(e.t)] = e.t; });
    const dropTimes = Object.keys(dropSet).map((k) => dropSet[k]).sort((a, b) => a - b);
    if (dropTimes.length < params.freq_minTotalDrops) return;
    const curFrom = now - params.freq_windowDays * DAY_MS;
    const prevFrom = now - 2 * params.freq_windowDays * DAY_MS;
    const curDrops = dropTimes.filter((t) => t > curFrom && t <= now).length;
    const prevDrops = dropTimes.filter((t) => t > prevFrom && t <= curFrom).length;
    if (prevDrops < params.freq_minPrevDrops) return;
    const delta = (curDrops - prevDrops) / prevDrops;
    if (delta <= -params.freq_pctThreshold / 100) {
      insights.push({
        type: 'frequencyDecline',
        severity: delta <= -params.freq_highPct / 100 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `מספר ה"דרופים" (ימי רכישה נפרדים) ירד מ-${prevDrops} בין ${fmtDateHe(prevFrom)}–${fmtDateHe(curFrom)} ל-${curDrops} בין ${fmtDateHe(curFrom)}–${fmtDateHe(now)} (חלונות של ${params.freq_windowDays} ימים כל אחד).`,
        metric: Math.round(delta * 100),
        breakdown: [{ label: 'דרופים אחרונים', value: curDrops }, { label: 'דרופים קודמים', value: prevDrops }]
      });
    }
  });

  // 8. monthly product-family purchase break (general policy 5: buying a substitute
  // keeps the pattern intact; general policy 3: suppressed if every family member is
  // currently out of stock).
  Object.keys(byCustomerFamily).forEach((key) => {
    const idx = key.indexOf('|');
    const cid = key.slice(0, idx), fam = key.slice(idx + 1);
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    const famEvents = byCustomerFamily[key];
    const pid = famEvents[famEvents.length - 1].pid;
    if (isFamilyInactive(pid)) return;
    if (isFamilyOutOfStock(pid)) return;
    const recentAny = (byCustomer[cid] || []).some((e) => e.t > now - params.monthlyBreak_recentActivityDays * DAY_MS);
    if (!recentAny) return;

    const monthsSet = {};
    famEvents.forEach((e) => { monthsSet[monthKey(e.t)] = true; });
    const recentMonthKeys = [];
    for (let m = 0; m <= params.monthlyBreak_totalMonthsChecked; m++) {
      recentMonthKeys.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1)));
    }
    const currentMonth = recentMonthKeys[0];
    const priorMonths = recentMonthKeys.slice(1);
    const boughtMonths = priorMonths.filter((mk) => monthsSet[mk]);
    const establishedCount = boughtMonths.length;

    if (establishedCount >= params.monthlyBreak_establishedMonthsNeeded && !monthsSet[currentMonth]) {
      const label = familyLabel(pid);
      insights.push({
        type: 'monthlyProductBreak',
        severity: establishedCount >= params.monthlyBreak_highMonthsNeeded ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הלקוח רכש את ${label} ב-${establishedCount} מתוך ${params.monthlyBreak_totalMonthsChecked} החודשים האחרונים (${boughtMonths.map(fmtMonthYearKey).join(', ')}), אך לא רכש אותו ב-${fmtMonthYearKey(currentMonth)} — דפוס רכישה חודשי שנקטע.${label.includes('/') ? ' (נספר כיחידה אחת עם המוצר התחליפי שלו.)' : ''}`,
        metric: establishedCount,
        breakdown: [{ label: 'חודשים עם רכישה', value: establishedCount }, { label: 'מתוך סך הכול', value: params.monthlyBreak_totalMonthsChecked }]
      });
    }
  });

  // 9. product variety gap by customer type (סוג לקוח)
  const varietyMinGroup = params.variety_minGroupSize;
  const varietyPct = params.variety_popularityPct / 100;
  const typeGroups = groupBy(activeCustomers, (c) => c.customerType || '');
  Object.keys(typeGroups).forEach((typeName) => {
    if (!typeName) return;
    const members = typeGroups[typeName];
    if (members.length < varietyMinGroup) return;
    const ids2 = members.map((c) => c.customerNumber).filter(Boolean);
    const famCounts2 = {}, famRepPid2 = {};
    ids2.forEach((id) => { Object.keys(custProducts[id] || {}).forEach((pid) => { const f = famKey(pid); famCounts2[f] = (famCounts2[f] || 0) + 1; famRepPid2[f] = pid; }); });
    const popularFams2 = Object.keys(famCounts2).filter((f) => famCounts2[f] >= Math.ceil(ids2.length * varietyPct) && !isFamilyInactive(famRepPid2[f]) && !isFamilyOutOfStock(famRepPid2[f]));
    ids2.forEach((id) => {
      const owned = custFamilyProducts[id] || {};
      popularFams2.forEach((fam) => {
        if (owned[fam]) return;
        const pid = famRepPid2[fam];
        const label = familyLabel(pid);
        insights.push({
          type: 'productVarietyGap',
          severity: 'low',
          customerId: id,
          customerName: custLabel(id),
          productCode: pid,
          message: `${famCounts2[fam]} מתוך ${ids2.length} הלקוחות מסוג "${typeName}" רכשו את ${label}, אך לקוח זה לא — פער במגוון המוצרים.`,
          metric: famCounts2[fam],
          breakdown: [{ label: 'קונים בקבוצה', value: famCounts2[fam] }, { label: 'סה"כ בקבוצה', value: ids2.length }]
        });
      });
    });
  });

  // 10. Rule 1a — monthly revenue shift (bidirectional: flags a meaningful jump in
  // either direction, not just a decline), with the specific products driving it.
  const monthlyPct = params.monthly_pctThreshold / 100;
  const monthlyHighPct = params.monthly_highPct / 100;
  Object.keys(byCustomer).forEach((cid) => {
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    const events = byCustomer[cid];
    const curMK = monthKey(now);
    const prevMK = prevMonthKeyOf(curMK);
    const curEvents = events.filter((e) => monthKey(e.t) === curMK);
    const prevEvents = events.filter((e) => monthKey(e.t) === prevMK);
    if (!curEvents.length || !prevEvents.length) return;
    const curRev = curEvents.reduce((a, e) => a + e.rev, 0);
    const prevRev = prevEvents.reduce((a, e) => a + e.rev, 0);
    if (prevRev < params.monthly_minBaseRevenue) return;
    const delta = (curRev - prevRev) / prevRev;
    if (Math.abs(delta) < monthlyPct) return;
    const isDecline = delta < 0;

    const curByPid = {}, prevByPid = {};
    curEvents.forEach((e) => { curByPid[e.pid] = (curByPid[e.pid] || 0) + e.rev; });
    prevEvents.forEach((e) => { prevByPid[e.pid] = (prevByPid[e.pid] || 0) + e.rev; });
    const allPids = {};
    Object.keys(curByPid).forEach((p) => { allPids[p] = true; });
    Object.keys(prevByPid).forEach((p) => { allPids[p] = true; });
    const diffs = Object.keys(allPids).map((pid) => ({ pid, diff: (curByPid[pid] || 0) - (prevByPid[pid] || 0) }))
      .filter((d) => (isDecline ? d.diff < 0 : d.diff > 0) && !isProductInactive(prodIndex[d.pid]))
      .sort((a, b) => isDecline ? a.diff - b.diff : b.diff - a.diff);
    const top = diffs.slice(0, params.monthly_topN).map((d) => `${prodLabel(d.pid)} (${fmtMoneyHe(d.diff)})`);
    const dirWord = isDecline ? 'ירדה' : 'עלתה';
    const driverWord = isDecline ? 'בעיקר בשל ירידה במוצרים' : 'בעיקר בזכות עלייה במוצרים';

    insights.push({
      type: 'monthlyRevenueShift',
      severity: Math.abs(delta) >= monthlyHighPct ? 'high' : 'medium',
      customerId: cid,
      customerName: custLabel(cid),
      message: `הכנסת הלקוח ${dirWord} ב-${Math.round(Math.abs(delta) * 100)}%: ${fmtMonthYearKey(curMK)} (${fmtMoneyHe(curRev)}) לעומת ${fmtMonthYearKey(prevMK)} (${fmtMoneyHe(prevRev)})${top.length ? ', ' + driverWord + ': ' + top.join(', ') : ''}.`,
      metric: Math.round(delta * 100),
      breakdown: [{ label: fmtMonthYearKey(curMK), value: Math.round(curRev) }, { label: fmtMonthYearKey(prevMK), value: Math.round(prevRev) }]
    });
  });

  // 11+12. seasonal/holiday year-over-year pattern shift (per customer, per relevant product)
  const seasonalPct = params.seasonal_pctThreshold / 100;
  const seasonalHighPct = params.seasonal_highPct / 100;
  const seasonalMinBase = params.seasonal_minBaseRevenue;
  function buildEventWindows(rows, source) {
    const byName = {};
    rows.forEach((r) => {
      const name = String(r.name || '').trim();
      if (!name) return;
      const before = source === 'holiday' ? (r.daysBefore || 0) : 0;
      const after = source === 'holiday' ? (r.daysAfter || 0) : 0;
      const start = new Date(r.fromDate).getTime() - before * DAY_MS;
      const end = new Date(r.toDate).getTime() + after * DAY_MS;
      (byName[name] = byName[name] || []).push({ start, end, year: new Date(r.fromDate).getFullYear() });
    });
    return byName;
  }
  function processSeasonalSource(rows, source) {
    const byName = buildEventWindows(rows, source);
    Object.keys(byName).forEach((name) => {
      const windows = byName[name].slice().sort((a, b) => b.start - a.start);
      if (windows.length < 2) return;
      const latest = windows[0], previous = windows[1];
      const latestMonths = overlappingMonths(latest.start, latest.end);
      const previousMonths = overlappingMonths(previous.start, previous.end);
      const latestLabel = latestMonths.length === 1 ? fmtMonthYearKey(latestMonths[0]) : fmtMonthYearKey(latestMonths[0]) + '–' + fmtMonthYearKey(latestMonths[latestMonths.length - 1]);
      const previousLabel = previousMonths.length === 1 ? fmtMonthYearKey(previousMonths[0]) : fmtMonthYearKey(previousMonths[0]) + '–' + fmtMonthYearKey(previousMonths[previousMonths.length - 1]);
      Object.keys(byCustomer).forEach((cid) => {
        const cust = custIndex[cid];
        if (isInactive(cust)) return;
        const pairEvents = {};
        byCustomer[cid].forEach((e) => { (pairEvents[e.pid] = pairEvents[e.pid] || []).push(e); });
        Object.keys(pairEvents).forEach((pid) => {
          if (isProductInactive(prodIndex[pid])) return;
          const rel = relevanceEngine.isRelevant(relCtx, pid, source, name);
          if (!rel.known || !rel.value) return;
          let latestRev = 0, prevRev = 0;
          pairEvents[pid].forEach((e) => {
            const mk = monthKey(e.t);
            if (latestMonths.includes(mk)) latestRev += e.rev;
            else if (previousMonths.includes(mk)) prevRev += e.rev;
          });
          if (prevRev < seasonalMinBase) return;
          const delta = (latestRev - prevRev) / prevRev;
          if (Math.abs(delta) < seasonalPct) return;

          const eventKind = source === 'holiday' ? 'חג' : 'עונת';
          const dirWord = delta > 0 ? 'עלייה' : 'ירידה';
          const typeKey = delta > 0 ? 'seasonalGrowth' : 'seasonalDecline';
          insights.push({
            type: typeKey,
            severity: Math.abs(delta) >= seasonalHighPct ? 'high' : 'medium',
            customerId: cid,
            customerName: custLabel(cid),
            productCode: pid,
            message: `${dirWord} של ${Math.round(Math.abs(delta) * 100)}% ברכישת ${prodLabel(pid)} בחודשים החופפים ל${eventKind} ${name} ${latest.year} (${latestLabel}, ${fmtMoneyHe(latestRev)}) לעומת החודשים החופפים לאותו אירוע אשתקד ${previous.year} (${previousLabel}, ${fmtMoneyHe(prevRev)}) — מוצר זה מסומן כרלוונטי אליו במסך שיוך חג ועונה למוצר. (המכירות ידועות ברמת חודש בלבד, ולכן ההשוואה היא לפי חודשים מלאים החופפים לתאריכי האירוע, לא לפי הימים המדויקים.)`,
            metric: Math.round(delta * 100),
            breakdown: [{ label: name + ' ' + latest.year, value: Math.round(latestRev) }, { label: name + ' ' + previous.year, value: Math.round(prevRev) }]
          });
        });
      });
    });
  }
  processSeasonalSource(relCtx.holidays, 'holiday');
  processSeasonalSource(relCtx.seasons, 'season');

  // 11c. Rule 1d — holiday/season "momentum": compares a product's sales during the
  // latest occurrence of one event against its sales during whichever OTHER holiday/
  // season most recently preceded it — a same-year, event-to-event signal alongside
  // the year-over-year comparison above (e.g. does Passover follow through on the
  // momentum Purim showed, not just "vs last Passover").
  {
    function latestWindowPerName(rows, source) {
      const byName = buildEventWindows(rows, source);
      return Object.keys(byName).map((name) => {
        const w = byName[name].slice().sort((a, b) => b.start - a.start)[0];
        return { source, name, start: w.start, end: w.end, year: w.year };
      });
    }
    const allLatest = latestWindowPerName(relCtx.holidays, 'holiday').concat(latestWindowPerName(relCtx.seasons, 'season'))
      .filter((w) => w.start <= now)
      .sort((a, b) => b.start - a.start);

    allLatest.forEach((E, i) => {
      const P = allLatest.slice(i + 1).find((w) => w.name !== E.name);
      if (!P) return;
      const EMonths = overlappingMonths(E.start, E.end);
      const PMonths = overlappingMonths(P.start, P.end);
      const EKind = E.source === 'holiday' ? 'חג' : 'עונת';
      const PKind = P.source === 'holiday' ? 'חג' : 'עונת';
      Object.keys(byCustomer).forEach((cid) => {
        const cust = custIndex[cid];
        if (isInactive(cust)) return;
        const pairEvents = {};
        byCustomer[cid].forEach((e) => { (pairEvents[e.pid] = pairEvents[e.pid] || []).push(e); });
        Object.keys(pairEvents).forEach((pid) => {
          if (isProductInactive(prodIndex[pid])) return;
          const relE = relevanceEngine.isRelevant(relCtx, pid, E.source, E.name);
          const relP = relevanceEngine.isRelevant(relCtx, pid, P.source, P.name);
          if (!relE.known || !relE.value || !relP.known || !relP.value) return;
          let eRev = 0, pRev = 0;
          pairEvents[pid].forEach((e) => {
            const mk = monthKey(e.t);
            if (EMonths.includes(mk)) eRev += e.rev;
            else if (PMonths.includes(mk)) pRev += e.rev;
          });
          if (pRev < seasonalMinBase) return;
          const delta = (eRev - pRev) / pRev;
          if (Math.abs(delta) < seasonalPct) return;
          const dirWord = delta > 0 ? 'ממשיכה' : 'לא ממשיכה';
          insights.push({
            type: 'holidayMomentumShift',
            severity: Math.abs(delta) >= seasonalHighPct ? 'high' : 'medium',
            customerId: cid,
            customerName: custLabel(cid),
            productCode: pid,
            message: `רכישת ${prodLabel(pid)} ב${EKind} ${E.name} ${E.year} (${fmtMoneyHe(eRev)}) ${dirWord} את המומנטום מ${PKind} ${P.name} ${P.year} שקדם לו (${fmtMoneyHe(pRev)}) — שינוי של ${Math.round(Math.abs(delta) * 100)}%. שני האירועים מסומנים כרלוונטיים למוצר זה במסך שיוך חג ועונה למוצר.`,
            metric: Math.round(delta * 100),
            breakdown: [{ label: E.name + ' ' + E.year, value: Math.round(eRev) }, { label: P.name + ' ' + P.year, value: Math.round(pRev) }]
          });
        });
      });
    });
  }

  // 13. substitute-for-shortage opportunity: product X is out of stock, a substitute
  // exists (and is itself in stock) — offer it to X's regular buyers.
  const substByProduct = groupBy(substitutes, (r) => r.productCode);
  Object.keys(substByProduct).forEach((pid) => {
    if (!isOutOfStock(pid)) return;
    if (isProductInactive(prodIndex[pid])) return;
    const options = substByProduct[pid].map((r) => r.substituteCode).filter((sub) => !isOutOfStock(sub) && !isProductInactive(prodIndex[sub]));
    if (!options.length) return;
    const lookbackFrom = now - params.substOpp_lookbackDays * DAY_MS;
    const buyers = (byProduct[pid] || []).filter((e) => e.t > lookbackFrom);
    const buyerLastPurchase = {};
    buyers.forEach((e) => { if (!buyerLastPurchase[e.cid] || e.t > buyerLastPurchase[e.cid]) buyerLastPurchase[e.cid] = e.t; });
    Object.keys(buyerLastPurchase).forEach((cid) => {
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const sub = options[0];
      insights.push({
        type: 'substituteOpportunity',
        severity: 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `${prodLabel(pid)} חסר במלאי כרגע. הלקוח רכש אותו לאחרונה ב-${fmtMonthYear(buyerLastPurchase[cid])} (בטווח ${params.substOpp_lookbackDays} הימים האחרונים, מאז ${fmtDateHe(lookbackFrom)}) — ניתן להציע את ${prodLabel(sub)} כתחליף.`,
        metric: options.length
      });
    });
  });

  // 14. hierarchy-based upsell: customers grouped by which product DEPARTMENT they
  // actually buy from (behavioral cohort, not a declared customer attribute) — if most
  // of that cohort buys a specific product in the department and this customer doesn't.
  const deptGroups = {};
  Object.keys(custProducts).forEach((cid) => {
    const depts = new Set();
    Object.keys(custProducts[cid]).forEach((pid) => {
      const dept = prodIndex[pid] && prodIndex[pid].department;
      if (dept) depts.add(dept);
    });
    depts.forEach((dept) => { (deptGroups[dept] = deptGroups[dept] || []).push(cid); });
  });
  const hierarchyMinGroup = params.hierarchyUpsell_minGroupSize;
  const hierarchyPct = params.hierarchyUpsell_popularityPct / 100;
  Object.keys(deptGroups).forEach((dept) => {
    const ids = deptGroups[dept].filter((cid) => !isInactive(custIndex[cid]));
    if (ids.length < hierarchyMinGroup) return;
    const deptFamCounts = {}, deptFamRepPid = {};
    ids.forEach((cid) => {
      Object.keys(custProducts[cid] || {}).forEach((pid) => {
        if (prodIndex[pid] && prodIndex[pid].department === dept) { const f = famKey(pid); deptFamCounts[f] = (deptFamCounts[f] || 0) + 1; deptFamRepPid[f] = pid; }
      });
    });
    const popularFams = Object.keys(deptFamCounts).filter((f) => deptFamCounts[f] >= Math.ceil(ids.length * hierarchyPct) && !isFamilyInactive(deptFamRepPid[f]) && !isFamilyOutOfStock(deptFamRepPid[f]));
    ids.forEach((cid) => {
      const owned = custFamilyProducts[cid] || {};
      popularFams.forEach((fam) => {
        if (owned[fam]) return;
        const pid = deptFamRepPid[fam];
        const label = familyLabel(pid);
        insights.push({
          type: 'hierarchyUpsell',
          severity: 'low',
          customerId: cid,
          customerName: custLabel(cid),
          productCode: pid,
          message: `${deptFamCounts[fam]} מתוך ${ids.length} הלקוחות שרכשו אי-פעם מוצר כלשהו ממחלקת "${dept}" רוכשים גם את ${label}, אך לקוח זה לא — הזדמנות למכירה נוספת.`,
          metric: deptFamCounts[fam],
          breakdown: [{ label: 'קונים במחלקה', value: deptFamCounts[fam] }, { label: 'סה"כ במחלקה', value: ids.length }]
        });
      });
    });
  });

  // 15. standing-order opportunity: customer buys almost every month overall (not tied
  // to one product) and hasn't bought anything yet this month — only checked from
  // mid-to-late month onward, to avoid flagging everyone in the first days of a month.
  if (nowDate.getDate() >= params.standingOrder_dayOfMonthGate) {
    const curMonth = monthKey(now);
    Object.keys(byCustomer).forEach((cid) => {
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const monthsSet = {};
      byCustomer[cid].forEach((e) => { monthsSet[monthKey(e.t)] = true; });
      if (monthsSet[curMonth]) return;
      const activeMonthKeys = [];
      for (let m = 1; m <= params.standingOrder_windowMonths; m++) {
        const mk = monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1));
        if (monthsSet[mk]) activeMonthKeys.push(mk);
      }
      if (activeMonthKeys.length >= params.standingOrder_minMonthsActive) {
        insights.push({
          type: 'standingOrderOpportunity',
          severity: 'low',
          customerId: cid,
          customerName: custLabel(cid),
          message: `הלקוח רכש ב-${activeMonthKeys.length} מתוך ${params.standingOrder_windowMonths} החודשים האחרונים (${activeMonthKeys.map(fmtMonthYearKey).join(', ')}), אך טרם ביצע רכישה ב-${fmtMonthYearKey(curMonth)} (נכון ל-${fmtDateHe(now)}) — הזדמנות להציע הזמנה שוטפת קבועה.`,
          metric: activeMonthKeys.length
        });
      }
    });
  }

  // 16. Rule 1c — cumulative revenue this year (Jan through the last fully completed
  // month) vs the same period last year, per customer — bidirectional, and a more
  // sensitive, earlier-warning companion to the rolling-90-day "ירידת מחזור" rule above.
  {
    const year = nowDate.getFullYear();
    const lastCompletedMonth = Math.max(1, nowDate.getMonth());
    const rangeLabel = MONTH_NAMES_HE[0] + '–' + MONTH_NAMES_HE[lastCompletedMonth - 1];
    const startThis = new Date(year, 0, 1).getTime();
    const endThis = new Date(year, lastCompletedMonth, 1).getTime();
    const startLast = new Date(year - 1, 0, 1).getTime();
    const endLast = new Date(year - 1, lastCompletedMonth, 1).getTime();
    Object.keys(byCustomer).forEach((cid) => {
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomer[cid];
      const thisRev = events.filter((e) => e.t >= startThis && e.t < endThis).reduce((a, e) => a + e.rev, 0);
      const lastRev = events.filter((e) => e.t >= startLast && e.t < endLast).reduce((a, e) => a + e.rev, 0);
      if (lastRev < params.cumulativeYoy_minBaseRevenue) return;
      const delta = (thisRev - lastRev) / lastRev;
      if (Math.abs(delta) >= params.cumulativeYoy_pctThreshold / 100) {
        const dirWord = delta > 0 ? 'עלייה' : 'ירידה';
        insights.push({
          type: 'cumulativeYoyShift',
          severity: Math.abs(delta) >= params.cumulativeYoy_highPct / 100 ? 'high' : 'medium',
          customerId: cid,
          customerName: custLabel(cid),
          message: `מחזור הלקוח ב-${rangeLabel} ${year} עמד על ${fmtMoneyHe(thisRev)} — ${dirWord} של ${Math.round(Math.abs(delta) * 100)}% לעומת אותה תקופה ב-${year - 1} (${rangeLabel} ${year - 1}, ${fmtMoneyHe(lastRev)}).`,
          metric: Math.round(delta * 100),
          breakdown: [{ label: rangeLabel + ' ' + year, value: Math.round(thisRev) }, { label: rangeLabel + ' ' + (year - 1), value: Math.round(lastRev) }]
        });
      }
    });
  }

  // 17. shrinking product variety: the customer is buying a much narrower range of
  // products than before, even if total revenue hasn't obviously dropped yet.
  {
    const winMs = params.varietyNarrowing_windowDays * DAY_MS;
    Object.keys(byCustomer).forEach((cid) => {
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomer[cid];
      const curFrom = now - winMs;
      const prevFrom = now - 2 * winMs;
      const curSet = new Set(events.filter((e) => e.t > curFrom && e.t <= now).map((e) => e.pid));
      const prevSet = new Set(events.filter((e) => e.t > prevFrom && e.t <= curFrom).map((e) => e.pid));
      if (prevSet.size < params.varietyNarrowing_minPriorProducts) return;
      const delta = (curSet.size - prevSet.size) / prevSet.size;
      if (delta <= -params.varietyNarrowing_pctThreshold / 100) {
        insights.push({
          type: 'varietyNarrowing',
          severity: delta <= -params.varietyNarrowing_highPct / 100 ? 'high' : 'medium',
          customerId: cid,
          customerName: custLabel(cid),
          message: `הלקוח קנה ${curSet.size} סוגי מוצרים שונים בין ${fmtDateHe(curFrom)}–${fmtDateHe(now)}, לעומת ${prevSet.size} סוגים בתקופה המקבילה שקדמה לה (${fmtDateHe(prevFrom)}–${fmtDateHe(curFrom)}) — ירידה במגוון הרכישות.`,
          metric: Math.round(delta * 100)
        });
      }
    });
  }

  // 18. consecutive-month declining trend (not just one month vs the last one).
  {
    const monthsNeeded = params.decliningTrend_monthsRequired;
    Object.keys(byCustomer).forEach((cid) => {
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const byMonth = groupBy(byCustomer[cid], (e) => monthKey(e.t));
      const series = [];
      const seriesKeys = [];
      for (let m = monthsNeeded; m >= 0; m--) {
        const mk = monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1));
        seriesKeys.push(mk);
        series.push((byMonth[mk] || []).reduce((a, e) => a + e.rev, 0));
      }
      if (series.some((v) => v <= 0)) return;
      let allDeclining = true;
      const pcts = [];
      for (let i = 1; i < series.length; i++) {
        const pct = (series[i] - series[i - 1]) / series[i - 1];
        pcts.push(pct);
        if (pct > -params.decliningTrend_pctPerMonth / 100) allDeclining = false;
      }
      if (!allDeclining) return;
      const avgPct = Math.round(-(pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100);
      const seriesLabel = seriesKeys.map((mk, i) => fmtMonthYearKey(mk) + ' (' + fmtMoneyHe(series[i]) + ')').join(' ← ');
      insights.push({
        type: 'decliningTrend',
        severity: avgPct >= params.decliningTrend_pctPerMonth * 1.5 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `מחזור הלקוח יורד ברציפות ${monthsNeeded} חודשים, בממוצע כ-${avgPct}% בחודש: ${seriesLabel}.`,
        metric: avgPct
      });
    });
  }

  // 19. Rule 1b — quarter-over-quarter and quarter-over-same-quarter-last-year shift,
  // bidirectional (uses the last fully completed quarter, to avoid comparing a partial
  // in-progress quarter).
  {
    const curQStartMonth = quarterOf(nowDate) * 3;
    const lastCompletedQStart = new Date(nowDate.getFullYear(), curQStartMonth - 3, 1).getTime();
    const lastCompletedQEnd = new Date(nowDate.getFullYear(), curQStartMonth, 1).getTime();
    const priorQStart = new Date(nowDate.getFullYear(), curQStartMonth - 6, 1).getTime();
    const priorQEnd = lastCompletedQStart;
    const yoyQStart = new Date(nowDate.getFullYear() - 1, curQStartMonth - 3, 1).getTime();
    const yoyQEnd = new Date(nowDate.getFullYear() - 1, curQStartMonth, 1).getTime();
    Object.keys(byCustomer).forEach((cid) => {
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomer[cid];
      const sum = (from, to) => events.filter((e) => e.t >= from && e.t < to).reduce((a, e) => a + e.rev, 0);
      const curQ = sum(lastCompletedQStart, lastCompletedQEnd);
      if (curQ <= 0) return;
      const priorQ = sum(priorQStart, priorQEnd);
      const yoyQ = sum(yoyQStart, yoyQEnd);
      let basis, baseRev, baseLabel;
      if (yoyQ >= params.quarterlyDecline_minBaseRevenue) { basis = `לרבעון המקביל אשתקד (${quarterLabel(yoyQStart)})`; baseRev = yoyQ; baseLabel = quarterLabel(yoyQStart); }
      else if (priorQ >= params.quarterlyDecline_minBaseRevenue) { basis = `לרבעון הקודם (${quarterLabel(priorQStart)})`; baseRev = priorQ; baseLabel = quarterLabel(priorQStart); }
      else return;
      const delta = (curQ - baseRev) / baseRev;
      if (Math.abs(delta) >= params.quarterlyDecline_pctThreshold / 100) {
        const dirWord = delta > 0 ? 'עלייה' : 'ירידה';
        insights.push({
          type: 'quarterlyRevenueShift',
          severity: Math.abs(delta) >= params.quarterlyDecline_highPct / 100 ? 'high' : 'medium',
          customerId: cid,
          customerName: custLabel(cid),
          message: `מחזור הלקוח ב${quarterLabel(lastCompletedQStart)} עמד על ${fmtMoneyHe(curQ)} — ${dirWord} של ${Math.round(Math.abs(delta) * 100)}% ביחס ${basis} (${fmtMoneyHe(baseRev)}).`,
          metric: Math.round(delta * 100),
          breakdown: [{ label: quarterLabel(lastCompletedQStart), value: Math.round(curQ) }, { label: baseLabel, value: Math.round(baseRev) }]
        });
      }
    });
  }

  // 20. central-customer (chain / franchise) cross-sell: sibling accounts under the
  // same "שם לקוח מרכז" tend to buy the same products.
  const centralGroups = groupBy(activeCustomers.filter((c) => c.centralCustomer), (c) => c.centralCustomer);
  const centralMinGroup = params.centralCross_minGroupSize;
  const centralPct = params.centralCross_popularityPct / 100;
  Object.keys(centralGroups).forEach((centralName) => {
    const members = centralGroups[centralName];
    if (members.length < centralMinGroup) return;
    const ids = members.map((c) => c.customerNumber).filter(Boolean);
    const famCounts3 = {}, famRepPid3 = {};
    ids.forEach((id) => { Object.keys(custProducts[id] || {}).forEach((pid) => { const f = famKey(pid); famCounts3[f] = (famCounts3[f] || 0) + 1; famRepPid3[f] = pid; }); });
    const popularFams3 = Object.keys(famCounts3).filter((f) => famCounts3[f] >= Math.ceil(ids.length * centralPct) && !isFamilyInactive(famRepPid3[f]) && !isFamilyOutOfStock(famRepPid3[f]));
    ids.forEach((id) => {
      const owned = custFamilyProducts[id] || {};
      popularFams3.forEach((fam) => {
        if (owned[fam]) return;
        const pid = famRepPid3[fam];
        const label = familyLabel(pid);
        insights.push({
          type: 'centralCustomerCrossSell',
          severity: 'low',
          customerId: id,
          customerName: custLabel(id),
          productCode: pid,
          message: `${famCounts3[fam]} מתוך ${ids.length} הסניפים תחת לקוח המרכז "${centralName}" רוכשים את ${label}, אך סניף זה לא — הזדמנות להציע גם כאן.`,
          metric: famCounts3[fam],
          breakdown: [{ label: 'סניפים קונים', value: famCounts3[fam] }, { label: 'סה"כ סניפים', value: ids.length }]
        });
      });
    });
  });

  // 21. product flagged for marketing push but barely selling (business-level, not
  // tied to one customer) — excluded if it's simply out of stock right now.
  Object.keys(prodIndex).forEach((pid) => {
    const prod = prodIndex[pid];
    if (isProductInactive(prod)) return;
    if (String(prod.forMarketing || '').trim() !== 'כן') return;
    if (isOutOfStock(pid)) return;
    const lookbackFrom = now - params.marketingUnderperf_lookbackMonths * 31 * DAY_MS;
    const qty = (byProduct[pid] || [])
      .filter((e) => e.t > lookbackFrom)
      .reduce((a, e) => a + e.qty, 0);
    if (qty > params.marketingUnderperf_maxUnits) return;
    insights.push({
      type: 'marketingUnderperformance',
      severity: 'low',
      productCode: pid,
      message: `${prodLabel(pid)} מסומן לשיווק ("לשיווק=כן"), אך נמכרו ממנו רק ${Math.round(qty)} יחידות בין ${fmtDateHe(lookbackFrom)} ל-${fmtDateHe(now)} (${params.marketingUnderperf_lookbackMonths} החודשים האחרונים).`,
      metric: Math.round(qty)
    });
  });

  // 22. upcoming holiday/season reminder: the event starts soon, and a customer who
  // bought a relevant product at last year's occurrence hasn't ordered it again yet.
  function processUpcomingEvents(rows, source) {
    const byName = groupBy(rows, (r) => String(r.name || '').trim());
    Object.keys(byName).forEach((name) => {
      if (!name) return;
      const instances = byName[name].slice().sort((a, b) => new Date(a.fromDate) - new Date(b.fromDate));
      instances.forEach((inst, i) => {
        const startT = new Date(inst.fromDate).getTime();
        const daysUntil = (startT - now) / DAY_MS;
        if (daysUntil < 0 || daysUntil > params.upcomingEvent_daysAhead) return;
        if (i === 0) return;
        const prevInst = instances[i - 1];
        const before = source === 'holiday' ? (prevInst.daysBefore || 0) : 0;
        const after = source === 'holiday' ? (prevInst.daysAfter || 0) : 0;
        const prevStart = new Date(prevInst.fromDate).getTime() - before * DAY_MS;
        const prevEnd = new Date(prevInst.toDate).getTime() + after * DAY_MS;
        // Same month-only-precision issue as the seasonal rule above: compare by
        // calendar month overlapping the window, not by the sale's exact (fabricated) day.
        const prevMonths = overlappingMonths(prevStart, prevEnd);
        const prevLabel = prevMonths.length === 1 ? fmtMonthYearKey(prevMonths[0]) : fmtMonthYearKey(prevMonths[0]) + '–' + fmtMonthYearKey(prevMonths[prevMonths.length - 1]);
        const lastPrevMonthEnd = monthRangeMs(prevMonths[prevMonths.length - 1])[1];

        Object.keys(byCustomer).forEach((cid) => {
          const cust = custIndex[cid];
          if (isInactive(cust)) return;
          const pairEvents = {};
          byCustomer[cid].forEach((e) => { (pairEvents[e.pid] = pairEvents[e.pid] || []).push(e); });
          Object.keys(pairEvents).forEach((pid) => {
            if (isProductInactive(prodIndex[pid])) return;
            const rel = relevanceEngine.isRelevant(relCtx, pid, source, name);
            if (!rel.known || !rel.value) return;
            const boughtLastTime = pairEvents[pid].some((e) => prevMonths.includes(monthKey(e.t)));
            if (!boughtLastTime) return;
            const boughtSinceThen = pairEvents[pid].some((e) => e.t >= lastPrevMonthEnd);
            if (boughtSinceThen) return;
            const eventKind = source === 'holiday' ? 'חג' : 'עונת';
            insights.push({
              type: 'upcomingEventReminder',
              severity: 'low',
              customerId: cid,
              customerName: custLabel(cid),
              productCode: pid,
              message: `${eventKind} ${name} מתחיל ב-${fmtDateHe(startT)} (בעוד ${Math.round(daysUntil)} ימים). הלקוח רכש את ${prodLabel(pid)} בחודשים החופפים לאירוע המקביל אשתקד (${prevLabel}) וטרם הזמין אותו מאז.`,
              metric: Math.round(daysUntil)
            });
          });
        });
      });
    });
  }
  processUpcomingEvents(relCtx.holidays, 'holiday');
  processUpcomingEvents(relCtx.seasons, 'season');

  // 23. Rule 2a — per-product(-family) quantity shift: is the customer buying
  // meaningfully more or less of a specific product than before, even without
  // stopping entirely (general policy 5: substitute purchases count together).
  {
    const winMs = params.productQty_windowDays * DAY_MS;
    Object.keys(byCustomerFamily).forEach((key) => {
      const idx = key.indexOf('|');
      const cid = key.slice(0, idx);
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomerFamily[key];
      const pid = events[events.length - 1].pid;
      if (isFamilyInactive(pid)) return;
      const curFrom = now - winMs;
      const prevFrom = now - 2 * winMs;
      const curQty = events.filter((e) => e.t > curFrom && e.t <= now).reduce((a, e) => a + e.qty, 0);
      const prevQty = events.filter((e) => e.t > prevFrom && e.t <= curFrom).reduce((a, e) => a + e.qty, 0);
      if (prevQty < params.productQty_minPriorQty) return;
      const delta = (curQty - prevQty) / prevQty;
      if (Math.abs(delta) < params.productQty_pctThreshold / 100) return;
      const label = familyLabel(pid);
      const dirWord = delta > 0 ? 'עלתה' : 'ירדה';
      insights.push({
        type: 'productQuantityShift',
        severity: Math.abs(delta) >= params.productQty_highPct / 100 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הכמות שהלקוח קונה מ${label} ${dirWord} ב-${Math.round(Math.abs(delta) * 100)}%: ${Math.round(curQty)} יח' ב-${params.productQty_windowDays} הימים האחרונים (${fmtDateHe(curFrom)}–${fmtDateHe(now)}) לעומת ${Math.round(prevQty)} יח' בתקופה הקודמת (${fmtDateHe(prevFrom)}–${fmtDateHe(curFrom)}).${label.includes('/') ? ' (נספר כיחידה אחת עם המוצר התחליפי שלו.)' : ''}`,
        metric: Math.round(delta * 100),
        breakdown: [{ label: 'כמות אחרונה', value: Math.round(curQty) }, { label: 'כמות קודמת', value: Math.round(prevQty) }]
      });
    });
  }

  // 24. Rule 2e — per-product(-family) purchase frequency this year vs the same
  // months last year (distinct months with a purchase), bidirectional.
  {
    const year = nowDate.getFullYear();
    const lastCompletedMonth = Math.max(1, nowDate.getMonth());
    const rangeLabel2 = MONTH_NAMES_HE[0] + '–' + MONTH_NAMES_HE[lastCompletedMonth - 1];
    Object.keys(byCustomerFamily).forEach((key) => {
      const idx = key.indexOf('|');
      const cid = key.slice(0, idx);
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomerFamily[key];
      const pid = events[events.length - 1].pid;
      if (isFamilyInactive(pid)) return;
      const thisMonths = new Set(), lastMonths = new Set();
      events.forEach((e) => {
        const d = new Date(e.t);
        if (d.getFullYear() === year && d.getMonth() + 1 <= lastCompletedMonth) thisMonths.add(d.getMonth());
        if (d.getFullYear() === year - 1 && d.getMonth() + 1 <= lastCompletedMonth) lastMonths.add(d.getMonth());
      });
      if (lastMonths.size < params.productFreqYoy_minPriorMonths) return;
      const delta = (thisMonths.size - lastMonths.size) / lastMonths.size;
      if (Math.abs(delta) < params.productFreqYoy_pctThreshold / 100) return;
      const label = familyLabel(pid);
      const dirWord = delta > 0 ? 'עלתה' : 'ירדה';
      insights.push({
        type: 'productFrequencyYoyShift',
        severity: Math.abs(delta) >= params.productFreqYoy_highPct / 100 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `תדירות הרכישה של ${label} ${dirWord}: נרכש ב-${thisMonths.size} חודשים שונים ב-${rangeLabel2} ${year}, לעומת ${lastMonths.size} חודשים באותה תקופה אשתקד.${label.includes('/') ? ' (נספר כיחידה אחת עם המוצר התחליפי שלו.)' : ''}`,
        metric: Math.round(delta * 100),
        breakdown: [{ label: rangeLabel2 + ' ' + year, value: thisMonths.size }, { label: rangeLabel2 + ' ' + (year - 1), value: lastMonths.size }]
      });
    });
  }

  // 25. Rule 2c — inconsistent purchase pattern for a product that's a meaningful
  // share of the customer's revenue: an opportunity to establish a steadier order.
  {
    Object.keys(byCustomerFamily).forEach((key) => {
      const idx = key.indexOf('|');
      const cid = key.slice(0, idx);
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomerFamily[key].slice().sort((a, b) => a.t - b.t);
      if (events.length < params.irregularity_minPurchases) return;
      const pid = events[events.length - 1].pid;
      if (isFamilyInactive(pid)) return;
      const totalRev = (byCustomer[cid] || []).reduce((a, e) => a + e.rev, 0);
      const famRev = events.reduce((a, e) => a + e.rev, 0);
      if (totalRev <= 0 || (famRev / totalRev) * 100 < params.irregularity_minRevenueShare) return;
      const gaps = [];
      for (let i = 1; i < events.length; i++) gaps.push((events[i].t - events[i - 1].t) / DAY_MS);
      const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (meanGap <= 0) return;
      const variance = gaps.reduce((a, g) => a + Math.pow(g - meanGap, 2), 0) / gaps.length;
      const cv = Math.sqrt(variance) / meanGap;
      if (cv * 100 < params.irregularity_cvThreshold) return;
      const label = familyLabel(pid);
      insights.push({
        type: 'purchaseIrregularity',
        severity: cv * 100 >= params.irregularity_cvThreshold * 1.5 ? 'high' : 'low',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הלקוח קונה את ${label} באופן לא סדיר — המרווחים בין ${events.length} הרכישות האחרונות נעים סביב ${Math.round(meanGap)} ימים בממוצע, בפיזור גבוה (מקדם שונות ${Math.round(cv * 100)}%). מוצר זה מהווה ${Math.round((famRev / totalRev) * 100)}% ממחזור הלקוח — הזדמנות לייצב את קצב ההזמנה.${label.includes('/') ? ' (נספר כיחידה אחת עם המוצר התחליפי שלו.)' : ''}`,
        metric: Math.round(cv * 100),
        breakdown: [{ label: 'מקדם שונות', value: Math.round(cv * 100) }, { label: 'סף', value: params.irregularity_cvThreshold }]
      });
    });
  }

  // 26. Rule 2d (new) — recently adopted a product family it never bought before:
  // a positive signal that a cross-sell/upsell effort worked.
  {
    const lookbackFrom = now - params.newProduct_lookbackDays * DAY_MS;
    Object.keys(byCustomerFamily).forEach((key) => {
      const idx = key.indexOf('|');
      const cid = key.slice(0, idx);
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomerFamily[key];
      const firstT = Math.min.apply(null, events.map((e) => e.t));
      if (firstT < lookbackFrom) return;
      const pid = events[events.length - 1].pid;
      if (isFamilyInactive(pid)) return;
      const recentRev = events.reduce((a, e) => a + e.rev, 0);
      if (recentRev < params.newProduct_minRevenue) return;
      const label = familyLabel(pid);
      insights.push({
        type: 'newProductAdopted',
        severity: 'low',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הלקוח התחיל לרכוש את ${label} לראשונה ב-${params.newProduct_lookbackDays} הימים האחרונים (מאז ${fmtDateHe(firstT)}), בהיקף של ${fmtMoneyHe(recentRev)} — אימוץ מוצר חדש מוצלח.`,
        metric: Math.round(recentRev),
        breakdown: [{ label: 'מחזור מהמוצר החדש', value: Math.round(recentRev) }]
      });
    });
  }

  // 27. Rule 2d (new) — revenue concentration risk: most of the customer's business
  // rides on very few products, a fragility worth knowing about even without a decline.
  {
    Object.keys(byCustomer).forEach((cid) => {
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const totalRev = byCustomer[cid].reduce((a, e) => a + e.rev, 0);
      if (totalRev < params.concentration_minRevenue) return;
      const famRevMap = {}, famRep = {};
      byCustomer[cid].forEach((e) => { const f = famKey(e.pid); famRevMap[f] = (famRevMap[f] || 0) + e.rev; famRep[f] = e.pid; });
      const sortedFams = Object.keys(famRevMap).map((f) => ({ fam: f, rev: famRevMap[f] })).sort((a, b) => b.rev - a.rev);
      const top = sortedFams.slice(0, params.concentration_topN);
      const topRev = top.reduce((a, x) => a + x.rev, 0);
      const pct = (topRev / totalRev) * 100;
      if (pct < params.concentration_pctThreshold) return;
      const labels = top.map((x) => familyLabel(famRep[x.fam]));
      insights.push({
        type: 'productConcentrationRisk',
        severity: pct >= 85 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `${Math.round(pct)}% ממחזור הלקוח (${fmtMoneyHe(topRev)} מתוך ${fmtMoneyHe(totalRev)}) מגיע מ-${top.length} מוצרים בלבד: ${labels.join(', ')} — סיכון ריכוזיות; פגיעה באחד מהם עלולה לפגוע משמעותית בקשר עם הלקוח.`,
        metric: Math.round(pct),
        breakdown: top.map((x, i) => ({ label: labels[i], value: Math.round(x.rev) }))
      });
    });
  }

  const sevRank = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || Math.abs(b.metric) - Math.abs(a.metric));
  return insights;
}

module.exports = { computeInsights, DEFAULT_PARAMS, loadParams };
