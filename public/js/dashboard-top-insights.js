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
// Respects the dashboard's customer filter (see dashboard-filters.js, which calls
// window.refreshDashboardTopInsights on every filter change): when a customer is
// selected, only that customer's insights are shown. Insights aren't computed
// per-period, so the period/comparison-period filters don't apply here.
//
// Clicking an insight applies its own customer/product/period/comparison-period
// (breakdown.dashFilter, set by insightsEngine.js — see periodMonths/compareMonths
// there) directly onto the dashboard's own filters, via
// window.applyDashboardFiltersFromInsight (dashboard-filters.js), rather than
// navigating away — so the whole dashboard re-renders scoped exactly to what the
// insight is about. An insight with no period concept (e.g. purchase irregularity,
// concentration risk) still filters by customer/product, just not by period.
let dashAllInsights = null;

function renderDashboardTopInsights(filters) {
  const container = document.getElementById('dashTopInsightsColumns');
  if (!container || !dashAllInsights) return;
  filters = filters || {};
  const customerIds = filters.customer || []; // array — the dashboard's customer filter is a multi-select
  const filtered = customerIds.length ? dashAllInsights.filter((i) => customerIds.includes(i.customerId)) : dashAllInsights;

  // Summary KPI-card tile(s) — appended into the sales revenue/qty tiles' OWN
  // per-side grid containers (#salesSummaryKpiGrid for primary, on the right;
  // #salesSummaryCompareKpiGrid for compare, on the left — see dashboard-sales-
  // summary.js, which owns and fully rebuilds both), so each insight tile lands
  // directly below its own side's tiles rather than a separate standalone tile
  // elsewhere on the page. Safe to append (not replace) here because apply() in
  // dashboard-filters.js always calls loadDashboardSalesSummary BEFORE
  // window.refreshDashboardTopInsights on every cycle, so these tiles never
  // accumulate across re-renders. The compare tile only appears when the compare
  // grid itself is currently shown (insights themselves aren't period/comparison-
  // scoped, so this is the same count shown both times). Deep-links to
  // insights.html scoped the same way as everywhere else (by the one selected
  // customer, when there's exactly one — the journal's per-column filter can't
  // express an arbitrary multi-customer OR, so a multi-customer dashboard
  // selection just links to the full unfiltered journal).
  const primaryGrid = document.getElementById('salesSummaryKpiGrid');
  const compareGrid = document.getElementById('salesSummaryCompareKpiGrid');
  if (primaryGrid) {
    const href = customerIds.length === 1 ? 'insights.html?customer=' + encodeURIComponent(customerIds[0]) : 'insights.html';
    const desc = customerIds.length ? 'תובנות פתוחות עבור הלקוח הנבחר' : 'תובנות פתוחות בסך הכול';
    const tile = (dot, cls) => '<a class="kpi-card" href="' + href + '">' +
      '<div class="kpi-blob" style="background:var(--' + dot + '-dot);"></div>' +
      '<div class="kpi-blob b2" style="background:var(--' + dot + ');"></div>' +
      '<div class="kpi-value ' + cls + '">' + filtered.length.toLocaleString('he-IL') + '</div>' +
      '<div class="kpi-desc">' + desc + '</div>' +
      '</a>';
    primaryGrid.insertAdjacentHTML('beforeend', tile('blue', 'v-blue'));
    if (compareGrid && compareGrid.style.display !== 'none' && compareGrid.children.length) {
      compareGrid.insertAdjacentHTML('beforeend', tile('purple', 'v-purple'));
    }
  }

  if (!filtered.length) {
    container.style.gridTemplateColumns = '1fr';
    container.innerHTML = '<div class="dash-insight-empty">' + (customerIds.length
      ? 'אין תובנות עבור הלקוח הנבחר.'
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
    }).join('') : '<div class="dash-insight-empty">אין תובנות מסוג זה' + (customerIds.length ? ' עבור הלקוח הנבחר' : '') + '.</div>';
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
  const res = await fetch('/api/insights', { credentials: 'include' });
  dashAllInsights = res.ok ? await res.json() : [];
  const initialCustomer = (new URLSearchParams(window.location.search).get('customer') || '').split(',').filter(Boolean);
  renderDashboardTopInsights({ customer: initialCustomer });
}

initDashboardTopInsights();
