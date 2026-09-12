// The 5 highest-priority insights on the dashboard — the ones whose handling is most
// likely to matter for sales. /api/insights already returns insights sorted by
// severity first, then by the size of the swing within that severity (see
// sortInsights in src/routes/insights.js) — severity itself is defined, per rule, by
// how large the deviation/opportunity is, so the first 5 rows are exactly "biggest
// severity, biggest magnitude" and need no separate re-ranking here.
async function initDashboardTopInsights() {
  const list = document.getElementById('dashTopInsightsList');
  if (!list) return;
  const res = await fetch('/api/insights', { credentials: 'include' });
  const insights = res.ok ? await res.json() : [];
  const top = insights.slice(0, 5);

  list.innerHTML = top.length ? top.map((i) => (
    '<div class="dash-insight-row' + (i.customerId ? ' row-clickable' : '') + '" data-customer="' + Layout.escapeHtml(i.customerId || '') + '">' +
    '<span class="pill ' + (SEV_CLASS[i.severity] || 'pill-gray') + '">' + (SEV_LABEL[i.severity] || i.severity) + '</span>' +
    '<div><div class="dash-insight-entity">' + Layout.escapeHtml((TYPE_META[i.type] || {}).label || i.type) + (i.customerName ? ' — ' + Layout.escapeHtml(i.customerName) : '') + '</div>' +
    '<div class="dash-insight-msg">' + Layout.escapeHtml(i.message) + '</div></div>' +
    '</div>'
  )).join('') : '<div class="dash-insight-empty">לא נוצרו תובנות עדיין — עברו למסך <a href="insights.html">יומן תובנות</a> וייצרו אותן.</div>';

  list.querySelectorAll('.dash-insight-row.row-clickable').forEach((row) => {
    row.addEventListener('click', () => {
      const customerId = row.getAttribute('data-customer');
      if (customerId) window.location.href = 'reports-full-sales.html?customerNumber=' + encodeURIComponent(customerId);
    });
  });
}

initDashboardTopInsights();
