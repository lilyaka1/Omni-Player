/**
 * auth.js — Логика страницы /login (вход и регистрация).
 */

(function () {

  function extractErrorMessage(payload, fallback) {
    if (!payload) return fallback;

    const detail = payload.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;

    if (Array.isArray(detail) && detail.length) {
      const first = detail[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') {
        if (typeof first.msg === 'string' && first.msg.trim()) return first.msg;
        if (Array.isArray(first.loc) && first.loc.length) {
          const field = String(first.loc[first.loc.length - 1] || 'field');
          const msg = typeof first.msg === 'string' ? first.msg : 'invalid value';
          return `${field}: ${msg}`;
        }
      }
    }

    if (detail && typeof detail === 'object') {
      if (typeof detail.message === 'string' && detail.message.trim()) return detail.message;
      if (typeof detail.msg === 'string' && detail.msg.trim()) return detail.msg;
    }

    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
    return fallback;
  }

  // ---- Если уже авторизован — редиректим ----
  if (localStorage.getItem('token')) {
    verifyAndRedirect();
  }

  async function verifyAndRedirect() {
    try {
      const res = await fetch('/auth/me', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) window.location.href = '/';
    } catch {}
  }

  // ---- Theme ----
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon   = document.getElementById('themeIcon');
  let darkMode = localStorage.getItem('theme') === 'dark';
  applyTheme();

  themeToggle?.addEventListener('click', () => {
    darkMode = !darkMode;
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
    applyTheme();
  });

  function applyTheme() {
    document.body.classList.toggle('dark', darkMode);
    if (themeIcon) themeIcon.className = darkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }

  // ---- Tabs ----
  const tabs = document.querySelectorAll('.auth-tab');
  const loginForm    = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      loginForm.classList.toggle('hidden',    which !== 'login');
      registerForm.classList.toggle('hidden', which !== 'register');
      // Очистить ошибки
      document.getElementById('loginError').textContent    = '';
      document.getElementById('registerError').textContent = '';
    });
  });

  // ---- Password toggle ----
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      btn.querySelector('i').className = isText ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    });
  });

  // ---- Login ----
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = document.getElementById('loginBtn');
    const errEl    = document.getElementById('loginError');
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
      errEl.textContent = 'Заполните все поля';
      return;
    }

    setLoading(btn, true);
    errEl.textContent = '';

    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.access_token) {
        localStorage.setItem('token', data.access_token);
        window.location.href = '/';
      } else {
        errEl.textContent = extractErrorMessage(data, 'Неверный логин или пароль');
      }
    } catch {
      errEl.textContent = 'Ошибка сети, попробуйте позже';
    } finally {
      setLoading(btn, false);
    }
  });

  // ---- Register ----
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = document.getElementById('registerBtn');
    const errEl    = document.getElementById('registerError');
    const username = document.getElementById('regUsername').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;

    errEl.textContent = '';

    if (!username || !password) {
      errEl.textContent = 'Заполните имя и пароль';
      return;
    }
    if (password !== password2) {
      errEl.textContent = 'Пароли не совпадают';
      return;
    }
    if (password.length < 6) {
      errEl.textContent = 'Пароль должен быть не менее 6 символов';
      return;
    }

    setLoading(btn, true);

    try {
      const body = { username, password };
      if (email) body.email = email;

      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        // После регистрации — сразу входим
        await autoLogin(username, password, errEl);
      } else {
        errEl.textContent = extractErrorMessage(data, 'Ошибка регистрации');
      }
    } catch {
      errEl.textContent = 'Ошибка сети';
    } finally {
      setLoading(btn, false);
    }
  });

  async function autoLogin(username, password, errEl) {
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) {
        localStorage.setItem('token', data.access_token);
        window.location.href = '/';
      } else {
        if (errEl) errEl.textContent = 'Аккаунт создан! Войдите вручную.';
        // Переключить на вкладку входа
        document.querySelector('[data-tab="login"]')?.click();
      }
    } catch {}
  }

  function setLoading(btn, loading) {
    if (!btn) return;
    const text    = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.spinner');
    btn.disabled          = loading;
    if (text)    text.style.display    = loading ? 'none' : '';
    if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
  }

})();
