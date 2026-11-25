'use strict';
const form = document.getElementById('loginForm');
const button = document.getElementById('signIn');
const status = document.getElementById('loginStatus');
const next = new URLSearchParams(location.search).get('next');
form.onsubmit = async event => {
  event.preventDefault();
  status.textContent = '';
  button.disabled = true;
  try {
    const response = await fetch('/api/session', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({password: document.getElementById('password').value}),
    });
    if (response.ok) {
      location.replace(next === 'stats' ? '/stats' : next === 'gamecast' ? '/gamecast' : next === 'spotting' ? '/spotting' : '/control');
      return;
    }
    status.textContent = (await response.json()).error || 'Sign-in is temporarily unavailable.';
  } catch {
    status.textContent = 'Could not reach the studio. Try again.';
  } finally {
    button.disabled = false;
  }
};
