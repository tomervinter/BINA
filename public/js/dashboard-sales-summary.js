// Dashboard infographics built from the sales-full-report consolidation: KPI tiles
// plus charts for customer-type mix, product department mix, and top performers.
const DASH_CHART_COLORS = ['#3D5CF5', '#8B5CF6', '#2FA88C', '#F2A93B', '#E85BA0', '#3FC4D0', '#DE4B4B'];

function fmtMoneyShort(n) { return Math.round(n || 0).toLocaleString('he-IL') + ' ₪'; }

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

  new Chart(document.getElementById('customerTypeChart'), {
    type: 'doughnut',
    data: {
      labels: s.byCustomerType.map((r) => r.name),
      datasets: [{ data: s.byCustomerType.map((r) => r.revenue), backgroundColor: DASH_CHART_COLORS }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: legendOpts }
  });

  new Chart(document.getElementById('departmentChart'), {
    type: 'bar',
    data: {
      labels: s.byDepartment.map((r) => r.name),
      datasets: [{ label: 'מחזור', data: s.byDepartment.map((r) => r.revenue), backgroundColor: '#3D5CF5', borderRadius: 6 }]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } } }
  });

  new Chart(document.getElementById('topCustomersChart'), {
    type: 'bar',
    data: {
      labels: s.topCustomers.map((r) => r.name),
      datasets: [{ label: 'מחזור', data: s.topCustomers.map((r) => r.revenue), backgroundColor: '#2FA88C', borderRadius: 6 }]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } } }
  });

  new Chart(document.getElementById('topProductsChart'), {
    type: 'bar',
    data: {
      labels: s.topProducts.map((r) => r.name),
      datasets: [{ label: 'מחזור', data: s.topProducts.map((r) => r.revenue), backgroundColor: '#F2A93B', borderRadius: 6 }]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } } }
  });
}

initDashboardSalesSummary();
