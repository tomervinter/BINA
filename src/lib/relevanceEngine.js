const prisma = require('./prisma');

const DAY_MS = 86400000;

// Ported from the artifact's RelevanceEngine: a product is "auto-relevant" to a
// holiday/season if its average sold quantity inside the event's window differs
// from its average outside the window by at least 25%, with at least 2 samples
// on each side.
function windowsFromHolidays(rows) {
  return rows.map((r) => ({
    name: String(r.name || '').trim(),
    start: new Date(r.fromDate).getTime() - (r.daysBefore || 0) * DAY_MS,
    end: new Date(r.toDate).getTime() + (r.daysAfter || 0) * DAY_MS
  })).filter((w) => w.name);
}
function windowsFromSeasons(rows) {
  return rows.map((r) => ({
    name: String(r.name || '').trim(),
    start: new Date(r.fromDate).getTime(),
    end: new Date(r.toDate).getTime()
  })).filter((w) => w.name);
}
function groupByName(windows) {
  const m = {};
  windows.forEach((w) => { (m[w.name] = m[w.name] || []).push(w); });
  return m;
}

function computeAuto(sales, holidays, seasons) {
  const byProduct = {};
  sales.forEach((r) => {
    const pid = r.productCode;
    const t = new Date(r.date).getTime();
    if (!pid || isNaN(t)) return;
    (byProduct[pid] = byProduct[pid] || []).push({ t, qty: r.quantity });
  });
  const auto = {};
  function evalGroups(groups, source) {
    Object.keys(groups).forEach((name) => {
      const wins = groups[name];
      Object.keys(byProduct).forEach((pid) => {
        const series = byProduct[pid];
        if (series.length < 4) return;
        let inSum = 0, inN = 0, outSum = 0, outN = 0;
        series.forEach((p) => {
          const inside = wins.some((w) => p.t >= w.start && p.t <= w.end);
          if (inside) { inSum += p.qty; inN++; } else { outSum += p.qty; outN++; }
        });
        if (inN < 2 || outN < 2) return;
        const inAvg = inSum / inN, outAvg = outSum / outN;
        const delta = outAvg > 0 ? (inAvg - outAvg) / outAvg : (inAvg > 0 ? 1 : 0);
        auto[pid + '|' + source + '|' + name] = Math.abs(delta) >= 0.25;
      });
    });
  }
  evalGroups(groupByName(windowsFromHolidays(holidays)), 'holiday');
  evalGroups(groupByName(windowsFromSeasons(seasons)), 'season');
  return auto;
}

function buildCatCache(products) {
  const byId = {}, byCat = {};
  products.forEach((p) => {
    const id = p.itemCode;
    if (!id) return;
    byId[id] = p;
    const cat = p.type || '';
    if (cat) (byCat[cat] = byCat[cat] || []).push(id);
  });
  return { byId, byCat };
}

async function loadContext(organizationId) {
  const [sales, holidays, seasons, products, overrides] = await Promise.all([
    prisma.sale.findMany({ where: { organizationId } }),
    prisma.holiday.findMany({ where: { organizationId } }),
    prisma.season.findMany({ where: { organizationId } }),
    prisma.product.findMany({ where: { organizationId } }),
    prisma.relevanceOverride.findMany({ where: { organizationId } })
  ]);
  const overrideMap = {};
  overrides.forEach((o) => { overrideMap[o.productCode + '|' + o.source + '|' + o.name] = o.value; });
  return {
    auto: computeAuto(sales, holidays, seasons),
    overrideMap,
    catCache: buildCatCache(products),
    holidays,
    seasons,
    products
  };
}

function directState(ctx, pid, source, name) {
  const key = pid + '|' + source + '|' + name;
  if (Object.prototype.hasOwnProperty.call(ctx.overrideMap, key)) return { value: !!ctx.overrideMap[key], manual: true, known: true };
  if (Object.prototype.hasOwnProperty.call(ctx.auto, key)) return { value: !!ctx.auto[key], manual: false, known: true };
  return null;
}

function isRelevant(ctx, pid, source, name) {
  return directState(ctx, pid, source, name) || { value: false, manual: false, known: false };
}

// Same category (טיפוס) as at least 2 peer products with a known state, majority wins as a "suggestion".
function getCellState(ctx, pid, source, name) {
  const direct = directState(ctx, pid, source, name);
  if (direct) { direct.suggested = false; return direct; }
  const prod = ctx.catCache.byId[pid];
  const cat = prod ? (prod.type || '') : '';
  if (cat) {
    const peers = ctx.catCache.byCat[cat] || [];
    let trueCount = 0, falseCount = 0;
    peers.forEach((otherId) => {
      if (otherId === pid) return;
      const peerState = directState(ctx, otherId, source, name);
      if (!peerState) return;
      if (peerState.value) trueCount++; else falseCount++;
    });
    if (trueCount + falseCount >= 2 && trueCount !== falseCount) {
      return { value: trueCount > falseCount, manual: false, known: false, suggested: true };
    }
  }
  return { value: false, manual: false, known: false, suggested: false };
}

module.exports = { loadContext, isRelevant, getCellState };
