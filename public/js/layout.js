// Shared app shell: dark sidebar + topbar, matching the original Artifact design exactly.
// Every authenticated page calls Layout.init(pageKey, pageLabel) once; it checks the
// session, redirects to login if needed, and injects the sidebar/topbar markup.

const NAV_ICONS = {
  dashboard: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.4"></rect><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"></rect><rect x="3.5" y="13.5" width="7" height="7" rx="1.4"></rect><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"></rect>',
  sales: '<path d="M12 4v11"></path><path d="M7.5 11.5 12 16l4.5-4.5"></path><path d="M4.5 17.5v1.7a1.3 1.3 0 0 0 1.3 1.3h12.4a1.3 1.3 0 0 0 1.3-1.3v-1.7"></path>',
  customers: '<circle cx="9" cy="8" r="3.1"></circle><path d="M3.5 19.5c.6-3.4 2.9-5.3 5.5-5.3s4.9 1.9 5.5 5.3"></path><circle cx="17" cy="9" r="2.3"></circle>',
  products: '<rect x="4" y="9" width="16" height="11" rx="1.3"></rect><path d="M4 9l2.5-5h11L20 9"></path><path d="M9.5 13.5h5"></path>',
  inventory: '<path d="M4 20.5V9.5l8-5 8 5v11"></path><path d="M4 12.5h16"></path>',
  holidays: '<rect x="4" y="5" width="16" height="15" rx="1.6"></rect><path d="M4 9.5h16M8 3v3.5M16 3v3.5"></path><path d="M9 13.2l1.6 1.6L15 10.6"></path>',
  seasons: '<circle cx="12" cy="12" r="4.2"></circle><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"></path>',
  relevance: '<path d="M9 12l2 2 4-4"></path><circle cx="12" cy="12" r="9"></circle>',
  insights: '<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"></path><path d="M9 12h6M9 15.5h6M9 8.5h3"></path>',
  'rule-engine': '<path d="M4 19.5V6a2 2 0 0 1 2-2h9l5 5v10.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"></path><path d="M9 12h6M9 15.5h6M9 8.5h3"></path>',
  users: '<circle cx="9" cy="8" r="3.1"></circle><path d="M3.5 19.5c.6-3.4 2.9-5.3 5.5-5.3s4.9 1.9 5.5 5.3"></path><circle cx="17" cy="9" r="2.3"></circle>',
  'reports-yoy': '<path d="M4 19.5h16"></path><path d="M7 19.5v-6M12 19.5v-10M17 19.5v-3.5"></path>',
  'reports-full-sales': '<rect x="3.5" y="4" width="17" height="16" rx="1.6"></rect><path d="M3.5 9.5h17M3.5 14.5h17M9 4v16"></path>',
  'product-substitutes': '<path d="M7 7h11l-2.5-2.5"></path><path d="M17 17H6l2.5 2.5"></path>'
};

function navSvg(key) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (NAV_ICONS[key] || '') + '</svg>';
}

const NAV_GROUPS = [
  { title: 'טעינת נתונים יומית', items: [
    { key: 'sales', href: 'sales.html', label: 'טעינת קובץ מכירות', countKey: 'sales' },
    { key: 'customers', href: 'customers.html', label: 'טעינת לקוחות', master: true, countKey: 'customers' },
    { key: 'products', href: 'products.html', label: 'טעינת מוצרים', master: true, countKey: 'products' },
    { key: 'inventory', href: 'inventory.html', label: 'טעינת מלאי', countKey: 'inventory' }
  ] },
  { title: 'הגדרות נתונים כלליים', items: [
    { key: 'holidays', href: 'holidays.html', label: 'ניהול חגים', countKey: 'holidays' },
    { key: 'seasons', href: 'seasons.html', label: 'ניהול עונתיות', countKey: 'seasons' },
    { key: 'relevance', href: 'relevance.html', label: 'שיוך חג ועונה למוצר' },
    { key: 'product-substitutes', href: 'product-substitutes.html', label: 'מוצרים תחליפיים' },
    { key: 'rule-engine', href: 'rule-engine.html', label: 'כללי מנוע התובנות' }
  ] },
  { title: 'דוחות', items: [
    { key: 'insights', href: 'insights.html', label: 'יומן תובנות' },
    { key: 'reports-full-sales', href: 'reports-full-sales.html', label: 'דוח מכירות מלא' }
  ] },
  { title: 'ניהול חברה', items: [
    { key: 'users', href: 'users.html', label: 'משתמשים' }
  ] }
];

