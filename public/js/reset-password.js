const form = document.getElementById('resetForm');
const errorBox = document.getElementById('errorBox');
const successBox = document.getElementById('successBox');
const token = new URLSearchParams(window.location.search).get('token');

if (!token) {
  form.style.display = 'none';
  errorBox.textContent = 'קישור לא תקין — יש לבקש קישור חדש מדף "שכחתי סיסמה"';
  errorBox.style.display = 'block';
}

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  errorBox.style.display = 'none';
  successBox.style.display = 'none';
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (newPassword !== confirmPassword) {
    errorBox.textContent = 'הסיסמאות אינן תואמות';
    errorBox.style.display = 'block';
    return;
  }
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ token, newPassword })
    });
    const data = await res.json();
    if (!res.ok) { errorBox.textContent = data.error || 'שגיאה באיפוס הסיסמה'; errorBox.style.display = 'block'; return; }
    successBox.textContent = 'הסיסמה עודכנה בהצלחה — מיד תועברו להתחברות.';
    successBox.style.display = 'block';
    form.style.display = 'none';
    setTimeout(function () { window.location.href = 'login.html'; }, 1800);
  } catch (err) {
    errorBox.textContent = 'שגיאת רשת — נסו שוב';
    errorBox.style.display = 'block';
  }
});
