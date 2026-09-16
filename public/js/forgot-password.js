document.getElementById('forgotForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const errorBox = document.getElementById('errorBox');
  const successBox = document.getElementById('successBox');
  errorBox.style.display = 'none';
  successBox.style.display = 'none';
  const email = document.getElementById('email').value.trim();
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) { errorBox.textContent = data.error || 'שגיאה בשליחת הקישור'; errorBox.style.display = 'block'; return; }
    // Always shows success regardless of whether the email is registered — the
    // server intentionally never reveals that, to avoid leaking which addresses exist.
    successBox.textContent = 'אם קיים חשבון עם כתובת זו, נשלח אליו קישור לאיפוס הסיסמה.';
    successBox.style.display = 'block';
    document.getElementById('forgotForm').reset();
  } catch (err) {
    errorBox.textContent = 'שגיאת רשת — נסו שוב';
    errorBox.style.display = 'block';
  }
});
