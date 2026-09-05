// Generic manually-edited row table (add/edit/delete), used for holidays & seasons —
// unlike customers/products/sales these are hand-maintained, not bulk-uploaded.
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
    let html = '<div class="inline-edit-table"><div class="table-scroll"><table><thead><tr>';
    config.fields.forEach((f) => { html += '<th>' + Layout.escapeHtml(f.label) + '</th>'; });
    html += '<th></th></tr></thead><tbody>';
    rows.forEach((row) => {
      html += '<tr data-id="' + row.id + '">';
      config.fields.forEach((f) => { html += '<td>' + inputHtml(f, row[f.key]) + '</td>'; });
      html += '<td><button class="icon-btn js-deleteRow" type="button" title="מחיקה">✕</button></td></tr>';
    });
    if (!rows.length) html += '<tr><td colspan="' + (config.fields.length + 1) + '" class="table-empty">אין שורות עדיין</td></tr>';
    html += '</tbody></table></div>';
    html += '<button class="btn btn-ghost btn-sm js-addRow" type="button" style="margin-top:10px;">+ הוספת שורה</button></div>';
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
  }

  await load();
}
