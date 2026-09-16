fetch('/api/auth/me', { credentials: 'include' })
  .then(function (res) { window.location.replace(res.ok ? 'dashboard.html' : 'login.html'); })
  .catch(function () { window.location.replace('login.html'); });
