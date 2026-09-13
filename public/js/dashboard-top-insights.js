// The 5 highest-priority insights on the dashboard — the ones whose handling is most
// likely to matter for sales. /api/insights already returns insights sorted by
// severity first, then by the size of the swing within that severity (see
// sortInsights in src/routes/insights.js) — severity itself is defined, per rule, by
// how large the deviation/opportunity is, so the first 5 matching rows are exactly
// "biggest severity, biggest magnitude" and need no separate re-ranking here.
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
  const list = document.getElementById('dashTopInsightsList');
  if (!list || !dashAllInsights) return;
  filters = filters || {};
  const filtered = filters.customer ? dashAllInsights.filter((i) => i.customerId === filters.customer) : dashAllInsights;
  const top = filtered.slice(0, 5);

  list.innerHTML = top.length ? top.map((i, idx) => (
    '<div class="dash-insight-row' + (i.customerId ? ' row-clickable' : '') + '" data-idx="' + idx + '">' +
    '<span class="pill ' + (SEV_CLASS[i.severity] || 'pill-gray') + '">' + (SEV_LABEL[i.severity] || i.severity) + '</span>' +
    '<div><div class="dash-insight-entity">' + Layout.escapeHtml((TYPE_META[i.type] || {}).label || i.type) + (i.customerName ? ' — ' + Layout.escapeHtml(i.customerName) : '') + '</div>' +
    '<div class="dash-insight-msg">' + Layout.escapeHtml(i.message) + '</div></div>' +
    '</div>'
  )).join('') : '<div class="dash-insight-empty">' + (filters.customer
    ? 'אין תובנות עבור הלקוח הנבחר.'
    : 'לא נוצרו תובנות עדיין — עברו למסך <a href="insights.html">יומן תובנות</a> וייצרו אותן.') + '</div>';

  list.querySelectorAll('.dash-insight-row.row-clickable').forEach((row) => {
    row.addEventListener('click', () => {
      const insight = top[+row.getAttribute('data-idx')];
      if (!insight || !insight.customerId || !window.applyDashboardFiltersFromInsight) return;
      const dashFilter = (insight.breakdown && insight.breakdown.dashFilter) || {};
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
  if (!document.getElementById('dashTopInsightsList')) return;
  const res = await fetch('/api/insights', { credentials: 'include' });
  dashAllInsights = res.ok ? await res.json() : [];
  const initialCustomer = new URLSearchParams(window.location.search).get('customer') || null;
  renderDashboardTopInsights({ customer: initialCustomer });
}

initDashboardTopInsights();
