// Renders the numeric comparison behind an insight as a compact bar chart. Every
// insight rule attaches a breakdown of { rows: [{label, value}, ...], dashFilter? }
// so the user can see the actual figures the computation compared, not just the
// resulting sentence — dashFilter (when present) drives the dashboard's own filters
// when the insight is clicked there (see dashboard-top-insights.js). Older
// already-stored insights may still carry a bare rows array instead of that wrapper
// object, from before dashFilter was added — handled here for backward compatibility.
function renderInsightBreakdown(breakdown) {
  const rows = Array.isArray(breakdown) ? breakdown : (breakdown && breakdown.rows) || null;
  if (!rows || !rows.length) return '<span class="ib-none">—</span>';
  const max = Math.max.apply(null, rows.map((b) => Math.abs(b.value))) || 1;
  return '<div class="insight-breakdown">' + rows.map((b, i) => {
    const pct = Math.max(4, Math.round((Math.abs(b.value) / max) * 100));
    const fillClass = i === 0 ? 'ib-fill' : 'ib-fill ib-muted';
    return '<div class="ib-row"><span class="ib-label" title="' + Layout.escapeHtml(b.label) + '">' + Layout.escapeHtml(b.label) + '</span>' +
      '<div class="ib-track"><div class="' + fillClass + '" style="width:' + pct + '%;"></div></div>' +
      '<span class="ib-value">' + Math.round(b.value).toLocaleString('he-IL') + '</span></div>';
  }).join('') + '</div>';
}
