// Boots the page: auth gate, then view switching between the three
// screens. No client-side framework — plain DOM wiring.
(function () {
  function showAuthed() {
    document.getElementById('auth-view').classList.remove('active');
    document.getElementById('main-nav').classList.remove('hidden');
    document.getElementById('who-box').classList.remove('hidden');
    document.getElementById('who-username').textContent = SokoAPI.getUsername() || '';
    switchView('entry');
  }

  function showAuth() {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById('auth-view').classList.add('active');
    document.getElementById('main-nav').classList.add('hidden');
    document.getElementById('who-box').classList.add('hidden');
  }

  function switchView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById(`${name}-view`).classList.add('active');
    document.querySelectorAll('#main-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'ledger') SokoLedger.onShow();
    if (name === 'blueprint') SokoAnalytics.onShow();
  }

  function bindNav() {
    document.getElementById('main-nav').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (btn) switchView(btn.dataset.view);
    });
    document.getElementById('logout-btn').addEventListener('click', () => {
      SokoAPI.clearSession();
      showAuth();
    });
  }

  function bindAuthForms() {
    document.getElementById('show-register').addEventListener('click', () => {
      document.querySelector('#auth-view .ledger-card').classList.add('hidden');
      document.getElementById('register-card').classList.remove('hidden');
    });
    document.getElementById('show-login').addEventListener('click', () => {
      document.getElementById('register-card').classList.add('hidden');
      document.querySelector('#auth-view .ledger-card').classList.remove('hidden');
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error');
      errorEl.classList.add('hidden');
      try {
        const data = await SokoAPI.request('/api/auth/login', { method: 'POST', body: { username, password } });
        SokoAPI.setSession(data.token, data.username);
        showAuthed();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('register-username').value.trim();
      const password = document.getElementById('register-password').value;
      const errorEl = document.getElementById('register-error');
      errorEl.classList.add('hidden');
      try {
        const data = await SokoAPI.request('/api/auth/register', { method: 'POST', body: { username, password } });
        SokoAPI.setSession(data.token, data.username);
        showAuthed();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });
  }

  window.addEventListener('sokoledger:unauthorized', showAuth);

  document.addEventListener('DOMContentLoaded', () => {
    bindNav();
    bindAuthForms();
    SokoEntry.init();
    SokoLedger.bind();
    SokoAnalytics.bind();

    if (SokoAPI.getToken()) {
      showAuthed();
    } else {
      showAuth();
    }
  });
})();
