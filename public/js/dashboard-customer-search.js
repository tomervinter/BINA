// Dashboard-wide customer filter: picking a customer here re-scopes every chart and
// KPI on the dashboard (via loadDashboardSalesSummary, from dashboard-sales-summary.js)
// to that customer alone, instead of navigating away. The filter is reflected in the
// URL (?customer=<number>) so it survives a refresh and can be bookmarked/shared, and
// is undone with the "הצג את כל הלקוחות" button.
async function initDashboardCustomerSearch() {
  const input = document.getElementById('dashCustomerSearch');
  if (!input) return;
  const res = await fetch('/api/customers?pageSize=all', { credentials: 'include' });
  const customers = res.ok ? (await res.json()).rows : [];
  const byDisplay = {};
  const nameByCode = {};
  customers.forEach((c) => {
    byDisplay[c.customerNumber + ' — ' + c.name] = c.customerNumber;
    nameByCode[c.customerNumber] = c.name;
  });

  const datalist = document.getElementById('dashCustomerList');
  datalist.innerHTML = Object.keys(byDisplay).map((d) => '<option value="' + Layout.escapeHtml(d) + '"></option>').join('');

  const clearBtn = document.getElementById('dashClearCustomerFilter');
  const subtitle = document.getElementById('dashFilterSubtitle');

  function applyFilter(code, pushUrl) {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('customer', code); else url.searchParams.delete('customer');
    if (pushUrl) window.history.replaceState(null, '', url.pathname + url.search);

    if (code && nameByCode[code]) {
      input.value = code + ' — ' + nameByCode[code];
      clearBtn.style.display = '';
      subtitle.textContent = 'הדשבורד מציג כרגע רק את הנתונים של ' + nameByCode[code] + '.';
    } else {
      input.value = '';
      clearBtn.style.display = 'none';
      subtitle.textContent = 'כברירת מחדל, כל הנתונים בדשבורד מציגים את כלל הלקוחות. הקלידו שם לקוח כדי להציג כאן רק את הנתונים שלו.';
    }
    loadDashboardSalesSummary(code || undefined);
  }

  function selectFromInput() {
    const v = input.value.trim();
    const code = byDisplay[v];
    if (code) applyFilter(code, true);
  }
  input.addEventListener('change', selectFromInput);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectFromInput(); });
  clearBtn.addEventListener('click', () => applyFilter(null, true));

  const initialCode = new URLSearchParams(window.location.search).get('customer');
  if (initialCode && nameByCode[initialCode]) {
    input.value = initialCode + ' — ' + nameByCode[initialCode];
    clearBtn.style.display = '';
    subtitle.textContent = 'הדשבורד מציג כרגע רק את הנתונים של ' + nameByCode[initialCode] + '.';
  }
}

initDashboardCustomerSearch();
