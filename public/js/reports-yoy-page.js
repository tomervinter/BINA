const CHART_COLORS = { thisYear: '#3D5CF5', lastYear: '#B9C1E4' };

function fmtMoney(n) { return Math.round(n || 0).toLocaleString('he-IL') + ' ₪'; }

async function initYoyReportPage() {
  const data = await Layout.init('reports-yoy');
  if (!data) return;

  const res = await fetch('/api/dashboard-yoy', { credentials: 'include' });
  if (!res.ok) { document.getElementById('yoyContent').innerHTML = '<p class="card-text">שגיאה בטעינת הדוח.</p>'; return; }
  const report = await res.json();

  document.getElementById('pageSubtitle').textContent = report.period.label;

  const deltaClass = report.total.deltaPct == null ? 'v-blue' : (report.total.deltaPct >= 0 ? 'v-green' : 'v-red');
  const deltaSign = report.total.deltaPct == null ? '—' : (report.total.deltaPct >= 0 ? '+' : '') + report.total.deltaPct + '%';

  document.getElementById('kpiGrid').innerHTML = [
    ['blue', 'v-blue', fmtMoney(report.total.thisYear), 'מחזור מצטבר ' + report.period.year],
    ['blue', 'v-blue', fmtMoney(report.total.lastYear), 'מחזור מצטבר ' + report.period.priorYear + ' (אותה תקופה)'],
    [report.total.deltaPct >= 0 ? 'green' : 'red', deltaClass, deltaSign, 'שינוי לעומת אשתקד'],
    ['blue', 'v-blue', (report.topChannel ? report.topChannel.name : '—'), 'ערוץ המכר המוביל'],
    ['blue', 'v-blue', (report.topSuperType ? report.topSuperType.name : '—'), 'טיפוס העל המוביל'],
    ['blue', 'v-blue', report.activeCustomerCount.toLocaleString('he-IL'), 'לקוחות פעילים בתקופה']
  ].map(([dot, cls, value, desc]) => (
    '<div class="kpi-card">' +
    '<div class="kpi-blob" style="background:var(--' + dot + '-dot);"></div>' +
    '<div class="kpi-blob b2" style="background:var(--' + dot + ');"></div>' +
    '<div class="kpi-value ' + cls + '">' + Layout.escapeHtml(String(value)) + '</div>' +
    '<div class="kpi-desc">' + Layout.escapeHtml(desc) + '</div>' +
    '</div>'
  )).join('');

  // Monthly comparison — grouped bar chart.
  new Chart(document.getElementById('monthlyChart'), {
    type: 'bar',
    data: {
      labels: report.period.monthNames,
      datasets: [
        { label: String(report.period.year), data: report.monthly.thisYear, backgroundColor: CHART_COLORS.thisYear, borderRadius: 6 },
        { label: String(report.period.priorYear), data: report.monthly.lastYear, backgroundColor: CHART_COLORS.lastYear, borderRadius: 6 }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } } }, scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } } }
  });

  // Revenue by channel — grouped bar chart.
  new Chart(document.getElementById('channelChart'), {
    type: 'bar',
    data: {
      labels: report.byChannel.map((c) => c.name),
      datasets: [
        { label: String(report.period.year), data: report.byChannel.map((c) => c.thisYear), backgroundColor: CHART_COLORS.thisYear, borderRadius: 6 },
        { label: String(report.period.priorYear), data: report.byChannel.map((c) => c.lastYear), backgroundColor: CHART_COLORS.lastYear, borderRadius: 6 }
      ]
    },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } } } }
  });

  // This-year channel distribution — donut, for visual variety.
  new Chart(document.getElementById('channelDonut'), {
    type: 'doughnut',
    data: {
      labels: report.byChannel.map((c) => c.name),
      datasets: [{ data: report.byChannel.map((c) => c.thisYear), backgroundColor: ['#3D5CF5', '#8B5CF6', '#2FA88C', '#F2A93B', '#E85BA0', '#3FC4D0', '#DE4B4B'] }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } } } }
  });

  // Revenue by super-type — grouped bar chart.
  new Chart(document.getElementById('superTypeChart'), {
    type: 'bar',
    data: {
      labels: report.bySuperType.map((c) => c.name),
      datasets: [
        { label: String(report.period.year), data: report.bySuperType.map((c) => c.thisYear), backgroundColor: CHART_COLORS.thisYear, borderRadius: 6 },
        { label: String(report.period.priorYear), data: report.bySuperType.map((c) => c.lastYear), backgroundColor: CHART_COLORS.lastYear, borderRadius: 6 }
      ]
    },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } } } }
  });

  function deltaCell(row) {
    if (row.deltaPct == null) return '—';
    const cls = row.deltaPct >= 0 ? 'pill-green' : 'pill-red';
    return '<span class="pill ' + cls + '">' + (row.deltaPct >= 0 ? '+' : '') + row.deltaPct + '%</span>';
  }

  createDataTable(document.getElementById('channelTable'), [
    { key: 'name', label: 'ערוץ מכר (סיווג ראשי לקוח)' },
    { key: 'thisYear', label: String(report.period.year), render: (r) => fmtMoney(r.thisYear) },
    { key: 'lastYear', label: String(report.period.priorYear), render: (r) => fmtMoney(r.lastYear) },
    { key: 'deltaPct', label: 'שינוי', html: true, render: deltaCell }
  ], report.byChannel, { exportFilename: 'yoy-by-channel' });

  createDataTable(document.getElementById('superTypeTable'), [
    { key: 'name', label: 'טיפוס על' },
    { key: 'thisYear', label: String(report.period.year), render: (r) => fmtMoney(r.thisYear) },
    { key: 'lastYear', label: String(report.period.priorYear), render: (r) => fmtMoney(r.lastYear) },
    { key: 'deltaPct', label: 'שינוי', html: true, render: deltaCell }
  ], report.bySuperType, { exportFilename: 'yoy-by-supertype' });
}
