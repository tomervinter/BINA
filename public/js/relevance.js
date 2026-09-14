// Product × holiday/season relevance matrix — manual classification only (no
// auto-detection or category suggestions). Any product with an unclassified cell
// gets its whole row flagged in red so it's obvious what still needs attention,
// including newly-uploaded products that have never been classified yet.
// Rows can be multi-selected and bulk-assigned to every holiday or every season
// in one click, instead of clicking each cell individually.
async function initRelevancePage() {
  const data = await Layout.init('relevance');
  if (!data) return;

  const container = document.getElementById('matrixContainer');
  let searchTerm = '';
  let onlyUnclassified = false;
  let payload = { events: [], matrix: [] };
  const selected = new Set();
  // The plain text/categorical product columns — each gets its own filter-row input
  // and a clickable, sortable header (same th-inner/sorted-asc/sorted-desc pattern
  // table.js uses elsewhere), independent of both the global search box above and
  // the toggle-cell holiday/season columns, which stay as they were.
  const RELEVANCE_TABLE_KEY = 'relevance';
  const originalColumns = [
    { key: 'productCode', label: 'קוד פריט' },
    { key: 'productName', label: 'שם פריט', cls: 'rel-product-name' },
    { key: 'superType', label: 'טיפוס על' },
    { key: 'type', label: 'טיפוס' },
    { key: 'department', label: 'מחלקה' }
  ];
  let columns = originalColumns.slice();
  const state = { sortCol: 'productName', sortDir: 'asc', filters: {}, focusedCol: null };

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

  function visibleRows() {
    let rows = payload.matrix.slice();
    const term = searchTerm.trim().toLowerCase();
    if (term) rows = rows.filter((r) => (r.productName || '').toLowerCase().includes(term) || (r.productCode || '').toLowerCase().includes(term));
    if (onlyUnclassified) rows = rows.filter((r) => unknownCount(r) > 0);
    columns.forEach((col) => {
      const f = (state.filters[col.key] || '').trim().toLowerCase();
      if (!f) return;
      rows = rows.filter((r) => String(r[col.key] || '').toLowerCase().indexOf(f) !== -1);
    });
    rows.sort((a, b) => {
      const cmp = String(a[state.sortCol] || '').localeCompare(String(b[state.sortCol] || ''), 'he');
      return state.sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }

  async function bulkAssign(source) {
    if (!selected.size) { alert('יש לסמן קודם לפחות שורה אחת (מוצר).'); return; }
    const names = payload.events.filter((ev) => ev.source === source).map((ev) => ev.name);
    if (!names.length) return;
    const label = source === 'holiday' ? 'כל החגים' : 'כל העונות';
    if (!confirm('לסמן ' + selected.size.toLocaleString('he-IL') + ' מוצרים נבחרים כרלוונטיים ל' + label + '?')) return;
    const writes = [];
    selected.forEach((productCode) => { names.forEach((name) => { writes.push({ productCode, source, name }); }); });
    await Promise.all(writes.map((w) =>
      fetch('/api/relevance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ...w, value: true }) })
    ));
    await load();
  }

  // Bulk-mark as "לא רלוונטי" (✗) — same PUT the per-cell cycle already uses for an
  // explicit "not relevant" classification (value:false), just applied to every
  // selected product's cells for every holiday/season at once. Distinct from clearing
  // to "?" unclassified: this is a considered "no" answer, not an unset one.
  async function bulkMarkIrrelevant(source) {
    if (!selected.size) { alert('יש לסמן קודם לפחות שורה אחת (מוצר).'); return; }
    const names = payload.events.filter((ev) => ev.source === source).map((ev) => ev.name);
    if (!names.length) return;
    const label = source === 'holiday' ? 'כל החגים' : 'כל העונות';
    if (!confirm('לסמן ' + selected.size.toLocaleString('he-IL') + ' מוצרים נבחרים כלא רלוונטיים ל' + label + '?')) return;
    const writes = [];
    selected.forEach((productCode) => { names.forEach((name) => { writes.push({ productCode, source, name }); }); });
    await Promise.all(writes.map((w) =>
      fetch('/api/relevance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ...w, value: false }) })
    ));
    await load();
  }

  function reorderColumns(newCols) {
    columns = newCols;
    saveColumnOrder(RELEVANCE_TABLE_KEY, columns);
    render();
  }

  function simpleCellValue(col, row) {
    if (col.key === 'productName') return row.productName || row.productCode;
    return row[col.key] || '';
  }

  function render() {
    const events = payload.events;
    if (!events.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">יש להגדיר קודם חגים ו/או עונות בניהול חגים / ניהול עונתיות.</p>';
      return;
    }

    const rows = visibleRows();
    const visibleCodes = rows.map((r) => r.productCode);
    const allVisibleSelected = visibleCodes.length > 0 && visibleCodes.every((c) => selected.has(c));
    const hasHolidays = events.some((ev) => ev.source === 'holiday');
    const hasSeasons = events.some((ev) => ev.source === 'season');

    let html = '<div class="rel-legend">' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-manual" style="pointer-events:none;">✓</span> רלוונטי</span>' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-manual-no" style="pointer-events:none;">✗</span> לא רלוונטי</span>' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-unknown" style="pointer-events:none;">?</span> טרם סווג (השורה מסומנת באדום)</span>' +
      '</div>';

    html += '<div class="table-head-row"><div class="table-head-right"></div><div class="table-head-left"><span class="count-pill">' + rows.length.toLocaleString('he-IL') + ' מוצרים' + (selected.size ? ' · ' + selected.size.toLocaleString('he-IL') + ' נבחרו' : '') + '</span></div></div>';
    html += '<div class="toolbar" style="flex-wrap:wrap;">' +
      '<button class="btn btn-ghost btn-sm js-relOnlyUnclassified' + (onlyUnclassified ? ' active' : '') + '" type="button">הצג רק מוצרים לא מסווגים</button>';
    if (hasHolidays) html += '<button class="btn btn-primary btn-sm js-relBulkHolidays" type="button">סמן נבחרים כרלוונטיים לכל החגים</button>';
    if (hasSeasons) html += '<button class="btn btn-primary btn-sm js-relBulkSeasons" type="button">סמן נבחרים כרלוונטיים לכל העונות</button>';
    if (hasHolidays) html += '<button class="btn btn-ghost btn-sm js-relBulkIrrelevantHolidays" type="button">סמן נבחרים כלא רלוונטיים לכל החגים</button>';
    if (hasSeasons) html += '<button class="btn btn-ghost btn-sm js-relBulkIrrelevantSeasons" type="button">סמן נבחרים כלא רלוונטיים לכל העונות</button>';
    if (selected.size) html += '<button class="btn btn-ghost btn-sm js-relClearSelection" type="button">נקה בחירה</button>';
    html += '<button class="btn btn-ghost btn-sm js-resetColOrder" type="button">איפוס סדר עמודות</button>';
    html += '<span class="spacer"></span>' +
      '<input type="text" class="filter-input js-relSearch" placeholder="חיפוש לפי שם מוצר / קוד פריט..." style="max-width:220px;" value="' + Layout.escapeHtml(searchTerm) + '">' +
      '</div>';

    html += '<div class="rel-matrix-scroll"><table class="rel-matrix"><thead><tr><th><input type="checkbox" class="js-relSelectAll"' + (allVisibleSelected ? ' checked' : '') + '></th>';
    columns.forEach((col) => {
      const sortCls = state.sortCol === col.key ? (' sorted-' + state.sortDir) : '';
      html += '<th class="js-relSimpleTh' + (col.cls ? ' ' + col.cls : '') + '"><span class="th-inner js-relSortBtn' + sortCls + '" data-col="' + col.key + '"><span class="th-label">' + Layout.escapeHtml(col.label) + '</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg></span></th>';
    });
    html += '<th>סטטוס</th>';
    events.forEach((ev) => { html += '<th>' + Layout.escapeHtml(ev.name) + '<br><span style="font-weight:400;color:var(--text-faint);">(' + (ev.source === 'holiday' ? 'חג' : 'עונה') + ')</span></th>'; });
    html += '</tr><tr class="filter-row"><td></td>';
    columns.forEach((col) => {
      html += '<td><input class="filter-input js-relFilterInput" data-col="' + col.key + '" placeholder="סנן..." value="' + Layout.escapeHtml(state.filters[col.key] || '') + '"></td>';
    });
    html += '<td></td>';
    events.forEach(() => { html += '<td></td>'; });
    html += '</tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="' + (7 + events.length) + '" class="table-empty">אין מוצרים להצגה</td></tr>';
    } else {
      rows.forEach((row) => {
        const unknown = unknownCount(row);
        const statusHtml = unknown > 0
          ? '<span class="pill pill-red">⚠ ' + unknown + ' לא מסווג' + (unknown > 1 ? 'ים' : '') + '</span>'
          : '<span class="pill pill-green">✓ מסווג</span>';
        html += '<tr' + (unknown > 0 ? ' class="rel-row-unclassified"' : '') + '>' +
          '<td><input type="checkbox" class="js-relRowCheck" data-product="' + Layout.escapeHtml(row.productCode) + '"' + (selected.has(row.productCode) ? ' checked' : '') + '></td>';
        columns.forEach((col) => {
          html += '<td' + (col.cls ? ' class="' + col.cls + '"' : '') + '>' + Layout.escapeHtml(simpleCellValue(col, row)) + '</td>';
        });
        html += '<td>' + statusHtml + '</td>';
        row.cells.forEach((cell) => { html += '<td class="rel-cell">' + cellControl(row, cell) + '</td>'; });
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Only the plain text/categorical columns are reorderable — the leading checkbox
    // column, the status column, and the per-holiday/season toggle columns stay fixed,
    // so drag-reorder is wired on just those <th> elements (matched via .js-relSimpleTh)
    // rather than the whole header row.
    wireColumnDragReorder({ children: Array.from(container.querySelectorAll('.js-relSimpleTh')) }, columns, reorderColumns);
    container.querySelector('.js-resetColOrder').addEventListener('click', async () => {
      await resetColumnOrder(RELEVANCE_TABLE_KEY);
      columns = applyColumnOrder(originalColumns, await loadColumnOrder(RELEVANCE_TABLE_KEY));
      render();
    });
    container.querySelector('.js-relOnlyUnclassified').addEventListener('click', () => { onlyUnclassified = !onlyUnclassified; render(); });
    container.querySelector('.js-relSearch').addEventListener('input', (e) => { searchTerm = e.target.value; render(); });
    container.querySelectorAll('.js-relSortBtn').forEach((el) => {
      el.addEventListener('click', () => {
        const col = el.getAttribute('data-col');
        if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortCol = col; state.sortDir = 'asc'; }
        render();
      });
    });
    container.querySelectorAll('.js-relFilterInput').forEach((el) => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('input', () => {
        state.filters[el.getAttribute('data-col')] = el.value;
        state.focusedCol = el.getAttribute('data-col');
        render();
      });
    });
    const holidaysBtn = container.querySelector('.js-relBulkHolidays');
    if (holidaysBtn) holidaysBtn.addEventListener('click', () => bulkAssign('holiday'));
    const seasonsBtn = container.querySelector('.js-relBulkSeasons');
    if (seasonsBtn) seasonsBtn.addEventListener('click', () => bulkAssign('season'));
    const irrelevantHolidaysBtn = container.querySelector('.js-relBulkIrrelevantHolidays');
    if (irrelevantHolidaysBtn) irrelevantHolidaysBtn.addEventListener('click', () => bulkMarkIrrelevant('holiday'));
    const irrelevantSeasonsBtn = container.querySelector('.js-relBulkIrrelevantSeasons');
    if (irrelevantSeasonsBtn) irrelevantSeasonsBtn.addEventListener('click', () => bulkMarkIrrelevant('season'));
    const clearBtn = container.querySelector('.js-relClearSelection');
    if (clearBtn) clearBtn.addEventListener('click', () => { selected.clear(); render(); });

    container.querySelector('.js-relSelectAll').addEventListener('change', (e) => {
      if (e.target.checked) visibleCodes.forEach((c) => selected.add(c));
      else visibleCodes.forEach((c) => selected.delete(c));
      render();
    });
    container.querySelectorAll('.js-relRowCheck').forEach((cb) => {
      cb.addEventListener('change', () => {
        const pid = cb.getAttribute('data-product');
        if (cb.checked) selected.add(pid); else selected.delete(pid);
        render();
      });
    });

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

    if (state.focusedCol) {
      const toFocus = container.querySelector('.js-relFilterInput[data-col="' + state.focusedCol + '"]');
      if (toFocus) { toFocus.focus(); const v = toFocus.value; toFocus.setSelectionRange(v.length, v.length); }
    }
  }

  columns = applyColumnOrder(originalColumns, await loadColumnOrder(RELEVANCE_TABLE_KEY));
  await load();
}
