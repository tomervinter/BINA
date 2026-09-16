document.getElementById('loginForm').addEventListener('submit', async function(e){
  e.preventDefault();
  const errorBox = document.getElementById('errorBox');
  errorBox.style.display = 'none';
  const body = {
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value
  };
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(body)
    });
    const data = await res.json();
    if(!res.ok){ errorBox.textContent = data.error || 'שגיאה בהתחברות'; errorBox.style.display = 'block'; return; }
    window.location.href = 'dashboard.html';
  } catch(err){
    errorBox.textContent = 'שגיאת רשת — נסו שוב';
    errorBox.style.display = 'block';
  }
});
