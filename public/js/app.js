// Boots the page: auth gate, then view switching between the three
// screens. No client-side framework, just plain DOM wiring.
(function () {
  // The Home button lives in the masthead and stays visible on every
  // screen, logged in or not. The app-section buttons (Log a sale /
  // Ledger / Financial blueprint) track whether you have a session, not
  // which screen is currently showing, so that browsing to Home while
  // logged in doesn't hide your way back into the app.
  function refreshNav() {
    const authed = Boolean(SokoAPI.getToken());
    document.querySelectorAll('#main-nav button[data-view]').forEach((b) => b.classList.toggle('hidden', !authed));
    document.getElementById('who-box').classList.toggle('hidden', !authed);
    if (authed) document.getElementById('who-username').textContent = SokoAPI.getUsername() || '';
  }

  function showAuthed() {
    if (window.SokoHeroDemo) SokoHeroDemo.stop();
    refreshNav();
    switchView('entry');
    SokoEntry.startPendingPolling();
  }

  // Home always means the landing page, logged in or not. If you're
  // still signed in, the app nav stays visible (see refreshNav) so this
  // never strands you, it's just a way to see the marketing page again.
  function showLanding() {
    if (!SokoAPI.getToken()) SokoEntry.stopPendingPolling();
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById('landing-view').classList.add('active');
    refreshNav();
    if (window.SokoHeroDemo) SokoHeroDemo.init();
  }

  // mode: 'login' | 'register', defaults to whichever card is already
  // showing (or login, the first time in).
  function showAuth(mode) {
    SokoEntry.stopPendingPolling();
    if (window.SokoHeroDemo) SokoHeroDemo.stop();
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById('auth-view').classList.add('active');
    document.querySelectorAll('#main-nav button[data-view]').forEach((b) => b.classList.add('hidden'));
    document.getElementById('who-box').classList.add('hidden');
    if (mode === 'register') {
      document.querySelector('#auth-view .ledger-card:not(#register-card)').classList.add('hidden');
      document.getElementById('register-card').classList.remove('hidden');
    } else if (mode === 'login') {
      document.querySelector('#auth-view .ledger-card:not(#register-card)').classList.remove('hidden');
      document.getElementById('register-card').classList.add('hidden');
    }
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
      showLanding();
    });
  }

  function bindLanding() {
    document.getElementById('wordmark-btn').addEventListener('click', showLanding);
    document.getElementById('home-btn').addEventListener('click', showLanding);
    document.getElementById('landing-get-started').addEventListener('click', () => showAuth('register'));
    document.getElementById('landing-login').addEventListener('click', () => showAuth('login'));
    document.getElementById('auth-back-btn').addEventListener('click', showLanding);
    document.getElementById('auth-back-btn-2').addEventListener('click', showLanding);
  }

  function bindPasswordToggles() {
    document.querySelectorAll('.password-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        const showing = input.type === 'password';
        input.type = showing ? 'text' : 'password';
        btn.classList.toggle('showing', showing);
        btn.setAttribute('aria-pressed', String(showing));
        btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
        btn.title = showing ? 'Hide password' : 'Show password';
      });
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

  window.addEventListener('sokoledger:unauthorized', () => showAuth('login'));

  document.addEventListener('DOMContentLoaded', () => {
    bindNav();
    bindLanding();
    bindAuthForms();
    bindPasswordToggles();
    SokoEntry.init();
    SokoLedger.bind();
    SokoAnalytics.bind();

    if (SokoAPI.getToken()) {
      showAuthed();
    } else {
      showLanding();
    }
  });
})();
