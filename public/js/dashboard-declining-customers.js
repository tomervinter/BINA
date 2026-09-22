// "Declining customers" panel — customers whose cumulative revenue this year
// (Jan through the last fully-completed month) is down vs the exact same
// period last year, each with the specific products that are individually down
// year-over-year for them. Respects whichever customer/product/segment filters
// are active in the main filter table (see window.refreshDashDecliningFilters,
// called from dashboard-filters.js's apply()) — same integration pattern as the
// lapsed-customers panel beside it, and same reasoning for staying collapsed
// behind a "הצג" button rather than auto-loading.
async function initDashDecliningCustomersPanel() {
  const minPctInput = document.getElementById('dashDecliningMinPct');
  if (!minPctInput) return;
  const showBtn = document.getElementById('dashDecliningShowBtn');
  const section = document.getElementById('dashDecliningCustomersSection');
  const countEl = document.getElementById('dashDecliningCustomersCount');
  const bodyEl = document.getElementById('dashDecliningCustomersBody');
  const exportBtn = document.getElementById('dashDecliningExportBtn');
  const subtitleEl = document.getElementById('dashDecliningSubtitle');

  // Panel starts collapsed behind its own toggle button (see dash-panel-toggles
  // in dashboard.html), independent of the "הצג"/"הסתר" toggle below which only
  // governs the results list once the panel itself is open.
  if (window.dashRegisterPanelToggle) window.dashRegisterPanelToggle('dashDecliningToggleBtn', 'dashDecliningPanelBox');

  let filterState = null;
  let expanded = false;

  function buildQuery(minPct) {
    const qs = new URLSearchParams();
    qs.set('minDeclinePct', minPct);
    const f = filterState || {};
    const setList = (key, arr) => { if (arr && arr.length) qs.set(key, arr.join(',')); };
    setList('customerNumber', f.customer);
    setList('productCode', f.product);
    setList('primaryClass', f.primaryClass);
    setList('customerType', f.customerType);
    setList('city', f.city);
    setList('centralCustomer', f.centralCustomer);
    setList('salesAgent', f.salesAgent);
    setList('superType', f.superType);
    setList('department', f.department);
    return qs.toString();
  }

  function updateSubtitle(minPct, yearLabel, priorYearLabel, lastCompletedMonthLabel) {
    const periodPhrase = yearLabel ? (yearLabel + ' מול ' + priorYearLabel) : 'השנה מול אשתקד';
    const pctPhrase = minPct > 0 ? (' (מעל ' + minPct + '%)') : '';
    subtitleEl.textContent = 'לקוחות בירידה מצטברת, ' + periodPhrase + pctPhrase + '.';
  }

  function collapse() {
    expanded = false;
    section.style.display = 'none';
    showBtn.textContent = 'הצג';
  }

  async function load() {
    const minPct = Math.max(0, parseFloat(minPctInput.value) || 0);
    const res = await fetch('/api/dashboard-sales-summary/declining-customers?' + buildQuery(minPct), { credentials: 'include' });
    const data = res.ok ? await res.json() : { customers: [] };
    updateSubtitle(minPct, data.yearLabel, data.priorYearLabel, data.lastCompletedMonthLabel);
    countEl.textContent = (data.customerCount || 0) + ' לקוחות · ' + data.customers.length + ' מוצרים שירדו';
    bodyEl.innerHTML = data.customers.map((c) =>
      '<tr><td>' + Layout.escapeHtml(c.customerNumber) + '</td><td>' + Layout.escapeHtml(c.name) + '</td><td>' +
      Layout.escapeHtml(c.centralCustomer || '') + '</td><td>' + Layout.escapeHtml(c.primaryClass || '') + '</td><td>' +
      Layout.escapeHtml(c.customerType || '') + '</td><td>' + Layout.escapeHtml(c.salesAgent || '') + '</td><td>' + c.declinePct + '</td><td>' + Layout.escapeHtml(c.productCode) + '</td><td>' + Layout.escapeHtml(c.productName) + '</td></tr>'
    ).join('') || '<tr><td colspan="9">אין לקוחות תואמים</td></tr>';
    exportBtn.href = '/api/dashboard-sales-summary/declining-customers/export?' + buildQuery(minPct);
    section.style.display = '';
    showBtn.textContent = 'הסתר';
    expanded = true;
  }

  showBtn.addEventListener('click', () => {
    if (expanded) { collapse(); return; }
    load();
  });
  minPctInput.addEventListener('input', () => {
    if (expanded) collapse();
    updateSubtitle(Math.max(0, parseFloat(minPctInput.value) || 0), null, null, null);
  });

  // The active filters changing above (unlike minPctInput, which fires per
  // keystroke) is a deliberate, discrete action — same as every other filter
  // change driving a live re-render elsewhere on the dashboard — so a panel
  // that's already open re-fetches and shows the up-to-date result immediately,
  // rather than silently collapsing and making the user click "הצג" again to see it.
  window.refreshDashDecliningFilters = function (state) {
    filterState = state;
    if (expanded) load();
  };

  updateSubtitle(Math.max(0, parseFloat(minPctInput.value) || 0), null, null, null);
  if (window.dashMarkReady) window.dashMarkReady();
}

initDashDecliningCustomersPanel();
