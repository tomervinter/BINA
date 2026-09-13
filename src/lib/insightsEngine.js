const prisma = require('./prisma');
const relevanceEngine = require('./relevanceEngine');

const DAY_MS = 86400000;
const MONTH_NAMES_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Every insight's message names the exact months/dates and figures behind the
// decision — not just "ירד באחוז X" but which months were compared and what the
// actual revenue/quantity/day-count was, so the number can be traced back by hand.
function fmtMonthYear(t) { const d = new Date(t); return MONTH_NAMES_HE[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtMonthYearKey(mk) { const [y, m] = mk.split('-'); return MONTH_NAMES_HE[+m - 1] + ' ' + y; }
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
// General policy 6: a product-specific insight only fires for a product that is
// active AND explicitly flagged both "לשיווק" (for marketing) and "לעיתוד" (for
// procurement) in the products table — a product not actively marketed or procured
// isn't one the business wants insights nudging customers toward.
function isProductEligible(prod) {
  if (!prod || isProductInactive(prod)) return false;
  if (String(prod.forMarketing || '').trim() !== 'כן') return false;
  if (String(prod.forProcurement || '').trim() !== 'כן') return false;
  return true;
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
// "YYYY-MM" keys for months `fromMonth`..`toMonth` (1-indexed, inclusive) of one year —
// matches the dashboard's own periodMonths/compareMonths format exactly, so an insight
// can drive the dashboard's filters directly when the user clicks it.
function yearMonthRange(year, fromMonth, toMonth) {
  const out = [];
  for (let m = fromMonth; m <= toMonth; m++) out.push(monthKey(new Date(year, m - 1, 1).getTime()));
  return out;
}
// The 3 consecutive month keys of the quarter starting at `startMs`.
function quarterMonthKeys(startMs) {
  const d = new Date(startMs);
  const out = [];
  for (let i = 0; i < 3; i++) out.push(monthKey(new Date(d.getFullYear(), d.getMonth() + i, 1).getTime()));
  return out;
}

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
  monthly_pctThreshold: 30, monthly_highPct: 50, monthly_minBaseRevenue: 100,
  cumulativeYoy_pctThreshold: 5, cumulativeYoy_highPct: 15, cumulativeYoy_minBaseRevenue: 100,
  quarterlyDecline_pctThreshold: 20, quarterlyDecline_highPct: 35, quarterlyDecline_minBaseRevenue: 100,
  productQty_windowMonths: 3, productQty_pctThreshold: 40, productQty_highPct: 60, productQty_minPriorQty: 5,
  productFreqYoy_pctThreshold: 40, productFreqYoy_highPct: 60, productFreqYoy_minPriorMonths: 2,
  irregularity_minPurchases: 4, irregularity_cvThreshold: 70, irregularity_minRevenueShare: 5,
  concentration_topN: 2, concentration_pctThreshold: 70, concentration_minRevenue: 500
};

async function loadParams(organizationId) {
  const rows = await prisma.ruleSetting.findMany({ where: { organizationId } });
  const params = Object.assign({}, DEFAULT_PARAMS);
  rows.forEach((r) => { params[r.paramId] = r.value; });
  return params;
}

// General policy 7: an insight only fires when it reflects negative information
// about the customer — a decline, a drop-off, an irregular ordering pattern, a
// concentration risk. Growth on its own isn't surfaced: every rule that could swing
// either direction (monthly/quarterly/cumulative-YoY revenue, product quantity/
// frequency shifts) only ever reports the decline side, and the one rule with no
// negative variant at all (new-product adoption) was removed outright rather than
// filtered, since it had nothing left to report.

// General policy 8: a holiday or season is never the SUBJECT of an insight (there is
// no "seasonal decline" or "holiday momentum" rule) — they're only used, behind the
// scenes, to decide whether an apparent decline is meaningful or just an expected
// seasonal/holiday-driven dip not worth flagging. See isExplainedBySeasonality below.

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
  function isFamilyEligible(pid) {
    const members = Array.from(familyMembers[famKey(pid)] || [pid]);
    return members.some((m) => isProductEligible(prodIndex[m]));
  }
  const byCustomerFamily = groupBy(s, (x) => x.cid + '|' + famKey(x.pid));

  // See general policy 8: true if the given window overlaps a holiday/season window
  // (with the holiday's own before/after padding) that is marked relevant for at
  // least one of the given products — meaning a dip in that window is expected
  // seasonal behavior, not a meaningful decline worth surfacing.
  function isExplainedBySeasonality(startMs, endMs, pids) {
    if (!pids.length) return false;
    function overlaps(rows, source) {
      return rows.some((r) => {
        const name = String(r.name || '').trim();
        if (!name) return false;
        const before = source === 'holiday' ? (r.daysBefore || 0) : 0;
        const after = source === 'holiday' ? (r.daysAfter || 0) : 0;
        const wStart = new Date(r.fromDate).getTime() - before * DAY_MS;
        const wEnd = new Date(r.toDate).getTime() + after * DAY_MS;
        if (wEnd <= startMs || wStart >= endMs) return false;
        return pids.some((pid) => { const rel = relevanceEngine.isRelevant(relCtx, pid, source, name); return rel.known && rel.value; });
      });
    }
    return overlaps(relCtx.holidays, 'holiday') || overlaps(relCtx.seasons, 'season');
  }

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
    if (delta > -monthlyPct) return; // only a decline counts — see general policy 7
    const [curMStart, curMEnd] = monthRangeMs(curMK);
    if (isExplainedBySeasonality(curMStart, curMEnd, Array.from(new Set(events.map((e) => e.pid))))) return;

    const curByPid = {}, prevByPid = {};
    curEvents.forEach((e) => { curByPid[e.pid] = (curByPid[e.pid] || 0) + e.rev; });
    prevEvents.forEach((e) => { prevByPid[e.pid] = (prevByPid[e.pid] || 0) + e.rev; });
    const allPids = {};
    Object.keys(curByPid).forEach((p) => { allPids[p] = true; });
    Object.keys(prevByPid).forEach((p) => { allPids[p] = true; });
    const diffs = Object.keys(allPids).map((pid) => ({ pid, diff: (curByPid[pid] || 0) - (prevByPid[pid] || 0) }))
      .filter((d) => d.diff < 0 && isProductEligible(prodIndex[d.pid]))
      .sort((a, b) => a.diff - b.diff);
    const topDriver = diffs.length ? prodLabel(diffs[0].pid) : null;

    insights.push({
      type: 'salesPattern',
      severity: Math.abs(delta) >= monthlyHighPct ? 'high' : 'medium',
      customerId: cid,
      customerName: custLabel(cid),
      message: `הכנסת הלקוח ירדה ב-${Math.round(Math.abs(delta) * 100)}% מול החודש הקודם${topDriver ? ', בעיקר עקב ' + topDriver : ''}.`,
      metric: Math.round(delta * 100),
      breakdown: {
        rows: [{ label: fmtMonthYearKey(curMK), value: Math.round(curRev) }, { label: fmtMonthYearKey(prevMK), value: Math.round(prevRev) }],
        dashFilter: { periodMonths: [curMK], compareMonths: [prevMK] }
      }
    });
  });

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
      if (delta <= -params.cumulativeYoy_pctThreshold / 100) { // only a decline counts — see general policy 7
        insights.push({
          type: 'salesPattern',
          severity: Math.abs(delta) >= params.cumulativeYoy_highPct / 100 ? 'high' : 'medium',
          customerId: cid,
          customerName: custLabel(cid),
          message: `מחזור הלקוח מתחילת השנה ירד ב-${Math.round(Math.abs(delta) * 100)}% לעומת אותה תקופה אשתקד.`,
          metric: Math.round(delta * 100),
          breakdown: {
            rows: [{ label: rangeLabel + ' ' + year, value: Math.round(thisRev) }, { label: rangeLabel + ' ' + (year - 1), value: Math.round(lastRev) }],
            dashFilter: { periodMonths: yearMonthRange(year, 1, lastCompletedMonth), compareMonths: yearMonthRange(year - 1, 1, lastCompletedMonth) }
          }
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
      if (yoyQ >= params.quarterlyDecline_minBaseRevenue) { basis = 'לרבעון המקביל אשתקד'; baseRev = yoyQ; baseLabel = quarterLabel(yoyQStart); }
      else if (priorQ >= params.quarterlyDecline_minBaseRevenue) { basis = 'לרבעון הקודם'; baseRev = priorQ; baseLabel = quarterLabel(priorQStart); }
      else return;
      const delta = (curQ - baseRev) / baseRev;
      if (delta <= -params.quarterlyDecline_pctThreshold / 100) { // only a decline counts — see general policy 7
        insights.push({
          type: 'salesPattern',
          severity: Math.abs(delta) >= params.quarterlyDecline_highPct / 100 ? 'high' : 'medium',
          customerId: cid,
          customerName: custLabel(cid),
          message: `מחזור הלקוח ברבעון האחרון ירד ב-${Math.round(Math.abs(delta) * 100)}% ${basis}.`,
          metric: Math.round(delta * 100),
          breakdown: {
            rows: [{ label: quarterLabel(lastCompletedQStart), value: Math.round(curQ) }, { label: baseLabel, value: Math.round(baseRev) }],
            dashFilter: {
              periodMonths: quarterMonthKeys(lastCompletedQStart),
              compareMonths: quarterMonthKeys(basis === 'לרבעון המקביל אשתקד' ? yoyQStart : priorQStart)
            }
          }
        });
      }
    });
  }

  // Rule 2a — per-product(-family) quantity shift: is the customer buying
  // meaningfully more or less of a specific product than before, even without
  // stopping entirely (general policy 5: substitute purchases count together).
  // Windowed by whole calendar months, not a fixed day count — sales only carry
  // month-level precision (every row sits on the 1st of its month), so slicing by
  // an exact day count would arbitrarily include/exclude a month depending on where
  // its day-1 anchor happens to fall relative to the cutoff (the same class of bug
  // the holiday-window comparison had before it was fixed to work in whole months).
  {
    const winMonths = params.productQty_windowMonths;
    const curMonthKeys = [];
    for (let m = 0; m < winMonths; m++) curMonthKeys.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime()));
    const prevMonthKeys = [];
    for (let m = winMonths; m < 2 * winMonths; m++) prevMonthKeys.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime()));
    const curWindowStart = monthRangeMs(curMonthKeys[curMonthKeys.length - 1])[0];
    const curWindowEnd = monthRangeMs(curMonthKeys[0])[1];
    Object.keys(byCustomerFamily).forEach((key) => {
      const idx = key.indexOf('|');
      const cid = key.slice(0, idx);
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomerFamily[key];
      const pid = events[events.length - 1].pid;
      if (!isFamilyEligible(pid)) return;
      const curQty = events.filter((e) => curMonthKeys.includes(monthKey(e.t))).reduce((a, e) => a + e.qty, 0);
      const prevQty = events.filter((e) => prevMonthKeys.includes(monthKey(e.t))).reduce((a, e) => a + e.qty, 0);
      if (prevQty < params.productQty_minPriorQty) return;
      const delta = (curQty - prevQty) / prevQty;
      if (delta > -params.productQty_pctThreshold / 100) return; // only a decline counts — see general policy 7
      if (isExplainedBySeasonality(curWindowStart, curWindowEnd, Array.from(familyMembers[famKey(pid)] || [pid]))) return;
      const label = familyLabel(pid);
      insights.push({
        type: 'purchasePattern',
        severity: Math.abs(delta) >= params.productQty_highPct / 100 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הכמות שהלקוח קונה מ${label} ירדה ב-${Math.round(Math.abs(delta) * 100)}% לעומת ${winMonths} החודשים הקודמים.`,
        metric: Math.round(delta * 100),
        breakdown: {
          rows: [{ label: 'כמות אחרונה', value: Math.round(curQty) }, { label: 'כמות קודמת', value: Math.round(prevQty) }],
          dashFilter: { periodMonths: curMonthKeys, compareMonths: prevMonthKeys }
        }
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
      if (!isFamilyEligible(pid)) return;
      const thisMonths = new Set(), lastMonths = new Set();
      events.forEach((e) => {
        const d = new Date(e.t);
        if (d.getFullYear() === year && d.getMonth() + 1 <= lastCompletedMonth) thisMonths.add(d.getMonth());
        if (d.getFullYear() === year - 1 && d.getMonth() + 1 <= lastCompletedMonth) lastMonths.add(d.getMonth());
      });
      if (lastMonths.size < params.productFreqYoy_minPriorMonths) return;
      const delta = (thisMonths.size - lastMonths.size) / lastMonths.size;
      if (delta > -params.productFreqYoy_pctThreshold / 100) return; // only a decline counts — see general policy 7
      const label = familyLabel(pid);
      insights.push({
        type: 'purchasePattern',
        severity: Math.abs(delta) >= params.productFreqYoy_highPct / 100 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `תדירות הרכישה של ${label} ירדה לעומת אשתקד.`,
        metric: Math.round(delta * 100),
        breakdown: {
          rows: [{ label: rangeLabel2 + ' ' + year, value: thisMonths.size }, { label: rangeLabel2 + ' ' + (year - 1), value: lastMonths.size }],
          dashFilter: { periodMonths: yearMonthRange(year, 1, lastCompletedMonth), compareMonths: yearMonthRange(year - 1, 1, lastCompletedMonth) }
        }
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
      if (!isFamilyEligible(pid)) return;
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
        type: 'purchasePattern',
        severity: cv * 100 >= params.irregularity_cvThreshold * 1.5 ? 'high' : 'low',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הלקוח קונה את ${label} בקצב לא סדיר, למרות שהוא מהווה נתח משמעותי ממחזורו.`,
        metric: Math.round(cv * 100),
        breakdown: { rows: [{ label: 'מקדם שונות', value: Math.round(cv * 100) }, { label: 'סף', value: params.irregularity_cvThreshold }] }
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
      const sortedFams = Object.keys(famRevMap)
        .filter((f) => isFamilyEligible(famRep[f]))
        .map((f) => ({ fam: f, rev: famRevMap[f] }))
        .sort((a, b) => b.rev - a.rev);
      const top = sortedFams.slice(0, params.concentration_topN);
      const topRev = top.reduce((a, x) => a + x.rev, 0);
      const pct = (topRev / totalRev) * 100;
      if (pct < params.concentration_pctThreshold) return;
      const labels = top.map((x) => familyLabel(famRep[x.fam]));
      insights.push({
        type: 'purchasePattern',
        severity: pct >= 85 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `${Math.round(pct)}% ממחזור הלקוח מגיע מ-${top.length} מוצרים בלבד — סיכון ריכוזיות.`,
        metric: Math.round(pct),
        breakdown: { rows: top.map((x, i) => ({ label: labels[i], value: Math.round(x.rev) })) }
      });
    });
  }

  const sevRank = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || Math.abs(b.metric) - Math.abs(a.metric));
  return insights;
}

module.exports = { computeInsights, DEFAULT_PARAMS, loadParams };
