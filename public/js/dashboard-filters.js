// Combined dashboard filter controls: the quick customer search plus a period and
// comparison-period month multi-select, all synced to the URL query string and
// driving one call to loadDashboardSalesSummary (dashboard-sales-summary.js)
// whenever any of them change, so a refresh or a shared link reproduces the exact
// same filtered view. A "period" is an arbitrary set of selected months, not
// necessarily contiguous — see month-multiselect.js.
async function initDashboardFilters() {
  const custInput = document.getElementById('dashCustomerSearch');
  if (!custInput) return;
  const custDatalist = document.getElementById('dashCustomerList');
  const custClearBtn = document.getElementById('dashClearCustomerFilter');
  const periodClearBtn = document.getElementById('dashClearPeriodFilter');
  const productClearBtn = document.getElementById('dashClearProductFilter');
  const subtitle = document.getElementById('dashFilterSubtitle');

  const res = await fetch('/api/customers?pageSize=all', { credentials: 'include' });
  const customers = res.ok ? (await res.json()).rows : [];
  const byDisplay = {};
  const nameByCode = {};
  customers.forEach((c) => {
    byDisplay[c.customerNumber + ' — ' + c.name] = c.customerNumber;
    nameByCode[c.customerNumber] = c.name;
  });
  custDatalist.innerHTML = Object.keys(byDisplay).map((d) => '<option value="' + Layout.escapeHtml(d) + '"></option>').join('');

  const urlParams = new URLSearchParams(window.location.search);
  const state = {
    customer: urlParams.get('customer') || null,
    product: urlParams.get('product') || null,
    // Resolved from the dashboard-sales-summary response once it comes back — the
    // URL/insight click only ever carries the product's code, not its display name.
    productName: null,
    periodMonths: (urlParams.get('periodMonths') || '').split(',').filter(Boolean),
    compareMonths: (urlParams.get('compareMonths') || '').split(',').filter(Boolean)
  };

  function syncUrl() {
    const url = new URL(window.location.href);
    if (state.customer) url.searchParams.set('customer', state.customer); else url.searchParams.delete('customer');
    if (state.product) url.searchParams.set('product', state.product); else url.searchParams.delete('product');
    if (state.periodMonths.length) url.searchParams.set('periodMonths', state.periodMonths.join(',')); else url.searchParams.delete('periodMonths');
    if (state.compareMonths.length) url.searchParams.set('compareMonths', state.compareMonths.join(',')); else url.searchParams.delete('compareMonths');
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  function updateUi() {
    if (state.customer && nameByCode[state.customer]) {
      custInput.value = state.customer + ' — ' + nameByCode[state.customer];
      custClearBtn.style.display = '';
    } else {
      custInput.value = '';
      custClearBtn.style.display = 'none';
    }
    const periodActive = state.periodMonths.length > 0;
    periodClearBtn.style.display = periodActive ? '' : 'none';
    productClearBtn.style.display = state.product ? '' : 'none';

    const parts = [];
    if (state.customer && nameByCode[state.customer]) parts.push('הלקוח ' + nameByCode[state.customer]);
    if (state.product) parts.push('המוצר ' + (state.productName || state.product));
    if (periodActive) {
      parts.push('התקופה שנבחרה' + (state.compareMonths.length ? ' (בהשוואה לתקופה נוספת)' : ''));
    }
    subtitle.textContent = parts.length
      ? ('הדשבורד מציג כרגע רק את הנתונים של ' + parts.join(' ו') + '.')
      : 'כברירת מחדל, כל הנתונים בדשבורד מציגים את כלל הלקוחות וכל התקופות. הקלידו שם לקוח ו/או בחרו תקופה כדי לסנן.';
  }

  async function apply() {
    syncUrl();
    updateUi();
    const s = await loadDashboardSalesSummary(state);
    if (s && state.product && s.productName !== state.productName) { state.productName = s.productName; updateUi(); }
    if (window.refreshDashboardTopInsights) window.refreshDashboardTopInsights(state);
  }

  function selectCustomerFromInput() {
    const v = custInput.value.trim();
    if (!v) { if (state.customer) { state.customer = null; apply(); } return; }
    const code = byDisplay[v];
    if (code && code !== state.customer) { state.customer = code; apply(); }
  }
  custInput.addEventListener('change', selectCustomerFromInput);
  custInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectCustomerFromInput(); });
  custClearBtn.addEventListener('click', () => { state.customer = null; apply(); });

  // Rebuilds both month pickers from the current state.periodMonths/compareMonths —
  // used on init, on manual clear, and when an insight click sets a period programmatically
  // (see applyDashboardFiltersFromInsight below), since the widget has no public setter.
  function rebuildPeriodPickers() {
    createMonthMultiSelect('dashPeriodPicker', {
      placeholder: 'בחרו חודשים...',
      initial: state.periodMonths,
      yearsAhead: 0, yearsBack: 0, // current period is always within the current year
      onChange: (months) => { state.periodMonths = months; apply(); }
    });
    createMonthMultiSelect('dashComparePicker', {
      placeholder: 'בחרו חודשים...',
      initial: state.compareMonths,
      yearsAhead: -1, yearsBack: 1, // comparison is always against last year's months
      onChange: (months) => { state.compareMonths = months; apply(); }
    });
  }
  rebuildPeriodPickers();

  periodClearBtn.addEventListener('click', () => {
    state.periodMonths = []; state.compareMonths = [];
    document.dispatchEvent(new Event('click')); // closes any open picker panel
    rebuildPeriodPickers();
    apply();
  });
  productClearBtn.addEventListener('click', () => { state.product = null; state.productName = null; apply(); });

  // Lets a dashboard insight (see dashboard-top-insights.js) drive these same filters
  // directly when clicked — the customer/product/period/comparison-period it names,
  // applied exactly as the insight's own rule computed them.
  window.applyDashboardFiltersFromInsight = function (f) {
    f = f || {};
    state.customer = f.customerId || null;
    state.product = f.productCode || null;
    state.productName = null;
    state.periodMonths = f.periodMonths || [];
    state.compareMonths = f.compareMonths || [];
    document.dispatchEvent(new Event('click')); // closes any open picker panel
    rebuildPeriodPickers();
    apply();
  };

  updateUi();
}

initDashboardFilters();
