// The highest-priority insights on the dashboard — one equal-width column per
// insight type (see TYPE_META in type-meta.js), each showing that type's own top 5.
// /api/insights already returns insights sorted by severity first, then by the size
// of the swing within that severity (see sortInsights in src/routes/insights.js) —
// severity itself is defined, per rule, by how large the deviation/opportunity is,
// so the first 5 matching rows per type are exactly "biggest severity, biggest
// magnitude" for that type and need no separate re-ranking here. The column count
// tracks Object.keys(TYPE_META) directly, so adding a new rule (and its TYPE_META
// entry) grows the grid automatically — nothing here is hardcoded to "3 columns".
//
// Respects every one of the dashboard's CUSTOMER-IDENTITY filters (see
// dashboard-filters.js, which calls window.refreshDashboardTopInsights on every
// filter change) — not just an explicit customer selection, but also primaryClass/
// customerType/city/centralCustomer, resolved to a customer set the same way
// buildEntityWhere does server-side (src/routes/dashboardSalesSummary.js): a
// segment filter wins over an explicit customer-number list when both are given.
// The comparison-side KPI tile gets its OWN resolved set the same way (its own
// identity bundle if any compare-specific field is given, else inherits the
// primary side's) — previously both tiles just showed the exact same unfiltered
// count regardless of what either side's filters were set to. Insights aren't
// computed per-period, so the period/comparison-period filters don't apply here,
// and product-level filters (product/superType/department) don't narrow this
// either — an insight not naming a specific product is still relevant to a
// customer in scope, and there's no single unambiguous rule for one that does.
//
// Clicking an insight applies its own customer/product/period/comparison-period
// (breakdown.dashFilter, set by insightsEngine.js — see periodMonths/compareMonths
// there) directly onto the dashboard's own filters, via
// window.applyDashboardFiltersFromInsight (dashboard-filters.js), rather than
// navigating away — so the whole dashboard re-renders scoped exactly to what the
// insight is about. An insight with no period concept (e.g. purchase irregularity,
// concentration risk) still filters by customer/product, just not by period.
let dashAllInsights = null;
let dashAllCustomers = null; // customerNumber -> the full customer row (primaryClass/customerType/city/centralCustomer)

// Resolves one side's customer-identity filters to a Set of matching customer
// numbers, or null for "no restriction" — mirrors buildEntityWhere's precedence
// exactly: any segment filter (primaryClass/customerType/city/centralCustomer)
// wins over an explicit customer-number list, and multiple segment dimensions
// combine with AND (a customer must match every one given), not OR.
function resolveInsightCustomerIds(f) {
  const primaryClass = f.primaryClass || [], customerType = f.customerType || [],
    city = f.city || [], centralCustomer = f.centralCustomer || [], customer = f.customer || [];
  if (primaryClass.length || customerType.length || city.length || centralCustomer.length) {
    const out = new Set();
    Object.keys(dashAllCustomers || {}).forEach((cid) => {
      const c = dashAllCustomers[cid];
      if (primaryClass.length && !primaryClass.includes(c.primaryClass)) return;
      if (customerType.length && !customerType.includes(c.customerType)) return;
      if (city.length && !city.includes(c.city)) return;
      if (centralCustomer.length && !centralCustomer.includes(c.centralCustomer)) return;
      out.add(cid);
    });
    return out;
  }
  if (customer.length) return new Set(customer);
  return null;
}

