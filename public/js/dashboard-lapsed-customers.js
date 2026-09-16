// "Lapsed regular buyers" panel — customers who bought in at least N distinct
// calendar months over the last 12 fully-completed months, but have not bought
// anything yet in the current, still-in-progress month. N is user-editable
// (1-12). Respects whichever customer/product/segment filters are active in the
// main filter table above (see window.refreshDashLapsedFilters, called from
// dashboard-filters.js's apply()) — NOT the year/month period pickers, which
// don't apply to this panel's fixed "last 12 months + current month" logic.
//
// The matching list is expensive-ish to look at (a real customer roster) and not
// everyone wants it visible by default, so it stays collapsed behind a "הצג"
// button rather than auto-loading — unlike the purchase-cohort panel beside it,
// which shows its list immediately once a bought/not-bought filter is set.
async function initDashLapsedCustomersPanel() {
  const minMonthsInput = document.getElementById('dashLapsedMinMonths');
  if (!minMonthsInput) return;
  const showBtn = document.getElementById('dashLapsedShowBtn');
  const section = document.getElementById('dashLapsedCustomersSection');
  const countEl = document.getElementById('dashLapsedCustomersCount');
  const bodyEl = document.getElementById('dashLapsedCustomersBody');
  const exportBtn = document.getElementById('dashLapsedExportBtn');
  const subtitleEl = document.getElementById('dashLapsedSubtitle');

  // Panel starts collapsed behind its own toggle button (see dash-panel-toggles
  // in dashboard.html), independent of the "הצג"/"הסתר" toggle below which only
  // governs the results list once the panel itself is open.
  if (window.dashRegisterPanelToggle) window.dashRegisterPanelToggle('dashLapsedToggleBtn', 'dashLapsedPanelBox');

  let filterState = null;
  let expanded = false;

  function buildQuery(minMonths) {
    const qs = new URLSearchParams();
    qs.set('minMonths', minMonths);
    const f = filterState || {};
    const setList = (key, arr) => { if (arr && arr.length) qs.set(key, arr.join(',')); };
    setList('customerNumber', f.customer);
    setList('productCode', f.product);
    setList('primaryClass', f.primaryClass);
    setList('customerType', f.customerType);
    setList('city', f.city);
    setList('centralCustomer', f.centralCustomer);
    setList('superType', f.superType);
    setList('department', f.department);
    return qs.toString();
  }

  function updateSubtitle(minMonths, currentMonthLabel) {
    const monthPhrase = currentMonthLabel ? ('ב' + currentMonthLabel) : 'החודש';
    subtitleEl.textContent = 'לקוחות שרכשו ב-' + minMonths + ' מ-12 החודשים האחרונים, אך טרם רכשו ' + monthPhrase + '.';
  }

  function collapse() {
    expanded = false;
    section.style.display = 'none';
    showBtn.textContent = 'הצג';
  }

  async function load() {
    const minMonths = Math.min(12, Math.max(1, parseInt(minMonthsInput.value, 10) || 1));
    const res = await fetch('/api/dashboard-sales-summary/lapsed-customers?' + buildQuery(minMonths), { credentials: 'include' });
    const data = res.ok ? await res.json() : { customers: [], currentMonthLabel: '' };
    updateSubtitle(minMonths, data.currentMonthLabel);
    countEl.textContent = data.customers.length + ' לקוחות תואמים';
    bodyEl.innerHTML = data.customers.map((c) =>
      '<tr><td>' + Layout.escapeHtml(c.customerNumber) + '</td><td>' + Layout.escapeHtml(c.name) + '</td><td>' +
      Layout.escapeHtml(c.centralCustomer || '') + '</td><td>' + Layout.escapeHtml(c.primaryClass || '') + '</td><td>' +
      Layout.escapeHtml(c.customerType || '') + '</td><td>' + c.activeMonths + '</td></tr>'
    ).join('') || '<tr><td colspan="6">אין לקוחות תואמים</td></tr>';
    exportBtn.href = '/api/dashboard-sales-summary/lapsed-customers/export?' + buildQuery(minMonths);
    section.style.display = '';
    showBtn.textContent = 'הסתר';
    expanded = true;
  }

  showBtn.addEventListener('click', () => {
    if (expanded) { collapse(); return; }
    load();
  });
  // Changing the minimum-months input, or the active filters changing above,
  // invalidates whatever's currently shown — collapse back to the "הצג" button
  // rather than silently leaving a stale list on screen; the user re-expands to
  // see the up-to-date result. The subtitle itself still updates live (with a
  // generic "החודש הנוכחי" until a real fetch confirms the exact month label) so
  // the panel's own description never looks out of sync with the input above it.
  minMonthsInput.addEventListener('input', () => {
    if (expanded) collapse();
    const minMonths = Math.min(12, Math.max(1, parseInt(minMonthsInput.value, 10) || 1));
    updateSubtitle(minMonths, null);
  });

  window.refreshDashLapsedFilters = function (state) {
    filterState = state;
    if (expanded) collapse();
  };

  updateSubtitle(Math.min(12, Math.max(1, parseInt(minMonthsInput.value, 10) || 1)), null);
  if (window.dashMarkReady) window.dashMarkReady();
}

initDashLapsedCustomersPanel();
