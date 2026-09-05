// Generic "upload CSV + browse table" page, parameterized per entity (customers/products/sales/inventory).
async function initListPage(config) {
  const data = await Layout.init(config.pageKey);
  if (!data) return;

  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('csvFile');
  const statusLine = document.getElementById('uploadStatus');

  uploadBtn.addEventListener('click', async () => {
    if (!fileInput.files || !fileInput.files[0]) { statusLine.textContent = 'יש לבחור קובץ קודם'; statusLine.style.color = 'var(--red)'; return; }
    const form = new FormData();
    form.append('file', fileInput.files[0]);
    statusLine.textContent = 'טוען...'; statusLine.style.color = 'var(--text-muted)';
    try {
      const res = await fetch(config.apiBase + '/upload', { method: 'POST', credentials: 'include', body: form });
      const result = await res.json();
      if (!res.ok) { statusLine.textContent = result.error || 'שגיאה בהעלאה'; statusLine.style.color = 'var(--red)'; return; }
      statusLine.textContent = '✓ נטענו ' + result.count + ' רשומות'; statusLine.style.color = 'var(--green)';
      await loadTable();
    } catch (err) {
      statusLine.textContent = 'שגיאת רשת'; statusLine.style.color = 'var(--red)';
    }
  });

  let table = null;
  async function loadTable() {
    if (table) { table.reload(); return; }
    table = createServerTable(document.getElementById('tableContainer'), config.columns, {
      apiBase: config.apiBase,
      exportFilename: config.exportFilename,
      defaultSort: config.defaultSort
    });
  }

  await loadTable();
}