function renderDashboardTopInsights(filters) {
  const container = document.getElementById('dashTopInsightsColumns');
  if (!container || !dashAllInsights) return;
  filters = filters || {};
  const primaryIds = resolveInsightCustomerIds(filters);
  const filtered = primaryIds ? dashAllInsights.filter((i) => primaryIds.has(i.customerId)) : dashAllInsights;
  const isPrimaryScoped = primaryIds !== null;
  // Same compare-side identity bundle-or-inherit rule as dashboard-sales-summary.js's
  // hasCompareIdentity: if the user gave ANY compare-specific identity field, use
  // exactly that bundle; otherwise the compare side inherits the primary side's
  // resolved set wholesale (so its tile isn't left meaninglessly unfiltered).
  const hasCompareIdentity = !!((filters.compareCustomer && filters.compareCustomer.length) ||
    (filters.comparePrimaryClass && filters.comparePrimaryClass.length) || (filters.compareCustomerType && filters.compareCustomerType.length) ||
    (filters.compareCity && filters.compareCity.length) || (filters.compareCentralCustomer && filters.compareCentralCustomer.length));
  const compareIds = hasCompareIdentity
    ? resolveInsightCustomerIds({ customer: filters.compareCustomer, primaryClass: filters.comparePrimaryClass, customerType: filters.compareCustomerType, city: filters.compareCity, centralCustomer: filters.compareCentralCustomer })
    : primaryIds;
  const compareFiltered = compareIds ? dashAllInsights.filter((i) => compareIds.has(i.customerId)) : dashAllInsights;

  // Summary KPI-card tile(s) — appended into the sales revenue/qty tiles' OWN
  // per-side 3-column grid containers (#salesSummaryKpiGrid for primary, on the
  // right; #salesSummaryCompareKpiGrid for compare, on the left — see dashboard-
  // sales-summary.js, which owns and fully rebuilds both), so each insight tile
  // lands as the third tile in the same row — to that side's own quantity tile's
  // left — rather than a separate standalone tile elsewhere on the page. Safe to
  // append (not replace) here because apply() in
  // dashboard-filters.js always calls loadDashboardSalesSummary BEFORE
  // window.refreshDashboardTopInsights on every cycle, so these tiles never
  // accumulate across re-renders. The compare tile only appears when the compare
  // grid itself is currently shown (insights themselves aren't period/comparison-
  // scoped, so this is the same count shown both times). Deep-links to
  // insights.html scoped the same way as everywhere else (by the one selected
  // customer, when there's exactly one — the journal's per-column filter can't
  // express an arbitrary multi-customer OR, so a multi-customer dashboard
  // selection just links to the full unfiltered journal).
  // A resolved set of exactly one customer still deep-links straight to that
  // customer in the journal (its per-column filter can't express an arbitrary
  // multi-customer OR, so anything broader — a segment filter matching several
  // customers, or no restriction at all — just links to the full journal instead).
  function tileHtml(dot, cls, ids, isScoped, count) {
    const idsArr = ids ? Array.from(ids) : [];
    const href = idsArr.length === 1 ? 'insights.html?customer=' + encodeURIComponent(idsArr[0]) : 'insights.html';
    const desc = !isScoped ? 'תובנות פתוחות בסך הכול'
      : (idsArr.length === 1 ? 'תובנות פתוחות עבור הלקוח הנבחר' : 'תובנות פתוחות עבור הסינון הנבחר');
    return '<a class="kpi-card" href="' + href + '">' +
      '<div class="kpi-blob" style="background:var(--' + dot + '-dot);"></div>' +
      '<div class="kpi-blob b2" style="background:var(--' + dot + ');"></div>' +
      '<div class="kpi-value ' + cls + '">' + count.toLocaleString('he-IL') + '</div>' +
      '<div class="kpi-desc">' + desc + '</div>' +
      '</a>';
  }
  const primaryGrid = document.getElementById('salesSummaryKpiGrid');
  const compareGrid = document.getElementById('salesSummaryCompareKpiGrid');
  if (primaryGrid) {
    primaryGrid.insertAdjacentHTML('beforeend', tileHtml('blue', 'v-blue', primaryIds, isPrimaryScoped, filtered.length));
    if (compareGrid && compareGrid.style.display !== 'none' && compareGrid.children.length) {
      compareGrid.insertAdjacentHTML('beforeend', tileHtml('purple', 'v-purple', compareIds, compareIds !== null, compareFiltered.length));
    }
  }

  if (!filtered.length) {
    container.style.gridTemplateColumns = '1fr';
    container.innerHTML = '<div class="dash-insight-empty">' + (isPrimaryScoped
      ? 'אין תובנות התואמות את הסינון הנבחר.'
      : 'לא נוצרו תובנות עדיין — עברו למסך <a href="insights.html">יומן תובנות</a> וייצרו אותן.') + '</div>';
    return;
  }

  const types = Object.keys(TYPE_META);
  container.style.gridTemplateColumns = 'repeat(' + types.length + ', 1fr)';
  const shown = []; // flat, in render order, so click handlers can index back into it
  container.innerHTML = types.map((type) => {
    const top = filtered.filter((i) => i.type === type).slice(0, 5);
    const rowsHtml = top.length ? top.map((i) => {
      const idx = shown.length;
      shown.push(i);
      const needsReview = i.breakdown && i.breakdown.needsReview;
      return '<div class="dash-insight-row' + (i.customerId ? ' row-clickable' : '') + '" data-idx="' + idx + '">' +
        '<span class="pill ' + (SEV_CLASS[i.severity] || 'pill-gray') + '">' + (SEV_LABEL[i.severity] || i.severity) + '</span>' +
        (needsReview ? '<span class="pill pill-review">חג/עונה</span>' : '') +
        '<div class="dash-insight-body">' + (i.customerName ? '<div class="dash-insight-entity">' + Layout.escapeHtml(i.customerName) + '</div>' : '') +
        '<div class="dash-insight-msg">' + Layout.escapeHtml(i.message) + '</div></div>' +
        '</div>';
    }).join('') : '<div class="dash-insight-empty">אין תובנות מסוג זה' + (isPrimaryScoped ? ' התואמות את הסינון הנבחר' : '') + '.</div>';
    return '<div class="dash-insights-column">' +
      '<div class="dash-insights-column-title">' + Layout.escapeHtml((TYPE_META[type] || {}).label || type) + '</div>' +
      rowsHtml + '</div>';
  }).join('');

  container.querySelectorAll('.dash-insight-row.row-clickable').forEach((row) => {
    row.addEventListener('click', () => {
      const insight = shown[+row.getAttribute('data-idx')];
      if (!insight || !insight.customerId) return;
      const dashFilter = (insight.breakdown && insight.breakdown.dashFilter) || {};
      // peerGap is about the whole gap, not the one customer named in it — drill
      // down via the purchase-cohort filter instead of narrowing to that customer.
      if (insight.type === 'peerGap') {
        if (!window.applyDashboardFiltersFromPeerGapInsight) return;
        window.applyDashboardFiltersFromPeerGapInsight({
          customerType: dashFilter.customerType || null,
          productCode: insight.productCode || null,
          periodMonths: dashFilter.periodMonths || []
        });
        return;
      }
      if (!window.applyDashboardFiltersFromInsight) return;
      window.applyDashboardFiltersFromInsight({
        customerId: insight.customerId,
        productCode: insight.productCode || null,
        periodMonths: dashFilter.periodMonths || [],
        compareMonths: dashFilter.compareMonths || []
      });
    });
  });
}

window.refreshDashboardTopInsights = renderDashboardTopInsights;

async function initDashboardTopInsights() {
  if (!document.getElementById('dashTopInsightsColumns')) return;
  const [insRes, custRes] = await Promise.all([
    fetch('/api/insights', { credentials: 'include' }),
    fetch('/api/customers?pageSize=all', { credentials: 'include' })
  ]);
  dashAllInsights = insRes.ok ? await insRes.json() : [];
  dashAllCustomers = {};
  const custRows = custRes.ok ? (await custRes.json()).rows : [];
  custRows.forEach((c) => { dashAllCustomers[c.customerNumber] = c; });
  const initialCustomer = (new URLSearchParams(window.location.search).get('customer') || '').split(',').filter(Boolean);
  renderDashboardTopInsights({ customer: initialCustomer });
}

initDashboardTopInsights();
