async function handleAuthSubmit({ endpoint, username, password, errorEl }) {
  errorEl.textContent = '';
  try {
    const authHash = await computeAuthHash(password, username);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, authHash }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Something went wrong';
      return;
    }

    // We already have the plaintext password in hand on this page, so derive
    // and stash the note-encryption key locally right away. It never leaves
    // the browser, and this saves the friend an extra prompt on this device.
    const encKey = await deriveEncKey(password, username);
    await storeEncKey(username, encKey);

    window.location.href = '/timeline.html';
  } catch (err) {
    errorEl.textContent = 'Could not reach the server. Please try again.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const errorEl = document.getElementById('error');
      handleAuthSubmit({ endpoint: '/api/login', username, password, errorEl });
    });
  }

  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm-password').value;
      const errorEl = document.getElementById('error');

      if (password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters';
        return;
      }
      if (password !== confirm) {
        errorEl.textContent = 'Passwords do not match';
        return;
      }
      handleAuthSubmit({ endpoint: '/api/signup', username, password, errorEl });
    });
  }
});
