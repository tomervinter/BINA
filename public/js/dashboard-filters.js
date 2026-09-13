// Combined dashboard filter controls, laid out as a table: one row per filterable
// dimension (customer, year, month, product, primary classification, customer type),
// each with a primary-side multi-select and a comparison-side multi-select (see
// dashboard.html's .dash-filter-table and entity-multiselect.js). Every field is
// synced to the URL query string (each as a comma-separated list) and drives one
// call to loadDashboardSalesSummary (dashboard-sales-summary.js) whenever any of
// them change, so a refresh or a shared link reproduces the exact same filtered
// view. "Year" and "month" are two independent multi-selects rather than one
// combined picker — the actual period applied is every year/month combination
// (the cross product), e.g. years [2025,2026] × months [ינואר,פברואר] gives
// 2025-01, 2025-02, 2026-01, 2026-02. A period is only active once BOTH a year and
// a month are picked on that side.
const DASH_MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
function dashCrossProductMonths(years, months) {
  if (!years.length || !months.length) return [];
  const out = [];
  years.forEach((y) => months.forEach((m) => out.push(y + '-' + String(m).padStart(2, '0'))));
  return out.sort();
}
// Inverse of the above, for restoring the year/month pickers' selections from an
// absolute "YYYY-MM" list (a bookmarked URL, or an insight's own dashFilter) —
// best-effort: a rolling window that happens to straddle a year boundary (e.g. Dec
// + Jan + Feb) decomposes into 2 years × 3 months, which re-applies as 6 months
// rather than the original 3. Rare in practice (insights only span a year boundary
// for "last N months" rules) and still lands on a reasonable, visible selection
// rather than an invisible one the pickers can't represent.
function dashDecomposeMonths(monthKeys) {
  const years = new Set(), months = new Set();
  (monthKeys || []).forEach((mk) => { const [y, m] = mk.split('-'); years.add(y); months.add(String(Number(m))); });
  return { years: Array.from(years).sort(), months: Array.from(months).sort((a, b) => +a - +b) };
}
async function initDashboardFilters() {
  const custPickerEl = document.getElementById('dashCustomerPicker');
  if (!custPickerEl) return;
  const subtitle = document.getElementById('dashFilterSubtitle');
  const cellClearBtns = {
    customer: document.getElementById('dashClearCustomer'),
    compareCustomer: document.getElementById('dashClearCompareCustomer'),
    year: document.getElementById('dashClearYear'),
    compareYear: document.getElementById('dashClearCompareYear'),
    month: document.getElementById('dashClearMonth'),
    compareMonth: document.getElementById('dashClearCompareMonth'),
    product: document.getElementById('dashClearProduct'),
    compareProduct: document.getElementById('dashClearCompareProduct'),
    primaryClass: document.getElementById('dashClearPrimaryClass'),
    comparePrimaryClass: document.getElementById('dashClearComparePrimaryClass'),
    customerType: document.getElementById('dashClearCustomerType'),
    compareCustomerType: document.getElementById('dashClearCompareCustomerType'),
    superType: document.getElementById('dashClearSuperType'),
    compareSuperType: document.getElementById('dashClearCompareSuperType'),
    department: document.getElementById('dashClearDepartment'),
    compareDepartment: document.getElementById('dashClearCompareDepartment'),
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
  const superTypeOptions = distinctOptions(products.map((p) => p.superType));
  const departmentOptions = distinctOptions(products.map((p) => p.department));
  // Same year range for both sides — no reason a comparison must be last year
  // specifically, the user picks whichever year/month combination they want.
  const dashCurrentYear = new Date().getFullYear();
  const yearOptions = [];
  for (let y = dashCurrentYear; y >= dashCurrentYear - 5; y--) yearOptions.push({ value: String(y), label: String(y) });
  const monthOptions = DASH_MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }));

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
    superType: csv('superType'),
    department: csv('department'),
    // periodMonths/compareMonths are DERIVED (the year × month cross product) —
    // never set directly except by that computation or by an insight click's own
    // absolute month list (see dashDecomposeMonths / applyDashboardFiltersFromInsight).
    periodYears: csv('periodYears'),
    periodMonthsSel: csv('periodMonthsSel'),
    compareYears: csv('compareYears'),
    compareMonthsSel: csv('compareMonthsSel'),
    periodMonths: [],
    compareMonths: [],
    // Entity-comparison axis: each is independent and optional, and each falls back
    // to the primary filter's own value on the server when unset — exactly like
    // compareMonths already does for dates (see dashboardSalesSummary.js).
    compareCustomer: csv('compareCustomer'),
    compareProduct: csv('compareProduct'),
    comparePrimaryClass: csv('comparePrimaryClass'),
    compareCustomerType: csv('compareCustomerType'),
    compareSuperType: csv('compareSuperType'),
    compareDepartment: csv('compareDepartment'),
    // Cohort filter: narrows the primary customer selection to those who bought/didn't
    // buy certain products — resolved server-side to a customer set (see
    // resolvePurchaseCohort in dashboardSalesSummary.js). Primary-side only; doesn't
    // apply to the comparison side.
    boughtProducts: csv('boughtProducts'),
    notBoughtProducts: csv('notBoughtProducts')
  };
  state.periodMonths = dashCrossProductMonths(state.periodYears, state.periodMonthsSel);
  state.compareMonths = dashCrossProductMonths(state.compareYears, state.compareMonthsSel);

  function syncUrl() {
    const url = new URL(window.location.href);
    const set = (key, arr) => { if (arr && arr.length) url.searchParams.set(key, arr.join(',')); else url.searchParams.delete(key); };
    set('customer', state.customer);
    set('product', state.product);
    set('primaryClass', state.primaryClass);
    set('customerType', state.customerType);
    set('superType', state.superType);
    set('department', state.department);
    set('periodYears', state.periodYears);
    set('periodMonthsSel', state.periodMonthsSel);
    set('compareYears', state.compareYears);
    set('compareMonthsSel', state.compareMonthsSel);
    set('compareCustomer', state.compareCustomer);
    set('compareProduct', state.compareProduct);
    set('comparePrimaryClass', state.comparePrimaryClass);
    set('compareCustomerType', state.compareCustomerType);
    set('compareSuperType', state.compareSuperType);
    set('compareDepartment', state.compareDepartment);
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
    cellClearBtns.year.style.display = state.periodYears.length ? '' : 'none';
    cellClearBtns.compareYear.style.display = state.compareYears.length ? '' : 'none';
    cellClearBtns.month.style.display = state.periodMonthsSel.length ? '' : 'none';
    cellClearBtns.compareMonth.style.display = state.compareMonthsSel.length ? '' : 'none';
    cellClearBtns.product.style.display = state.product.length ? '' : 'none';
    cellClearBtns.compareProduct.style.display = state.compareProduct.length ? '' : 'none';
    cellClearBtns.primaryClass.style.display = state.primaryClass.length ? '' : 'none';
    cellClearBtns.comparePrimaryClass.style.display = state.comparePrimaryClass.length ? '' : 'none';
    cellClearBtns.customerType.style.display = state.customerType.length ? '' : 'none';
    cellClearBtns.compareCustomerType.style.display = state.compareCustomerType.length ? '' : 'none';
    cellClearBtns.superType.style.display = state.superType.length ? '' : 'none';
    cellClearBtns.compareSuperType.style.display = state.compareSuperType.length ? '' : 'none';
    cellClearBtns.department.style.display = state.department.length ? '' : 'none';
    cellClearBtns.compareDepartment.style.display = state.compareDepartment.length ? '' : 'none';
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
    if (state.superType.length) parts.push(state.superType.length === 1 ? 'טיפוס על ' + state.superType[0] : state.superType.length + ' טיפוסי על');
    if (state.department.length) parts.push(state.department.length === 1 ? 'מחלקת מוצר ' + state.department[0] : state.department.length + ' מחלקות מוצר');
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
    if (state.compareSuperType.length) cmpParts.push(state.compareSuperType.length === 1 ? 'לטיפוס על ' + state.compareSuperType[0] : 'ל-' + state.compareSuperType.length + ' טיפוסי על');
    if (state.compareDepartment.length) cmpParts.push(state.compareDepartment.length === 1 ? 'למחלקת מוצר ' + state.compareDepartment[0] : 'ל-' + state.compareDepartment.length + ' מחלקות מוצר');
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
  function makePicker(containerId, options, initial, searchable, onChange, quickActions) {
    pickers[containerId] = createEntityMultiSelect(containerId, { options, initial, searchable, onChange, quickActions });
  }
  // Quarter shortcuts are fixed month groups; the YTD-cumulative shortcut uses the
  // last fully completed calendar month (same Math.max(1, ...) convention as the
  // insights engine's own YTD rule) so it never includes the in-progress month.
  const monthQuickActions = [
    { label: 'רבעון 1 (ינואר-מרץ)', values: ['1', '2', '3'] },
    { label: 'רבעון 2 (אפריל-יוני)', values: ['4', '5', '6'] },
    { label: 'רבעון 3 (יולי-ספטמבר)', values: ['7', '8', '9'] },
    { label: 'רבעון 4 (אוקטובר-דצמבר)', values: ['10', '11', '12'] },
    { label: 'מצטבר עד החודש האחרון שהסתיים', values: Array.from({ length: Math.max(1, new Date().getMonth()) }, (_, i) => String(i + 1)) }
  ];
  makePicker('dashCustomerPicker', custOptions, state.customer, true, (vals) => { state.customer = vals; apply(); });
  makePicker('dashCompareCustomerPicker', custOptions, state.compareCustomer, true, (vals) => { state.compareCustomer = vals; apply(); });
  makePicker('dashProductPicker', prodOptions, state.product, true, (vals) => { state.product = vals; state.productNames = null; apply(); });
  makePicker('dashCompareProductPicker', prodOptions, state.compareProduct, true, (vals) => { state.compareProduct = vals; apply(); });
  makePicker('dashPrimaryClassPicker', primaryClassOptions, state.primaryClass, false, (vals) => { state.primaryClass = vals; apply(); });
  makePicker('dashComparePrimaryClassPicker', primaryClassOptions, state.comparePrimaryClass, false, (vals) => { state.comparePrimaryClass = vals; apply(); });
  makePicker('dashCustomerTypePicker', customerTypeOptions, state.customerType, false, (vals) => { state.customerType = vals; apply(); });
  makePicker('dashCompareCustomerTypePicker', customerTypeOptions, state.compareCustomerType, false, (vals) => { state.compareCustomerType = vals; apply(); });
  makePicker('dashSuperTypePicker', superTypeOptions, state.superType, false, (vals) => { state.superType = vals; apply(); });
  makePicker('dashCompareSuperTypePicker', superTypeOptions, state.compareSuperType, false, (vals) => { state.compareSuperType = vals; apply(); });
  makePicker('dashDepartmentPicker', departmentOptions, state.department, false, (vals) => { state.department = vals; apply(); });
  makePicker('dashCompareDepartmentPicker', departmentOptions, state.compareDepartment, false, (vals) => { state.compareDepartment = vals; apply(); });
  makePicker('dashBoughtProductsPicker', prodOptions, state.boughtProducts, true, (vals) => { state.boughtProducts = vals; apply(); });
  makePicker('dashNotBoughtProductsPicker', prodOptions, state.notBoughtProducts, true, (vals) => { state.notBoughtProducts = vals; apply(); });
  makePicker('dashYearPicker', yearOptions, state.periodYears, false, (vals) => { state.periodYears = vals; state.periodMonths = dashCrossProductMonths(state.periodYears, state.periodMonthsSel); apply(); });
  makePicker('dashMonthPicker', monthOptions, state.periodMonthsSel, false, (vals) => { state.periodMonthsSel = vals; state.periodMonths = dashCrossProductMonths(state.periodYears, state.periodMonthsSel); apply(); }, monthQuickActions);
  makePicker('dashCompareYearPicker', yearOptions, state.compareYears, false, (vals) => { state.compareYears = vals; state.compareMonths = dashCrossProductMonths(state.compareYears, state.compareMonthsSel); apply(); });
  makePicker('dashCompareMonthPicker', monthOptions, state.compareMonthsSel, false, (vals) => { state.compareMonthsSel = vals; state.compareMonths = dashCrossProductMonths(state.compareYears, state.compareMonthsSel); apply(); }, monthQuickActions);

  cellClearBtns.customer.addEventListener('click', () => { state.customer = []; pickers.dashCustomerPicker.setSelected([]); apply(); });
  cellClearBtns.compareCustomer.addEventListener('click', () => { state.compareCustomer = []; pickers.dashCompareCustomerPicker.setSelected([]); apply(); });
  cellClearBtns.product.addEventListener('click', () => { state.product = []; state.productNames = null; pickers.dashProductPicker.setSelected([]); apply(); });
  cellClearBtns.compareProduct.addEventListener('click', () => { state.compareProduct = []; pickers.dashCompareProductPicker.setSelected([]); apply(); });
  cellClearBtns.primaryClass.addEventListener('click', () => { state.primaryClass = []; pickers.dashPrimaryClassPicker.setSelected([]); apply(); });
  cellClearBtns.comparePrimaryClass.addEventListener('click', () => { state.comparePrimaryClass = []; pickers.dashComparePrimaryClassPicker.setSelected([]); apply(); });
  cellClearBtns.customerType.addEventListener('click', () => { state.customerType = []; pickers.dashCustomerTypePicker.setSelected([]); apply(); });
  cellClearBtns.compareCustomerType.addEventListener('click', () => { state.compareCustomerType = []; pickers.dashCompareCustomerTypePicker.setSelected([]); apply(); });
  cellClearBtns.superType.addEventListener('click', () => { state.superType = []; pickers.dashSuperTypePicker.setSelected([]); apply(); });
  cellClearBtns.compareSuperType.addEventListener('click', () => { state.compareSuperType = []; pickers.dashCompareSuperTypePicker.setSelected([]); apply(); });
  cellClearBtns.department.addEventListener('click', () => { state.department = []; pickers.dashDepartmentPicker.setSelected([]); apply(); });
  cellClearBtns.compareDepartment.addEventListener('click', () => { state.compareDepartment = []; pickers.dashCompareDepartmentPicker.setSelected([]); apply(); });
  cellClearBtns.boughtProducts.addEventListener('click', () => { state.boughtProducts = []; pickers.dashBoughtProductsPicker.setSelected([]); apply(); });
  cellClearBtns.notBoughtProducts.addEventListener('click', () => { state.notBoughtProducts = []; pickers.dashNotBoughtProductsPicker.setSelected([]); apply(); });
  cellClearBtns.year.addEventListener('click', () => { state.periodYears = []; state.periodMonths = dashCrossProductMonths(state.periodYears, state.periodMonthsSel); pickers.dashYearPicker.setSelected([]); apply(); });
  cellClearBtns.month.addEventListener('click', () => { state.periodMonthsSel = []; state.periodMonths = dashCrossProductMonths(state.periodYears, state.periodMonthsSel); pickers.dashMonthPicker.setSelected([]); apply(); });
  cellClearBtns.compareYear.addEventListener('click', () => { state.compareYears = []; state.compareMonths = dashCrossProductMonths(state.compareYears, state.compareMonthsSel); pickers.dashCompareYearPicker.setSelected([]); apply(); });
  cellClearBtns.compareMonth.addEventListener('click', () => { state.compareMonthsSel = []; state.compareMonths = dashCrossProductMonths(state.compareYears, state.compareMonthsSel); pickers.dashCompareMonthPicker.setSelected([]); apply(); });

  // Lets a dashboard insight (see dashboard-top-insights.js) drive these same filters
  // directly when clicked — the customer/product/period/comparison-period it names,
  // applied exactly as the insight's own rule computed them.
  window.applyDashboardFiltersFromInsight = function (f) {
    f = f || {};
    state.customer = f.customerId ? [f.customerId] : [];
    state.product = f.productCode ? [f.productCode] : [];
    state.productNames = null;
    // The insight names absolute months, not a year/month picker selection — decompose
    // back into the two pickers (best-effort; see dashDecomposeMonths) so they display
    // what's actually applied, then recompute the cross product from that decomposition
    // rather than trusting f.periodMonths verbatim (it can differ slightly — e.g. a
    // rolling window that straddles a year boundary — from what the pickers can express).
    const periodDecomp = dashDecomposeMonths(f.periodMonths);
    state.periodYears = periodDecomp.years; state.periodMonthsSel = periodDecomp.months;
    state.periodMonths = dashCrossProductMonths(state.periodYears, state.periodMonthsSel);
    const compareDecomp = dashDecomposeMonths(f.compareMonths);
    state.compareYears = compareDecomp.years; state.compareMonthsSel = compareDecomp.months;
    state.compareMonths = dashCrossProductMonths(state.compareYears, state.compareMonthsSel);
    // An insight names a customer/product/period, never a segment or a comparison
    // axis — clear anything the user had set manually so it doesn't linger mixed in.
    state.primaryClass = []; state.customerType = []; state.superType = []; state.department = [];
    state.compareCustomer = []; state.compareProduct = []; state.comparePrimaryClass = []; state.compareCustomerType = []; state.compareSuperType = []; state.compareDepartment = [];
    state.boughtProducts = []; state.notBoughtProducts = [];
    pickers.dashCustomerPicker.setSelected(state.customer);
    pickers.dashProductPicker.setSelected(state.product);
    pickers.dashPrimaryClassPicker.setSelected([]);
    pickers.dashCustomerTypePicker.setSelected([]);
    pickers.dashSuperTypePicker.setSelected([]);
    pickers.dashDepartmentPicker.setSelected([]);
    pickers.dashCompareCustomerPicker.setSelected([]);
    pickers.dashCompareProductPicker.setSelected([]);
    pickers.dashComparePrimaryClassPicker.setSelected([]);
    pickers.dashCompareCustomerTypePicker.setSelected([]);
    pickers.dashCompareSuperTypePicker.setSelected([]);
    pickers.dashCompareDepartmentPicker.setSelected([]);
    pickers.dashBoughtProductsPicker.setSelected([]);
    pickers.dashNotBoughtProductsPicker.setSelected([]);
    pickers.dashYearPicker.setSelected(state.periodYears);
    pickers.dashMonthPicker.setSelected(state.periodMonthsSel);
    pickers.dashCompareYearPicker.setSelected(state.compareYears);
    pickers.dashCompareMonthPicker.setSelected(state.compareMonthsSel);
    document.dispatchEvent(new Event('click')); // closes any open picker panel
    apply();
  };

  // A peerGap insight ("customer X doesn't buy product Y, unlike most of its peers")
  // drills down differently from the other two types: the point isn't one customer,
  // it's the whole gap — every peer missing the product. So instead of narrowing to
  // the clicked customer, this sets customerType (the peer group the insight found,
  // when it was the customerType path that triggered it) + the insight's own trailing
  // window as the period, and puts the product into "לא קנו מוצר/ים" in the
  // purchase-cohort panel — which then lists every matching customer, not just the
  // one named in the insight.
  window.applyDashboardFiltersFromPeerGapInsight = function (f) {
    f = f || {};
    state.customer = []; state.product = []; state.productNames = null;
    state.primaryClass = []; state.superType = []; state.department = [];
    state.customerType = f.customerType ? [f.customerType] : [];
    pickers.dashCustomerPicker.setSelected([]);
    pickers.dashProductPicker.setSelected([]);
    pickers.dashPrimaryClassPicker.setSelected([]);
    pickers.dashSuperTypePicker.setSelected([]);
    pickers.dashDepartmentPicker.setSelected([]);
    pickers.dashCustomerTypePicker.setSelected(state.customerType);
    const periodDecomp = dashDecomposeMonths(f.periodMonths);
    state.periodYears = periodDecomp.years; state.periodMonthsSel = periodDecomp.months;
    state.periodMonths = dashCrossProductMonths(state.periodYears, state.periodMonthsSel);
    pickers.dashYearPicker.setSelected(state.periodYears);
    pickers.dashMonthPicker.setSelected(state.periodMonthsSel);
    // Comparison side isn't part of what the insight is about — cleared so it
    // doesn't linger mixed in from whatever the user had set manually before.
    state.compareCustomer = []; state.compareProduct = []; state.comparePrimaryClass = [];
    state.compareCustomerType = []; state.compareSuperType = []; state.compareDepartment = [];
    state.compareYears = []; state.compareMonthsSel = []; state.compareMonths = [];
    pickers.dashCompareCustomerPicker.setSelected([]);
    pickers.dashCompareProductPicker.setSelected([]);
    pickers.dashComparePrimaryClassPicker.setSelected([]);
    pickers.dashCompareCustomerTypePicker.setSelected([]);
    pickers.dashCompareSuperTypePicker.setSelected([]);
    pickers.dashCompareDepartmentPicker.setSelected([]);
    pickers.dashCompareYearPicker.setSelected([]);
    pickers.dashCompareMonthPicker.setSelected([]);
    // The whole point of this click: surface the cohort in the purchase-cohort
    // table/export, via the same "לא קנו מוצר/ים" field a user would fill by hand.
    state.boughtProducts = [];
    state.notBoughtProducts = f.productCode ? [f.productCode] : [];
    pickers.dashBoughtProductsPicker.setSelected([]);
    pickers.dashNotBoughtProductsPicker.setSelected(state.notBoughtProducts);
    document.dispatchEvent(new Event('click'));
    apply();
  };

  // Lets a clicked bar/slice on one of the breakdown or ranked charts (see
  // dashboard-sales-summary.js) narrow the dashboard's own filters directly, instead
  // of navigating away to the full sales report — e.g. clicking the "יין ואלכוהול"
  // bar in the superType breakdown sets the superType filter to that value. Only
  // dimensions the filter table actually has a field for are wired this way.
  const DASH_CLICK_DIMENSIONS = {
    customer: { state: 'customer', compareState: 'compareCustomer', picker: 'dashCustomerPicker', comparePicker: 'dashCompareCustomerPicker' },
    product: { state: 'product', compareState: 'compareProduct', picker: 'dashProductPicker', comparePicker: 'dashCompareProductPicker' },
    superType: { state: 'superType', compareState: 'compareSuperType', picker: 'dashSuperTypePicker', comparePicker: 'dashCompareSuperTypePicker' },
    department: { state: 'department', compareState: 'compareDepartment', picker: 'dashDepartmentPicker', comparePicker: 'dashCompareDepartmentPicker' }
  };
  window.applyDashboardFilterByDimension = function (dimension, value, isCompare) {
    const map = DASH_CLICK_DIMENSIONS[dimension];
    if (!map || value == null) return;
    const stateKey = isCompare ? map.compareState : map.state;
    const pickerId = isCompare ? map.comparePicker : map.picker;
    state[stateKey] = [value];
    if (stateKey === 'product') state.productNames = null;
    pickers[pickerId].setSelected(state[stateKey]);
    document.dispatchEvent(new Event('click'));
    apply();
  };

  // Same idea for a clicked month bar on either trend chart — sets the year/month
  // pickers to exactly that one month (primary or comparison side).
  window.applyDashboardPeriodFilter = function (year, month, isCompare) {
    const yearStr = String(year), monthStr = String(month);
    if (isCompare) {
      state.compareYears = [yearStr]; state.compareMonthsSel = [monthStr];
      state.compareMonths = dashCrossProductMonths(state.compareYears, state.compareMonthsSel);
      pickers.dashCompareYearPicker.setSelected(state.compareYears);
      pickers.dashCompareMonthPicker.setSelected(state.compareMonthsSel);
    } else {
      state.periodYears = [yearStr]; state.periodMonthsSel = [monthStr];
      state.periodMonths = dashCrossProductMonths(state.periodYears, state.periodMonthsSel);
      pickers.dashYearPicker.setSelected(state.periodYears);
      pickers.dashMonthPicker.setSelected(state.periodMonthsSel);
    }
    document.dispatchEvent(new Event('click'));
    apply();
  };

  // Fires the one initial dashboard-data fetch for this whole page — loadDashboardSalesSummary
  // must never be called a second, independent time elsewhere with a narrower filter
  // set (a stale duplicate of that kind previously raced this one and silently
  // dropped whichever filters it didn't know about).
  apply();
}

initDashboardFilters();
