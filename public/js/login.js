const loginForm = document.getElementById('loginForm');
const submitBtn = loginForm.querySelector('button[type="submit"]');
const submitBtnDefaultText = submitBtn.textContent;
const LOGIN_TIMEOUT_MS = 20000;

loginForm.addEventListener('submit', async function(e){
  e.preventDefault();
  const errorBox = document.getElementById('errorBox');
  errorBox.style.display = 'none';
  const body = {
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value
  };

  submitBtn.disabled = true;
  submitBtn.textContent = 'מתחבר...';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(body), signal: controller.signal
    });
    const data = await res.json();
    if(!res.ok){ errorBox.textContent = data.error || 'שגיאה בהתחברות'; errorBox.style.display = 'block'; return; }
    window.location.href = 'dashboard.html';
    return; // keep the button disabled through the navigation instead of re-enabling below
  } catch(err){
    errorBox.textContent = err.name === 'AbortError'
      ? 'השרת לא הגיב בזמן — ייתכן שהוא בתהליך "התעוררות", נסו שוב בעוד רגע'
      : 'שגיאת רשת — נסו שוב';
    errorBox.style.display = 'block';
  } finally {
    clearTimeout(timeoutId);
    submitBtn.disabled = false;
    submitBtn.textContent = submitBtnDefaultText;
  }
});
