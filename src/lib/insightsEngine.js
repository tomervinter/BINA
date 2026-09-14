const prisma = require('./prisma');
const relevanceEngine = require('./relevanceEngine');

const DAY_MS = 86400000;
const MONTH_NAMES_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Every insight's message names the exact months/dates and figures behind the
// decision — not just "ירד באחוז X" but which months were compared and what the
// actual revenue/quantity/day-count was, so the number can be traced back by hand.
function fmtMonthYear(t) { const d = new Date(t); return MONTH_NAMES_HE[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtMonthYearKey(mk) { const [y, m] = mk.split('-'); return MONTH_NAMES_HE[+m - 1] + ' ' + y; }
// Names the exact month(s) an insight's "current" window covers, so the message
// states when the decline happened rather than only a relative window size like
// "the last 3 months" — e.g. "יולי 2026, אוגוסט 2026, ספטמבר 2026".
function monthKeysLabel(keys) {
  return keys.slice().sort().map(fmtMonthYearKey).join(', ');
}
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
// A "YYYY-MM" key as a single comparable integer (year*12+month) — the gap between
// two months, in months, is just the difference of their indices. Used by the
// overdue-reorder rule below to measure inter-purchase gaps without repeated
// month-by-month date-arithmetic loops.
function monthIndexOf(mk) { const [y, m] = mk.split('-').map(Number); return y * 12 + m; }
function monthKeyFromIndex(idx) { const y = Math.floor((idx - 1) / 12); const m = idx - y * 12; return y + '-' + (m < 10 ? '0' + m : m); }
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
// Covers Rule 1 (customer sales pattern), Rule 2 (customer purchase pattern) and
// Rule 3 (purchase gap vs. peer customers) — every other previously-explored rule
// type was removed.
const DEFAULT_PARAMS = {
  monthly_pctThreshold: 30, monthly_highPct: 50, monthly_minBaseRevenue: 100,
  trend_windowMonths: 4, trend_pctThreshold: 15, trend_highPct: 30, trend_minBaseRevenue: 200, trend_recoveryTolerancePct: 15,
  trend_slowWindowMonths: 7, trend_slowMaxUpSteps: 1,
  peakDrop_windowMonths: 6, peakDrop_pctThreshold: 10, peakDrop_highPct: 25, peakDrop_minBaseRevenue: 200,
  cumulativeYoy_pctThreshold: 5, cumulativeYoy_highPct: 15, cumulativeYoy_minBaseRevenue: 100,
  quarterlyDecline_pctThreshold: 20, quarterlyDecline_highPct: 35, quarterlyDecline_minBaseRevenue: 100,
  productQty_windowMonths: 3, productQty_pctThreshold: 40, productQty_highPct: 60, productQty_minPriorQty: 5,
  variety_windowMonths: 3, variety_pctThreshold: 30, variety_highPct: 50, variety_minPriorCount: 3,
  productFreqYoy_pctThreshold: 40, productFreqYoy_highPct: 60, productFreqYoy_minPriorMonths: 2,
  overdueReorder_lookbackMonths: 24, overdueReorder_minPurchaseMonths: 3, overdueReorder_minAvgGapMonths: 2,
  overdueReorder_extraMonths: 1, overdueReorder_highExtraMonths: 3,
  irregularity_windowMonths: 6, irregularity_minActiveMonths: 4, irregularity_cvThreshold: 70, irregularity_minRevenueShare: 5,
  concentration_topN: 2, concentration_pctThreshold: 70, concentration_minRevenue: 500,
  peerGap_windowMonths: 6, peerGap_pctThreshold: 50, peerGap_highPct: 80, peerGap_minGroupSize: 2
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

  // Some source ERPs export a full customer×product×month grid rather than a sparse
  // transaction log — meaning a month with no actual purchase can still show up as a
  // real Sale row, not as an absent one, with a "zero" quantity/revenue represented
  // several different ways: a literal 0, a blank cell (null/undefined/empty string),
  // or a negative number (e.g. a return/correction row) — all three are normalized to
  // 0 here, uniformly, before anything downstream ever sees them. Every SUM-based rule
  // (revenue/quantity totals) is naturally immune to a true 0 — it contributes
  // nothing — but any rule that asks "did an event happen in month X" or "does the
  // customer have this product at all" (distinct-month counting, family-presence sets)
  // would wrongly treat a zero-value placeholder as a real purchase, masking exactly
  // the kind of drop-off/stoppage these rules exist to catch — so rows left at 0 in
  // both fields after normalization are dropped here, once, so every rule downstream
  // sees only real purchase activity. Kept to qty!==0 OR rev!==0 (not AND) so a
  // legitimate edge case with a value in only one field (e.g. a free sample: qty>0,
  // rev=0) still counts as a real event.
  const zeroSafe = (v) => Math.max(0, Number(v) || 0);
  const s = sales
    .map((r) => ({ cid: r.customerNumber, pid: r.productCode, t: new Date(r.date).getTime(), qty: zeroSafe(r.quantity), rev: zeroSafe(r.revenue) }))
    .filter((e) => e.qty !== 0 || e.rev !== 0);
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
  // A decline explained by seasonality is never suppressed — it's shown with a
  // caveat and flagged breakdown.needsReview:true regardless of severity, purely as
  // informational context for the user to judge for themselves, rather than the
  // engine silently deciding a medium-severity decline isn't worth seeing at all
  // (general policy 8). needsReview insights still sort after non-flagged ones of
  // the same type (see sortInsights in src/routes/insights.js), so they only occupy
  // a dashboard's limited top-5 slots when there's nothing else to show.
  //
  // The check itself is only meaningful over a SHORT window: a holiday/season
  // genuinely might explain a specific month's dip, but over a long multi-month
  // window (a cumulative or wide-trend insight) some holiday or other overlaps it
  // almost by certainty, regardless of whether it has anything to do with the
  // decline — flagging every such insight would just be noise. So the check only
  // runs at all when the insight's own window is SEASONALITY_NOTE_MAX_MONTHS or
  // narrower; wider windows skip it entirely (no caveat, no flag) rather than
  // returning an almost-always-true result.
  const SEASONALITY_NOTE_MAX_MONTHS = 2;
  const SEASONALITY_CAVEAT = ' שימו לב: התקופה חופפת לחג/עונה המשויכים למוצר — ייתכן שהשינוי מוסבר בכך, ומומלץ לוודא את הנתון בפועל.';

  // Rule 1a — monthly revenue shift (bidirectional: flags a meaningful jump in
  // either direction, not just a decline), with the specific products driving it.
  // "Current" is the last FULLY completed month, not the in-progress one — a
  // partial month always looks like a decline against a full prior month purely
  // because fewer days have happened yet, which isn't a real signal.
  const monthlyPct = params.monthly_pctThreshold / 100;
  const monthlyHighPct = params.monthly_highPct / 100;
  Object.keys(byCustomer).forEach((cid) => {
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    const events = byCustomer[cid];
    const curMK = prevMonthKeyOf(monthKey(now));
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
    const isHighSeverity = Math.abs(delta) >= monthlyHighPct;
    const seasonalityExplained = isExplainedBySeasonality(curMStart, curMEnd, Array.from(new Set(events.map((e) => e.pid))));

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
      severity: isHighSeverity ? 'high' : 'medium',
      customerId: cid,
      customerName: custLabel(cid),
      message: `ב${fmtMonthYearKey(curMK)} הכנסת הלקוח ירדה ב-${Math.round(Math.abs(delta) * 100)}% מול החודש הקודם${topDriver ? ', בעיקר עקב ' + topDriver : ''}.` + (seasonalityExplained ? SEASONALITY_CAVEAT : ''),
      metric: Math.round(delta * 100),
      breakdown: {
        rows: [{ label: fmtMonthYearKey(curMK), value: Math.round(curRev) }, { label: fmtMonthYearKey(prevMK), value: Math.round(prevRev) }],
        dashFilter: { periodMonths: [curMK], compareMonths: [prevMK] },
        needsReview: seasonalityExplained
      }
    });
  });

  // Rule 1d — consistent month-over-month decline trend: revenue trending down and
  // STAYING down, not just one bad month with otherwise stable neighbors (rule 1a)
  // or one bad quarter (rule 1b). Three independent ways to qualify, since a decline
  // can look very different depending on how it unfolds — checked in this order,
  // each only evaluated if an earlier one didn't already qualify the customer, since
  // (a) is the most urgent/specific signal and (c)/(b) are progressively broader:
  //  (a) a SHARP recent shift — the last trend_windowMonths months (split into an
  //      earlier half and a later half) with the later half's average down
  //      trend_pctThreshold%+ vs the earlier half's, allowing at most one
  //      step-over-step uptick beyond trend_recoveryTolerancePct along the way (a
  //      single blip on an otherwise declining trajectory shouldn't disqualify it).
  //  (b) a SLOW, steady erosion — nearly every month down a little from the one
  //      before it over a longer trend_slowWindowMonths window, even though no
  //      single step is dramatic and the aggregate move is too gentle to cross (a)'s
  //      threshold within a short window. Qualifies when at most
  //      trend_slowMaxUpSteps of the window's month-over-month steps are net
  //      increases, AND the window's last month is still below its first (a real net
  //      decline, not a wash).
  //  (c) a sharp DROP FROM A RECENT PEAK that never recovered — different in
  //      character from (a)/(b), which both compare consecutive windows/steps to
  //      each other and so miss this once the drop itself is further back than
  //      trend_windowMonths/trend_slowWindowMonths: by then the post-drop months
  //      look flat/stable relative to EACH OTHER, even though they're still well
  //      below what the customer was doing right before the drop. Finds the highest
  //      single month within the earlier half of a peakDrop_windowMonths window and
  //      compares it to the later half's average; qualifies when that average is
  //      down peakDrop_pctThreshold%+ from the peak. Checked between (a) and (b)
  //      since a real peak-and-drop is a more specific, notable story than generic
  //      erosion but less urgent than an ongoing sharp slide.
  // Computed into a map keyed by customer, NOT pushed directly — rule 1c below folds
  // a customer's trend result into ONE combined insight when that customer also has
  // a cumulative-YoY decline, and pushes any leftover trend-only customers itself
  // afterward.
  const trendByCustomer = {};
  {
    function monthlyRevSeries(events, winMonths) {
      const monthKeys = [];
      for (let m = winMonths; m >= 1; m--) monthKeys.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime()));
      const byMonth = monthKeys.map((mk) => events.filter((e) => monthKey(e.t) === mk).reduce((a, e) => a + e.rev, 0));
      return { monthKeys, byMonth };
    }
    const winMonths = params.trend_windowMonths;
    const half = Math.floor(winMonths / 2);
    const slowWinMonths = params.trend_slowWindowMonths;
    Object.keys(byCustomer).forEach((cid) => {
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomer[cid];
      const pids = Array.from(new Set(events.map((e) => e.pid)));

      // (a) sharp recent shift
      sharp: {
        const { monthKeys, byMonth } = monthlyRevSeries(events, winMonths);
        const firstHalfKeys = monthKeys.slice(0, half);
        const secondHalfKeys = monthKeys.slice(winMonths - half);
        const firstHalfAvg = byMonth.slice(0, half).reduce((a, v) => a + v, 0) / half;
        const secondHalfAvg = byMonth.slice(winMonths - half).reduce((a, v) => a + v, 0) / half;
        if (firstHalfAvg < params.trend_minBaseRevenue) break sharp;
        const delta = (secondHalfAvg - firstHalfAvg) / firstHalfAvg;
        if (delta > -params.trend_pctThreshold / 100) break sharp; // only a decline counts — see general policy 7
        let recoveries = 0;
        for (let i = 1; i < byMonth.length; i++) {
          if (byMonth[i - 1] > 0 && byMonth[i] > byMonth[i - 1] * (1 + params.trend_recoveryTolerancePct / 100)) recoveries++;
        }
        if (recoveries > 1) break sharp;
        const isHighSeverity = Math.abs(delta) >= params.trend_highPct / 100;
        const trendWindowStart = monthRangeMs(monthKeys[0])[0];
        const trendWindowEnd = monthRangeMs(monthKeys[monthKeys.length - 1])[1];
        const seasonalityExplained = winMonths <= SEASONALITY_NOTE_MAX_MONTHS && isExplainedBySeasonality(trendWindowStart, trendWindowEnd, pids);
        trendByCustomer[cid] = {
          delta, isHighSeverity, seasonalityExplained,
          message: `מחזור הלקוח במגמת ירידה עקבית: ${monthKeysLabel(secondHalfKeys)} נמוכים ב-${Math.round(Math.abs(delta) * 100)}% בממוצע לעומת ${monthKeysLabel(firstHalfKeys)}, ללא סימני התאוששות.`,
          breakdown: {
            rows: monthKeys.map((mk, i) => ({ label: fmtMonthYearKey(mk), value: Math.round(byMonth[i]) })),
            dashFilter: { periodMonths: secondHalfKeys, compareMonths: firstHalfKeys },
            needsReview: seasonalityExplained
          }
        };
      }
      if (trendByCustomer[cid]) return; // (a) already found something for this customer — it takes priority over (b)/(c)

      // (c) sharp drop from a recent peak, without recovery. No seasonality note —
      // the window is wide enough (peakDrop_windowMonths, default 6) that it's
      // always above SEASONALITY_NOTE_MAX_MONTHS in practice, so the check would
      // short-circuit to false anyway; left out explicitly rather than computed and
      // discarded.
      peakDrop: {
        const winM = params.peakDrop_windowMonths;
        const half2 = Math.floor(winM / 2);
        const { monthKeys, byMonth } = monthlyRevSeries(events, winM);
        const firstHalfKeys = monthKeys.slice(0, half2);
        const secondHalfKeys = monthKeys.slice(winM - half2);
        const firstHalfVals = byMonth.slice(0, half2);
        const secondHalfVals = byMonth.slice(winM - half2);
        const peakValue = Math.max.apply(null, firstHalfVals);
        if (peakValue < params.peakDrop_minBaseRevenue) break peakDrop;
        const peakMonthKey = firstHalfKeys[firstHalfVals.indexOf(peakValue)];
        const recentAvg = secondHalfVals.reduce((a, v) => a + v, 0) / secondHalfVals.length;
        const delta = (recentAvg - peakValue) / peakValue;
        if (delta > -params.peakDrop_pctThreshold / 100) break peakDrop; // only a decline counts — see general policy 7
        const isHighSeverity = Math.abs(delta) >= params.peakDrop_highPct / 100;
        trendByCustomer[cid] = {
          delta, isHighSeverity, seasonalityExplained: false,
          message: `מחזור הלקוח הגיע לשיא ב${fmtMonthYearKey(peakMonthKey)} (${fmtMoneyHe(peakValue)}), ומאז — ${monthKeysLabel(secondHalfKeys)} — עומד בממוצע על ${fmtMoneyHe(recentAvg)}: ירידה של ${Math.round(Math.abs(delta) * 100)}% מהשיא, ללא חזרה לרמה ההיא.`,
          breakdown: {
            rows: monthKeys.map((mk, i) => ({ label: fmtMonthYearKey(mk), value: Math.round(byMonth[i]) })),
            dashFilter: { periodMonths: secondHalfKeys, compareMonths: [peakMonthKey] },
            needsReview: false
          }
        };
      }
      if (trendByCustomer[cid]) return; // (c) took it — skip (b)

      // (b) slow, steady erosion. No seasonality suppression here unlike (a) — that
      // check asks whether the whole window overlaps a holiday/season, which is a
      // reasonable "maybe this explains it" question over a short 4-month span, but
      // over a 7-month span it's nearly guaranteed to overlap SOME holiday somewhere
      // in Israeli retail regardless of whether that holiday has anything to do with
      // a genuine sustained erosion — applying it here silently killed real cases.
      {
        const { monthKeys, byMonth } = monthlyRevSeries(events, slowWinMonths);
        if (byMonth[0] < params.trend_minBaseRevenue) return;
        let upSteps = 0;
        for (let i = 1; i < byMonth.length; i++) {
          if (byMonth[i] > byMonth[i - 1]) upSteps++;
        }
        if (upSteps > params.trend_slowMaxUpSteps) return;
        const delta = (byMonth[byMonth.length - 1] - byMonth[0]) / byMonth[0];
        if (delta >= 0) return; // no net decline over the window — see general policy 7
        const isHighSeverity = Math.abs(delta) >= params.trend_highPct / 100;
        trendByCustomer[cid] = {
          delta, isHighSeverity, seasonalityExplained: false,
          message: `מחזור הלקוח נשחק בהדרגה — ${monthKeysLabel([monthKeys[monthKeys.length - 1]])} נמוך ב-${Math.round(Math.abs(delta) * 100)}% לעומת ${monthKeysLabel([monthKeys[0]])}, ברוב חודשי התקופה ירידה מול החודש הקודם.`,
          breakdown: {
            rows: monthKeys.map((mk, i) => ({ label: fmtMonthYearKey(mk), value: Math.round(byMonth[i]) })),
            dashFilter: { periodMonths: [monthKeys[monthKeys.length - 1]], compareMonths: [monthKeys[0]] },
            needsReview: false
          }
        };
      }
    });
  }

  // Rule 1c — cumulative revenue this year (Jan through the last fully completed
  // month) vs the same period last year, per customer — bidirectional, and a more
  // sensitive, earlier-warning companion to the monthly and quarterly rules. Also
  // decomposes the YTD delta into its monthly YoY components to name the 1-2
  // months that actually drove the decline, rather than leaving the customer to
  // guess where in an 8-month range the problem is, and folds in rule 1d's trend
  // result (see above) into one combined insight when a customer trips both.
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
      if (delta > -params.cumulativeYoy_pctThreshold / 100) return; // only a decline counts — see general policy 7

      const monthlyDeltas = [];
      for (let m = 1; m <= lastCompletedMonth; m++) {
        const [mStart, mEnd] = monthRangeMs(monthKey(new Date(year, m - 1, 1).getTime()));
        const [mLastStart, mLastEnd] = monthRangeMs(monthKey(new Date(year - 1, m - 1, 1).getTime()));
        const thisM = events.filter((e) => e.t >= mStart && e.t < mEnd).reduce((a, e) => a + e.rev, 0);
        const lastM = events.filter((e) => e.t >= mLastStart && e.t < mLastEnd).reduce((a, e) => a + e.rev, 0);
        monthlyDeltas.push({ m, diff: thisM - lastM });
      }
      const decliningMonths = monthlyDeltas.filter((d) => d.diff < 0).sort((a, b) => a.diff - b.diff);
      const driverMonths = decliningMonths.length
        ? (decliningMonths.length > 1 && Math.abs(decliningMonths[1].diff) >= Math.abs(decliningMonths[0].diff) * 0.5
          ? [decliningMonths[0], decliningMonths[1]] : [decliningMonths[0]])
        : [];
      const driverLabel = driverMonths.map((d) => MONTH_NAMES_HE[d.m - 1] + ' ' + year).join(' ו');

      const trend = trendByCustomer[cid];
      delete trendByCustomer[cid]; // consumed — folded into this combined insight below

      let message = `מחזור הלקוח ב${rangeLabel} ${year} ירד ב-${Math.round(Math.abs(delta) * 100)}% לעומת אותה תקופה אשתקד` +
        (driverLabel ? `, בעיקר עקב הירידה ב${driverLabel}` : '') + '.';
      if (trend) {
        message += ' ' + trend.message;
        if (trend.seasonalityExplained) message += SEASONALITY_CAVEAT;
      }

      insights.push({
        type: 'salesPattern',
        severity: (Math.abs(delta) >= params.cumulativeYoy_highPct / 100 || (trend && trend.isHighSeverity)) ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message,
        metric: Math.round(delta * 100),
        breakdown: {
          rows: [{ label: rangeLabel + ' ' + year, value: Math.round(thisRev) }, { label: rangeLabel + ' ' + (year - 1), value: Math.round(lastRev) }],
          dashFilter: { periodMonths: yearMonthRange(year, 1, lastCompletedMonth), compareMonths: yearMonthRange(year - 1, 1, lastCompletedMonth) },
          needsReview: !!(trend && trend.seasonalityExplained)
        }
      });
    });

    // Trend-only customers (didn't also trip the cumulative-YoY rule above) still
    // get their own standalone insight.
    Object.keys(trendByCustomer).forEach((cid) => {
      const t = trendByCustomer[cid];
      insights.push({
        type: 'salesPattern',
        severity: t.isHighSeverity ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: t.message + (t.seasonalityExplained ? SEASONALITY_CAVEAT : ''),
        metric: Math.round(t.delta * 100),
        breakdown: t.breakdown
      });
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
          message: `מחזור הלקוח ב${quarterLabel(lastCompletedQStart)} ירד ב-${Math.round(Math.abs(delta) * 100)}% ${basis}.`,
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
  // Both windows start at the last FULLY completed month (m=1), skipping the
  // in-progress current month entirely — including it would make "current" look
  // artificially low just because the month isn't over yet.
  {
    const winMonths = params.productQty_windowMonths;
    const curMonthKeys = [];
    for (let m = 1; m <= winMonths; m++) curMonthKeys.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime()));
    const prevMonthKeys = [];
    for (let m = winMonths + 1; m <= 2 * winMonths; m++) prevMonthKeys.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime()));
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
      const isHighSeverity = Math.abs(delta) >= params.productQty_highPct / 100;
      const seasonalityExplained = winMonths <= SEASONALITY_NOTE_MAX_MONTHS && isExplainedBySeasonality(curWindowStart, curWindowEnd, Array.from(familyMembers[famKey(pid)] || [pid]));
      const label = familyLabel(pid);
      insights.push({
        type: 'purchasePattern',
        severity: isHighSeverity ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `ב${monthKeysLabel(curMonthKeys)} הכמות שהלקוח קונה מ${label} ירדה ב-${Math.round(Math.abs(delta) * 100)}% לעומת ${winMonths} החודשים שקדמו.` + (seasonalityExplained ? SEASONALITY_CAVEAT : ''),
        metric: Math.round(delta * 100),
        breakdown: {
          rows: [{ label: 'כמות אחרונה', value: Math.round(curQty) }, { label: 'כמות קודמת', value: Math.round(prevQty) }],
          dashFilter: { periodMonths: curMonthKeys, compareMonths: prevMonthKeys },
          needsReview: seasonalityExplained
        }
      });
    });
  }

  // Rule 2f — shrinking product variety: is the customer buying a NARROWER range of
  // distinct products than before, even if quantities of what they still buy haven't
  // dropped? Counted by product family (general policy 5), same window convention as
  // rule 2a (both windows anchored at the last fully completed month). Independent of
  // rule 2a — a customer who buys steady quantities of fewer and fewer products won't
  // necessarily trip the per-product decline check, since each remaining product's
  // own quantity may be flat or even up.
  {
    const winMonths = params.variety_windowMonths;
    const curMonthKeys = [];
    for (let m = 1; m <= winMonths; m++) curMonthKeys.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime()));
    const prevMonthKeys = [];
    for (let m = winMonths + 1; m <= 2 * winMonths; m++) prevMonthKeys.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime()));
    function famLabelByKey(fam) { return Array.from(familyMembers[fam] || [fam]).map(prodLabel).join(' / '); }
    Object.keys(byCustomer).forEach((cid) => {
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomer[cid];
      const curFamilies = new Set(), prevFamilies = new Set();
      events.forEach((e) => {
        if (curMonthKeys.includes(monthKey(e.t))) curFamilies.add(famKey(e.pid));
        else if (prevMonthKeys.includes(monthKey(e.t))) prevFamilies.add(famKey(e.pid));
      });
      if (prevFamilies.size < params.variety_minPriorCount) return;
      const delta = (curFamilies.size - prevFamilies.size) / prevFamilies.size;
      if (delta > -params.variety_pctThreshold / 100) return; // only a decline counts — see general policy 7
      const dropped = Array.from(prevFamilies).filter((f) => !curFamilies.has(f));
      if (!dropped.length) return; // shrank in count but the actual set didn't narrow (e.g. swapped one family for another) — not the pattern this rule targets
      const droppedLabel = dropped.map(famLabelByKey).join(', ');
      insights.push({
        type: 'purchasePattern',
        severity: Math.abs(delta) >= params.variety_highPct / 100 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `מגוון המוצרים של הלקוח צומצם מ-${prevFamilies.size} ל-${curFamilies.size} מוצרים שונים ב-${winMonths} החודשים האחרונים, לעומת ${winMonths} החודשים שקדמו. הלקוח הפסיק לקנות: ${droppedLabel}.`,
        metric: Math.round(delta * 100),
        breakdown: {
          rows: [{ label: 'מוצרים שונים — אחרונה', value: curFamilies.size }, { label: 'מוצרים שונים — קודמת', value: prevFamilies.size }],
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
        message: `תדירות הרכישה של ${label} ב${rangeLabel2} ${year} ירדה לעומת אשתקד.`,
        metric: Math.round(delta * 100),
        breakdown: {
          rows: [{ label: rangeLabel2 + ' ' + year, value: thisMonths.size }, { label: rangeLabel2 + ' ' + (year - 1), value: lastMonths.size }],
          dashFilter: { periodMonths: yearMonthRange(year, 1, lastCompletedMonth), compareMonths: yearMonthRange(year - 1, 1, lastCompletedMonth) }
        }
      });
    });
  }

  // Rule 2g — overdue expected reorder: for a customer×product(-family) with a
  // clearly PERIODIC, sparse purchase pattern (buys occasionally — every few
  // months, not every month; general policy 5 applies, substitutes count as the
  // same family), is the customer now overdue relative to their OWN historical
  // rhythm? Different from rule 2e above, which compares purchase-month counts
  // within a fixed Jan-to-date calendar window and is a noisy signal for someone
  // who only buys 2-3x/year total (one purchase landing on either side of the
  // window swings the count by 50-100%), and from rule 2c below, which measures
  // variance in QUANTITY across active months but says nothing about how long a
  // gap has run. This instead looks at the customer's own historical
  // inter-purchase gaps (in months) over a bounded lookback window, and flags
  // when the gap since their last purchase already exceeds the longest gap
  // they've ever had before — going quiet for longer than they ever have,
  // even for an occasional buyer for whom months-long gaps are otherwise normal.
  {
    const lookbackMonths = params.overdueReorder_lookbackMonths;
    const lastCompletedMK = prevMonthKeyOf(monthKey(now));
    const lastCompletedIdx = monthIndexOf(lastCompletedMK);
    const lookbackStartIdx = lastCompletedIdx - lookbackMonths + 1;
    Object.keys(byCustomerFamily).forEach((key) => {
      const idx = key.indexOf('|');
      const cid = key.slice(0, idx);
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const events = byCustomerFamily[key];
      const pid = events[events.length - 1].pid;
      if (!isFamilyEligible(pid)) return;
      const purchaseMonthIdxs = Array.from(new Set(events.map((e) => monthKey(e.t))))
        .map(monthIndexOf)
        .filter((i) => i >= lookbackStartIdx && i <= lastCompletedIdx)
        .sort((a, b) => a - b);
      if (purchaseMonthIdxs.length < params.overdueReorder_minPurchaseMonths) return;
      const gaps = [];
      for (let i = 1; i < purchaseMonthIdxs.length; i++) gaps.push(purchaseMonthIdxs[i] - purchaseMonthIdxs[i - 1]);
      const avgGap = gaps.reduce((a, g) => a + g, 0) / gaps.length;
      // A near-monthly regular buyer isn't this rule's target — a missed month for
      // them is already caught by the revenue/quantity decline rules above, and
      // treating a 1-month gap as "overdue" here would just be noise on top of that.
      if (avgGap < params.overdueReorder_minAvgGapMonths) return;
      const maxGap = Math.max.apply(null, gaps);
      const lastPurchaseIdx = purchaseMonthIdxs[purchaseMonthIdxs.length - 1];
      const currentGap = lastCompletedIdx - lastPurchaseIdx;
      if (currentGap < maxGap + params.overdueReorder_extraMonths) return;
      const isHighSeverity = currentGap >= maxGap + params.overdueReorder_highExtraMonths;
      const label = familyLabel(pid);
      const lastPurchaseMK = monthKeyFromIndex(lastPurchaseIdx);
      const dryMonthKeys = [];
      for (let i = lastPurchaseIdx + 1; i <= lastCompletedIdx; i++) dryMonthKeys.push(monthKeyFromIndex(i));
      insights.push({
        type: 'purchasePattern',
        severity: isHighSeverity ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הלקוח נוהג לרכוש את ${label} בממוצע כל כ-${Math.round(avgGap * 10) / 10} חודשים (הפער הגדול ביותר עד כה: ${maxGap} חודשים), אך לא רכש מאז ${fmtMonthYearKey(lastPurchaseMK)} — ${currentGap} חודשים ללא רכישה, פער חורג מכל מה שנצפה אצלו בעבר.`,
        metric: currentGap,
        breakdown: {
          rows: [
            { label: 'חודשים מאז הרכישה האחרונה', value: currentGap },
            { label: 'הפער הגדול ביותר בעבר', value: maxGap },
            { label: 'פער ממוצע בין רכישות', value: Math.round(avgGap * 10) / 10 }
          ],
          dashFilter: { periodMonths: dryMonthKeys.length ? dryMonthKeys : [lastCompletedMK] }
        }
      });
    });
  }

  // Rule 2c — inconsistent purchase pattern for a product that's a meaningful
  // share of the customer's revenue: an opportunity to establish a steadier order.
  // Measured quantitatively as the coefficient of variation of MONTHLY QUANTITY
  // across two comparable windows — the last irregularity_windowMonths fully
  // completed months, plus the same calendar months a year earlier — rather than
  // the raw time gaps between individual purchase events, so a customer who buys
  // wildly different amounts month to month (even on an otherwise regular cadence)
  // is caught, and the two windows can drive the dashboard's own period filters
  // the same way every other rule here does. Revenue share is scoped to this same
  // 12-month combined window, not all-time, to stay consistent with everything
  // else the rule now measures within it.
  {
    const winMonths = params.irregularity_windowMonths;
    const curMonthKeys = [];
    for (let m = 1; m <= winMonths; m++) curMonthKeys.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime()));
    const yoyMonthKeys = [];
    for (let m = 1; m <= winMonths; m++) yoyMonthKeys.push(monthKey(new Date(nowDate.getFullYear() - 1, nowDate.getMonth() - m, 1).getTime()));
    const allMonthKeys = curMonthKeys.concat(yoyMonthKeys);
    Object.keys(byCustomerFamily).forEach((key) => {
      const idx = key.indexOf('|');
      const cid = key.slice(0, idx);
      const cust = custIndex[cid];
      if (isInactive(cust)) return;
      const pid = byCustomerFamily[key][byCustomerFamily[key].length - 1].pid;
      if (!isFamilyEligible(pid)) return;
      const windowEvents = byCustomerFamily[key].filter((e) => allMonthKeys.includes(monthKey(e.t)));
      const totalRev = (byCustomer[cid] || []).filter((e) => allMonthKeys.includes(monthKey(e.t))).reduce((a, e) => a + e.rev, 0);
      const famRev = windowEvents.reduce((a, e) => a + e.rev, 0);
      if (totalRev <= 0 || (famRev / totalRev) * 100 < params.irregularity_minRevenueShare) return;
      const monthlyQty = allMonthKeys.map((mk) => windowEvents.filter((e) => monthKey(e.t) === mk).reduce((a, e) => a + e.qty, 0));
      const activeMonths = monthlyQty.filter((q) => q > 0).length;
      if (activeMonths < params.irregularity_minActiveMonths) return;
      const mean = monthlyQty.reduce((a, q) => a + q, 0) / monthlyQty.length;
      if (mean <= 0) return;
      const variance = monthlyQty.reduce((a, q) => a + Math.pow(q - mean, 2), 0) / monthlyQty.length;
      const cv = Math.sqrt(variance) / mean;
      if (cv * 100 < params.irregularity_cvThreshold) return;
      const label = familyLabel(pid);
      insights.push({
        type: 'purchasePattern',
        severity: cv * 100 >= params.irregularity_cvThreshold * 1.5 ? 'high' : 'low',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הלקוח קונה את ${label} בכמות לא סדירה מחודש לחודש — נבדק ב${monthKeysLabel(curMonthKeys)} וכן באותם חודשים אשתקד — למרות שהוא מהווה נתח משמעותי ממחזורו.`,
        metric: Math.round(cv * 100),
        breakdown: {
          rows: [{ label: 'מקדם שונות בכמות החודשית', value: Math.round(cv * 100) }, { label: 'סף', value: params.irregularity_cvThreshold }],
          dashFilter: { periodMonths: curMonthKeys, compareMonths: yoyMonthKeys }
        }
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

  // Rule 3 — purchase gap vs. peer customers: flags a customer who does NOT buy a
  // specific product while a strong majority of its peers do, within the last
  // peerGap_windowMonths — peers being (a) other active customers under the same
  // "לקוח מרכז" (central-customer) group, and/or (b) other active customers of the
  // same customer type. A customer already covered via a substitute product
  // (general policy 5) is never flagged — the gap isn't real once they've switched
  // to an equivalent. Unlike the family-merged rules above, the "peers buy X" count
  // itself is by exact product code, not merged with substitutes, by design — only
  // the target customer's own "do they already have this covered" check uses the
  // family. When both peer groups clear the threshold for the same customer/product,
  // one insight reports both reasons rather than two separate ones.
  {
    const winMonths = params.peerGap_windowMonths;
    const windowMonthKeys = new Set();
    for (let m = 1; m <= winMonths; m++) windowMonthKeys.add(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime()));
    const sortedWindowMonthKeys = Array.from(windowMonthKeys).sort();

    const boughtInWindow = {}; // cid -> Set(pid)
    const productBuyers = {}; // pid -> Set(cid)
    s.forEach((e) => {
      if (!windowMonthKeys.has(monthKey(e.t))) return;
      (boughtInWindow[e.cid] = boughtInWindow[e.cid] || new Set()).add(e.pid);
      (productBuyers[e.pid] = productBuyers[e.pid] || new Set()).add(e.cid);
    });
    function coveredByFamily(cid, pid) {
      const bought = boughtInWindow[cid];
      if (!bought) return false;
      const members = familyMembers[famKey(pid)] || new Set([pid]);
      for (const m of members) { if (bought.has(m)) return true; }
      return false;
    }

    const byCentral = {}, byType = {};
    customers.forEach((c) => {
      if (isInactive(c)) return;
      const central = String(c.centralCustomer || '').trim();
      if (central) (byCentral[central] = byCentral[central] || []).push(c.customerNumber);
      const type = String(c.customerType || '').trim();
      if (type) (byType[type] = byType[type] || []).push(c.customerNumber);
    });

    const hits = {}; // "cid|pid" -> { cid, pid, centralPct, centralName, typePct, typeName }
    function scanGroups(groups, pid, buyers, key) {
      Object.keys(groups).forEach((groupName) => {
        const members = groups[groupName];
        if (members.length < params.peerGap_minGroupSize) return;
        const buyerCount = members.filter((m) => buyers.has(m)).length;
        const pct = buyerCount / members.length;
        if (pct < params.peerGap_pctThreshold / 100) return;
        members.forEach((cid) => {
          if (buyers.has(cid) || coveredByFamily(cid, pid)) return;
          const hk = cid + '|' + pid;
          const hit = hits[hk] = hits[hk] || { cid, pid };
          hit[key + 'Pct'] = Math.round(pct * 100);
          hit[key + 'Name'] = groupName;
        });
      });
    }
    Object.keys(prodIndex).forEach((pid) => {
      if (!isProductEligible(prodIndex[pid])) return;
      const buyers = productBuyers[pid];
      if (!buyers || !buyers.size) return;
      scanGroups(byCentral, pid, buyers, 'central');
      scanGroups(byType, pid, buyers, 'type');
    });

    Object.keys(hits).forEach((hk) => {
      const h = hits[hk];
      const cust = custIndex[h.cid];
      if (isInactive(cust)) return;
      const bits = [];
      if (h.centralPct != null) bits.push(`${h.centralPct}% מהלקוחות הנוספים תחת לקוח מרכז "${h.centralName}"`);
      if (h.typePct != null) bits.push(`${h.typePct}% מהלקוחות מסוג "${h.typeName}"`);
      const maxPct = Math.max(h.centralPct || 0, h.typePct || 0);
      insights.push({
        type: 'peerGap',
        severity: maxPct >= params.peerGap_highPct ? 'high' : 'medium',
        customerId: h.cid,
        customerName: custLabel(h.cid),
        productCode: h.pid,
        message: `הלקוח אינו רוכש את ${prodLabel(h.pid)} (מק"ט ${h.pid}), בעוד ש${bits.join(' וגם ')} רוכשים אותו.`,
        metric: maxPct,
        breakdown: {
          rows: [
            h.centralPct != null ? { label: 'אחוז קונים — לקוח מרכז ' + h.centralName, value: h.centralPct } : null,
            h.typePct != null ? { label: 'אחוז קונים — סוג לקוח ' + h.typeName, value: h.typePct } : null
          ].filter(Boolean),
          // Lets a dashboard click reproduce the exact cohort behind this insight:
          // the same trailing window the rule scanned, and — when the customerType
          // path triggered it — that type as a filter (centralCustomer has no
          // matching dashboard filter field yet, so it isn't surfaced here).
          dashFilter: { periodMonths: sortedWindowMonthKeys, customerType: h.typeName || null }
        }
      });
    });
  }

  const sevRank = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || Math.abs(b.metric) - Math.abs(a.metric));
  return insights;
}

module.exports = { computeInsights, DEFAULT_PARAMS, loadParams };
