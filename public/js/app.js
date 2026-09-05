async function init() {
  const data = await Layout.init('dashboard');
  if (!data) return;

  document.querySelectorAll('button[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => uploadFile(btn.getAttribute('data-target')));
  });

  await refreshInsightsCount();
}

async function uploadFile(target) {
  const input = document.getElementById(target + 'File');
  const statusLine = document.getElementById('uploadStatus');
  if (!input.files || !input.files[0]) { statusLine.textContent = 'יש לבחור קובץ קודם'; statusLine.style.color = 'var(--red)'; return; }
  const form = new FormData();
  form.append('file', input.files[0]);
  statusLine.textContent = 'טוען...'; statusLine.style.color = 'var(--text-muted)';
  try {
    const res = await fetch('/api/' + target + '/upload', { method: 'POST', credentials: 'include', body: form });
    const result = await res.json();
    if (!res.ok) { statusLine.textContent = result.error || 'שגיאה בהעלאה'; statusLine.style.color = 'var(--red)'; return; }
    statusLine.textContent = '✓ נטענו ' + result.count + ' רשומות'; statusLine.style.color = 'var(--green)';
    await refreshInsightsCount();
  } catch (err) {
    statusLine.textContent = 'שגיאת רשת'; statusLine.style.color = 'var(--red)';
  }
}

async function refreshInsightsCount() {
  const res = await fetch('/api/insights', { credentials: 'include' });
  if (!res.ok) return;
  const insights = await res.json();
  document.getElementById('insightsCount').textContent = insights.length;
}

init();
