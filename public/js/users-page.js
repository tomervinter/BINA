async function initUsersPage() {
  const data = await Layout.init('users');
  if (!data) return;

  const isAdmin = data.user.role === 'admin';
  const isSuperAdmin = !!data.user.isSuperAdmin;
  const inviteCard = document.getElementById('inviteCard');
  if (!isAdmin) inviteCard.hidden = true;

  // Only shown while NO super-admin exists yet anywhere in the system — a one-time
  // self-service bootstrap so the very first one never needs direct DB access (see
  // POST /api/users/bootstrap-superadmin). Any existing company admin can do this,
  // not just this organization's — it's a system-wide state, not a per-org one.
  if (isAdmin && !isSuperAdmin && !data.superAdminExists) {
    document.getElementById('bootstrapCard').style.display = '';
    document.getElementById('bootstrapBtn').addEventListener('click', async () => {
      const btn = document.getElementById('bootstrapBtn');
      const statusLine = document.getElementById('bootstrapStatus');
      btn.disabled = true;
      const res = await fetch('/api/users/bootstrap-superadmin', { method: 'POST', credentials: 'include' });
      const result = await res.json();
      statusLine.style.display = 'block';
      if (!res.ok) { statusLine.textContent = result.error || 'שגיאה'; statusLine.style.color = 'var(--red)'; btn.disabled = false; return; }
      statusLine.textContent = '✓ הפכת למנהל-על. טוען מחדש...';
      statusLine.style.color = 'var(--green)';
      window.location.reload();
    });
  }

  // A super-admin can add a user to ANY company, not just their own — the org
  // picker only appears for them; everyone else's invite always targets their own
  // organization implicitly (server-enforced regardless of what the client sends).
  let orgOptions = [];
  if (isSuperAdmin) {
    document.getElementById('pageSubtitle').textContent = 'ניהול משתמשים בכל החברות במערכת (מנהל-על) — ניתן לבחור לאיזו חברה להוסיף כל משתמש.';
    document.getElementById('usersCardTitle').textContent = 'כל המשתמשים במערכת';
    const orgsRes = await fetch('/api/organizations', { credentials: 'include' });
    orgOptions = orgsRes.ok ? await orgsRes.json() : [];
    const orgField = document.getElementById('inviteOrgField');
    const orgSelect = document.getElementById('inviteOrg');
    orgField.style.display = '';
    orgSelect.innerHTML = orgOptions.map((o) => '<option value="' + o.id + '">' + Layout.escapeHtml(o.name) + '</option>').join('');
    // Default to this admin's own org so the common case (adding to your own
    // company) needs no extra click — only picking a DIFFERENT company does.
    if (data.organization && orgOptions.some((o) => o.id === data.organization.id)) orgSelect.value = data.organization.id;
  }

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
    if (isSuperAdmin) body.organizationId = document.getElementById('inviteOrg').value;
    const res = await fetch('/api/users/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok) { statusLine.textContent = result.error || 'שגיאה בהוספת משתמש'; statusLine.style.color = 'var(--red)'; statusLine.style.display = 'block'; return; }
    statusLine.textContent = '✓ המשתמש נוצר בהצלחה'; statusLine.style.color = 'var(--green)'; statusLine.style.display = 'block';
    document.getElementById('inviteForm').reset();
    if (isSuperAdmin && data.organization && orgOptions.some((o) => o.id === data.organization.id)) document.getElementById('inviteOrg').value = data.organization.id;
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
    if (isSuperAdmin) {
      columns.push({ key: 'organizationName', label: 'חברה' });
      columns.push({ key: 'isSuperAdmin', label: 'מנהל-על', render: (r) => r.isSuperAdmin ? '✓' : '' });
    }
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

initUsersPage();
