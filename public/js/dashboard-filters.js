// Combined dashboard filter controls, laid out as a table: one row per filterable
// dimension (customer, period, product, primary classification, customer type),
// each with a primary-side multi-select and a comparison-side multi-select (see
// dashboard.html's .dash-filter-table and entity-multiselect.js). Every field is
// synced to the URL query string (each as a comma-separated list) and drives one
// call to loadDashboardSalesSummary (dashboard-sales-summary.js) whenever any of
// them change, so a refresh or a shared link reproduces the exact same filtered
// view. A "period" is likewise an arbitrary set of selected months, not necessarily
// contiguous — see month-multiselect.js.
async function initDashboardFilters() {
  const custPickerEl = document.getElementById('dashCustomerPicker');
  if (!custPickerEl) return;
  const subtitle = document.getElementById('dashFilterSubtitle');
  const cellClearBtns = {
    customer: document.getElementById('dashClearCustomer'),
    compareCustomer: document.getElementById('dashClearCompareCustomer'),
    period: document.getElementById('dashClearPeriod'),
    comparePeriod: document.getElementById('dashClearComparePeriod'),
    product: document.getElementById('dashClearProduct'),
    compareProduct: document.getElementById('dashClearCompareProduct'),
    primaryClass: document.getElementById('dashClearPrimaryClass'),
    comparePrimaryClass: document.getElementById('dashClearComparePrimaryClass'),
    customerType: document.getElementById('dashClearCustomerType'),
    compareCustomerType: document.getElementById('dashClearCompareCustomerType'),
    boughtProducts: document.getElementById('dashClearBoughtProducts'),
    notBoughtProducts: document.getElementById('dashClearNotBoughtProducts')
  };
  const purchaseCohortSubtitle = document.getElementById('dashPurchaseCohortSubtitle');

  const [custRes, prodRes] = await Promise.all([
    fetch('/api/customers?pageSize=all', { credentials: 'include' }),
    fetch('/api/products?pageSize=all', { credentials: 'include' })
  ]);
  const customers = custRes.ok ? (await custRes.json()).rows : [];
  const products = prodRes.ok ? (await prodRes.json()).rows : [];
  const nameByCode = {};
  customers.forEach((c) => { nameByCode[c.customerNumber] = c.name; });
  const prodNameByCode = {};
  products.forEach((p) => { prodNameByCode[p.itemCode] = p.name; });
  const custOptions = customers.map((c) => ({ value: c.customerNumber, label: c.customerNumber + ' — ' + c.name }));
  const prodOptions = products.map((p) => ({ value: p.itemCode, label: p.itemCode + ' — ' + p.name }));
  // Distinct values straight off the already-fetched customer list — no separate
  // endpoint needed for the four segment dropdowns (primary + compare, class + type).
  function distinctOptions(values) {
    return Array.from(new Set(values.filter(Boolean))).sort().map((v) => ({ value: v, label: v }));
  }
  const primaryClassOptions = distinctOptions(customers.map((c) => c.primaryClass));
  const customerTypeOptions = distinctOptions(customers.map((c) => c.customerType));

  const urlParams = new URLSearchParams(window.location.search);
  const csv = (key) => (urlParams.get(key) || '').split(',').filter(Boolean);
  const state = {
    customer: csv('customer'),
    product: csv('product'),
    // Resolved from the dashboard-sales-summary response once it comes back — the
    // URL/insight click only ever carries product codes, not their display names.
    productNames: null,
    primaryClass: csv('primaryClass'),
    customerType: csv('customerType'),
    periodMonths: csv('periodMonths'),
    compareMonths: csv('compareMonths'),
    // Entity-comparison axis: each is independent and optional, and each falls back
    // to the primary filter's own value on the server when unset — exactly like
    // compareMonths already does for dates (see dashboardSalesSummary.js).
    compareCustomer: csv('compareCustomer'),
    compareProduct: csv('compareProduct'),
    comparePrimaryClass: csv('comparePrimaryClass'),
    compareCustomerType: csv('compareCustomerType'),
    // Cohort filter: narrows the primary customer selection to those who bought/didn't
    // buy certain products — resolved server-side to a customer set (see
    // resolvePurchaseCohort in dashboardSalesSummary.js). Primary-side only; doesn't
    // apply to the comparison side.
    boughtProducts: csv('boughtProducts'),
    notBoughtProducts: csv('notBoughtProducts')
  };

  function syncUrl() {
    const url = new URL(window.location.href);
    const set = (key, arr) => { if (arr && arr.length) url.searchParams.set(key, arr.join(',')); else url.searchParams.delete(key); };
    set('customer', state.customer);
    set('product', state.product);
    set('primaryClass', state.primaryClass);
    set('customerType', state.customerType);
    set('periodMonths', state.periodMonths);
    set('compareMonths', state.compareMonths);
    set('compareCustomer', state.compareCustomer);
    set('compareProduct', state.compareProduct);
    set('comparePrimaryClass', state.comparePrimaryClass);
    set('compareCustomerType', state.compareCustomerType);
    set('boughtProducts', state.boughtProducts);
    set('notBoughtProducts', state.notBoughtProducts);
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  // Joins a list of values into a short human sentence fragment, using the given
  // preposition-prefixed word for 1 item and a plain count for more (e.g. "הלקוח X"
  // vs "3 לקוחות"), so the subtitle stays readable regardless of how many are picked.
  function joinNamed(codes, nameMap, singularLabel, pluralLabel) {
    if (!codes.length) return null;
    if (codes.length === 1) return singularLabel + ' ' + (nameMap ? (nameMap[codes[0]] || codes[0]) : codes[0]);
    return codes.length + ' ' + pluralLabel;
  }

  function updateUi() {
    const periodActive = state.periodMonths.length > 0;
    cellClearBtns.customer.style.display = state.customer.length ? '' : 'none';
    cellClearBtns.compareCustomer.style.display = state.compareCustomer.length ? '' : 'none';
    cellClearBtns.period.style.display = periodActive ? '' : 'none';
    cellClearBtns.comparePeriod.style.display = state.compareMonths.length ? '' : 'none';
    cellClearBtns.product.style.display = state.product.length ? '' : 'none';
    cellClearBtns.compareProduct.style.display = state.compareProduct.length ? '' : 'none';
    cellClearBtns.primaryClass.style.display = state.primaryClass.length ? '' : 'none';
    cellClearBtns.comparePrimaryClass.style.display = state.comparePrimaryClass.length ? '' : 'none';
    cellClearBtns.customerType.style.display = state.customerType.length ? '' : 'none';
    cellClearBtns.compareCustomerType.style.display = state.compareCustomerType.length ? '' : 'none';
    cellClearBtns.boughtProducts.style.display = state.boughtProducts.length ? '' : 'none';
    cellClearBtns.notBoughtProducts.style.display = state.notBoughtProducts.length ? '' : 'none';

    const parts = [];
    const custPart = joinNamed(state.customer, nameByCode, 'הלקוח', 'לקוחות');
    if (custPart) parts.push(custPart);
    const prodPart = state.product.length
      ? (state.product.length === 1 ? 'המוצר ' + ((state.productNames && state.productNames[0]) || prodNameByCode[state.product[0]] || state.product[0]) : state.product.length + ' מוצרים')
      : null;
    if (prodPart) parts.push(prodPart);
    if (state.primaryClass.length) parts.push(state.primaryClass.length === 1 ? 'סיווג ' + state.primaryClass[0] : state.primaryClass.length + ' סיווגים ראשיים');
    if (state.customerType.length) parts.push(state.customerType.length === 1 ? 'סוג לקוח ' + state.customerType[0] : state.customerType.length + ' סוגי לקוח');
    if (periodActive) parts.push('התקופה שנבחרה');
    if (state.boughtProducts.length) parts.push('לקוחות שקנו ' + (state.boughtProducts.length === 1 ? (prodNameByCode[state.boughtProducts[0]] || state.boughtProducts[0]) : state.boughtProducts.length + ' מוצרים נבחרים'));
    if (state.notBoughtProducts.length) parts.push('שלא קנו ' + (state.notBoughtProducts.length === 1 ? (prodNameByCode[state.notBoughtProducts[0]] || state.notBoughtProducts[0]) : state.notBoughtProducts.length + ' מוצרים נבחרים'));

    if (purchaseCohortSubtitle) {
      if (state.boughtProducts.length || state.notBoughtProducts.length) {
        const cohortBits = [];
        if (state.boughtProducts.length) cohortBits.push('קנו ' + state.boughtProducts.map((p) => prodNameByCode[p] || p).join(', '));
        if (state.notBoughtProducts.length) cohortBits.push('לא קנו ' + state.notBoughtProducts.map((p) => prodNameByCode[p] || p).join(', '));
        purchaseCohortSubtitle.textContent = 'מוצג רק לקוחות ש' + cohortBits.join(' ו') + (periodActive ? ' בתקופה הנוכחית שנבחרה' : '') + '.';
      } else {
        purchaseCohortSubtitle.textContent = 'מצמצם את הלקוח/ות בבדיקה הראשית למי שקנו מוצר מסוים ו/או למי שלא קנו מוצר אחר' + (periodActive ? ', בתקופה הנוכחית שנבחרה' : '') + '.';
      }
    }

    // Each compare-side part already carries its own preposition ("ל...") so joining
    // them never needs a second one inserted in front.
    const cmpParts = [];
    const cmpCustPart = joinNamed(state.compareCustomer, nameByCode, 'ללקוח', 'לקוחות');
    if (cmpCustPart) cmpParts.push(cmpCustPart);
    if (state.compareProduct.length) cmpParts.push(state.compareProduct.length === 1 ? 'למוצר ' + (prodNameByCode[state.compareProduct[0]] || state.compareProduct[0]) : 'ל-' + state.compareProduct.length + ' מוצרים');
    if (state.comparePrimaryClass.length) cmpParts.push(state.comparePrimaryClass.length === 1 ? 'לסיווג ' + state.comparePrimaryClass[0] : 'ל-' + state.comparePrimaryClass.length + ' סיווגים ראשיים');
    if (state.compareCustomerType.length) cmpParts.push(state.compareCustomerType.length === 1 ? 'לסוג לקוח ' + state.compareCustomerType[0] : 'ל-' + state.compareCustomerType.length + ' סוגי לקוח');
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

  const cohortSection = document.getElementById('dashCohortCustomersSection');
  const cohortCountEl = document.getElementById('dashCohortCustomersCount');
  const cohortBodyEl = document.getElementById('dashCohortCustomersBody');
  const cohortExportBtn = document.getElementById('dashCohortExportBtn');

  // Shows the exact customer list the purchase-cohort filter above ("בחרו מוצר/ים
  // שקנו/לא קנו") resolved to, with a real .xlsx export of that same list — hidden
  // whenever that cohort filter itself is empty, even if the main filter table
  // happens to narrow customers for an unrelated reason (e.g. a plain customer
  // selection made for a different check shouldn't surface here).
  function renderCohortCustomers(s) {
    if (!s || !s.filteredCustomers || !(state.boughtProducts.length || state.notBoughtProducts.length)) { cohortSection.style.display = 'none'; return; }
    cohortSection.style.display = '';
    cohortCountEl.textContent = s.filteredCustomers.length + ' לקוחות תואמים';
    cohortBodyEl.innerHTML = s.filteredCustomers.map((c) =>
      '<tr><td>' + Layout.escapeHtml(c.customerNumber) + '</td><td>' + Layout.escapeHtml(c.name) + '</td><td>' +
      Layout.escapeHtml(c.centralCustomer || '') + '</td><td>' + Layout.escapeHtml(c.primaryClass || '') + '</td><td>' +
      Layout.escapeHtml(c.customerType || '') + '</td></tr>'
    ).join('') || '<tr><td colspan="5">אין לקוחות תואמים</td></tr>';
    const qs = new URLSearchParams();
    const setList = (key, arr) => { if (arr && arr.length) qs.set(key, arr.join(',')); };
    setList('customerNumber', state.customer);
    setList('primaryClass', state.primaryClass);
    setList('customerType', state.customerType);
    setList('boughtProducts', state.boughtProducts);
    setList('notBoughtProducts', state.notBoughtProducts);
    setList('periodMonths', state.periodMonths);
    cohortExportBtn.href = '/api/dashboard-sales-summary/cohort-customers/export?' + qs.toString();
  }

  async function apply() {
    syncUrl();
    updateUi();
    const s = await loadDashboardSalesSummary(state);
    if (s && state.product.length && s.productNames) { state.productNames = s.productNames; updateUi(); }
    renderCohortCustomers(s);
    if (window.refreshDashboardTopInsights) window.refreshDashboardTopInsights(state);
  }

  const pickers = {};
  function makePicker(containerId, options, initial, searchable, onChange) {
    pickers[containerId] = createEntityMultiSelect(containerId, { options, initial, searchable, onChange });
  }
  makePicker('dashCustomerPicker', custOptions, state.customer, true, (vals) => { state.customer = vals; apply(); });
  makePicker('dashCompareCustomerPicker', custOptions, state.compareCustomer, true, (vals) => { state.compareCustomer = vals; apply(); });
  makePicker('dashProductPicker', prodOptions, state.product, true, (vals) => { state.product = vals; state.productNames = null; apply(); });
  makePicker('dashCompareProductPicker', prodOptions, state.compareProduct, true, (vals) => { state.compareProduct = vals; apply(); });
  makePicker('dashPrimaryClassPicker', primaryClassOptions, state.primaryClass, false, (vals) => { state.primaryClass = vals; apply(); });
  makePicker('dashComparePrimaryClassPicker', primaryClassOptions, state.comparePrimaryClass, false, (vals) => { state.comparePrimaryClass = vals; apply(); });
  makePicker('dashCustomerTypePicker', customerTypeOptions, state.customerType, false, (vals) => { state.customerType = vals; apply(); });
  makePicker('dashCompareCustomerTypePicker', customerTypeOptions, state.compareCustomerType, false, (vals) => { state.compareCustomerType = vals; apply(); });
  makePicker('dashBoughtProductsPicker', prodOptions, state.boughtProducts, true, (vals) => { state.boughtProducts = vals; apply(); });
  makePicker('dashNotBoughtProductsPicker', prodOptions, state.notBoughtProducts, true, (vals) => { state.notBoughtProducts = vals; apply(); });

  // Rebuilds both month pickers from the current state.periodMonths/compareMonths —
  // used on init, on manual clear, and when an insight click sets a period programmatically
  // (see applyDashboardFiltersFromInsight below), since the widget has no public setter.
  function rebuildPeriodPickers() {
    createMonthMultiSelect('dashPeriodPicker', {
      placeholder: 'בחרו חודשים...',
      initial: state.periodMonths,
      yearsAhead: 0, yearsBack: 5, // any year/month up to 5 years back — not locked to the current year
      onChange: (months) => { state.periodMonths = months; apply(); }
    });
    createMonthMultiSelect('dashComparePicker', {
      placeholder: 'בחרו חודשים...',
      initial: state.compareMonths,
      yearsAhead: 0, yearsBack: 5, // free choice of year/month here too — not locked to last year
      onChange: (months) => { state.compareMonths = months; apply(); }
    });
  }
  rebuildPeriodPickers();

  cellClearBtns.customer.addEventListener('click', () => { state.customer = []; pickers.dashCustomerPicker.setSelected([]); apply(); });
  cellClearBtns.compareCustomer.addEventListener('click', () => { state.compareCustomer = []; pickers.dashCompareCustomerPicker.setSelected([]); apply(); });
  cellClearBtns.product.addEventListener('click', () => { state.product = []; state.productNames = null; pickers.dashProductPicker.setSelected([]); apply(); });
  cellClearBtns.compareProduct.addEventListener('click', () => { state.compareProduct = []; pickers.dashCompareProductPicker.setSelected([]); apply(); });
  cellClearBtns.primaryClass.addEventListener('click', () => { state.primaryClass = []; pickers.dashPrimaryClassPicker.setSelected([]); apply(); });
  cellClearBtns.comparePrimaryClass.addEventListener('click', () => { state.comparePrimaryClass = []; pickers.dashComparePrimaryClassPicker.setSelected([]); apply(); });
  cellClearBtns.customerType.addEventListener('click', () => { state.customerType = []; pickers.dashCustomerTypePicker.setSelected([]); apply(); });
  cellClearBtns.compareCustomerType.addEventListener('click', () => { state.compareCustomerType = []; pickers.dashCompareCustomerTypePicker.setSelected([]); apply(); });
  cellClearBtns.boughtProducts.addEventListener('click', () => { state.boughtProducts = []; pickers.dashBoughtProductsPicker.setSelected([]); apply(); });
  cellClearBtns.notBoughtProducts.addEventListener('click', () => { state.notBoughtProducts = []; pickers.dashNotBoughtProductsPicker.setSelected([]); apply(); });
  cellClearBtns.period.addEventListener('click', () => {
    state.periodMonths = [];
    document.dispatchEvent(new Event('click')); // closes any open picker panel
    rebuildPeriodPickers();
    apply();
  });
  cellClearBtns.comparePeriod.addEventListener('click', () => {
    state.compareMonths = [];
    document.dispatchEvent(new Event('click')); // closes any open picker panel
    rebuildPeriodPickers();
    apply();
  });

  // Lets a dashboard insight (see dashboard-top-insights.js) drive these same filters
  // directly when clicked — the customer/product/period/comparison-period it names,
  // applied exactly as the insight's own rule computed them.
  window.applyDashboardFiltersFromInsight = function (f) {
    f = f || {};
    state.customer = f.customerId ? [f.customerId] : [];
    state.product = f.productCode ? [f.productCode] : [];
    state.productNames = null;
    state.periodMonths = f.periodMonths || [];
    state.compareMonths = f.compareMonths || [];
    // An insight names a customer/product/period, never a segment or a comparison
    // axis — clear anything the user had set manually so it doesn't linger mixed in.
    state.primaryClass = []; state.customerType = [];
    state.compareCustomer = []; state.compareProduct = []; state.comparePrimaryClass = []; state.compareCustomerType = [];
    state.boughtProducts = []; state.notBoughtProducts = [];
    pickers.dashCustomerPicker.setSelected(state.customer);
    pickers.dashProductPicker.setSelected(state.product);
    pickers.dashPrimaryClassPicker.setSelected([]);
    pickers.dashCustomerTypePicker.setSelected([]);
    pickers.dashCompareCustomerPicker.setSelected([]);
    pickers.dashCompareProductPicker.setSelected([]);
    pickers.dashComparePrimaryClassPicker.setSelected([]);
    pickers.dashCompareCustomerTypePicker.setSelected([]);
    pickers.dashBoughtProductsPicker.setSelected([]);
    pickers.dashNotBoughtProductsPicker.setSelected([]);
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
