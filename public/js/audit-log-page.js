// Read-only report over the AuditLog table (see src/lib/auditLog.js for which
// actions get recorded) — no upload/delete here, same reasoning as
// reports-full-sales-page.js: this data is a byproduct of other pages' actions,
// never edited directly.
const AUDIT_ACTION_LABELS = {
  'auth.login': 'התחברות',
  'auth.login_failed': 'ניסיון התחברות כושל',
  'user.invite': 'הזמנת משתמש',
  'user.role_change': 'שינוי תפקיד משתמש',
  'user.delete': 'מחיקת משתמש',
  'organization.create': 'יצירת חברה',
  'sale.upload': 'טעינת קובץ מכירות',
  'sale.delete_all': 'מחיקת כל נתוני המכירות',
  'customer.upload': 'טעינת קובץ לקוחות',
  'customer.delete_all': 'מחיקת כל נתוני הלקוחות',
  'product.upload': 'טעינת קובץ מוצרים',
  'product.delete_all': 'מחיקת כל נתוני המוצרים',
  'inventory.upload': 'טעינת קובץ מלאי',
  'inventory.delete_all': 'מחיקת כל נתוני המלאי'
};

function fmtAuditDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

async function initAuditLogPage() {
  const data = await Layout.init('audit-log');
  if (!data) return;

  createServerTable(document.getElementById('tableContainer'), [
    { key: 'createdAt', label: 'תאריך ושעה', render: (r) => fmtAuditDate(r.createdAt) },
    { key: 'userEmail', label: 'בוצע על ידי', filterable: true },
    { key: 'action', label: 'פעולה', render: (r) => AUDIT_ACTION_LABELS[r.action] || r.action, filterable: true },
    { key: 'details', label: 'פרטים', sortable: false }
  ], {
    apiBase: '/api/audit-log',
    defaultSort: { field: 'createdAt', dir: 'desc' },
    deletable: false,
    tableKey: 'audit-log'
  });
}

initAuditLogPage();
