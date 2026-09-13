// Combined dashboard filter controls, laid out as a table: one row per filterable
// dimension (customer, period, product, primary classification, customer type),
// each with a primary-side control and a comparison-side control (see
// dashboard.html's .dash-filter-table). Every field is synced to the URL query
// string and drives one call to loadDashboardSalesSummary (dashboard-sales-summary.js)
// whenever any of them change, so a refresh or a shared link reproduces the exact
// same filtered view. A "period" is an arbitrary set of selected months, not
// necessarily contiguous — see month-multiselect.js.
async function initDashboardFilters() {
  const custInput = document.getElementById('dashCustomerSearch');
  if (!custInput) return;
  const custDatalist = document.getElementById('dashCustomerList');
  const prodInput = document.getElementById('dashProductSearch');
  const prodDatalist = document.getElementById('dashProductList');
  const primaryClassSel = document.getElementById('dashPrimaryClass');
  const customerTypeSel = document.getElementById('dashCustomerType');
  const subtitle = document.getElementById('dashFilterSubtitle');
  const cmpCustInput = document.getElementById('dashCompareCustomerSearch');
  const cmpCustDatalist = document.getElementById('dashCompareCustomerList');
  const cmpProdInput = document.getElementById('dashCompareProductSearch');
  const cmpProdDatalist = document.getElementById('dashCompareProductList');
  const cmpPrimaryClassSel = document.getElementById('dashComparePrimaryClass');
  const cmpCustomerTypeSel = document.getElementById('dashCompareCustomerType');
  const rowClearBtns = {
    customer: document.getElementById('dashClearRowCustomer'),
    period: document.getElementById('dashClearRowPeriod'),
    product: document.getElementById('dashClearRowProduct'),
    primaryClass: document.getElementById('dashClearRowPrimaryClass'),
    customerType: document.getElementById('dashClearRowCustomerType')
  };

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
  prodDatalist.innerHTML = Object.keys(prodByDisplay).map((d) => '<option value="' + Layout.escapeHtml(d) + '"></option>').join('');
  cmpProdDatalist.innerHTML = prodDatalist.innerHTML;
  // Distinct values straight off the already-fetched customer list — no separate
  // endpoint needed for the four segment dropdowns (primary + compare, class + type).
  function fillSelect(sel, values) {
    sel.innerHTML = '<option value="">הכל</option>' + Array.from(new Set(values.filter(Boolean))).sort()
      .map((v) => '<option value="' + Layout.escapeHtml(v) + '">' + Layout.escapeHtml(v) + '</option>').join('');
  }
  fillSelect(primaryClassSel, customers.map((c) => c.primaryClass));
  fillSelect(customerTypeSel, customers.map((c) => c.customerType));
  fillSelect(cmpPrimaryClassSel, customers.map((c) => c.primaryClass));
  fillSelect(cmpCustomerTypeSel, customers.map((c) => c.customerType));

  const urlParams = new URLSearchParams(window.location.search);
  const state = {
    customer: urlParams.get('customer') || null,
    product: urlParams.get('product') || null,
    // Resolved from the dashboard-sales-summary response once it comes back — the
    // URL/insight click only ever carries the product's code, not its display name.
    productName: null,
    primaryClass: urlParams.get('primaryClass') || null,
    customerType: urlParams.get('customerType') || null,
    periodMonths: (urlParams.get('periodMonths') || '').split(',').filter(Boolean),
    compareMonths: (urlParams.get('compareMonths') || '').split(',').filter(Boolean),
    // Entity-comparison axis: each is independent and optional, and each falls back
    // to the primary filter's own value on the server when unset — exactly like
    // compareMonths already does for dates (see dashboardSalesSummary.js).
    compareCustomer: urlParams.get('compareCustomer') || null,
    compareProduct: urlParams.get('compareProduct') || null,
    comparePrimaryClass: urlParams.get('comparePrimaryClass') || null,
    compareCustomerType: urlParams.get('compareCustomerType') || null
  };

  function syncUrl() {
    const url = new URL(window.location.href);
    const set = (key, val) => { if (val) url.searchParams.set(key, val); else url.searchParams.delete(key); };
    set('customer', state.customer);
    set('product', state.product);
    set('primaryClass', state.primaryClass);
    set('customerType', state.customerType);
    set('periodMonths', state.periodMonths.length ? state.periodMonths.join(',') : null);
    set('compareMonths', state.compareMonths.length ? state.compareMonths.join(',') : null);
    set('compareCustomer', state.compareCustomer);
    set('compareProduct', state.compareProduct);
    set('comparePrimaryClass', state.comparePrimaryClass);
    set('compareCustomerType', state.compareCustomerType);
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  function updateUi() {
    custInput.value = (state.customer && nameByCode[state.customer]) ? (state.customer + ' — ' + nameByCode[state.customer]) : '';
    prodInput.value = (state.product && prodNameByCode[state.product]) ? (state.product + ' — ' + (state.productName || prodNameByCode[state.product])) : '';
    primaryClassSel.value = state.primaryClass || '';
    customerTypeSel.value = state.customerType || '';
    cmpCustInput.value = (state.compareCustomer && nameByCode[state.compareCustomer]) ? (state.compareCustomer + ' — ' + nameByCode[state.compareCustomer]) : '';
    cmpProdInput.value = (state.compareProduct && prodNameByCode[state.compareProduct]) ? (state.compareProduct + ' — ' + prodNameByCode[state.compareProduct]) : '';
    cmpPrimaryClassSel.value = state.comparePrimaryClass || '';
    cmpCustomerTypeSel.value = state.compareCustomerType || '';

    const periodActive = state.periodMonths.length > 0;
    rowClearBtns.customer.style.display = (state.customer || state.compareCustomer) ? '' : 'none';
    rowClearBtns.period.style.display = (periodActive || state.compareMonths.length) ? '' : 'none';
    rowClearBtns.product.style.display = (state.product || state.compareProduct) ? '' : 'none';
    rowClearBtns.primaryClass.style.display = (state.primaryClass || state.comparePrimaryClass) ? '' : 'none';
    rowClearBtns.customerType.style.display = (state.customerType || state.compareCustomerType) ? '' : 'none';

    const parts = [];
    if (state.customer && nameByCode[state.customer]) parts.push('הלקוח ' + nameByCode[state.customer]);
    if (state.product) parts.push('המוצר ' + (state.productName || state.product));
    if (state.primaryClass) parts.push('סיווג ' + state.primaryClass);
    if (state.customerType) parts.push('סוג לקוח ' + state.customerType);
    if (periodActive) parts.push('התקופה שנבחרה');
    // Each compare-side part already carries its own preposition ("ל...") so joining
    // them never needs a second one inserted in front.
    const cmpParts = [];
    if (state.compareCustomer && nameByCode[state.compareCustomer]) cmpParts.push('ללקוח ' + nameByCode[state.compareCustomer]);
    if (state.compareProduct && prodNameByCode[state.compareProduct]) cmpParts.push('למוצר ' + prodNameByCode[state.compareProduct]);
    if (state.comparePrimaryClass) cmpParts.push('לסיווג ' + state.comparePrimaryClass);
    if (state.compareCustomerType) cmpParts.push('לסוג לקוח ' + state.compareCustomerType);
    if (state.compareMonths.length) cmpParts.push('לתקופה נוספת');

    if (parts.length && cmpParts.length) {
      subtitle.textContent = 'הדשבורד מציג כרגע את הנתונים של ' + parts.join(' ו') + ', בהשוואה ' + cmpParts.join(' ו') + '.';
    } else if (parts.length) {
      subtitle.textContent = 'הדשבורד מציג כרגע רק את הנתונים של ' + parts.join(' ו') + '.';
    } else if (cmpParts.length) {
      subtitle.textContent = 'הדשבורד מציג כרגע את כלל הנתונים, בהשוואה ' + cmpParts.join(' ו') + '.';
    } else {
      subtitle.textContent = 'כברירת מחדל, כל הנתונים בדשבורד מציגים את כלל הלקוחות וכל התקופות. מלאו כל שורה בנפרד כדי לסנן לפיה, ואת עמודת ההשוואה כדי להציג לצידה נתון להשוואה.';
    }
  }

  async function apply() {
    syncUrl();
    updateUi();
    const s = await loadDashboardSalesSummary(state);
    if (s && state.product && s.productName !== state.productName) { state.productName = s.productName; updateUi(); }
    if (window.refreshDashboardTopInsights) window.refreshDashboardTopInsights(state);
  }

  function wireEntitySearch(input, byDisplayMap, onSelect) {
    function handle() {
      const v = input.value.trim();
      if (!v) { onSelect(null); return; }
      const code = byDisplayMap[v];
      if (code) onSelect(code);
    }
    input.addEventListener('change', handle);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handle(); });
  }
  wireEntitySearch(custInput, byDisplay, (code) => { if (code !== state.customer) { state.customer = code; apply(); } });
  wireEntitySearch(prodInput, prodByDisplay, (code) => { if (code !== state.product) { state.product = code; state.productName = null; apply(); } });
  wireEntitySearch(cmpCustInput, byDisplay, (code) => { if (code !== state.compareCustomer) { state.compareCustomer = code; apply(); } });
  wireEntitySearch(cmpProdInput, prodByDisplay, (code) => { if (code !== state.compareProduct) { state.compareProduct = code; apply(); } });

  primaryClassSel.addEventListener('change', () => { state.primaryClass = primaryClassSel.value || null; apply(); });
  customerTypeSel.addEventListener('change', () => { state.customerType = customerTypeSel.value || null; apply(); });
  cmpPrimaryClassSel.addEventListener('change', () => { state.comparePrimaryClass = cmpPrimaryClassSel.value || null; apply(); });
  cmpCustomerTypeSel.addEventListener('change', () => { state.compareCustomerType = cmpCustomerTypeSel.value || null; apply(); });

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

  rowClearBtns.customer.addEventListener('click', () => { state.customer = null; state.compareCustomer = null; apply(); });
  rowClearBtns.product.addEventListener('click', () => { state.product = null; state.productName = null; state.compareProduct = null; apply(); });
  rowClearBtns.primaryClass.addEventListener('click', () => { state.primaryClass = null; state.comparePrimaryClass = null; apply(); });
  rowClearBtns.customerType.addEventListener('click', () => { state.customerType = null; state.compareCustomerType = null; apply(); });
  rowClearBtns.period.addEventListener('click', () => {
    state.periodMonths = []; state.compareMonths = [];
    document.dispatchEvent(new Event('click')); // closes any open picker panel
    rebuildPeriodPickers();
    apply();
  });

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
    // An insight names a customer/product/period, never a segment or a comparison
    // axis — clear anything the user had set manually so it doesn't linger mixed in.
    state.primaryClass = null; state.customerType = null;
    state.compareCustomer = null; state.compareProduct = null; state.comparePrimaryClass = null; state.compareCustomerType = null;
    document.dispatchEvent(new Event('click')); // closes any open picker panel
    rebuildPeriodPickers();
    apply();
  };

  // Fires the one initial dashboard-data fetch for this whole page — loadDashboardSalesSummary
  // must never be called a second, independent time elsewhere with a narrower filter
  // set (a stale duplicate of that kind previously raced this one and silently
  // dropped whichever filters it didn't know about).
  apply();
}

initDashboardFilters();
