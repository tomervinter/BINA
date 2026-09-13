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
  const cmpCustInput = document.getElementById('dashCompareCustomerSearch');
  const cmpCustDatalist = document.getElementById('dashCompareCustomerList');
  const cmpProdInput = document.getElementById('dashCompareProductSearch');
  const cmpProdDatalist = document.getElementById('dashCompareProductList');
  const cmpPrimaryClassSel = document.getElementById('dashComparePrimaryClass');
  const cmpCustomerTypeSel = document.getElementById('dashCompareCustomerType');
  const entityCompareClearBtn = document.getElementById('dashClearEntityCompareFilter');

  const [custRes, prodRes] = await Promise.all([
    fetch('/api/customers?pageSize=all', { credentials: 'include' }),
    fetch('/api/products?pageSize=all', { credentials: 'include' })
  ]);
  const customers = custRes.ok ? (await custRes.json()).rows : [];
  const products = prodRes.ok ? (await prodRes.json()).rows : [];
  const byDisplay = {};
  const nameByCode = {};
  customers.forEach((c) => {
    byDisplay[c.customerNumber + ' — ' + c.name] = c.customerNumber;
    nameByCode[c.customerNumber] = c.name;
  });
  custDatalist.innerHTML = Object.keys(byDisplay).map((d) => '<option value="' + Layout.escapeHtml(d) + '"></option>').join('');
  cmpCustDatalist.innerHTML = custDatalist.innerHTML;
  const prodByDisplay = {};
  const prodNameByCode = {};
  products.forEach((p) => {
    prodByDisplay[p.itemCode + ' — ' + p.name] = p.itemCode;
    prodNameByCode[p.itemCode] = p.name;
  });
  cmpProdDatalist.innerHTML = Object.keys(prodByDisplay).map((d) => '<option value="' + Layout.escapeHtml(d) + '"></option>').join('');
  // Distinct values straight off the already-fetched customer list — no separate
  // endpoint needed for the two segment-comparison dropdowns.
  function fillSelect(sel, values) {
    sel.innerHTML = '<option value="">הכל</option>' + Array.from(new Set(values.filter(Boolean))).sort()
      .map((v) => '<option value="' + Layout.escapeHtml(v) + '">' + Layout.escapeHtml(v) + '</option>').join('');
  }
  fillSelect(cmpPrimaryClassSel, customers.map((c) => c.primaryClass));
  fillSelect(cmpCustomerTypeSel, customers.map((c) => c.customerType));

  const urlParams = new URLSearchParams(window.location.search);
  const state = {
    customer: urlParams.get('customer') || null,
    product: urlParams.get('product') || null,
    // Resolved from the dashboard-sales-summary response once it comes back — the
    // URL/insight click only ever carries the product's code, not its display name.
    productName: null,
    periodMonths: (urlParams.get('periodMonths') || '').split(',').filter(Boolean),
    compareMonths: (urlParams.get('compareMonths') || '').split(',').filter(Boolean),
    // Entity-comparison axis: each is independent and optional, and each falls back
    // to the primary customer/product filter's own value on the server when unset —
    // exactly like compareMonths already does for dates (see dashboardSalesSummary.js).
    compareCustomer: urlParams.get('compareCustomer') || null,
    compareProduct: urlParams.get('compareProduct') || null,
    comparePrimaryClass: urlParams.get('comparePrimaryClass') || null,
    compareCustomerType: urlParams.get('compareCustomerType') || null
  };

  function syncUrl() {
    const url = new URL(window.location.href);
    if (state.customer) url.searchParams.set('customer', state.customer); else url.searchParams.delete('customer');
    if (state.product) url.searchParams.set('product', state.product); else url.searchParams.delete('product');
    if (state.periodMonths.length) url.searchParams.set('periodMonths', state.periodMonths.join(',')); else url.searchParams.delete('periodMonths');
    if (state.compareMonths.length) url.searchParams.set('compareMonths', state.compareMonths.join(',')); else url.searchParams.delete('compareMonths');
    if (state.compareCustomer) url.searchParams.set('compareCustomer', state.compareCustomer); else url.searchParams.delete('compareCustomer');
    if (state.compareProduct) url.searchParams.set('compareProduct', state.compareProduct); else url.searchParams.delete('compareProduct');
    if (state.comparePrimaryClass) url.searchParams.set('comparePrimaryClass', state.comparePrimaryClass); else url.searchParams.delete('comparePrimaryClass');
    if (state.compareCustomerType) url.searchParams.set('compareCustomerType', state.compareCustomerType); else url.searchParams.delete('compareCustomerType');
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

    cmpCustInput.value = (state.compareCustomer && nameByCode[state.compareCustomer]) ? (state.compareCustomer + ' — ' + nameByCode[state.compareCustomer]) : '';
    cmpProdInput.value = (state.compareProduct && prodNameByCode[state.compareProduct]) ? (state.compareProduct + ' — ' + prodNameByCode[state.compareProduct]) : '';
    cmpPrimaryClassSel.value = state.comparePrimaryClass || '';
    cmpCustomerTypeSel.value = state.compareCustomerType || '';
    const entityCompareActive = !!(state.compareCustomer || state.compareProduct || state.comparePrimaryClass || state.compareCustomerType);
    entityCompareClearBtn.style.display = entityCompareActive ? '' : 'none';

    const parts = [];
    if (state.customer && nameByCode[state.customer]) parts.push('הלקוח ' + nameByCode[state.customer]);
    if (state.product) parts.push('המוצר ' + (state.productName || state.product));
    if (periodActive) {
      parts.push('התקופה שנבחרה' + (state.compareMonths.length ? ' (בהשוואה לתקופה נוספת)' : ''));
    }
    // Each compare-side part already carries its own preposition ("ל...") so joining
    // them never needs a second one inserted in front.
    const cmpParts = [];
    if (state.compareCustomer && nameByCode[state.compareCustomer]) cmpParts.push('ללקוח ' + nameByCode[state.compareCustomer]);
    if (state.compareProduct && prodNameByCode[state.compareProduct]) cmpParts.push('למוצר ' + prodNameByCode[state.compareProduct]);
    if (state.comparePrimaryClass) cmpParts.push('לסיווג ' + state.comparePrimaryClass);
    if (state.compareCustomerType) cmpParts.push('לסוג לקוח ' + state.compareCustomerType);

    if (parts.length && cmpParts.length) {
      subtitle.textContent = 'הדשבורד מציג כרגע את הנתונים של ' + parts.join(' ו') + ', בהשוואה ' + cmpParts.join(' ו') + '.';
    } else if (parts.length) {
      subtitle.textContent = 'הדשבורד מציג כרגע רק את הנתונים של ' + parts.join(' ו') + '.';
    } else if (cmpParts.length) {
      subtitle.textContent = 'הדשבורד מציג כרגע את כלל הנתונים, בהשוואה ' + cmpParts.join(' ו') + '.';
    } else {
      subtitle.textContent = 'כברירת מחדל, כל הנתונים בדשבורד מציגים את כלל הלקוחות וכל התקופות. הקלידו שם לקוח ו/או בחרו תקופה כדי לסנן.';
    }
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

  function selectCompareCustomerFromInput() {
    const v = cmpCustInput.value.trim();
    if (!v) { if (state.compareCustomer) { state.compareCustomer = null; apply(); } return; }
    const code = byDisplay[v];
    if (code && code !== state.compareCustomer) { state.compareCustomer = code; apply(); }
  }
  cmpCustInput.addEventListener('change', selectCompareCustomerFromInput);
  cmpCustInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectCompareCustomerFromInput(); });

  function selectCompareProductFromInput() {
    const v = cmpProdInput.value.trim();
    if (!v) { if (state.compareProduct) { state.compareProduct = null; apply(); } return; }
    const code = prodByDisplay[v];
    if (code && code !== state.compareProduct) { state.compareProduct = code; apply(); }
  }
  cmpProdInput.addEventListener('change', selectCompareProductFromInput);
  cmpProdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectCompareProductFromInput(); });

  cmpPrimaryClassSel.addEventListener('change', () => { state.comparePrimaryClass = cmpPrimaryClassSel.value || null; apply(); });
  cmpCustomerTypeSel.addEventListener('change', () => { state.compareCustomerType = cmpCustomerTypeSel.value || null; apply(); });
  entityCompareClearBtn.addEventListener('click', () => {
    state.compareCustomer = null; state.compareProduct = null; state.comparePrimaryClass = null; state.compareCustomerType = null;
    apply();
  });

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
    // An insight names a customer/product/period, never an entity-comparison axis —
    // clear any comparison the user had set manually so it doesn't linger mixed in.
    state.compareCustomer = null; state.compareProduct = null; state.comparePrimaryClass = null; state.compareCustomerType = null;
    document.dispatchEvent(new Event('click')); // closes any open picker panel
    rebuildPeriodPickers();
    apply();
  };

  // Fires the one initial dashboard-data fetch for this whole page — see the note
  // atop this function; loadDashboardSalesSummary must never be called a second,
  // independent time elsewhere with a narrower filter set (a stale duplicate of that
  // kind previously raced this one and silently dropped whichever filters it didn't
  // know about).
  apply();
}

initDashboardFilters();
