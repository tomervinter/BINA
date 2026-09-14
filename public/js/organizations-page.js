async function initOrganizationsPage() {
  const data = await Layout.init('organizations');
  if (!data) return;

  // The nav item itself is already hidden for a non-super-admin (see layout.js), but
  // the URL is still reachable directly — this is the actual access gate.
  if (!data.user.isSuperAdmin) {
    document.getElementById('deniedNotice').style.display = '';
    return;
  }
  document.getElementById('orgsContent').style.display = '';

  const statusLine = document.getElementById('createStatus');
  function setStatus(text, isError) {
    statusLine.textContent = text;
    statusLine.style.color = isError ? 'var(--red)' : 'var(--green)';
    statusLine.style.display = 'block';
  }

  async function loadTable() {
    const res = await fetch('/api/organizations', { credentials: 'include' });
    const rows = res.ok ? await res.json() : [];
    const columns = [
      { key: 'name', label: 'שם החברה' },
      { key: 'userCount', label: 'משתמשים' },
      { key: 'customerCount', label: 'לקוחות' },
      { key: 'createdAt', label: 'הוקמה בתאריך', render: (r) => new Date(r.createdAt).toLocaleDateString('he-IL') }
    ];
    createDataTable(document.getElementById('orgsTable'), columns, rows, { exportFilename: 'organizations', tableKey: 'organizations' });
  }

  document.getElementById('createOrgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    statusLine.style.display = 'none';
    const name = document.getElementById('orgName').value.trim();
    const res = await fetch('/api/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name }) });
    const result = await res.json();
    if (!res.ok) { setStatus(result.error || 'שגיאה בהקמת החברה', true); return; }
    setStatus('✓ החברה "' + result.name + '" הוקמה בהצלחה — ניתן כעת להוסיף לה משתמשים במסך "משתמשים".', false);
    document.getElementById('createOrgForm').reset();
    await loadTable();
  });

  await loadTable();
}
