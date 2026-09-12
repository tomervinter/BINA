// Dashboard infographics built from the sales-full-report consolidation: KPI tiles,
// a 12-month revenue trend, and breakdown charts by customer/product classification.
// Every chart is clickable — it deep-links to the full sales report, pre-filtered to
// whatever bar/slice was clicked.
//
// The whole dashboard can be scoped to one customer (see dashboard-customer-search.js,
// which drives this via loadDashboardSalesSummary(customerNumber)) — everything here is
// re-fetched and every chart destroyed and rebuilt on each call, since Chart.js refuses
// to reuse a canvas that already has a live chart on it.
//
// A single restrained blue/navy/slate palette throughout — no per-category rainbow —
// to keep the look formal and consistent with the rest of the app's brand color.
const DASH_CHART_COLORS = ['#3D5CF5', '#2C48D8', '#1B2144', '#64748B', '#93A4C3', '#B9C1E4', '#0F172A'];
const DASH_BLUE = '#3D5CF5';
const DASH_NAVY = '#1B2144';
const DASH_SLATE = '#64748B';

const dashCharts = {};
function upsertChart(canvasId, config) {
  if (dashCharts[canvasId]) dashCharts[canvasId].destroy();
  dashCharts[canvasId] = new Chart(document.getElementById(canvasId), config);
}

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

async function loadDashboardSalesSummary(customerNumber) {
  const qs = customerNumber ? ('?customerNumber=' + encodeURIComponent(customerNumber)) : '';
  const res = await fetch('/api/dashboard-sales-summary' + qs, { credentials: 'include' });
  if (!res.ok) return;
  const s = await res.json();
  const suffix = s.customerName ? (' — ' + s.customerName) : '';
  const baseReportParams = s.customerNumber ? { customerNumber: s.customerNumber } : {};

  document.getElementById('monthlyTrendTitle').textContent = 'מחזור מכירות לפי חודשים' + suffix;
  document.getElementById('salesSummaryTitle').textContent = (s.customerNumber ? 'תמונת מכירות — הלקוח הנבחר' : 'תמונת מכירות כוללת');
  document.getElementById('salesSummarySubtitle').textContent = s.customerNumber
    ? ('מבוסס על שורות המכירה של ' + s.customerName + ' בלבד. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.')
    : 'מבוסס על דוח המכירות המלא — כל שורות המכירות בצירוף נתוני הלקוחות והמוצרים. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.';
  document.getElementById('salesSummaryFullReportLink').href = reportUrl(baseReportParams);
  document.getElementById('superTypeTitle').textContent = 'מחזור לפי טיפוס על' + suffix;
  document.getElementById('departmentTitle').textContent = 'מחזור לפי מחלקת מוצר' + suffix;
  document.getElementById('topProductsTitle').textContent = s.customerNumber ? 'המוצרים המובילים אצל הלקוח' : '5 המוצרים המובילים במחזור';
  document.getElementById('topCustomersTitle').textContent = s.customerNumber ? 'מחזור הלקוח הנבחר' : '5 הלקוחות המובילים במחזור';

  document.getElementById('salesSummaryKpiGrid').innerHTML = [
    ['blue', 'v-blue', fmtMoneyShort(s.totalRevenue), s.customerNumber ? 'מחזור הלקוח' : 'מחזור כולל'],
    ['blue', 'v-blue', Math.round(s.totalQuantity || 0).toLocaleString('he-IL'), 'כמות שנמכרה בסך הכול'],
    ['green', 'v-green', s.activeCustomerCount.toLocaleString('he-IL'), s.customerNumber ? 'לקוח מוצג' : 'לקוחות עם רכישות'],
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
  upsertChart('monthlyTrendChart', {
    type: 'bar',
    data: {
      labels: s.monthly.map((m) => m.label),
      datasets: [{ label: 'מחזור', data: s.monthly.map((m) => m.revenue), backgroundColor: DASH_BLUE, borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
      onClick: function (evt, elements) {
        if (!elements.length) return;
        const m = s.monthly[elements[0].index];
        window.location.href = reportUrl(Object.assign({}, baseReportParams, { year: m.year, month: m.month }));
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
    }
  });

  function breakdownChart(canvasId, rows, filterKey, type, color) {
    const cfg = {
      type,
      data: {
        labels: rows.map((r) => r.name),
        datasets: [{
          label: 'מחזור', data: rows.map((r) => r.revenue),
          backgroundColor: type === 'doughnut' ? DASH_CHART_COLORS : color,
          borderRadius: type === 'bar' ? 6 : undefined
        }]
      },
      options: {
        indexAxis: type === 'bar' ? 'y' : undefined,
        responsive: true, maintainAspectRatio: false,
        plugins: type === 'doughnut' ? legendOpts : { legend: { display: false } },
        scales: type === 'bar' ? { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } } : undefined,
        onClick: onChartClick((label) => reportUrl(Object.assign({}, baseReportParams, { [filterKey]: label }))),
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
      }
    };
    upsertChart(canvasId, cfg);
  }

  breakdownChart('superTypeChart', s.bySuperType, 'superType', 'bar', DASH_BLUE);
  breakdownChart('departmentChart', s.byDepartment, 'department', 'bar', DASH_NAVY);

  upsertChart('topCustomersChart', {
    type: 'bar',
    data: { labels: s.topCustomers.map((r) => r.name), datasets: [{ label: 'מחזור', data: s.topCustomers.map((r) => r.revenue), backgroundColor: DASH_BLUE, borderRadius: 6 }] },
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

  upsertChart('topProductsChart', {
    type: 'bar',
    data: { labels: s.topProducts.map((r) => r.name), datasets: [{ label: 'מחזור', data: s.topProducts.map((r) => r.revenue), backgroundColor: DASH_SLATE, borderRadius: 6 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
      onClick: function (evt, elements) {
        if (!elements.length) return;
        const p = s.topProducts[elements[0].index];
        window.location.href = reportUrl(Object.assign({}, baseReportParams, { productCode: p.code }));
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
    }
  });
}

loadDashboardSalesSummary(new URLSearchParams(window.location.search).get('customer') || undefined);
