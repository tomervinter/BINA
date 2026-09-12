// Shared sortable/filterable table with CSV ("Excel") export, reused by every
// list/report page instead of duplicating table wiring per page.
function createDataTable(container, columns, rows, opts) {
  opts = opts || {};
  const originalColumns = columns.slice();
  const state = { filters: Object.assign({}, opts.initialFilters || {}), sortCol: opts.defaultSortCol || null, sortDir: opts.defaultSortDir || 'asc', focusedCol: null };

  function cellValue(col, row) {
    return col.render ? col.render(row) : row[col.key];
  }

  function filteredSorted() {
    let out = rows.filter((row) => columns.every((col) => {
      const f = state.filters[col.key];
      if (!f) return true;
      const val = col.filterValue ? col.filterValue(row) : cellValue(col, row);
      return String(val == null ? '' : val).toLowerCase().indexOf(f.toLowerCase()) !== -1;
    }));
    if (state.sortCol) {
      const col = columns.find((c) => c.key === state.sortCol);
      if (col) {
        out = out.slice().sort((a, b) => {
          let va = col.sortValue ? col.sortValue(a) : cellValue(col, a);
          let vb = col.sortValue ? col.sortValue(b) : cellValue(col, b);
          if (va == null) va = '';
          if (vb == null) vb = '';
          const cmp = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb), 'he');
          return state.sortDir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return out;
  }

  function exportCsv() {
    if (opts.exportUrl) { window.location.href = opts.exportUrl; return; }
    const data = filteredSorted();
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const header = columns.map((c) => esc(c.label)).join(',');
    const lines = data.map((row) => columns.map((c) => esc(c.exportValue ? c.exportValue(row) : cellValue(c, row))).join(','));
    const csv = '﻿' + [header].concat(lines).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (opts.exportFilename || 'export') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function reorderColumns(newCols) {
    columns = newCols;
    saveColumnOrder(opts.tableKey, columns);
    render();
  }

  function render() {
    const data = filteredSorted();
    let html = '<div class="table-head-row"><div class="table-head-right"></div><div class="table-head-left"><span class="count-pill">' + data.length.toLocaleString('he-IL') + ' רשומות</span></div></div>';
    html += '<div class="toolbar">' +
      (opts.tableKey ? '<button class="btn btn-ghost btn-sm js-resetColOrder" type="button">איפוס סדר עמודות</button>' : '') +
      '<span class="spacer"></span><button class="btn btn-success btn-sm js-exportBtn" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"></rect><path d="M3.5 9.5h17M3.5 14.5h17M9.5 3.5v17"></path></svg>ייצוא לאקסל</button></div>';
    html += '<div class="table-scroll"><table><thead><tr>';
    columns.forEach((col) => {
      const sortCls = state.sortCol === col.key ? (' sorted-' + state.sortDir) : '';
      html += '<th><span class="th-inner js-sortBtn' + sortCls + '" data-col="' + col.key + '"><span class="th-label">' + Layout.escapeHtml(col.label) + '</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg></span></th>';
    });
    html += '</tr><tr class="filter-row">';
    columns.forEach((col) => {
      html += '<td><input class="filter-input js-filterInput" data-col="' + col.key + '" placeholder="סנן..." value="' + Layout.escapeHtml(state.filters[col.key] || '') + '"></td>';
    });
    html += '</tr></thead><tbody>';
    if (!data.length) {
      html += '<tr><td colspan="' + columns.length + '" class="table-empty">אין נתונים להצגה</td></tr>';
    } else {
      data.forEach((row, i) => {
        const rid = opts.rowId ? opts.rowId(row) : String(i);
        html += '<tr' + (opts.onRowClick ? ' class="row-clickable"' : '') + ' data-row-id="' + Layout.escapeHtml(rid) + '">';
        columns.forEach((col) => {
          const v = cellValue(col, row);
          html += '<td>' + (col.html ? v : Layout.escapeHtml(v == null ? '' : v)) + '</td>';
        });
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;

    wireColumnDragReorder(container.querySelector('thead tr'), columns, reorderColumns);
    container.querySelector('.js-exportBtn').addEventListener('click', exportCsv);
    const resetBtn = container.querySelector('.js-resetColOrder');
    if (resetBtn) resetBtn.addEventListener('click', async () => {
      await resetColumnOrder(opts.tableKey);
      const order = await loadColumnOrder(opts.tableKey);
      columns = applyColumnOrder(originalColumns, order);
      render();
    });
    container.querySelectorAll('.js-sortBtn').forEach((el) => {
      el.addEventListener('click', () => {
        const col = el.getAttribute('data-col');
        if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortCol = col; state.sortDir = 'asc'; }
        render();
      });
    });
    container.querySelectorAll('.js-filterInput').forEach((el) => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('input', () => {
        state.filters[el.getAttribute('data-col')] = el.value;
        state.focusedCol = el.getAttribute('data-col');
        render();
      });
    });
    if (opts.onRowClick) {
      container.querySelectorAll('tr.row-clickable').forEach((tr) => {
        tr.addEventListener('click', () => {
          const rid = tr.getAttribute('data-row-id');
          const row = data.find((r, i) => (opts.rowId ? opts.rowId(r) : String(i)) === rid);
          if (row) opts.onRowClick(row);
        });
      });
    }
    if (state.focusedCol) {
      const toFocus = container.querySelector('.js-filterInput[data-col="' + state.focusedCol + '"]');
      if (toFocus) { toFocus.focus(); const v = toFocus.value; toFocus.setSelectionRange(v.length, v.length); }
    }
  }

  (async () => {
    if (opts.tableKey) columns = applyColumnOrder(originalColumns, await loadColumnOrder(opts.tableKey));
    render();
  })();
  return { refresh: (newRows) => { rows = newRows; render(); } };
}
