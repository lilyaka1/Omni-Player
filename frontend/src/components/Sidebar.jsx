import { useEffect, useMemo, useState } from 'react';
import { getToken, clearToken } from '../utils/auth';
import { showToast } from '../utils/toast';

export default function Sidebar({ activePage, onPageChange }) {
  const token = getToken();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [myRooms, setMyRooms] = useState([]);

  async function loadCurrentUser() {
    if (!token) return;
    try {
      const res = await fetch('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        clearToken();
        return;
      }
      const user = await res.json();
      setCurrentUser(user);
    } catch {
      clearToken();
    }
  }

  async function loadRooms() {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/rooms/', { headers });
      if (!res.ok) return;
      const data = await res.json();
      setRooms(data.rooms || []);
    } catch {
      // ignore
    }
  }

  async function deleteMyRoom(roomId) {
    if (!token) return;
    if (!confirm('Удалить комнату?')) return;
    try {
      const res = await fetch(`/rooms/${roomId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      showToast('Комната удалена', 'success');
      loadRooms();
    } catch {
      showToast('Ошибка удаления', 'error');
    }
  }

  useEffect(() => {
    loadCurrentUser();
    loadRooms();
    const interval = setInterval(loadRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (currentUser && rooms.length) {
      const mine = rooms.filter((r) => r.owner_id === currentUser.id);
      setMyRooms(mine);
    }
  }, [currentUser, rooms]);

  const navMap = useMemo(() => ({
    home: '/',
    search: '/',
    rooms: '/',
    genres: '/',
    profile: '/profile',
    player: '/player',
    live: '/live',
    room: '/room',
  }), []);

  const handleNav = (page) => {
    setSidebarOpen(false);
    const href = navMap[page] || '/';
    // Pages that have their own route should always navigate via href
    const externalPages = ['player', 'live', 'room', 'profile'];
    if (externalPages.includes(page)) {
      if (window.location.pathname !== href) {
        window.location.href = href;
      }
      return;
    }
    if (onPageChange) {
      onPageChange(page);
      return;
    }
    if (window.location.pathname !== href) {
      window.location.href = href;
    }
  };

  return (
    <>
      <button className="hamburger-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
        <i className={`fa-solid ${sidebarOpen ? 'fa-times' : 'fa-bars'}`} />
      </button>
      <aside className={`sidebar glass glass-primary ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon"><i className="fa-solid fa-circle-play" /></div>
          <span>Omniplayer</span>
        </div>

        <nav>
          <div className="nav-section-label">Главное</div>
          <button className={`nav-item ${activePage === 'home' ? 'active' : ''}`} onClick={() => handleNav('home')}>
            <i className="fa-solid fa-house" /> Главная
          </button>
          <button className={`nav-item ${activePage === 'search' ? 'active' : ''}`} onClick={() => handleNav('search')}>
            <i className="fa-solid fa-magnifying-glass" /> Поиск
          </button>

          <div className="nav-section-label">Каталог</div>
          <button className={`nav-item ${activePage === 'rooms' ? 'active' : ''}`} onClick={() => handleNav('rooms')}>
            <i className="fa-solid fa-door-open" /> Комнаты
            {rooms.length > 0 && <span className="count-badge glass-flat">{rooms.length}</span>}
          </button>
          <button className={`nav-item ${activePage === 'genres' ? 'active' : ''}`} onClick={() => handleNav('genres')}>
            <i className="fa-solid fa-layer-group" /> Жанры
          </button>
          <button className={`nav-item ${activePage === 'player' ? 'active' : ''}`} onClick={() => handleNav('player')}>
            <i className="fa-solid fa-bookmark" /> Моя медиотека
          </button>

          {!!myRooms.length && (
            <div>
              <div className="sidebar-divider" />
              <div className="nav-section-label">Мои комнаты</div>
              <div>
                {myRooms.slice(0, 5).map((room) => (
                  <div className="nav-item" style={{ justifyContent: 'space-between', gap: 8 }} key={room.id}>
                    <button
                      style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer' }}
                      onClick={() => {
                        setSidebarOpen(false);
                        window.location.href = `/user?room_id=${room.id}`;
                      }}
                    >
                      <i className="fa-solid fa-music" />
                      <span className="truncate" style={{ flex: 1, textAlign: 'left' }}>{room.name}</span>
                    </button>
                    <button
                      onClick={() => deleteMyRoom(room.id)}
                      title="Удалить комнату"
                      style={{ all: 'unset', cursor: 'pointer', color: '#ff6b6b', padding: '2px 4px', borderRadius: 8 }}
                    >
                      <i className="fa-solid fa-trash-can" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="sidebar-divider" />
        <button className="nav-item" id="themeToggle">
          <i className="fa-solid fa-moon" id="themeIcon" /> Тема
        </button>

        <div className="sidebar-footer">
          {currentUser ? (
            <div className="user-card" onClick={() => handleNav('profile')} style={{ cursor: 'pointer' }}>
              <div className="user-avatar">
                {currentUser.avatar_url ? (
                  <img src={currentUser.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  currentUser.username?.[0]?.toUpperCase() || '?'
                )}
              </div>
              <div className="user-info">
                <div className="name">{currentUser.username}</div>
                <div className="role">{currentUser.is_admin ? 'Администратор' : 'Пользователь'}</div>
              </div>
              <button className="logout-btn" title="Выйти" onClick={(e) => { e.stopPropagation(); clearToken(); window.location.href = '/login'; }}>
                <i className="fa-solid fa-right-from-bracket" />
              </button>
            </div>
          ) : (
            <button className="nav-item" onClick={() => { window.location.href = '/login'; }}>
              <i className="fa-solid fa-right-to-bracket" /> Войти
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
