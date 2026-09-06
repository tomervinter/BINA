// Server-paginated table for large data sets (sales/inventory can run into hundreds of
// thousands of rows) — sorting and filtering happen in the database via query params;
// the browser only ever holds one page of rows at a time. Toolbar/markup matches the
// original Artifact (count-pill, delete-all, clear-filter, real .xlsx export).
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

  function buildParams() {
    const params = new URLSearchParams();
    params.set('page', state.page);
    params.set('pageSize', state.pageSize);
    if (state.sortBy) { params.set('sortBy', state.sortBy); params.set('sortDir', state.sortDir); }
    const activeFilters = {};
    Object.keys(state.filters).forEach((k) => { if (state.filters[k]) activeFilters[k] = state.filters[k]; });
    if (Object.keys(activeFilters).length) params.set('filters', JSON.stringify(activeFilters));
    return params;
  }

  async function load() {
    let data, loadError = null;
    try {
      const res = await fetch(opts.apiBase + '?' + buildParams().toString(), { credentials: 'include' });
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

  function exportXlsx() {
    window.location.href = opts.apiBase + '/export?' + buildParams().toString();
  }

  function deleteAll() {
    confirmDangerousDelete('פעולה זו תמחק את כל הנתונים בטבלה זו לצמיתות ואינה הפיכה.', async () => {
      await fetch(opts.apiBase, { method: 'DELETE', credentials: 'include' });
      state.page = 1;
      await load();
    });
  }

  function clearFilters() {
    state.filters = {};
    state.page = 1;
    load();
  }

  function render(loadError) {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    let html = '';
    if (loadError) html += '<div class="error-box" style="display:block;">' + Layout.escapeHtml(loadError) + '</div>';
    html += '<div class="table-head-row"><div class="table-head-right"></div><div class="table-head-left"><span class="count-pill">' + state.total.toLocaleString('he-IL') + ' רשומות</span></div></div>';
    html += '<div class="toolbar">';
    if (opts.deletable !== false) {
      html += '<button class="btn btn-danger btn-sm js-deleteAllBtn" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"></path><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"></path><path d="M7 7l1 12.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5L17 7"></path></svg>' +
        'מחיקת כל הנתונים</button>';
    }
    html += '<button class="btn btn-ghost btn-sm js-clearFilterBtn" type="button">נקה סינון</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-success btn-sm js-exportBtn" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"></rect><path d="M3.5 9.5h17M3.5 14.5h17M9.5 3.5v17"></path></svg>' +
      'ייצוא לאקסל</button></div>';

    html += '<div class="table-scroll"><table><thead><tr>';
    columns.forEach((col) => {
      const sortable = col.sortable !== false;
      const sortKey = col.sortKey || col.key;
      const sortCls = state.sortBy === sortKey ? (' sorted-' + state.sortDir) : '';
      if (sortable) {
        html += '<th><span class="th-inner js-sortBtn' + sortCls + '" data-col="' + sortKey + '"><span class="th-label">' + Layout.escapeHtml(col.label) + '</span>' +
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

    container.querySelector('.js-exportBtn').addEventListener('click', exportXlsx);
    container.querySelector('.js-clearFilterBtn').addEventListener('click', clearFilters);
    const deleteBtn = container.querySelector('.js-deleteAllBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', deleteAll);
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
