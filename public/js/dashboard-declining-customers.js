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
  (function wirePanelToggle() {
    const btn = document.getElementById('dashDecliningToggleBtn');
    const box = document.getElementById('dashDecliningPanelBox');
    if (!btn || !box) return;
    btn.addEventListener('click', () => {
      const isOpen = box.style.display !== 'none';
      box.style.display = isOpen ? 'none' : '';
      btn.setAttribute('aria-expanded', String(!isOpen));
      btn.classList.toggle('active', !isOpen);
    });
  })();

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
    setList('superType', f.superType);
    setList('department', f.department);
    return qs.toString();
  }

  function updateSubtitle(minPct, yearLabel, priorYearLabel, lastCompletedMonthLabel) {
    const base = 'לקוחות עם ירידה במחזור מצטבר';
    const periodPhrase = yearLabel ? (' מינואר עד ' + lastCompletedMonthLabel + ' לעומת אותה תקופה ב-' + priorYearLabel) : (' השנה מול אשתקד');
    const pctPhrase = minPct > 0 ? (' של לפחות ' + minPct + '%') : '';
    subtitleEl.textContent = base + periodPhrase + pctPhrase + ', ולכל לקוח — המוצרים שירדו אצלו.';
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
    countEl.textContent = data.customers.length + ' לקוחות תואמים';
    bodyEl.innerHTML = data.customers.map((c) => {
      const productsText = c.declinedProducts.join(', ');
      return '<tr><td>' + Layout.escapeHtml(c.customerNumber) + '</td><td>' + Layout.escapeHtml(c.name) + '</td><td>' +
        Layout.escapeHtml(c.centralCustomer || '') + '</td><td>' + Layout.escapeHtml(c.primaryClass || '') + '</td><td>' +
        Layout.escapeHtml(c.customerType || '') + '</td><td>' + c.declinePct + '</td><td title="' + Layout.escapeHtml(productsText) + '">' + Layout.escapeHtml(productsText || '—') + '</td></tr>';
    }).join('') || '<tr><td colspan="7">אין לקוחות תואמים</td></tr>';
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

  window.refreshDashDecliningFilters = function (state) {
    filterState = state;
    if (expanded) collapse();
  };

  updateSubtitle(Math.max(0, parseFloat(minPctInput.value) || 0), null, null, null);
  if (window.dashMarkReady) window.dashMarkReady();
}
