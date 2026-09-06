// Generic manually-edited row table (add/edit/delete), used for holidays & seasons —
// unlike customers/products/sales these are hand-maintained, not bulk-uploaded.
// config: { pageKey, apiBase, addLabel, countLabel, fields:[{key,label,type,default}] }
async function initInlineEditTable(config) {
  const data = await Layout.init(config.pageKey);
  if (!data) return;

  const container = document.getElementById('tableContainer');

  async function load() {
    const res = await fetch(config.apiBase, { credentials: 'include' });
    const rows = res.ok ? await res.json() : [];
    render(rows);
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

  function render(rows) {
    let html = '<div class="table-head-row"><div class="table-head-right"></div><div class="table-head-left">' +
      '<span class="count-pill">' + rows.length.toLocaleString('he-IL') + ' ' + config.countLabel + '</span></div></div>';
    html += '<div class="toolbar">' +
      '<button class="btn btn-primary btn-sm js-addRow" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>' + config.addLabel + '</button>' +
      '<button class="btn btn-danger btn-sm js-deleteAllBtn" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"></path><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"></path><path d="M7 7l1 12.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5L17 7"></path></svg>מחיקת כל הנתונים</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-success btn-sm js-exportBtn" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"></rect><path d="M3.5 9.5h17M3.5 14.5h17M9.5 3.5v17"></path></svg>ייצוא לאקסל</button>' +
      '</div>';

    html += '<div class="inline-edit-table"><div class="table-scroll"><table><thead><tr>';
    config.fields.forEach((f) => { html += '<th>' + Layout.escapeHtml(f.label) + '</th>'; });
    html += '<th></th></tr></thead><tbody>';
    rows.forEach((row) => {
      html += '<tr data-id="' + row.id + '">';
      config.fields.forEach((f) => { html += '<td>' + inputHtml(f, row[f.key]) + '</td>'; });
      html += '<td><button class="icon-btn js-deleteRow" type="button" title="מחיקה">✕</button></td></tr>';
    });
    if (!rows.length) html += '<tr><td colspan="' + (config.fields.length + 1) + '" class="table-empty">אין שורות עדיין</td></tr>';
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
    container.querySelector('.js-exportBtn').addEventListener('click', () => {
      window.location.href = config.apiBase + '/export';
    });
  }

  await load();
}
