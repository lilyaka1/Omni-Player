import { useEffect, useMemo, useState } from 'react';
import { getToken, clearToken } from '../utils/auth';
import { showToast } from '../utils/toast';
import { escHtml, formatTime } from '../utils/format';

const GENRES = [
  { name: 'Lofi', color: '#6c63ff,#a855f7', icon: '🎵' },
  { name: 'Hip-Hop', color: '#f59e0b,#ef4444', icon: '🎤' },
  { name: 'Electronic', color: '#3b82f6,#8b5cf6', icon: '🎛' },
  { name: 'Indie', color: '#10b981,#059669', icon: '🎸' },
  { name: 'Jazz', color: '#f97316,#eab308', icon: '🎺' },
  { name: 'Pop', color: '#ec4899,#f43f5e', icon: '⭐' },
  { name: 'Metal', color: '#6b7280,#374151', icon: '🤘' },
  { name: 'Acoustic', color: '#84cc16,#16a34a', icon: '🪕' },
  { name: 'R&B', color: '#0ea5e9,#6c63ff', icon: '🎙' },
  { name: 'Classical', color: '#d97706,#92400e', icon: '🎻' },
];

export default function HomePage() {
  const token = getToken();
  const [page, setPage] = useState('home');
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [myRooms, setMyRooms] = useState([]);
  const [roomSearch, setRoomSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', is_public: true });
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [searchSource, setSearchSource] = useState('youtube');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const greetingText = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Доброе утро ';
    if (h < 18) return 'Добрый день ';
    return 'Добрый вечер ';
  }, []);

  useEffect(() => {
    loadCurrentUser();
    loadRooms();
  }, []);

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
      loadMyRooms();
    } catch {
      // noop
    }
  }

  async function loadMyRooms() {
    if (!token) return;
    try {
      const res = await fetch('/rooms/my/rooms', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      setMyRooms(await res.json());
    } catch {
      // noop
    }
  }

  async function loadRooms() {
    setRoomsLoading(true);
    try {
      const res = await fetch('/rooms/');
      if (!res.ok) throw new Error('rooms');
      setRooms(await res.json());
    } catch {
      showToast('Не удалось загрузить комнаты', 'error');
    } finally {
      setRoomsLoading(false);
    }
  }

  async function deleteMyRoom(roomId) {
    if (!token) return;
    if (!window.confirm('Удалить комнату?')) return;
    try {
      const res = await fetch(`/rooms/${roomId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Не удалось удалить комнату', 'error');
        return;
      }
      showToast('Комната удалена', 'success');
      loadMyRooms();
      loadRooms();
    } catch {
      showToast('Ошибка сети', 'error');
    }
  }

  async function createRoom(event) {
    event.preventDefault();
    if (!token) return;
    if (!createForm.name.trim()) return;

    try {
      const res = await fetch('/rooms/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: createForm.name.trim(),
          description: createForm.description.trim(),
          is_public: createForm.is_public,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Ошибка создания комнаты', 'error');
        return;
      }

      const room = await res.json();
      setShowCreateModal(false);
      setCreateForm({ name: '', description: '', is_public: true });
      showToast('Комната создана!', 'success');
      window.location.href = `/user?room_id=${room.id}`;
    } catch {
      showToast('Ошибка сети', 'error');
    }
  }

  async function doSearch() {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const url = searchSource === 'youtube'
        ? `/api/player/search/youtube?query=${encodeURIComponent(q)}`
        : `/api/player/search/soundcloud?query=${encodeURIComponent(q)}`;

      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('search');

      const data = await res.json();
      setSearchResults(data.tracks || []);
    } catch {
      setSearchResults([]);
      showToast('Ошибка поиска. Сервер недоступен.', 'error');
    } finally {
      setSearchLoading(false);
    }
  }

  const filteredRooms = useMemo(() => {
    if (!roomSearch.trim()) return rooms;
    return rooms.filter((r) => (r.name || '').toLowerCase().includes(roomSearch.toLowerCase()));
  }, [rooms, roomSearch]);

  const genreRooms = useMemo(() => {
    if (!selectedGenre) return [];
    return rooms.filter((r) => {
      const text = `${r.genre || ''} ${r.name || ''}`.toLowerCase();
      return text.includes(selectedGenre.name.toLowerCase());
    });
  }, [rooms, selectedGenre]);

  const totalListeners = rooms.reduce((sum, room) => sum + (room.listener_count || 0), 0);
  const canCreate = !!(currentUser && (currentUser.can_create_rooms || currentUser.is_admin));

  return (
    <>
      <div id="toast-container" />
      <div className="app-shell">
        <aside className="sidebar glass glass-primary">
          <div className="sidebar-logo">
            <div className="logo-icon"><i className="fa-solid fa-circle-play" /></div>
            <span>Omniplayer</span>
          </div>

          <nav>
            <div className="nav-section-label">Главное</div>
            <button className={`nav-item ${page === 'home' ? 'active' : ''}`} onClick={() => setPage('home')}>
              <i className="fa-solid fa-house" /> Главная
            </button>
            <button className={`nav-item ${page === 'search' ? 'active' : ''}`} onClick={() => setPage('search')}>
              <i className="fa-solid fa-magnifying-glass" /> Поиск
            </button>

            <div className="nav-section-label">Каталог</div>
            <button className={`nav-item ${page === 'rooms' ? 'active' : ''}`} onClick={() => setPage('rooms')}>
              <i className="fa-solid fa-door-open" /> Комнаты
              {rooms.length > 0 && <span className="count-badge glass-flat">{rooms.length}</span>}
            </button>
            <button className={`nav-item ${page === 'genres' ? 'active' : ''}`} onClick={() => setPage('genres')}>
              <i className="fa-solid fa-layer-group" /> Жанры
            </button>
              <button className="nav-item" onClick={() => (window.location.href = '/player')}>
                <i className="fa-solid fa-bookmark" /> Локальный плеер
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
                        onClick={() => (window.location.href = `/user?room_id=${room.id}`)}
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
              <div className="user-card">
                <div className="user-avatar">{currentUser.username?.[0]?.toUpperCase() || '?'}</div>
                <div className="user-info">
                  <div className="name">{currentUser.username}</div>
                  <div className="role">{currentUser.is_admin ? 'Администратор' : 'Пользователь'}</div>
                </div>
                <button className="logout-btn" title="Выйти" onClick={() => { clearToken(); window.location.href = '/login'; }}>
                  <i className="fa-solid fa-right-from-bracket" />
                </button>
              </div>
            ) : (
              <button className="nav-item" onClick={() => (window.location.href = '/login')}>
                <i className="fa-solid fa-right-to-bracket" /> Войти
              </button>
            )}
          </div>
        </aside>

        <main className="main-content">
          {page === 'home' && (
            <div className="page-section active">
              <div className="page-header">
                <div>
                  <h2>{greetingText}</h2>
                  <p className="sub">Что будем слушать сегодня?</p>
                </div>
                <div className="header-actions">
                  {canCreate && (
                    <button className="btn btn-accent" onClick={() => setShowCreateModal(true)}>
                      <i className="fa-solid fa-plus" /> Комната
                    </button>
                  )}
                </div>
              </div>

              <div className="featured-banner" onClick={() => setPage('rooms')}>
                <div className="fb-bg" style={{ background: 'linear-gradient(135deg,#6c63ff 0%,#a855f7 55%,#ec4899 100%)' }} />
                <div className="fb-overlay" />
                <div className="fb-content">
                  <div className="fb-tag">Популярное сейчас</div>
                  <h2>Комнаты онлайн</h2>
                  <div className="fb-sub">{rooms.length} комнат · {totalListeners} слушателей</div>
                </div>
                <button className="fb-play" onClick={(e) => { e.stopPropagation(); setPage('rooms'); }}>
                  <i className="fa-solid fa-arrow-right" />
                </button>
              </div>

              <div style={{ marginBottom: 28 }}>
                <div className="sec-header">
                  <span className="sec-title">Активные комнаты</span>
                  <button className="sec-link" onClick={() => setPage('rooms')}>Смотреть все →</button>
                </div>
                <div className="h-strip">
                  {roomsLoading && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>Загрузка...</div>}
                  {!roomsLoading && !rooms.length && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>Комнат пока нет</div>}
                  {!roomsLoading && rooms.slice(0, 8).map((room) => (
                    <div className="room-card room-sm glass glass-secondary" key={room.id} onClick={() => (window.location.href = `/user?room_id=${room.id}`)} style={{ width: 160 }}>
                      <div className="room-artwork">
                        <div className="artwork-placeholder"><i className="fa-solid fa-music" /></div>
                        {(room.listener_count || 0) > 5 && <div className="live-badge">LIVE</div>}
                        <div className="room-listeners-badge"><i className="fa-solid fa-headphones" /> {room.listener_count || 0}</div>
                      </div>
                      <div className="room-info">
                        <div className="room-title">{room.name}</div>
                        <div className="room-meta">
                          <span className="room-genre">{room.description || '—'}</span>
                          <span className="room-privacy"><i className={`fa-solid ${room.is_public ? 'fa-globe' : 'fa-lock'}`} style={{ fontSize: '.6rem' }} /></span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {page === 'rooms' && (
            <div className="page-section active">
              <div className="page-header">
                <div>
                  <h2>Комнаты</h2>
                  <p className="sub">Слушай музыку вместе</p>
                </div>
                <div className="header-actions">
                  <div className="search-bar">
                    <i className="fa-solid fa-magnifying-glass" />
                    <input className="input" type="text" value={roomSearch} onChange={(e) => setRoomSearch(e.target.value)} placeholder="Поиск комнат..." />
                  </div>
                  {canCreate && <button className="btn btn-accent" onClick={() => setShowCreateModal(true)}><i className="fa-solid fa-plus" /> Создать</button>}
                </div>
              </div>

              <div className="rooms-grid">
                {roomsLoading && (
                  <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
                    <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
                  </div>
                )}
                {!roomsLoading && !filteredRooms.length && (
                  <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                    <i className="fa-solid fa-door-closed" />
                    <p>Комнат пока нет</p>
                  </div>
                )}
                {!roomsLoading && filteredRooms.map((room) => (
                  <div className="room-card glass glass-secondary" key={room.id} onClick={() => (window.location.href = `/user?room_id=${room.id}`)}>
                    <div className="room-artwork">
                      <div className="artwork-placeholder"><i className="fa-solid fa-music" /></div>
                      {(room.listener_count || 0) > 5 && <div className="live-badge">LIVE</div>}
                      <div className="room-listeners-badge"><i className="fa-solid fa-headphones" /><span>{room.listener_count || 0}</span></div>
                    </div>
                    <div className="room-info">
                      <div className="room-title">{room.name}</div>
                      <div className="room-meta">
                        <span className="room-genre">{room.description || 'Без описания'}</span>
                        <span className="room-privacy"><i className={`fa-solid ${room.is_public ? 'fa-globe' : 'fa-lock'}`} style={{ fontSize: '0.65rem' }} /></span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {page === 'search' && (
            <div className="page-section active">
              <div className="page-header">
                <div><h2>Поиск</h2><p className="sub">YouTube и SoundCloud</p></div>
              </div>

              <div className="search-main-wrap">
                <div className="search-input-row">
                  <input className="input" type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} placeholder="Название трека или артист..." />
                  <button className="btn btn-accent" onClick={doSearch}><i className="fa-solid fa-magnifying-glass" /> Найти</button>
                </div>
                <div className="search-src-tabs">
                  <button className={`src-tab glass-tertiary ${searchSource === 'youtube' ? 'active' : ''}`} onClick={() => setSearchSource('youtube')}><i className="fa-brands fa-youtube" /> YouTube</button>
                  <button className={`src-tab glass-tertiary ${searchSource === 'soundcloud' ? 'active' : ''}`} onClick={() => setSearchSource('soundcloud')}><i className="fa-brands fa-soundcloud" /> SoundCloud</button>
                </div>

                <div className="search-results-list">
                  {searchLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><div className="spinner" style={{ width: 28, height: 28, borderWidth: 2 }} /></div>}
                  {!searchLoading && !searchResults.length && <div className="empty-state"><i className="fa-solid fa-magnifying-glass" /><p>Введите запрос для поиска</p></div>}
                  {!searchLoading && searchResults.map((t, i) => (
                    <div className="search-result-item" key={`${t.title}-${i}`}>
                      <div className="sri-thumb">🎵</div>
                      <div className="sri-info">
                        <div className="sri-title">{t.title || t.name || '—'}</div>
                        <div className="sri-sub">{t.artist || t.uploader || '—'}{t.duration ? ` · ${formatTime(t.duration)}` : ''}</div>
                      </div>
                      <span className={`src-badge glass-flat ${searchSource === 'youtube' ? 'yt' : 'sc'}`}>{searchSource === 'youtube' ? 'YT' : 'SC'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {page === 'genres' && (
            <div className="page-section active">
              <div className="page-header"><div><h2>Жанры</h2><p className="sub">Выбери своё настроение</p></div></div>
              <div className="genres-grid">
                {GENRES.map((g) => {
                  const [c1, c2] = g.color.split(',');
                  return (
                    <button key={g.name} className="genre-chip" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} onClick={() => setSelectedGenre(g)}>
                      <span>{g.icon} {g.name}</span>
                    </button>
                  );
                })}
              </div>

              {!!selectedGenre && (
                <div>
                  <div className="sec-header">
                    <span className="sec-title">Комнаты — {selectedGenre.name}</span>
                    <button className="sec-link" onClick={() => setSelectedGenre(null)}>← Назад к жанрам</button>
                  </div>
                  <div className="rooms-grid">
                    {!genreRooms.length && <div className="empty-state" style={{ gridColumn: '1/-1' }}><i className="fa-solid fa-door-closed" /><p>Нет комнат в жанре «{selectedGenre.name}»</p></div>}
                    {genreRooms.map((room) => (
                      <div className="room-card glass glass-secondary" key={room.id} onClick={() => (window.location.href = `/user?room_id=${room.id}`)}>
                        <div className="room-artwork">
                          <div className="artwork-placeholder"><i className="fa-solid fa-music" /></div>
                          <div className="room-listeners-badge"><i className="fa-solid fa-headphones" /> {room.listener_count || 0}</div>
                        </div>
                        <div className="room-info">
                          <div className="room-title">{room.name}</div>
                          <div className="room-meta">
                            <span className="room-genre">{room.description || '—'}</span>
                            <span className="room-privacy"><i className={`fa-solid ${room.is_public ? 'fa-globe' : 'fa-lock'}`} style={{ fontSize: '.6rem' }} /></span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {showCreateModal && (
        <div className="modal-overlay open" onClick={(e) => e.target.classList.contains('modal-overlay') && setShowCreateModal(false)}>
          <div className="modal glass glass-primary">
            <div className="modal-header">
              <h3>Создать комнату</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}><i className="fa-solid fa-xmark" /></button>
            </div>
            <form className="modal-form" onSubmit={createRoom}>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Название *</label>
                <input className="input" type="text" value={createForm.name} onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))} required maxLength={80} />
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Описание</label>
                <input className="input" type="text" value={createForm.description} onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))} maxLength={200} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
                <input type="checkbox" checked={createForm.is_public} onChange={(e) => setCreateForm((prev) => ({ ...prev, is_public: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                <label style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>Публичная комната</label>
              </div>
              <button type="submit" className="btn btn-accent w-full" style={{ padding: 13, fontSize: '0.95rem', fontWeight: 600 }}>
                Создать комнату
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
