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
  const [insightsRes, countsRes] = await Promise.all([
    fetch('/api/insights', { credentials: 'include' }),
    fetch('/api/nav-counts', { credentials: 'include' })
  ]);
  const insights = insightsRes.ok ? await insightsRes.json() : [];
  const counts = countsRes.ok ? await countsRes.json() : {};

  document.getElementById('kpiChurn').textContent = insights.filter((i) => i.type === 'churn').length.toLocaleString('he-IL');
  document.getElementById('kpiDecline').textContent = insights.filter((i) => i.type === 'decline').length.toLocaleString('he-IL');
  document.getElementById('kpiDropoff').textContent = insights.filter((i) => i.type === 'dropoff').length.toLocaleString('he-IL');
  document.getElementById('kpiActiveCustomers').textContent = (counts.activeCustomers || 0).toLocaleString('he-IL');
  document.getElementById('kpiActiveDesc').textContent = 'לקוחות פעילים מתוך ' + (counts.customers || 0).toLocaleString('he-IL') + ' לקוחות בבסיס הנתונים';

  const top = insights.slice(0, 8);
  const list = document.getElementById('dashInsightsList');
  list.innerHTML = top.length ? top.map((i) => (
    '<div class="dash-insight-row">' +
    '<span class="pill ' + (SEV_CLASS[i.severity] || 'pill-gray') + '">' + (SEV_LABEL[i.severity] || i.severity) + '</span>' +
    '<div><div class="dash-insight-entity">' + Layout.escapeHtml((TYPE_META[i.type] || {}).label || i.type) + (i.customerName ? ' — ' + Layout.escapeHtml(i.customerName) : '') + '</div>' +
    '<div class="dash-insight-msg">' + Layout.escapeHtml(i.message) + '</div></div>' +
    '</div>'
  )).join('') : '<div class="dash-insight-empty">אין עדיין תובנות — טענו נתוני לקוחות ומכירות.</div>';
}

init();
