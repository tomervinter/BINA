const prisma = require('./prisma');
const relevanceEngine = require('./relevanceEngine');

const DAY_MS = 86400000;

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
function weekKey(t) {
  const d = new Date(t);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const diffDays = Math.floor((d - jan1) / DAY_MS);
  return d.getFullYear() + '-W' + Math.floor(diffDays / 7);
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

// Mirrors the artifact's editable RULE_PARAM_DEFS — same names, same defaults.
const DEFAULT_PARAMS = {
  churn_minPurchases: 3, churn_dayFloor: 45, churn_gapMultiplier: 2.5, churn_highMultiplier: 1.6,
  decline_currentWindowDays: 90, decline_priorWindowDays: 90, decline_pctThreshold: 30, decline_highPct: 50, decline_minBaseRevenue: 100,
  dropoff_minPurchases: 3, dropoff_recentActivityDays: 60, dropoff_dayFloor: 45, dropoff_gapMultiplier: 2, dropoff_highGapMultiplier: 3,
  lookalike_minGroupSize: 3, lookalike_pctOfAvg: 50, lookalike_highPctOfAvg: 25,
  upsell_popularityPct: 50,
  anomaly_minMonths: 4, anomaly_pctThreshold: 40, anomaly_highPct: 70,
  freq_minTotalDrops: 4, freq_windowDays: 30, freq_minPrevDrops: 2, freq_pctThreshold: 40, freq_highPct: 60,
  weekly_recentActivityDays: 60, weekly_establishedWeeksNeeded: 3, weekly_totalWeeksChecked: 5, weekly_highWeeksNeeded: 4,
  variety_minGroupSize: 3, variety_popularityPct: 50,
  monthly_pctThreshold: 30, monthly_highPct: 50, monthly_minBaseRevenue: 100, monthly_topN: 3,
  seasonal_pctThreshold: 40, seasonal_highPct: 70, seasonal_minBaseRevenue: 100
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
  const [customers, products, sales, inventory, relCtx] = await Promise.all([
    prisma.customer.findMany({ where: { organizationId } }),
    prisma.product.findMany({ where: { organizationId } }),
    prisma.sale.findMany({ where: { organizationId } }),
    prisma.inventoryRecord.findMany({ where: { organizationId } }),
    relevanceEngine.loadContext(organizationId)
  ]);
  const params = await loadParams(organizationId);
  const now = Date.now();

  const custIndex = {};
  customers.forEach((c) => { custIndex[c.customerNumber] = c; });
  const prodIndex = {};
  products.forEach((p) => { prodIndex[p.itemCode] = p; });
  const invIndex = {};
  inventory.forEach((r) => { if (r.sku && !(r.sku in invIndex)) invIndex[r.sku] = r; });

  const s = sales.map((r) => ({
    cid: r.customerNumber, pid: r.productCode, t: new Date(r.date).getTime(), qty: r.quantity, rev: r.revenue
  }));
  const byCustomer = groupBy(s, (x) => x.cid);
  const byPair = groupBy(s, (x) => x.cid + '|' + x.pid);
  const byProduct = groupBy(s, (x) => x.pid);

  const insights = [];
  const custLabel = (cid) => (custIndex[cid] && custIndex[cid].name) || cid;
  const prodLabel = (pid) => (prodIndex[pid] && prodIndex[pid].name) || pid;

  // 1. churn
  Object.keys(byCustomer).forEach((cid) => {
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    const events = byCustomer[cid].slice().sort((a, b) => a.t - b.t);
    if (events.length < params.churn_minPurchases) return;
    const gaps = [];
    for (let i = 1; i < events.length; i++) gaps.push((events[i].t - events[i - 1].t) / DAY_MS);
    const typicalGap = median(gaps) || 30;
    const daysSince = (now - events[events.length - 1].t) / DAY_MS;
    const threshold = Math.max(params.churn_dayFloor, typicalGap * params.churn_gapMultiplier);
    if (daysSince > threshold) {
      insights.push({
        type: 'churn',
        severity: daysSince > threshold * params.churn_highMultiplier ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `לא בוצעה רכישה כבר ${Math.round(daysSince)} ימים (קצב רגיל: כל כ-${Math.round(typicalGap)} ימים).`,
        metric: Math.round(daysSince)
      });
    }
  });

  // 2. decline (quarterly / YoY)
  Object.keys(byCustomer).forEach((cid) => {
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    const events = byCustomer[cid];
    const cur = events.filter((e) => e.t > now - params.decline_currentWindowDays * DAY_MS && e.t <= now);
    if (!cur.length) return;
    const curRev = cur.reduce((a, e) => a + e.rev, 0);
    const yoy = events.filter((e) => e.t > now - (365 + params.decline_currentWindowDays) * DAY_MS && e.t <= now - 365 * DAY_MS);
    let basis, baseRev;
    if (yoy.length) {
      basis = 'לתקופה המקבילה אשתקד';
      baseRev = yoy.reduce((a, e) => a + e.rev, 0);
    } else {
      const prev = events.filter((e) => e.t > now - (params.decline_currentWindowDays + params.decline_priorWindowDays) * DAY_MS && e.t <= now - params.decline_currentWindowDays * DAY_MS);
      basis = 'לרבעון הקודם';
      baseRev = prev.reduce((a, e) => a + e.rev, 0);
    }
    if (baseRev < params.decline_minBaseRevenue) return;
    const delta = (curRev - baseRev) / baseRev;
    if (delta <= -params.decline_pctThreshold / 100) {
      insights.push({
        type: 'decline',
        severity: delta <= -params.decline_highPct / 100 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `ירידה של ${Math.round(-delta * 100)}% במחזור ביחס ${basis}.`,
        metric: Math.round(delta * 100)
      });
    }
  });

  // 3. product dropoff
  Object.keys(byPair).forEach((key) => {
    const idx = key.indexOf('|');
    const cid = key.slice(0, idx), pid = key.slice(idx + 1);
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    if (isProductInactive(prodIndex[pid])) return;
    const recentAny = (byCustomer[cid] || []).some((e) => e.t > now - params.dropoff_recentActivityDays * DAY_MS);
    if (!recentAny) return;
    const events = byPair[key].slice().sort((a, b) => a.t - b.t);
    if (events.length < params.dropoff_minPurchases) return;
    const gaps = [];
    for (let i = 1; i < events.length; i++) gaps.push((events[i].t - events[i - 1].t) / DAY_MS);
    const typicalGap = median(gaps) || 30;
    const daysSince = (now - events[events.length - 1].t) / DAY_MS;
    if (daysSince > Math.max(params.dropoff_dayFloor, typicalGap * params.dropoff_gapMultiplier)) {
      insights.push({
        type: 'dropoff',
        severity: daysSince > typicalGap * params.dropoff_highGapMultiplier ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הלקוח פעיל אך הפסיק לרכוש את המוצר ${prodLabel(pid)} — ${Math.round(daysSince)} ימים ללא רכישה (קצב רגיל: כ-${Math.round(typicalGap)} ימים).`,
        metric: Math.round(daysSince)
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
    const productCounts = {};
    ids.forEach((id) => { Object.keys(custProducts[id] || {}).forEach((pid) => { productCounts[pid] = (productCounts[pid] || 0) + 1; }); });
    const popularPids = Object.keys(productCounts).filter((pid) => productCounts[pid] >= Math.ceil(ids.length * upsellPopPct) && !isProductInactive(prodIndex[pid]));

    ids.forEach((id) => {
      const rev = custRevenue[id] || 0;
      if (avgRev > 0 && rev > 0 && rev < avgRev * lookalikePct) {
        insights.push({
          type: 'lookalike',
          severity: rev < avgRev * lookalikeHighPct ? 'high' : 'medium',
          customerId: id,
          customerName: custLabel(id),
          message: `מחזור הלקוח נמוך משמעותית מהממוצע בקבוצת "${seg}" (${Math.round(rev).toLocaleString('he-IL')} לעומת ממוצע ${Math.round(avgRev).toLocaleString('he-IL')}) — פוטנציאל צמיחה לא ממומש.`,
          metric: Math.round((rev / avgRev) * 100)
        });
      }
      const owned = custProducts[id] || {};
      popularPids.forEach((pid) => {
        if (owned[pid]) return;
        insights.push({
          type: 'upsell',
          severity: 'low',
          customerId: id,
          customerName: custLabel(id),
          productCode: pid,
          message: `רוב הלקוחות הדומים בקבוצת "${seg}" רוכשים את ${prodLabel(pid)}, אך לקוח זה לא — הזדמנות ל-Upsell.`,
          metric: productCounts[pid]
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

    const parts = lastMonth.split('-');
    const lastMonthMidT = new Date(+parts[0], +parts[1] - 1, 15).getTime();
    let explained = false;
    function checkWindows(rows, source) {
      rows.forEach((r) => {
        const name = String(r.name || '').trim();
        if (!name) return;
        const before = source === 'holiday' ? (r.daysBefore || 0) : 0;
        const after = source === 'holiday' ? (r.daysAfter || 0) : 0;
        const start = new Date(r.fromDate).getTime() - before * DAY_MS;
        const end = new Date(r.toDate).getTime() + after * DAY_MS;
        if (lastMonthMidT >= start && lastMonthMidT <= end) {
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
      message: `${delta > 0 ? 'עלייה חדה' : 'ירידה חדה'} לא צפויה של ${Math.round(Math.abs(delta) * 100)}% במכירות ${prodLabel(pid)} בחודש האחרון, ללא הסבר עונתי/חג ידוע.`,
      metric: Math.round(delta * 100)
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
    const curDrops = dropTimes.filter((t) => t > now - params.freq_windowDays * DAY_MS && t <= now).length;
    const prevDrops = dropTimes.filter((t) => t > now - 2 * params.freq_windowDays * DAY_MS && t <= now - params.freq_windowDays * DAY_MS).length;
    if (prevDrops < params.freq_minPrevDrops) return;
    const delta = (curDrops - prevDrops) / prevDrops;
    if (delta <= -params.freq_pctThreshold / 100) {
      insights.push({
        type: 'frequencyDecline',
        severity: delta <= -params.freq_highPct / 100 ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        message: `קצב הביקורים (דרופים) ירד מ-${prevDrops} ל-${curDrops} ב-${params.freq_windowDays} הימים האחרונים לעומת ${params.freq_windowDays} הימים שלפניהם.`,
        metric: Math.round(delta * 100)
      });
    }
  });

  // 8. weekly product purchase break (inventory-aware — suppressed when out of stock)
  Object.keys(byPair).forEach((key) => {
    const idx = key.indexOf('|');
    const cid = key.slice(0, idx), pid = key.slice(idx + 1);
    const cust = custIndex[cid];
    if (isInactive(cust)) return;
    if (isProductInactive(prodIndex[pid])) return;
    const recentAny = (byCustomer[cid] || []).some((e) => e.t > now - params.weekly_recentActivityDays * DAY_MS);
    if (!recentAny) return;

    const weeksSet = {};
    byPair[key].forEach((e) => { weeksSet[weekKey(e.t)] = true; });
    const recentWeekKeys = [];
    for (let w = 0; w <= params.weekly_totalWeeksChecked; w++) recentWeekKeys.push(weekKey(now - w * 7 * DAY_MS));
    const lastWeek = recentWeekKeys[0];
    const priorWeeks = recentWeekKeys.slice(1);
    const establishedCount = priorWeeks.filter((wk) => weeksSet[wk]).length;

    if (establishedCount >= params.weekly_establishedWeeksNeeded && !weeksSet[lastWeek]) {
      const invRow = invIndex[pid];
      const stock = invRow ? invRow.stock : null;
      if (stock !== null && stock <= 0) return;
      insights.push({
        type: 'weeklyProductBreak',
        severity: establishedCount >= params.weekly_highWeeksNeeded ? 'high' : 'medium',
        customerId: cid,
        customerName: custLabel(cid),
        productCode: pid,
        message: `הלקוח רכש את ${prodLabel(pid)} ב-${establishedCount} מתוך ${params.weekly_totalWeeksChecked} השבועות האחרונים, אך לא רכש השבוע — דפוס רכישה שבועי שנקטע.`,
        metric: establishedCount
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
    const productCounts2 = {};
    ids2.forEach((id) => { Object.keys(custProducts[id] || {}).forEach((pid) => { productCounts2[pid] = (productCounts2[pid] || 0) + 1; }); });
    const popularPids2 = Object.keys(productCounts2).filter((pid) => productCounts2[pid] >= Math.ceil(ids2.length * varietyPct) && !isProductInactive(prodIndex[pid]));
    ids2.forEach((id) => {
      const owned = custProducts[id] || {};
      popularPids2.forEach((pid) => {
        if (owned[pid]) return;
        insights.push({
          type: 'productVarietyGap',
          severity: 'low',
          customerId: id,
          customerName: custLabel(id),
          productCode: pid,
          message: `רוב הלקוחות מסוג "${typeName}" רוכשים את ${prodLabel(pid)}, אך לקוח זה לא — פער במגוון המוצרים.`,
          metric: productCounts2[pid]
        });
      });
    });
  });

  // 10. monthly decline with product-level breakdown
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
    if (delta > -monthlyPct) return;

    const curByPid = {}, prevByPid = {};
    curEvents.forEach((e) => { curByPid[e.pid] = (curByPid[e.pid] || 0) + e.rev; });
    prevEvents.forEach((e) => { prevByPid[e.pid] = (prevByPid[e.pid] || 0) + e.rev; });
    const allPids = {};
    Object.keys(curByPid).forEach((p) => { allPids[p] = true; });
    Object.keys(prevByPid).forEach((p) => { allPids[p] = true; });
    const diffs = Object.keys(allPids).map((pid) => ({ pid, diff: (curByPid[pid] || 0) - (prevByPid[pid] || 0) }))
      .filter((d) => d.diff < 0 && !isProductInactive(prodIndex[d.pid]))
      .sort((a, b) => a.diff - b.diff);
    const top = diffs.slice(0, params.monthly_topN).map((d) => `${prodLabel(d.pid)} (${Math.round(d.diff).toLocaleString('he-IL')}₪)`);

    insights.push({
      type: 'monthlyDeclineDetail',
      severity: delta <= -monthlyHighPct ? 'high' : 'medium',
      customerId: cid,
      customerName: custLabel(cid),
      message: `ירידה של ${Math.round(-delta * 100)}% במחזור החודש מול החודש הקודם${top.length ? ', בעיקר במוצרים: ' + top.join(', ') : ''}.`,
      metric: Math.round(delta * 100)
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
            if (e.t >= latest.start && e.t <= latest.end) latestRev += e.rev;
            else if (e.t >= previous.start && e.t <= previous.end) prevRev += e.rev;
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
            message: `${dirWord} של ${Math.round(Math.abs(delta) * 100)}% ברכישת ${prodLabel(pid)} ב${eventKind} ${name} (${latest.year}) לעומת אותו ${source === 'holiday' ? 'חג' : 'עונה'} אשתקד (${previous.year}) — מוצר זה מסומן כרלוונטי אליו במסך שיוך חג ועונה למוצר.`,
            metric: Math.round(delta * 100)
          });
        });
      });
    });
  }
  processSeasonalSource(relCtx.holidays, 'holiday');
  processSeasonalSource(relCtx.seasons, 'season');

  const sevRank = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || Math.abs(b.metric) - Math.abs(a.metric));
  return insights;
}

module.exports = { computeInsights, DEFAULT_PARAMS, loadParams };
