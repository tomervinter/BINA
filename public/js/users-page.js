async function initUsersPage() {
  const data = await Layout.init('users');
  if (!data) return;

  const isAdmin = data.user.role === 'admin';
  const inviteCard = document.getElementById('inviteCard');
  if (!isAdmin) inviteCard.hidden = true;

  const statusLine = document.getElementById('inviteStatus');
  document.getElementById('inviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    statusLine.style.display = 'none';
    const body = {
      email: document.getElementById('inviteEmail').value.trim(),
      password: document.getElementById('invitePassword').value,
      name: document.getElementById('inviteName').value.trim(),
      role: document.getElementById('inviteRole').value
    };
    const res = await fetch('/api/users/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok) { statusLine.textContent = result.error || 'שגיאה בהוספת משתמש'; statusLine.style.color = 'var(--red)'; statusLine.style.display = 'block'; return; }
    statusLine.textContent = '✓ המשתמש נוצר בהצלחה'; statusLine.style.color = 'var(--green)'; statusLine.style.display = 'block';
    document.getElementById('inviteForm').reset();
    await loadTable();
  });

  async function loadTable() {
    const res = await fetch('/api/users', { credentials: 'include' });
    const rows = res.ok ? await res.json() : [];
    const columns = [
      { key: 'name', label: 'שם', render: (r) => r.name || '—' },
      { key: 'email', label: 'אימייל' },
      { key: 'role', label: 'תפקיד', render: (r) => r.role === 'admin' ? 'מנהל' : 'חבר צוות' }
    ];
    if (isAdmin) {
      columns.push({
        key: 'actions', label: '', html: true,
        render: (r) => r.id === data.user.id ? '' : '<button class="icon-btn js-removeUser" data-id="' + r.id + '" type="button" title="הסרה">✕</button>'
      });
    }
    createDataTable(document.getElementById('usersTable'), columns, rows, { exportFilename: 'users', tableKey: 'users' });
  }

  // Delegated on the container (not the buttons) since table.js rebuilds the
  // table's innerHTML on every sort/filter — per-button listeners would be lost.
  document.getElementById('usersTable').addEventListener('click', async (e) => {
    const btn = e.target.closest('.js-removeUser');
    if (!btn) return;
    await fetch('/api/users/' + btn.getAttribute('data-id'), { method: 'DELETE', credentials: 'include' });
    await loadTable();
  });

  await loadTable();
}
