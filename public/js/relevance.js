// Product × holiday/season relevance matrix. Each cell cycles: not-manual → manual-yes
// → manual-no → back to automatic/suggested (deletes the override).
async function initRelevancePage() {
  const data = await Layout.init('relevance');
  if (!data) return;

  const container = document.getElementById('matrixContainer');

  function cellClassAndIcon(state) {
    if (state.manual) return state.value ? ['rel-dot-manual', '✓'] : ['rel-dot-manual-no', '✕'];
    if (state.suggested) return state.value ? ['rel-dot-suggest', '✓'] : ['rel-dot-suggest-no', '✕'];
    if (state.known) return state.value ? ['rel-dot-auto', '✓'] : ['rel-dot-auto-no', '✕'];
    return ['rel-dot-unknown', '?'];
  }

  function cellTitle(state) {
    if (state.manual) return state.value ? 'סומן ידנית כרלוונטי (לחצו לשינוי)' : 'סומן ידנית כלא רלוונטי (לחצו לאיפוס)';
    if (state.suggested) return 'הצעה אוטומטית לפי מוצרים דומים (לחצו לאישור/דחייה ידניים)';
    if (state.known) return 'זוהה אוטומטית לפי נתוני המכירות (לחצו לקביעה ידנית)';
    return 'לא ידוע — אין מספיק נתונים (לחצו לקביעה ידנית)';
  }

  async function load() {
    const res = await fetch('/api/relevance/matrix', { credentials: 'include' });
    const payload = res.ok ? await res.json() : { events: [], matrix: [] };
    render(payload);
  }

  function render(payload) {
    const events = payload.events;
    if (!events.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">אין עדיין חגים או עונות מוגדרים — הוסיפו אותם במסכי "ניהול חגים" / "ניהול עונתיות" כדי לבצע שיוך.</p>';
      return;
    }
    let html = '<div class="rel-legend">' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-manual" style="pointer-events:none;">✓</span> נקבע ידנית</span>' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-auto" style="pointer-events:none;">✓</span> זוהה אוטומטית</span>' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-suggest" style="pointer-events:none;">✓</span> הצעה לפי קטגוריה</span>' +
      '<span class="rel-legend-item"><span class="rel-cell-btn rel-dot-unknown" style="pointer-events:none;">?</span> לא ידוע</span>' +
      '</div>';
    html += '<div class="rel-matrix-scroll"><table class="rel-matrix"><thead><tr><th class="rel-product-name">מוצר</th>';
    events.forEach((ev) => { html += '<th>' + Layout.escapeHtml(ev.name) + '<br><span style="font-weight:400;color:var(--text-faint);">(' + (ev.source === 'holiday' ? 'חג' : 'עונה') + ')</span></th>'; });
    html += '</tr></thead><tbody>';
    payload.matrix.forEach((row) => {
      html += '<tr><td class="rel-product-name">' + Layout.escapeHtml(row.productName || row.productCode) + '</td>';
      row.cells.forEach((cell) => {
        const [cls, icon] = cellClassAndIcon(cell.state);
        html += '<td class="rel-cell"><button type="button" class="rel-cell-btn js-relBtn ' + cls + '" title="' + Layout.escapeHtml(cellTitle(cell.state)) +
          '" data-product="' + Layout.escapeHtml(row.productCode) + '" data-source="' + cell.source + '" data-name="' + Layout.escapeHtml(cell.name) +
          '" data-manual="' + (cell.state.manual ? '1' : '0') + '" data-value="' + (cell.state.value ? '1' : '0') + '">' + icon + '</button></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelectorAll('.js-relBtn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const productCode = btn.getAttribute('data-product');
        const source = btn.getAttribute('data-source');
        const name = btn.getAttribute('data-name');
        const manual = btn.getAttribute('data-manual') === '1';
        const value = btn.getAttribute('data-value') === '1';
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
