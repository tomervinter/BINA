// Generic "upload + browse table" page, parameterized per entity (customers/products/sales/inventory).
async function initListPage(config) {
  const data = await Layout.init(config.pageKey);
  if (!data) return;

  let table = null;
  async function loadTable() {
    if (table) { table.reload(); return; }
    table = createServerTable(document.getElementById('tableContainer'), config.columns, {
      apiBase: config.apiBase,
      defaultSort: config.defaultSort
    });
  }

  initUploadWidget(document.getElementById('uploadWidget'), {
    apiBase: config.apiBase,
    templateEntity: config.pageKey,
    onUploaded: loadTable
  });

  await loadTable();
}
