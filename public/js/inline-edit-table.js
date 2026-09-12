// Generic manually-edited row table (add/edit/delete), used for holidays & seasons —
// unlike customers/products/sales these are hand-maintained, not bulk-uploaded.
// config: { pageKey, apiBase, addLabel, countLabel, fields:[{key,label,type,default}] }
async function initInlineEditTable(config) {
  const data = await Layout.init(config.pageKey);
  if (!data) return;

  const container = document.getElementById('tableContainer');
  const state = { rows: [], filters: {}, sortCol: null, sortDir: 'asc', focusedCol: null };

  async function load() {
    const res = await fetch(config.apiBase, { credentials: 'include' });
    state.rows = res.ok ? await res.json() : [];
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
    }
    return out;
  }

  function render() {
    const rows = filteredSortedRows();
    let html = '<div class="table-head-row"><div class="table-head-right"></div><div class="table-head-left">' +
      '<span class="count-pill">' + rows.length.toLocaleString('he-IL') + ' ' + config.countLabel + '</span></div></div>';
    html += '<div class="toolbar">' +
      '<button class="btn btn-primary btn-sm js-addRow" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>' + config.addLabel + '</button>' +
      '<button class="btn btn-danger btn-sm js-deleteAllBtn" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"></path><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"></path><path d="M7 7l1 12.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5L17 7"></path></svg>מחיקת כל הנתונים</button>' +
      '<button class="btn btn-ghost btn-sm js-clearFilterBtn" type="button">נקה סינון</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-success btn-sm js-exportBtn" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"></rect><path d="M3.5 9.5h17M3.5 14.5h17M9.5 3.5v17"></path></svg>ייצוא לאקסל</button>' +
      '</div>';

    html += '<div class="inline-edit-table"><div class="table-scroll"><table><thead><tr>';
    config.fields.forEach((f) => {
      const sortCls = state.sortCol === f.key ? (' sorted-' + state.sortDir) : '';
      html += '<th><span class="th-inner js-sortBtn' + sortCls + '" data-col="' + f.key + '"><span class="th-label">' + Layout.escapeHtml(f.label) + '</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg></span></th>';
    });
    html += '<th></th></tr><tr class="filter-row">';
    config.fields.forEach((f) => {
      html += '<td><input class="filter-input js-filterInput" data-col="' + f.key + '" placeholder="סנן..." value="' + Layout.escapeHtml(state.filters[f.key] || '') + '"></td>';
    });
    html += '<td></td></tr></thead><tbody>';
    rows.forEach((row) => {
      html += '<tr data-id="' + row.id + '">';
      config.fields.forEach((f) => { html += '<td>' + inputHtml(f, row[f.key]) + '</td>'; });
      html += '<td><button class="icon-btn js-deleteRow" type="button" title="מחיקה">✕</button></td></tr>';
    });
    if (!rows.length) html += '<tr><td colspan="' + (config.fields.length + 1) + '" class="table-empty">אין שורות להצגה</td></tr>';
    html += '</tbody></table></div></div>';
    container.innerHTML = html;

    container.querySelectorAll('tr[data-id] input').forEach((input) => {
      input.addEventListener('change', async () => {
        const tr = input.closest('tr');
        const id = tr.getAttribute('data-id');
        const payload = {};
        tr.querySelectorAll('input[data-field]').forEach((inp) => { payload[inp.getAttribute('data-field')] = inp.value; });
        await fetch(config.apiBase + '/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
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
