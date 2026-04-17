import { useEffect, useState } from 'react';

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

export default function LoginPage() {
  const [tab, setTab] = useState('login');
  const [darkMode, setDarkMode] = useState(localStorage.getItem('theme') === 'dark');

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPassword2, setRegPassword2] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [registerLoading, setRegisterLoading] = useState(false);

  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegPassword2, setShowRegPassword2] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    if (!token) return;

    fetch('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.ok) {
          window.location.href = '/';
          return;
        }
        localStorage.removeItem('token');
        localStorage.removeItem('access_token');
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('access_token');
      });
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setLoginError('');

    const username = loginUsername.trim();
    const password = loginPassword;

    if (!username || !password) {
      setLoginError('Заполните все поля');
      return;
    }

    setLoginLoading(true);
    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) {
        setLoginError(extractErrorMessage(data, 'Неверный логин или пароль'));
        return;
      }

      localStorage.setItem('token', data.access_token);
      localStorage.setItem('access_token', data.access_token);
      window.location.href = '/';
    } catch {
      setLoginError('Ошибка сети, попробуйте позже');
    } finally {
      setLoginLoading(false);
    }
  }

  async function autoLogin(username, password) {
    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.access_token) {
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('access_token', data.access_token);
        window.location.href = '/';
        return;
      }
      setRegisterError('Аккаунт создан! Войдите вручную.');
      setTab('login');
    } catch {
      setRegisterError('Аккаунт создан! Войдите вручную.');
      setTab('login');
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setRegisterError('');

    const username = regUsername.trim();
    const email = regEmail.trim();
    const password = regPassword;
    const password2 = regPassword2;

    if (!username || !password) {
      setRegisterError('Заполните имя и пароль');
      return;
    }
    if (password !== password2) {
      setRegisterError('Пароли не совпадают');
      return;
    }
    if (password.length < 6) {
      setRegisterError('Пароль должен быть не менее 6 символов');
      return;
    }

    setRegisterLoading(true);
    try {
      const payload = { username, password };
      if (email) payload.email = email;

      const response = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRegisterError(extractErrorMessage(data, 'Ошибка регистрации'));
        return;
      }

      await autoLogin(username, password);
    } catch {
      setRegisterError('Ошибка сети');
    } finally {
      setRegisterLoading(false);
    }
  }

  return (
    <div className="auth-page-wrap">
      <div className="auth-card glass glass-primary">
        <div className="auth-head">
          <div className="auth-brand">
            <div className="auth-logo"><i className="fa-solid fa-circle-play" /></div>
            <div>
              <h1>Omni Player</h1>
              <p>Добро пожаловать обратно</p>
            </div>
          </div>
          <button className="btn btn-icon glass-tertiary" id="themeToggle" onClick={() => setDarkMode((v) => !v)} title="Переключить тему">
            <i className={`fa-solid ${darkMode ? 'fa-sun' : 'fa-moon'}`} id="themeIcon" />
          </button>
        </div>

        <div className="auth-tabs">
          <button className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setRegisterError(''); }} data-tab="login">Вход</button>
          <button className={`auth-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setLoginError(''); }} data-tab="register">Регистрация</button>
        </div>

        {tab === 'login' && (
          <form id="loginForm" onSubmit={handleLogin}>
            {loginError ? <div className="auth-error" id="loginError">{loginError}</div> : <div id="loginError" />}

            <div className="form-group-auth">
              <label htmlFor="loginUsername">Логин</label>
              <input id="loginUsername" className="input" type="text" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} autoComplete="username" required />
            </div>

            <div className="form-group-auth">
              <label htmlFor="loginPassword">Пароль</label>
              <div className="password-wrap">
                <input id="loginPassword" className="input" type={showLoginPassword ? 'text' : 'password'} value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="current-password" required />
                <button type="button" className="password-toggle" onClick={() => setShowLoginPassword((v) => !v)}>
                  <i className={`fa-solid ${showLoginPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                </button>
              </div>
            </div>

            <button id="loginBtn" className="btn btn-accent w-full" type="submit" disabled={loginLoading}>
              {!loginLoading && <span className="btn-text">Войти</span>}
              {loginLoading && <><span className="spinner" style={{ display: 'inline-block' }} /> Вход...</>}
            </button>
          </form>
        )}

        {tab === 'register' && (
          <form id="registerForm" onSubmit={handleRegister}>
            {registerError ? <div className="auth-error" id="registerError">{registerError}</div> : <div id="registerError" />}

            <div className="form-group-auth">
              <label htmlFor="regUsername">Логин</label>
              <input id="regUsername" className="input" type="text" value={regUsername} onChange={(e) => setRegUsername(e.target.value)} autoComplete="username" required />
            </div>

            <div className="form-group-auth">
              <label htmlFor="regEmail">Email (опционально)</label>
              <input id="regEmail" className="input" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} autoComplete="email" />
            </div>

            <div className="form-group-auth">
              <label htmlFor="regPassword">Пароль</label>
              <div className="password-wrap">
                <input id="regPassword" className="input" type={showRegPassword ? 'text' : 'password'} value={regPassword} onChange={(e) => setRegPassword(e.target.value)} autoComplete="new-password" required />
                <button type="button" className="password-toggle" onClick={() => setShowRegPassword((v) => !v)}>
                  <i className={`fa-solid ${showRegPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                </button>
              </div>
            </div>

            <div className="form-group-auth">
              <label htmlFor="regPassword2">Повторите пароль</label>
              <div className="password-wrap">
                <input id="regPassword2" className="input" type={showRegPassword2 ? 'text' : 'password'} value={regPassword2} onChange={(e) => setRegPassword2(e.target.value)} autoComplete="new-password" required />
                <button type="button" className="password-toggle" onClick={() => setShowRegPassword2((v) => !v)}>
                  <i className={`fa-solid ${showRegPassword2 ? 'fa-eye-slash' : 'fa-eye'}`} />
                </button>
              </div>
            </div>

            <button id="registerBtn" className="btn btn-accent w-full" type="submit" disabled={registerLoading}>
              {!registerLoading && <span className="btn-text">Создать аккаунт</span>}
              {registerLoading && <><span className="spinner" style={{ display: 'inline-block' }} /> Регистрация...</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
