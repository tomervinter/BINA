async function init() {
  const data = await Layout.init('dashboard');
  if (!data) return;

  // The dashboard is the home page — a "בית" breadcrumb pill pointing at itself is
  // redundant here (every other page's crumb is useful; this one only ever names
  // the page you're already looking at).
  const crumb = document.querySelector('.crumb');
  if (crumb) crumb.remove();

  document.getElementById('greeting').textContent = 'שלום, ' + (data.user.name || data.user.email);
  const today = new Date();
  const p = (n) => String(n).padStart(2, '0');
  document.getElementById('updateLine').textContent = 'תאריך: ' + p(today.getDate()) + '.' + p(today.getMonth() + 1) + '.' + today.getFullYear();
}

init();
