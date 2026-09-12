// Dashboard infographics built from the sales-full-report consolidation: KPI tiles,
// a 12-month revenue trend, and breakdown charts by customer/product classification.
// Every chart is clickable — it deep-links to the full sales report, pre-filtered to
// whatever bar/slice was clicked.
const DASH_CHART_COLORS = ['#3D5CF5', '#8B5CF6', '#2FA88C', '#F2A93B', '#E85BA0', '#3FC4D0', '#DE4B4B'];

function fmtMoneyShort(n) { return Math.round(n || 0).toLocaleString('he-IL') + ' ₪'; }

function reportUrl(params) {
  const q = new URLSearchParams(params).toString();
  return 'reports-full-sales.html' + (q ? '?' + q : '');
}

// Chart.js click handler factory: resolves the clicked element back to its data label
// (bar/donut slice) and navigates. Works for both single- and multi-dataset charts.
function onChartClick(getUrl) {
  return function (evt, elements, chart) {
    if (!elements.length) return;
    const el = elements[0];
    const label = chart.data.labels[el.index];
    const url = getUrl(label, el);
    if (url) window.location.href = url;
  };
}

async function initDashboardSalesSummary() {
  const res = await fetch('/api/dashboard-sales-summary', { credentials: 'include' });
  if (!res.ok) return;
  const s = await res.json();

  document.getElementById('salesSummaryKpiGrid').innerHTML = [
    ['blue', 'v-blue', fmtMoneyShort(s.totalRevenue), 'מחזור כולל'],
    ['blue', 'v-blue', Math.round(s.totalQuantity || 0).toLocaleString('he-IL'), 'כמות שנמכרה בסך הכול'],
    ['green', 'v-green', s.activeCustomerCount.toLocaleString('he-IL'), 'לקוחות עם רכישות'],
    ['green', 'v-green', s.activeProductCount.toLocaleString('he-IL'), 'מוצרים שנמכרו']
  ].map(([dot, cls, value, desc]) => (
    '<div class="kpi-card">' +
    '<div class="kpi-blob" style="background:var(--' + dot + '-dot);"></div>' +
    '<div class="kpi-blob b2" style="background:var(--' + dot + ');"></div>' +
    '<div class="kpi-value ' + cls + '">' + Layout.escapeHtml(String(value)) + '</div>' +
    '<div class="kpi-desc">' + Layout.escapeHtml(desc) + '</div>' +
    '</div>'
  )).join('');

  const legendOpts = { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } } };

  // Monthly revenue trend — click a bar to see that month's rows in the full report.
  new Chart(document.getElementById('monthlyTrendChart'), {
    type: 'bar',
    data: {
      labels: s.monthly.map((m) => m.label),
      datasets: [{ label: 'מחזור', data: s.monthly.map((m) => m.revenue), backgroundColor: '#3D5CF5', borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
      onClick: function (evt, elements) {
        if (!elements.length) return;
        const m = s.monthly[elements[0].index];
        window.location.href = reportUrl({ year: m.year, month: m.month });
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
    }
  });

  function breakdownChart(canvasId, rows, filterKey, type) {
    const cfg = {
      type,
      data: {
        labels: rows.map((r) => r.name),
        datasets: [{
          label: 'מחזור', data: rows.map((r) => r.revenue),
          backgroundColor: type === 'doughnut' ? DASH_CHART_COLORS : '#3D5CF5',
          borderRadius: type === 'bar' ? 6 : undefined
        }]
      },
      options: {
        indexAxis: type === 'bar' ? 'y' : undefined,
        responsive: true, maintainAspectRatio: false,
        plugins: type === 'doughnut' ? legendOpts : { legend: { display: false } },
        scales: type === 'bar' ? { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } } : undefined,
        onClick: onChartClick((label) => reportUrl({ [filterKey]: label })),
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
      }
    };
    new Chart(document.getElementById(canvasId), cfg);
  }

  breakdownChart('superTypeChart', s.bySuperType, 'superType', 'bar');
  breakdownChart('departmentChart', s.byDepartment, 'department', 'bar');

  new Chart(document.getElementById('topCustomersChart'), {
    type: 'bar',
    data: { labels: s.topCustomers.map((r) => r.name), datasets: [{ label: 'מחזור', data: s.topCustomers.map((r) => r.revenue), backgroundColor: '#2FA88C', borderRadius: 6 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
      onClick: function (evt, elements) {
        if (!elements.length) return;
        const c = s.topCustomers[elements[0].index];
        window.location.href = reportUrl({ customerNumber: c.code });
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
    }
  });

  new Chart(document.getElementById('topProductsChart'), {
    type: 'bar',
    data: { labels: s.topProducts.map((r) => r.name), datasets: [{ label: 'מחזור', data: s.topProducts.map((r) => r.revenue), backgroundColor: '#F2A93B', borderRadius: 6 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
      onClick: function (evt, elements) {
        if (!elements.length) return;
        const p = s.topProducts[elements[0].index];
        window.location.href = reportUrl({ productCode: p.code });
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
    }
  });
}

initDashboardSalesSummary();
