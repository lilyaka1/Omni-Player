import { useEffect, useState } from 'react';
import { clearToken, getToken } from '../utils/auth';

export default function ProfilePage() {
  const token = getToken();
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!token) {
      window.location.replace('/login');
      return;
    }
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const res = await fetch('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        window.location.replace('/login');
        return;
      }
      const profile = await res.json();
      setUser(profile);
      document.title = `${profile.username} — Omni Player`;
    } catch {
      // noop
    }
  }

  function logout() {
    if (!window.confirm('Выйти из аккаунта?')) return;
    clearToken();
    window.location.replace('/login');
  }

  return (
    <>
      <div id="toast-container" />
      <div className="profile-page">
        <div className="glass glass-primary profile-card">
          <div className="profile-card-tools">
            <button className="btn btn-icon glass-tertiary" id="themeToggle" title="Переключить тему" style={{ width: 38, height: 38, fontSize: '0.9rem' }}>
              <i className="fa-solid fa-moon" id="themeIcon" />
            </button>
          </div>

          <div className="profile-avatar">{user?.username?.[0]?.toUpperCase() || '?'}</div>
          <div className="profile-name">{user?.username || 'Загрузка...'}</div>
          <div className="profile-email">{user?.email || ''}</div>

          <div className="profile-badges">
            {user?.is_admin && <span className="badge glass-tertiary"><i className="fa-solid fa-shield-halved" /> Admin</span>}
            {user?.can_create_rooms && <span className="badge glass-tertiary"><i className="fa-solid fa-door-open" /> Creator</span>}
          </div>

          <div>
            <div className="profile-stat"><span className="label">ID пользователя</span><span className="value">{user?.id ?? '—'}</span></div>
            <div className="profile-stat"><span className="label">Имя пользователя</span><span className="value">{user?.username ?? '—'}</span></div>
            <div className="profile-stat"><span className="label">Роль</span><span className="value">{user ? (user.is_admin ? 'Администратор' : 'Пользователь') : '—'}</span></div>
            <div className="profile-stat"><span className="label">Может создавать комнаты</span><span className="value">{user ? ((user.can_create_rooms || user.is_admin) ? 'Да' : 'Нет') : '—'}</span></div>
          </div>

          <div className="profile-actions">
            <button className="btn" onClick={() => (window.location.href = '/')}><i className="fa-solid fa-door-open" /> Комнаты</button>
            <button className="btn" onClick={() => (window.location.href = '/player')}><i className="fa-solid fa-music" /> Локальный плеер</button>
            <button className="btn" style={{ color: '#ff5050', borderColor: 'rgba(255,80,80,0.3)' }} onClick={logout}><i className="fa-solid fa-right-from-bracket" /> Выйти</button>
          </div>
        </div>
      </div>
    </>
  );
}
