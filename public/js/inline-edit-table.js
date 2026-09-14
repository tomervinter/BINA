// Generic manually-edited row table (add/edit/delete), used for holidays & seasons —
// unlike customers/products/sales these are hand-maintained, not bulk-uploaded.
// config: { pageKey, apiBase, addLabel, countLabel, fields:[{key,label,type,default}],
//   defaultSortOrder: [name,...] } — defaultSortOrder (optional) is a fixed list of
// values for fields[0] (the "name" column — חג/עונה) that rows sort by whenever the
// user hasn't clicked a column header; a name not in the list sorts after every name
// that is, keeping its original relative order. Clicking any column header still
// works normally and overrides this default, same as any other sortable table here.
async function initInlineEditTable(config) {
  const data = await Layout.init(config.pageKey);
  if (!data) return;

  const container = document.getElementById('tableContainer');
  const state = { rows: [], filters: {}, sortCol: null, sortDir: 'asc', focusedCol: null };
  const nameField = config.fields[0].key;
  let columns = config.fields.slice();
  const originalColumns = config.fields.slice();

  // A subtle, distinct background per unique value of the name column (e.g. every
  // "פסח" row the same soft tint) — built from ALL loaded rows, not just the
  // filtered/sorted ones currently on screen, so a color stays the same for a given
  // name regardless of filtering/sorting/pagination.
  const PALETTE = [
    'hsl(0,65%,95%)', 'hsl(28,70%,93%)', 'hsl(48,70%,90%)', 'hsl(88,50%,92%)',
    'hsl(140,45%,93%)', 'hsl(172,45%,92%)', 'hsl(200,60%,93%)', 'hsl(225,60%,95%)',
    'hsl(265,50%,95%)', 'hsl(320,45%,95%)'
  ];
  const nameColors = {};
  function colorForName(name) {
    if (!name) return null; // no name yet (e.g. a just-added row) — no color to assign
    if (!(name in nameColors)) {
      const order = Object.keys(nameColors).length;
      nameColors[name] = PALETTE[order % PALETTE.length];
    }
    return nameColors[name];
  }

  async function load() {
    const res = await fetch(config.apiBase, { credentials: 'include' });
    state.rows = res.ok ? await res.json() : [];
    if (config.pageKey) columns = applyColumnOrder(originalColumns, await loadColumnOrder(config.pageKey));
    render();
  }

  function inputHtml(field, value) {
    if (field.type === 'date') {
      // Local calendar date, not toISOString()'s UTC date — those differ by a day
      // in positive-offset timezones (e.g. Asia/Jerusalem) and would show the wrong day.
      let localIso = '';
      if (value) {
        const d = new Date(value);
        const p = (n) => String(n).padStart(2, '0');
        localIso = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      }
      return '<input type="date" data-field="' + field.key + '" value="' + localIso + '">';
    }
    return '<input type="' + (field.type || 'text') + '" data-field="' + field.key + '" value="' + Layout.escapeHtml(value == null ? '' : value) + '">';
  }

  function filteredSortedRows() {
    let out = state.rows.filter((row) => config.fields.every((f) => {
      const term = state.filters[f.key];
      if (!term) return true;
      return String(row[f.key] == null ? '' : row[f.key]).toLowerCase().indexOf(term.toLowerCase()) !== -1;
    }));
    if (state.sortCol) {
      out = out.slice().sort((a, b) => {
        let va = a[state.sortCol], vb = b[state.sortCol];
        if (va == null) va = '';
        if (vb == null) vb = '';
        const na = Number(va), nb = Number(vb);
        const cmp = (va !== '' && vb !== '' && !isNaN(na) && !isNaN(nb)) ? na - nb : String(va).localeCompare(String(vb), 'he');
        return state.sortDir === 'asc' ? cmp : -cmp;
      });
    } else if (config.defaultSortOrder && config.defaultSortOrder.length) {
      const rank = {};
      config.defaultSortOrder.forEach((name, i) => { rank[name] = i; });
      out = out
        .map((row, i) => ({ row, i, rank: rank[row[nameField]] != null ? rank[row[nameField]] : config.defaultSortOrder.length }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map((x) => x.row);
    }
    return out;
  }

  function reorderColumns(newCols) {
    columns = newCols;
    saveColumnOrder(config.pageKey, columns);
    render();
  }

  function render() {
    const rows = filteredSortedRows();
    // Assign/refresh the color map from every loaded row (not just the currently
    // visible ones) so a name's color never shifts as filters/sort change.
    state.rows.forEach((row) => colorForName(row[nameField]));

    let html = '<div class="table-head-row"><div class="table-head-right"></div><div class="table-head-left">' +
      '<span class="count-pill">' + rows.length.toLocaleString('he-IL') + ' ' + config.countLabel + '</span></div></div>';
    html += '<div class="toolbar">' +
      '<button class="btn btn-primary btn-sm js-addRow" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>' + config.addLabel + '</button>' +
      '<button class="btn btn-danger btn-sm js-deleteAllBtn" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"></path><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"></path><path d="M7 7l1 12.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5L17 7"></path></svg>מחיקת כל הנתונים</button>' +
      '<button class="btn btn-ghost btn-sm js-clearFilterBtn" type="button">נקה סינון</button>' +
      (config.pageKey ? '<button class="btn btn-ghost btn-sm js-resetColOrder" type="button">איפוס סדר עמודות</button>' : '') +
      '<span class="spacer"></span>' +
      '<button class="btn btn-success btn-sm js-exportBtn" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"></rect><path d="M3.5 9.5h17M3.5 14.5h17M9.5 3.5v17"></path></svg>ייצוא לאקסל</button>' +
      '</div>';

    html += '<div class="inline-edit-table"><div class="table-scroll"><table><thead><tr>';
    columns.forEach((f) => {
      const sortCls = state.sortCol === f.key ? (' sorted-' + state.sortDir) : '';
      html += '<th><span class="th-inner js-sortBtn' + sortCls + '" data-col="' + f.key + '"><span class="th-label">' + Layout.escapeHtml(f.label) + '</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg></span></th>';
    });
    html += '<th></th></tr><tr class="filter-row">';
    columns.forEach((f) => {
      html += '<td><input class="filter-input js-filterInput" data-col="' + f.key + '" placeholder="סנן..." value="' + Layout.escapeHtml(state.filters[f.key] || '') + '"></td>';
    });
    html += '<td></td></tr></thead><tbody>';
    rows.forEach((row) => {
      html += '<tr data-id="' + row.id + '" style="background:' + (colorForName(row[nameField]) || 'transparent') + ';">';
      columns.forEach((f) => { html += '<td>' + inputHtml(f, row[f.key]) + '</td>'; });
      html += '<td><button class="icon-btn js-deleteRow" type="button" title="מחיקה">✕</button></td></tr>';
    });
    if (!rows.length) html += '<tr><td colspan="' + (columns.length + 1) + '" class="table-empty">אין שורות להצגה</td></tr>';
    html += '</tbody></table></div></div>';
    container.innerHTML = html;

    container.querySelectorAll('tr[data-id] input').forEach((input) => {
      input.addEventListener('change', async () => {
        const tr = input.closest('tr');
        const id = tr.getAttribute('data-id');
        const payload = {};
        tr.querySelectorAll('input[data-field]').forEach((inp) => { payload[inp.getAttribute('data-field')] = inp.value; });
        // Keep the in-memory row in sync with what was just typed. Without this, state.rows
        // still held the pre-edit values, so the next render() — triggered by sorting,
        // filtering, reordering columns, or adding another row — rebuilt the table from
        // stale data and made the just-typed value appear lost, even though the PUT below
        // had already saved it server-side.
        const row = state.rows.find((r) => String(r.id) === id);
        if (row) {
          Object.assign(row, payload);
          if (input.getAttribute('data-field') === nameField) {
            tr.style.background = colorForName(row[nameField]) || 'transparent';
          }
        }
        await fetch(config.apiBase + '/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      });
    });
    // One Tab press moves focus exactly one cell over, uniformly across every field
    // type — including date inputs, whose native behavior otherwise steps through
    // their internal day/month/year segments (2-3 Tab presses) before moving to the
    // next actual field. Shift+Tab moves backward the same way.
    container.querySelectorAll('tr[data-id] input[data-field]').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const all = Array.from(container.querySelectorAll('tr[data-id] input[data-field]'));
        const idx = all.indexOf(input);
        const next = all[idx + (e.shiftKey ? -1 : 1)];
        if (!next) return; // let focus leave the table normally at either end
        e.preventDefault();
        next.focus();
        if (next.type !== 'date') next.select();
      });
    });
    container.querySelectorAll('.js-deleteRow').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        await fetch(config.apiBase + '/' + tr.getAttribute('data-id'), { method: 'DELETE', credentials: 'include' });
        await load();
      });
    });
    container.querySelector('.js-addRow').addEventListener('click', async () => {
      const payload = {};
      config.fields.forEach((f) => { payload[f.key] = f.default != null ? f.default : ''; });
      const res = await fetch(config.apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      if (res.ok) await load();
    });
    container.querySelector('.js-deleteAllBtn').addEventListener('click', () => {
      confirmDangerousDelete('פעולה זו תמחק את כל הנתונים בטבלה זו לצמיתות ואינה הפיכה.', async () => {
        await fetch(config.apiBase, { method: 'DELETE', credentials: 'include' });
        await load();
      });
    });
    container.querySelector('.js-clearFilterBtn').addEventListener('click', () => {
      state.filters = {};
      render();
    });
    container.querySelector('.js-exportBtn').addEventListener('click', () => {
      window.location.href = config.apiBase + '/export';
    });
    const resetColBtn = container.querySelector('.js-resetColOrder');
    if (resetColBtn) resetColBtn.addEventListener('click', async () => {
      await resetColumnOrder(config.pageKey);
      columns = applyColumnOrder(originalColumns, await loadColumnOrder(config.pageKey));
      render();
    });
    const headRow = container.querySelector('thead tr');
    wireColumnDragReorder(headRow, columns, reorderColumns);
    // The trailing header cell is the delete-button column, not a data column — it must
    // stay out of `columns`, so it can't be dragged itself (dropping onto it is still fine,
    // wireColumnDragReorder's splice just appends to the end in that case).
    const actionsHeadCell = headRow.lastElementChild;
    if (actionsHeadCell) { actionsHeadCell.removeAttribute('draggable'); actionsHeadCell.classList.remove('th-draggable'); }
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
    if (state.focusedCol) {
      const toFocus = container.querySelector('.js-filterInput[data-col="' + state.focusedCol + '"]');
      if (toFocus) { toFocus.focus(); const v = toFocus.value; toFocus.setSelectionRange(v.length, v.length); }
    }
  }

  await load();
}
