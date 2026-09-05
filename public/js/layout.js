// Shared app shell: sidebar navigation + topbar. Every authenticated page calls
// Layout.init(pageKey) once; it checks the session, redirects to login if needed,
// and injects the sidebar/topbar markup into #sidebarMount / #topbarMount.
var NAV_GROUPS = [
  { title: null, items: [{ key: 'dashboard', href: 'dashboard.html', label: 'דשבורד' }] },
  { title: 'טעינת נתונים יומית', items: [
    { key: 'customers', href: 'customers.html', label: 'לקוחות' },
    { key: 'products', href: 'products.html', label: 'מוצרים' },
    { key: 'sales', href: 'sales.html', label: 'מכירות' },
    { key: 'inventory', href: 'inventory.html', label: 'מלאי' }
  ] },
  { title: 'הגדרות נתונים כלליים', items: [
    { key: 'holidays', href: 'holidays.html', label: 'ניהול חגים' },
    { key: 'seasons', href: 'seasons.html', label: 'ניהול עונתיות' },
    { key: 'relevance', href: 'relevance.html', label: 'שיוך חג ועונה למוצר' }
  ] },
  { title: 'דוחות', items: [
    { key: 'insights', href: 'insights.html', label: 'יומן תובנות' },
    { key: 'rule-engine', href: 'rule-engine.html', label: 'כללי מנוע התובנות' },
    { key: 'customer-profile', href: 'customer-profile.html', label: 'כרטסת תחקור לקוח' }
  ] },
  { title: 'ניהול חברה', items: [
    { key: 'users', href: 'users.html', label: 'משתמשים' }
  ] }
];

var Layout = (function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderSidebar(activeKey) {
    var html = '<div class="sidebar-brand">רדאר מכירות</div><nav class="sidebar-nav">';
    NAV_GROUPS.forEach(function (group) {
      if (group.title) html += '<div class="sidebar-group-title">' + escapeHtml(group.title) + '</div>';
      group.items.forEach(function (item) {
        html += '<a class="sidebar-link' + (item.key === activeKey ? ' active' : '') + '" href="' + item.href + '">' + escapeHtml(item.label) + '</a>';
      });
    });
    html += '</nav>';
    return html;
  }

  function renderTopbar(user, org) {
    return (
      '<div class="brand-mobile"></div>' +
      '<div class="topbar-right">' +
      '<span class="topbar-user">' + escapeHtml(org.name) + ' · ' + escapeHtml(user.name || user.email) + (user.role === 'admin' ? ' <span class="pill pill-gray">מנהל</span>' : '') + '</span>' +
      '<button class="btn btn-ghost" id="logoutBtn">התנתקות</button>' +
      '</div>'
    );
  }

  async function init(pageKey) {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) { window.location.href = 'login.html'; return null; }
    const data = await res.json();

    const sidebarMount = document.getElementById('sidebarMount');
    const topbarMount = document.getElementById('topbarMount');
    if (sidebarMount) sidebarMount.innerHTML = renderSidebar(pageKey);
    if (topbarMount) topbarMount.innerHTML = renderTopbar(data.user, data.organization);

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = 'login.html';
    });

    Layout.currentUser = data.user;
    Layout.currentOrg = data.organization;
    return data;
  }

  return { init: init, escapeHtml: escapeHtml, currentUser: null, currentOrg: null };
})();
