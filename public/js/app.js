async function init() {
  const data = await Layout.init('dashboard');
  if (!data) return;

  document.getElementById('greeting').textContent = 'שלום, ' + (data.user.name || data.user.email);
  const today = new Date();
  const p = (n) => String(n).padStart(2, '0');
  document.getElementById('updateLine').textContent = 'תאריך: ' + p(today.getDate()) + '.' + p(today.getMonth() + 1) + '.' + today.getFullYear();

  await refreshDashboard();
}

async function refreshDashboard() {
  const insightsRes = await fetch('/api/insights', { credentials: 'include' });
  const insights = insightsRes.ok ? await insightsRes.json() : [];

  const highCount = insights.filter((i) => i.severity === 'high').length;
  const alertCount = insights.filter((i) => (TYPE_META[i.type] || {}).category === 'התראה').length;
  const opportunityCount = insights.filter((i) => (TYPE_META[i.type] || {}).category === 'הזדמנות').length;

  document.getElementById('insightsSummaryKpiGrid').innerHTML = [
    ['blue', 'v-blue', insights.length.toLocaleString('he-IL'), 'סה"כ תובנות פעילות'],
    ['red', 'v-red', highCount.toLocaleString('he-IL'), 'בחומרה גבוהה — דורשות טיפול'],
    ['red', 'v-red', alertCount.toLocaleString('he-IL'), 'התראות'],
    ['green', 'v-green', opportunityCount.toLocaleString('he-IL'), 'הזדמנויות']
  ].map(([dot, cls, value, desc]) => (
    '<div class="kpi-card">' +
    '<div class="kpi-blob" style="background:var(--' + dot + '-dot);"></div>' +
    '<div class="kpi-blob b2" style="background:var(--' + dot + ');"></div>' +
    '<div class="kpi-value ' + cls + '">' + Layout.escapeHtml(value) + '</div>' +
    '<div class="kpi-desc">' + Layout.escapeHtml(desc) + '</div>' +
    '</div>'
  )).join('');

  const top = insights.slice(0, 8);
  const list = document.getElementById('dashInsightsList');
  list.innerHTML = top.length ? top.map((i) => (
    '<div class="dash-insight-row">' +
    '<span class="pill ' + (SEV_CLASS[i.severity] || 'pill-gray') + '">' + (SEV_LABEL[i.severity] || i.severity) + '</span>' +
    '<div><div class="dash-insight-entity">' + Layout.escapeHtml((TYPE_META[i.type] || {}).label || i.type) + (i.customerName ? ' — ' + Layout.escapeHtml(i.customerName) : '') + '</div>' +
    '<div class="dash-insight-msg">' + Layout.escapeHtml(i.message) + '</div></div>' +
    '</div>'
  )).join('') : '<div class="dash-insight-empty">לא נוצרו תובנות עדיין — עברו למסך <a href="insights.html">יומן תובנות</a> וייצרו אותן.</div>';
}

init();