const PAGE_LABELS = {
  dashboard: 'בית', sales: 'טעינת קובץ מכירות', customers: 'טעינת לקוחות', products: 'טעינת מוצרים',
  inventory: 'טעינת מלאי', holidays: 'ניהול חגים', seasons: 'ניהול עונתיות', relevance: 'שיוך חג ועונה למוצר',
  insights: 'יומן תובנות', 'rule-engine': 'כללי מנוע התובנות', users: 'משתמשים',
  'reports-yoy': 'דוח שנה מול שנה', 'product-substitutes': 'מוצרים תחליפיים', 'reports-full-sales': 'דוח מכירות מלא'
};

const Layout = (function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderSidebar(activeKey, counts) {
    let html =
      '<div class="brand-row">' +
      '<div class="brand-icon"><img src="img/logo.gif" alt="BINA"></div>' +
      '<div class="brand-text"><div class="brand-name">BINA</div><div class="brand-tagline">BINA. The Art of Smart Selling</div></div>' +
      '</div>' +
      '<a class="nav-cta' + (activeKey === 'dashboard' ? ' active' : '') + '" href="dashboard.html">' + navSvg('dashboard') + 'דשבורד</a>' +
      '<div class="nav-scroll">';

    NAV_GROUPS.forEach((group) => {
      html += '<div class="nav-group"><div class="nav-group-label">' + escapeHtml(group.title) + '</div>';
      group.items.forEach((item) => {
        const count = item.countKey && counts ? counts[item.countKey] : null;
        html += '<a class="nav-item' + (item.key === activeKey ? ' active' : '') + '" href="' + item.href + '">' +
          navSvg(item.key) + escapeHtml(item.label) +
          (item.master ? '<span class="master-badge">Master</span>' : '') +
          '<span class="spacer"></span>' +
          (count != null ? '<span class="nav-badge">' + Number(count).toLocaleString('he-IL') + '</span>' : '') +
          '</a>';
      });
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  function renderTopbar(pageKey, org) {
    return (
      '<div class="crumb">' +
      '<div class="crumb-pill">' + escapeHtml(PAGE_LABELS[pageKey] || pageKey) +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg></div>' +
      '</div>' +
      '<div class="source-pill">' + escapeHtml(org.name) + '</div>'
    );
  }

  function renderSidebarFooter(user) {
    const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();
    return (
      '<div class="sidebar-footer">' +
      '<div class="user-chip"><div class="avatar">' + escapeHtml(initial) + '</div>' +
      '<div class="user-meta"><div class="user-name">' + escapeHtml(user.name || user.email) + '</div>' +
      '<div class="user-role">' + (user.role === 'admin' ? 'מנהל' : 'חבר צוות') + '</div></div></div>' +
      '<button class="logout-btn" id="logoutBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"></path><path d="M9 12h11m0 0-3-3m3 3-3 3"></path></svg>התנתקות</button>' +
      '</div>'
    );
  }

  async function init(pageKey) {
    // Fired together, not sequentially — nav-counts only needs the same auth cookie
    // auth/me checks, not auth/me's response, and this runs on every single page
    // navigation in the app, so the round-trip it saves adds up.
    const [res, countsRes] = await Promise.all([
      fetch('/api/auth/me', { credentials: 'include' }),
      fetch('/api/nav-counts', { credentials: 'include' }).catch(() => null)
    ]);
    if (!res.ok) { window.location.href = 'login.html'; return null; }
    const data = await res.json();

    let counts = null;
    try {
      if (countsRes && countsRes.ok) counts = await countsRes.json();
    } catch (err) { /* badges are cosmetic — ignore failures */ }

    const sidebarMount = document.getElementById('sidebarMount');
    const topbarMount = document.getElementById('topbarMount');
    if (sidebarMount) {
      sidebarMount.innerHTML = renderSidebar(pageKey, counts) + renderSidebarFooter(data.user);
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        window.location.href = 'login.html';
      });
    }
    if (topbarMount) topbarMount.innerHTML = renderTopbar(pageKey, data.organization);

    Layout.currentUser = data.user;
    Layout.currentOrg = data.organization;
    return data;
  }

  return { init: init, escapeHtml: escapeHtml, currentUser: null, currentOrg: null };
})();
