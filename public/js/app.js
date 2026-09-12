async function init() {
  const data = await Layout.init('dashboard');
  if (!data) return;

  document.getElementById('greeting').textContent = 'שלום, ' + (data.user.name || data.user.email);
  const today = new Date();
  const p = (n) => String(n).padStart(2, '0');
  document.getElementById('updateLine').textContent = 'תאריך: ' + p(today.getDate()) + '.' + p(today.getMonth() + 1) + '.' + today.getFullYear();
}

init();
