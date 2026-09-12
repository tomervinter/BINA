// Quick "jump to customer profile" search on the dashboard — same datalist-search
// pattern used in product-substitutes-page.js.
async function initDashboardCustomerSearch() {
  const input = document.getElementById('dashCustomerSearch');
  if (!input) return;
  const res = await fetch('/api/customers?pageSize=all', { credentials: 'include' });
  const customers = res.ok ? (await res.json()).rows : [];
  const byDisplay = {};
  customers.forEach((c) => { byDisplay[c.customerNumber + ' — ' + c.name] = c.customerNumber; });

  const datalist = document.getElementById('dashCustomerList');
  datalist.innerHTML = Object.keys(byDisplay).map((d) => '<option value="' + Layout.escapeHtml(d) + '"></option>').join('');

  function goToCustomer() {
    const v = input.value.trim();
    const code = byDisplay[v];
    if (code) window.location.href = 'reports-full-sales.html?customerNumber=' + encodeURIComponent(code);
  }
  input.addEventListener('change', goToCustomer);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') goToCustomer(); });
}

initDashboardCustomerSearch();
