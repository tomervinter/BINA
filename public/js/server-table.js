// Server-paginated table for large data sets (sales/inventory can run into hundreds of
// thousands of rows) — sorting and filtering happen in the database via query params;
// the browser only ever holds one page of rows at a time.
function createServerTable(container, columns, opts) {
  opts = opts || {};
  const state = {
    page: 1,
    pageSize: opts.pageSize || 50,
    sortBy: (opts.defaultSort && opts.defaultSort.field) || null,
    sortDir: (opts.defaultSort && opts.defaultSort.dir) || 'asc',
    filters: {},
    total: 0,
    rows: [],
    focusedCol: null
  };
  let filterDebounce = null;

  function cellValue(col, row) {
    return col.render ? col.render(row) : row[col.key];
  }

  async function load() {
    const params = new URLSearchParams();
    params.set('page', state.page);
    params.set('pageSize', state.pageSize);
    if (state.sortBy) { params.set('sortBy', state.sortBy); params.set('sortDir', state.sortDir); }
    const activeFilters = {};
    Object.keys(state.filters).forEach((k) => { if (state.filters[k]) activeFilters[k] = state.filters[k]; });
    if (Object.keys(activeFilters).length) params.set('filters', JSON.stringify(activeFilters));

    let data, loadError = null;
    try {
      const res = await fetch(opts.apiBase + '?' + params.toString(), { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (err) {
      loadError = 'שגיאה בטעינת הנתונים — נסו שוב';
      data = { rows: [], total: 0 };
    }
    state.rows = data.rows;
    state.total = data.total;
    render(loadError);
  }

  function exportCurrentPageCsv() {
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const header = columns.map((c) => esc(c.label)).join(',');
    const lines = state.rows.map((row) => columns.map((c) => esc(c.exportValue ? c.exportValue(row) : cellValue(c, row))).join(','));
    const csv = '﻿' + [header].concat(lines).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (opts.exportFilename || 'export') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function render(loadError) {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    let html = '';
    if (loadError) html += '<div class="error-box" style="display:block;">' + Layout.escapeHtml(loadError) + '</div>';
    html += '<div class="table-toolbar">' +
      '<button class="btn btn-ghost btn-sm js-exportBtn" type="button">ייצוא העמוד הנוכחי לאקסל</button>' +
      '<span class="table-count">' + state.total.toLocaleString('he-IL') + ' רשומות בסה"כ</span>' +
      '</div>';
    html += '<div class="table-scroll"><table><thead><tr>';
    columns.forEach((col) => {
      const sortable = col.sortable !== false;
      const sortCls = state.sortBy === col.key ? (' sorted-' + state.sortDir) : '';
      if (sortable) {
        html += '<th><span class="th-inner js-sortBtn' + sortCls + '" data-col="' + col.key + '">' + Layout.escapeHtml(col.label) +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg></span></th>';
      } else {
        html += '<th><span class="th-inner">' + Layout.escapeHtml(col.label) + '</span></th>';
      }
    });
    html += '</tr><tr class="filter-row">';
    columns.forEach((col) => {
      if (col.filterable === false) { html += '<td></td>'; return; }
      html += '<td><input class="filter-input js-filterInput" data-col="' + col.key + '" placeholder="סנן..." value="' + Layout.escapeHtml(state.filters[col.key] || '') + '"></td>';
    });
    html += '</tr></thead><tbody>';
    if (!state.rows.length) {
      html += '<tr><td colspan="' + columns.length + '" class="table-empty">אין נתונים להצגה</td></tr>';
    } else {
      state.rows.forEach((row) => {
        html += '<tr>';
        columns.forEach((col) => {
          const v = cellValue(col, row);
          html += '<td>' + (col.html ? v : Layout.escapeHtml(v == null ? '' : v)) + '</td>';
        });
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';

    html += '<div class="pager">' +
      '<button class="btn btn-ghost btn-sm js-prevPage" type="button"' + (state.page <= 1 ? ' disabled' : '') + '>הקודם</button>' +
      '<span class="pager-status">עמוד ' + state.page + ' מתוך ' + totalPages.toLocaleString('he-IL') + '</span>' +
      '<button class="btn btn-ghost btn-sm js-nextPage" type="button"' + (state.page >= totalPages ? ' disabled' : '') + '>הבא</button>' +
      '</div>';

    container.innerHTML = html;

    container.querySelector('.js-exportBtn').addEventListener('click', exportCurrentPageCsv);
    container.querySelector('.js-prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
    container.querySelector('.js-nextPage').addEventListener('click', () => { if (state.page < totalPages) { state.page++; load(); } });
    container.querySelectorAll('.js-sortBtn').forEach((el) => {
      el.addEventListener('click', () => {
        const col = el.getAttribute('data-col');
        if (state.sortBy === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortBy = col; state.sortDir = 'asc'; }
        state.page = 1;
        load();
      });
    });
    container.querySelectorAll('.js-filterInput').forEach((el) => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('input', () => {
        state.filters[el.getAttribute('data-col')] = el.value;
        state.focusedCol = el.getAttribute('data-col');
        state.page = 1;
        clearTimeout(filterDebounce);
        filterDebounce = setTimeout(load, 400);
      });
    });
    if (state.focusedCol) {
      const toFocus = container.querySelector('.js-filterInput[data-col="' + state.focusedCol + '"]');
      if (toFocus) { toFocus.focus(); const v = toFocus.value; toFocus.setSelectionRange(v.length, v.length); }
    }
  }

  load();
  return { reload: load };
}
