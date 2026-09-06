// Directional product-substitute table: "if productCode is out of stock, suggest
// substituteCode instead." Both sides resolve against the product master — search
// by name (via a datalist) or paste a code directly and the name is looked up.
async function initProductSubstitutesPage() {
  const data = await Layout.init('product-substitutes');
  if (!data) return;

  const productsRes = await fetch('/api/products?pageSize=all', { credentials: 'include' });
  const products = productsRes.ok ? (await productsRes.json()).rows : [];
  const byDisplay = {}, byCode = {};
  products.forEach((p) => {
    const display = p.itemCode + ' — ' + p.name;
    byDisplay[display] = p.itemCode;
    byCode[p.itemCode] = display;
  });

  const datalist = document.getElementById('productsDatalist');
  datalist.innerHTML = Object.keys(byDisplay).map((d) => '<option value="' + Layout.escapeHtml(d) + '"></option>').join('');

  function setupPicker(input) {
    function resolve() {
      const v = input.value.trim();
      if (byDisplay[v]) { input.dataset.code = byDisplay[v]; input.classList.remove('input-invalid'); return; }
      if (byCode[v]) { input.value = byCode[v]; input.dataset.code = v; input.classList.remove('input-invalid'); return; }
      delete input.dataset.code;
      input.classList.toggle('input-invalid', v.length > 0);
    }
    input.addEventListener('change', resolve);
    input.addEventListener('blur', resolve);
  }

  const primaryInput = document.getElementById('primaryProductInput');
  const substituteInput = document.getElementById('substituteProductInput');
  setupPicker(primaryInput);
  setupPicker(substituteInput);

  const statusLine = document.getElementById('subStatus');
  document.getElementById('addSubBtn').addEventListener('click', async () => {
    const productCode = primaryInput.dataset.code;
    const substituteCode = substituteInput.dataset.code;
    statusLine.style.display = 'none';
    if (!productCode || !substituteCode) {
      statusLine.textContent = 'יש לבחור מוצר תקין משני הצדדים (מהרשימה הנפתחת או קוד מוצר קיים)';
      statusLine.style.color = 'var(--red)'; statusLine.style.display = 'block';
      return;
    }
    const res = await fetch('/api/product-substitutes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ productCode, substituteCode }) });
    const result = await res.json();
    if (!res.ok) { statusLine.textContent = result.error || 'שגיאה בהוספה'; statusLine.style.color = 'var(--red)'; statusLine.style.display = 'block'; return; }
    primaryInput.value = ''; substituteInput.value = '';
    delete primaryInput.dataset.code; delete substituteInput.dataset.code;
    statusLine.textContent = '✓ נוסף בהצלחה'; statusLine.style.color = 'var(--green)'; statusLine.style.display = 'block';
    await loadTable();
  });

  async function loadTable() {
    const res = await fetch('/api/product-substitutes', { credentials: 'include' });
    const rows = res.ok ? await res.json() : [];
    createDataTable(document.getElementById('subsTable'), [
      { key: 'productName', label: 'מוצר' },
      { key: 'substituteName', label: 'מוצר תחליפי' },
      { key: 'actions', label: '', html: true, sortable: false, filterable: false, render: (r) => '<button class="icon-btn js-deleteSub" data-id="' + r.id + '" type="button" title="מחיקה">✕</button>' }
    ], rows, { exportFilename: 'product-substitutes' });
  }

  document.getElementById('subsTable').addEventListener('click', async (e) => {
    const btn = e.target.closest('.js-deleteSub');
    if (!btn) return;
    await fetch('/api/product-substitutes/' + btn.getAttribute('data-id'), { method: 'DELETE', credentials: 'include' });
    await loadTable();
  });

  await loadTable();
}
