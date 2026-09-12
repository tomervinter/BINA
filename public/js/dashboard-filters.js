// Combined dashboard filter controls: the quick customer search plus a period and
// comparison-period picker, all synced to the URL query string and driving one call
// to loadDashboardSalesSummary (dashboard-sales-summary.js) whenever any of them
// change, so a refresh or a shared link reproduces the exact same filtered view.
async function initDashboardFilters() {
  const custInput = document.getElementById('dashCustomerSearch');
  if (!custInput) return;
  const custDatalist = document.getElementById('dashCustomerList');
  const custClearBtn = document.getElementById('dashClearCustomerFilter');
  const periodFromEl = document.getElementById('dashPeriodFrom');
  const periodToEl = document.getElementById('dashPeriodTo');
  const compareFromEl = document.getElementById('dashCompareFrom');
  const compareToEl = document.getElementById('dashCompareTo');
  const periodClearBtn = document.getElementById('dashClearPeriodFilter');
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
    periodFrom: urlParams.get('periodFrom') || '',
    periodTo: urlParams.get('periodTo') || '',
    compareFrom: urlParams.get('compareFrom') || '',
    compareTo: urlParams.get('compareTo') || ''
  };

  function syncUrl() {
    const url = new URL(window.location.href);
    ['customer', 'periodFrom', 'periodTo', 'compareFrom', 'compareTo'].forEach((key) => {
      if (state[key]) url.searchParams.set(key, state[key]); else url.searchParams.delete(key);
    });
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
    periodFromEl.value = state.periodFrom;
    periodToEl.value = state.periodTo;
    compareFromEl.value = state.compareFrom;
    compareToEl.value = state.compareTo;
    const periodActive = !!(state.periodFrom && state.periodTo);
    periodClearBtn.style.display = periodActive ? '' : 'none';

    const parts = [];
    if (state.customer && nameByCode[state.customer]) parts.push('הלקוח ' + nameByCode[state.customer]);
    if (periodActive) {
      parts.push('התקופה ' + state.periodFrom + ' עד ' + state.periodTo +
        (state.compareFrom && state.compareTo ? ' (בהשוואה ל-' + state.compareFrom + ' עד ' + state.compareTo + ')' : ''));
    }
    subtitle.textContent = parts.length
      ? ('הדשבורד מציג כרגע רק את הנתונים של ' + parts.join(' ו') + '.')
      : 'כברירת מחדל, כל הנתונים בדשבורד מציגים את כלל הלקוחות וכל התקופות. הקלידו שם לקוח ו/או בחרו תקופה כדי לסנן.';
  }

  function apply() {
    syncUrl();
    updateUi();
    loadDashboardSalesSummary(state);
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

  [periodFromEl, periodToEl, compareFromEl, compareToEl].forEach((el) => {
    el.addEventListener('change', () => {
      state.periodFrom = periodFromEl.value;
      state.periodTo = periodToEl.value;
      state.compareFrom = compareFromEl.value;
      state.compareTo = compareToEl.value;
      apply();
    });
  });
  periodClearBtn.addEventListener('click', () => {
    state.periodFrom = ''; state.periodTo = ''; state.compareFrom = ''; state.compareTo = '';
    apply();
  });

  updateUi();
}

initDashboardFilters();
