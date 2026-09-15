// "Lapsed regular buyers" panel — self-contained, independent of the main filter
// table/state above it (no period/customer/product filters apply here): shows
// customers who bought in at least N distinct calendar months (full history,
// through the last fully completed month) but have not bought anything yet in
// the current, still-in-progress month. N is user-editable; every change re-fetches.
async function initDashLapsedCustomersPanel() {
  const minMonthsInput = document.getElementById('dashLapsedMinMonths');
  if (!minMonthsInput) return;
  const countEl = document.getElementById('dashLapsedCustomersCount');
  const bodyEl = document.getElementById('dashLapsedCustomersBody');
  const exportBtn = document.getElementById('dashLapsedExportBtn');
  const subtitleEl = document.getElementById('dashLapsedSubtitle');

  async function load() {
    const minMonths = Math.max(1, parseInt(minMonthsInput.value, 10) || 1);
    const res = await fetch('/api/dashboard-sales-summary/lapsed-customers?minMonths=' + minMonths, { credentials: 'include' });
    const data = res.ok ? await res.json() : { customers: [], currentMonthLabel: '' };
    countEl.textContent = data.customers.length + ' לקוחות תואמים';
    bodyEl.innerHTML = data.customers.map((c) =>
      '<tr><td>' + Layout.escapeHtml(c.customerNumber) + '</td><td>' + Layout.escapeHtml(c.name) + '</td><td>' +
      Layout.escapeHtml(c.centralCustomer || '') + '</td><td>' + Layout.escapeHtml(c.primaryClass || '') + '</td><td>' +
      Layout.escapeHtml(c.customerType || '') + '</td><td>' + c.activeMonths + '</td></tr>'
    ).join('') || '<tr><td colspan="6">אין לקוחות תואמים</td></tr>';
    exportBtn.href = '/api/dashboard-sales-summary/lapsed-customers/export?minMonths=' + minMonths;
    if (subtitleEl && data.currentMonthLabel) {
      subtitleEl.textContent = 'מציג לקוחות שרכשו לפחות ב-' + minMonths + ' חודשים שונים (מתוך כלל ההיסטוריה, עד לחודש האחרון שנסגר), אך טרם רכשו ב' + data.currentMonthLabel + '.';
    }
  }

  let debounceTimer = null;
  minMonthsInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(load, 400);
  });

  await load();
  if (window.dashMarkReady) window.dashMarkReady();
}
