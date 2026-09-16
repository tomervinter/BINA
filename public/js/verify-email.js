(async function () {
  const errorBox = document.getElementById('errorBox');
  const successBox = document.getElementById('successBox');
  const statusText = document.getElementById('statusText');
  const token = new URLSearchParams(window.location.search).get('token');

  if (!token) {
    statusText.style.display = 'none';
    errorBox.textContent = 'קישור לא תקין';
    errorBox.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/auth/verify-email?token=' + encodeURIComponent(token), { credentials: 'include' });
    const data = await res.json();
    statusText.style.display = 'none';
    if (!res.ok) { errorBox.textContent = data.error || 'שגיאה באימות המייל'; errorBox.style.display = 'block'; return; }
    successBox.textContent = 'כתובת המייל אומתה בהצלחה!';
    successBox.style.display = 'block';
  } catch (err) {
    statusText.style.display = 'none';
    errorBox.textContent = 'שגיאת רשת — נסו שוב';
    errorBox.style.display = 'block';
  }
})();
