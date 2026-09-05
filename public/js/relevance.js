// Product × holiday/season relevance matrix — manual classification only (no
// auto-detection or category suggestions). Any product with an unclassified cell
// gets its whole row flagged in red so it's obvious what still needs attention,
// including newly-uploaded products that have never been classified yet.
async function initRelevancePage() {
  const data = await Layout.init('relevance');
  if (!data) return;

  const container = document.getElementById('matrixContainer');
  let searchTerm = '';
  let onlyUnclassified = false;
  let payload = { events: [], matrix: [] };

  function cellControl(row, cell) {
    const st = cell.state;
    let cls, icon, title;
    if (st.manual) {
      cls = st.value ? 'rel-dot-manual' : 'rel-dot-manual-no';
      icon = st.value ? '✓' : '✗';
      title = st.value ? 'סומן ידנית: רלוונטי (לחצו לשינוי)' : 'סומן ידנית: לא רלוונטי (לחצו לאיפוס)';
    } else {
      cls = 'rel-dot-unknown';
      icon = '?';
      title = 'טרם סווג — יש לסמן ידנית';
    }
    return '<button type="button" class="rel-cell-btn js-relBtn ' + cls + '" title="' + Layout.escapeHtml(title) +
      '" data-product="' + Layout.escapeHtml(row.productCode) + '" data-source="' + cell.source + '" data-name="' + Layout.escapeHtml(cell.name) +
      '" data-manual="' + (st.manual ? '1' : '0') + '" data-value="' + (st.value ? '1' : '0') + '">' + icon + '</button>';
  }

  function unknownCount(row) {
    return row.cells.filter((c) => !c.state.manual).length;
  }

  async function load() {
    const res = await fetch('/api/relevance/matrix', { credentials: 'include' });
    payload = res.ok ? await res.json() : { events: [], matrix: [] };
    render();
  }

  function render() {
    const events = payload.events;
    if (!events.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">יש להגדיר קודם חגים ו/או עונות בניהול חגים / ניהול עונתיות.</p>';
      return;
    }

    let rows = payload.matrix.slice().sort((a, b) => String(a.productName || '').localeCompare(String(b.productName || ''), 'he'));
    const term = searchTerm.trim().toLowerCase();
    if (term) rows = rows.filter((r) => (r.productName || '').toLowerCase().includes(term) || (r.productCode || '').toLowerCase().includes(term));
    if (onlyUnclassified) rows = rows.filter((r) => unknownCount(r) > 0);

    let html = '<div class="rel-legend">' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-manual" style="pointer-events:none;">✓</span> רלוונטי</span>' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-manual-no" style="pointer-events:none;">✗</span> לא רלוונטי</span>' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-unknown" style="pointer-events:none;">?</span> טרם סווג (השורה מסומנת באדום)</span>' +
      '</div>';

    html += '<div class="table-head-row"><div class="table-head-right"></div><div class="table-head-left"><span class="count-pill">' + rows.length.toLocaleString('he-IL') + ' מוצרים</span></div></div>';
    html += '<div class="toolbar" style="flex-wrap:wrap;">' +
      '<button class="btn btn-ghost btn-sm js-relOnlyUnclassified' + (onlyUnclassified ? ' active' : '') + '" type="button">הצג רק מוצרים לא מסווגים</button>' +
      '<span class="spacer"></span>' +
      '<input type="text" class="filter-input js-relSearch" placeholder="חיפוש לפי שם מוצר / קוד פריט..." style="max-width:220px;" value="' + Layout.escapeHtml(searchTerm) + '">' +
      '</div>';

    html += '<div class="rel-matrix-scroll"><table class="rel-matrix"><thead><tr><th>קוד פריט</th><th class="rel-product-name">שם פריט</th><th>סטטוס</th>';
    events.forEach((ev) => { html += '<th>' + Layout.escapeHtml(ev.name) + '<br><span style="font-weight:400;color:var(--text-faint);">(' + (ev.source === 'holiday' ? 'חג' : 'עונה') + ')</span></th>'; });
    html += '</tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="' + (3 + events.length) + '" class="table-empty">אין מוצרים להצגה</td></tr>';
    } else {
      rows.forEach((row) => {
        const unknown = unknownCount(row);
        const statusHtml = unknown > 0
          ? '<span class="pill pill-red">⚠ ' + unknown + ' לא מסווג' + (unknown > 1 ? 'ים' : '') + '</span>'
          : '<span class="pill pill-green">✓ מסווג</span>';
        html += '<tr' + (unknown > 0 ? ' class="rel-row-unclassified"' : '') + '><td>' + Layout.escapeHtml(row.productCode) + '</td><td class="rel-product-name">' + Layout.escapeHtml(row.productName || row.productCode) + '</td><td>' + statusHtml + '</td>';
        row.cells.forEach((cell) => { html += '<td class="rel-cell">' + cellControl(row, cell) + '</td>'; });
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelector('.js-relOnlyUnclassified').addEventListener('click', () => { onlyUnclassified = !onlyUnclassified; render(); });
    container.querySelector('.js-relSearch').addEventListener('input', (e) => { searchTerm = e.target.value; render(); });

    container.querySelectorAll('.js-relBtn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const productCode = btn.getAttribute('data-product');
        const source = btn.getAttribute('data-source');
        const name = btn.getAttribute('data-name');
        const manual = btn.getAttribute('data-manual') === '1';
        const value = btn.getAttribute('data-value') === '1';
        // Cycle: unclassified -> relevant -> not relevant -> unclassified.
        if (!manual) {
          await fetch('/api/relevance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ productCode, source, name, value: true }) });
        } else if (value) {
          await fetch('/api/relevance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ productCode, source, name, value: false }) });
        } else {
          await fetch('/api/relevance', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ productCode, source, name }) });
        }
        await load();
      });
    });
  }

  await load();
}
