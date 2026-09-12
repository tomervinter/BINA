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
// Only covers the currently-active rules (Rule 1: customer sales pattern, Rule 2:
// customer purchase pattern) — every other previously-explored rule type was removed.
const DEFAULT_PARAMS = {
  monthly_pctThreshold: 30, monthly_highPct: 50, monthly_minBaseRevenue: 100, monthly_topN: 3,
  seasonal_pctThreshold: 40, seasonal_highPct: 70, seasonal_minBaseRevenue: 100,
  cumulativeYoy_pctThreshold: 5, cumulativeYoy_highPct: 15, cumulativeYoy_minBaseRevenue: 100,
  quarterlyDecline_pctThreshold: 20, quarterlyDecline_highPct: 35, quarterlyDecline_minBaseRevenue: 100,
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
  const [customers, products, sales, substitutes, relCtx] = await Promise.all([
    prisma.customer.findMany({ where: { organizationId } }),
    prisma.product.findMany({ where: { organizationId } }),
    prisma.sale.findMany({ where: { organizationId } }),
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

  const s = sales.map((r) => ({
    cid: r.customerNumber, pid: r.productCode, t: new Date(r.date).getTime(), qty: r.quantity, rev: r.revenue
  }));
  const byCustomer = groupBy(s, (x) => x.cid);

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
  function isFamilyInactive(pid) {
    const members = Array.from(familyMembers[famKey(pid)] || [pid]);
    return members.every((m) => isProductInactive(prodIndex[m]));
  }
  const byCustomerFamily = groupBy(s, (x) => x.cid + '|' + famKey(x.pid));

  // Rule 1a — monthly revenue shift (bidirectional: flags a meaningful jump in
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

  // Rule 1d — seasonal/holiday year-over-year pattern shift (per customer, per relevant product)
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

  // Rule 1d cont. — holiday/season "momentum": compares a product's sales during the
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

  // Rule 1c — cumulative revenue this year (Jan through the last fully completed
  // month) vs the same period last year, per customer — bidirectional, and a more
  // sensitive, earlier-warning companion to the monthly and quarterly rules.
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

  // Rule 1b — quarter-over-quarter and quarter-over-same-quarter-last-year shift,
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

  // Rule 2a — per-product(-family) quantity shift: is the customer buying
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

  // Rule 2e — per-product(-family) purchase frequency this year vs the same
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

  // Rule 2c — inconsistent purchase pattern for a product that's a meaningful
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

  // Rule 2d — recently adopted a product family it never bought before: a positive
  // signal that a cross-sell/upsell effort worked.
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

  // Rule 2d — revenue concentration risk: most of the customer's business rides
  // on very few products, a fragility worth knowing about even without a decline.
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
