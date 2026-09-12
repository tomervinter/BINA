// Renders the numeric comparison behind an insight as a compact bar chart — every
// insight rule attaches a `breakdown` array ([{label, value}, ...]) so the user can
// see the actual figures the computation compared, not just the resulting sentence.
function renderInsightBreakdown(breakdown) {
  if (!breakdown || !breakdown.length) return '<span class="ib-none">—</span>';
  const max = Math.max.apply(null, breakdown.map((b) => Math.abs(b.value))) || 1;
  return '<div class="insight-breakdown">' + breakdown.map((b, i) => {
    const pct = Math.max(4, Math.round((Math.abs(b.value) / max) * 100));
    const fillClass = i === 0 ? 'ib-fill' : 'ib-fill ib-muted';
    return '<div class="ib-row"><span class="ib-label" title="' + Layout.escapeHtml(b.label) + '">' + Layout.escapeHtml(b.label) + '</span>' +
      '<div class="ib-track"><div class="' + fillClass + '" style="width:' + pct + '%;"></div></div>' +
      '<span class="ib-value">' + Math.round(b.value).toLocaleString('he-IL') + '</span></div>';
  }).join('') + '</div>';
}
