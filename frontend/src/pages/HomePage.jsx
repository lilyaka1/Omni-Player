import { useEffect, useMemo, useState } from 'react';
import { getToken, clearToken } from '../utils/auth';
import { showToast } from '../utils/toast';
import { escHtml, formatTime } from '../utils/format';
import ProfilePage from './ProfilePage';
import { SkeletonRoomGrid } from '../components/Skeleton';
import { useSwipe } from '../hooks/useSwipe';

const GENRES = [
  { name: 'Lofi', color: '#6c63ff,#a855f7' },
  { name: 'Hip-Hop', color: '#f59e0b,#ef4444' },
  { name: 'Electronic', color: '#3b82f6,#8b5cf6' },
  { name: 'Indie', color: '#10b981,#059669' },
  { name: 'Jazz', color: '#f97316,#eab308' },
  { name: 'Pop', color: '#ec4899,#f43f5e' },
  { name: 'Metal', color: '#6b7280,#374151' },
  { name: 'Acoustic', color: '#84cc16,#16a34a' },
  { name: 'R&B', color: '#0ea5e9,#6c63ff' },
  { name: 'Classical', color: '#d97706,#92400e' },
];

export default function HomePage() {
  const token = getToken();
  const [page, setPage] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [myRooms, setMyRooms] = useState([]);
  const [roomSearch, setRoomSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    room_type: 'public',
    genre: '',
    max_users: 50,
    cover_url: '',
    password: '',
  });
  const [coverUploading, setCoverUploading] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
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

    // Auto-refresh rooms every 5 seconds to update listener counts
    const interval = setInterval(loadRooms, 5000);

    return () => clearInterval(interval);
  }, []);

  // Reload user when returning to home or after profile edit
  useEffect(() => {
    if (page === 'home') {
      loadCurrentUser();
    }
    // Close sidebar on mobile when page changes
    setSidebarOpen(false);
  }, [page]);

  // Swipe navigation (left = next page, right = previous page)
  const pages = ['home', 'rooms', 'genres', 'profile'];
  const currentPageIndex = pages.indexOf(page);

  useSwipe(
    () => {
      // Swipe left -> next page
      if (currentPageIndex < pages.length - 1) {
        setPage(pages[currentPageIndex + 1]);
      }
    },
    () => {
      // Swipe right -> previous page
      if (currentPageIndex > 0) {
        setPage(pages[currentPageIndex - 1]);
      }
    }
  );

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

  function resetCreateForm() {
    setCreateForm({
      name: '',
      description: '',
      room_type: 'public',
      genre: '',
      max_users: 50,
      cover_url: '',
    });
  }

  async function uploadCoverDraft(file) {
    if (!file || !token) return;
    setCoverUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/rooms/upload-cover', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Не удалось загрузить обложку', 'error');
        return;
      }
      const data = await res.json();
      setCreateForm((prev) => ({ ...prev, cover_url: data.cover_url }));
    } catch {
      showToast('Ошибка сети', 'error');
    } finally {
      setCoverUploading(false);
    }
  }

  async function createRoom(event) {
    event.preventDefault();
    if (!token || createSubmitting) return;
    if (!createForm.name.trim()) return;

    setCreateSubmitting(true);
    try {
      const res = await fetch('/rooms/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: createForm.name.trim(),
          description: createForm.description.trim() || null,
          room_type: createForm.room_type || 'public',
          genre: createForm.genre.trim() || null,
          max_users: Number(createForm.max_users) || 50,
          cover_url: createForm.cover_url || null,
          password: createForm.password.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Ошибка создания комнаты', 'error');
        return;
      }

      const room = await res.json();
      setShowCreateModal(false);
      resetCreateForm();
      showToast('Комната создана!', 'success');
      window.location.href = `/user?room_id=${room.id}`;
    } catch {
      showToast('Ошибка сети', 'error');
    } finally {
      setCreateSubmitting(false);
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
  const canCreate = !!currentUser && (currentUser.role === 'admin' || currentUser.can_create_rooms !== false);

  return (
    <>
      <div id="toast-container" />
      <div className="app-shell">
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
              <div className="user-card" onClick={() => setPage('profile')} style={{ cursor: 'pointer' }}>
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
              <button className="nav-item" onClick={() => (window.location.href = '/login')}>
                <i className="fa-solid fa-right-to-bracket" /> Войти
              </button>
            )}
          </div>
        </aside>

        <main className="main-content">
          {page === 'home' && (
            <div className="page-section active" key="home">
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
                <div className="fb-bg" />
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
                  {roomsLoading && <SkeletonRoomGrid count={4} style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }} />}
                  {!roomsLoading && !rooms.length && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>Комнат пока нет</div>}
                  {!roomsLoading && rooms.slice(0, 8).map((room) => (
                    <div className="room-card room-sm glass glass-secondary" key={room.id} onClick={() => (window.location.href = `/user?room_id=${room.id}`)} style={{ width: 160 }}>
                      <div className="room-artwork">
                        {room.cover_url ? (
                          <img src={room.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div className="artwork-placeholder"><i className="fa-solid fa-music" /></div>
                        )}
                        {(room.listener_count || 0) > 5 && <div className="live-badge">LIVE</div>}
                        <div className="room-listeners-badge"><i className="fa-solid fa-headphones" /> {room.listener_count || 0}</div>
                      </div>
                      <div className="room-info">
                        <div className="room-title">{room.name}</div>
                        <div className="room-meta">
                          <span className="room-genre">{room.genre || room.description || '—'}</span>
                          <span className="room-privacy"><i className={`fa-solid ${(room.room_type || 'public') === 'public' ? 'fa-globe' : 'fa-lock'}`} style={{ fontSize: '.6rem' }} /></span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {page === 'rooms' && (
            <div className="page-section active" key="rooms">
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
                {roomsLoading && <SkeletonRoomGrid count={12} />}
                {!roomsLoading && !filteredRooms.length && (
                  <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                    <i className="fa-solid fa-door-closed" />
                    <p>Комнат пока нет</p>
                  </div>
                )}
                {!roomsLoading && filteredRooms.map((room) => (
                  <div className="room-card glass glass-secondary" key={room.id} onClick={() => (window.location.href = `/user?room_id=${room.id}`)}>
                    <div className="room-artwork">
                      {room.cover_url ? (
                        <img src={room.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div className="artwork-placeholder"><i className="fa-solid fa-music" /></div>
                      )}
                      {(room.listener_count || 0) > 5 && <div className="live-badge">LIVE</div>}
                      <div className="room-listeners-badge"><i className="fa-solid fa-headphones" /><span>{room.listener_count || 0}</span></div>
                    </div>
                    <div className="room-info">
                      <div className="room-title">{room.name}</div>
                      <div className="room-meta">
                        <span className="room-genre">{room.genre || room.description || 'Без описания'}</span>
                        <span className="room-privacy"><i className={`fa-solid ${(room.room_type || 'public') === 'public' ? 'fa-globe' : 'fa-lock'}`} style={{ fontSize: '0.65rem' }} /></span>
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
            <div className="page-section active" key="genres">
              <div className="page-header"><div><h2>Жанры</h2><p className="sub">Выбери своё настроение</p></div></div>
              <div className="genres-grid">
                {GENRES.map((g) => {
                  const [c1, c2] = g.color.split(',');
                  return (
                    <button key={g.name} className="genre-chip" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} onClick={() => setSelectedGenre(g)}>
                      <span>{g.name}</span>
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
                          {room.cover_url ? (
                            <img src={room.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div className="artwork-placeholder"><i className="fa-solid fa-music" /></div>
                          )}
                          <div className="room-listeners-badge"><i className="fa-solid fa-headphones" /> {room.listener_count || 0}</div>
                        </div>
                        <div className="room-info">
                          <div className="room-title">{room.name}</div>
                          <div className="room-meta">
                            <span className="room-genre">{room.genre || room.description || '—'}</span>
                            <span className="room-privacy"><i className={`fa-solid ${(room.room_type || 'public') === 'public' ? 'fa-globe' : 'fa-lock'}`} style={{ fontSize: '.6rem' }} /></span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {page === 'profile' && <div key="profile" className="page-section active"><ProfilePage /></div>}
        </main>
      </div>

      {showCreateModal && (
        <div className="modal-overlay open" onClick={(e) => e.target.classList.contains('modal-overlay') && setShowCreateModal(false)}>
          <div className="modal glass glass-primary" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3>Создать комнату</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}><i className="fa-solid fa-xmark" /></button>
            </div>
            <form className="modal-form" onSubmit={createRoom}>
              {/* ── Cover ─────────────────────────────────────────────── */}
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Обложка комнаты</label>
                <label
                  className="glass-tertiary"
                  style={{
                    cursor: 'pointer',
                    display: 'block',
                    width: '100%',
                    aspectRatio: '16/9',
                    borderRadius: 14,
                    overflow: 'hidden',
                    position: 'relative',
                    background: 'rgba(255,255,255,0.04)',
                  }}
                >
                  {createForm.cover_url ? (
                    <img src={createForm.cover_url} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 6, opacity: 0.7 }}>
                      <i className="fa-solid fa-image" style={{ fontSize: '1.6rem' }} />
                      <span style={{ fontSize: '0.85rem' }}>Загрузить обложку (jpg/png/webp)</span>
                    </div>
                  )}
                  {coverUploading && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
                      <div className="spinner" />
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadCoverDraft(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                {createForm.cover_url && (
                  <button
                    type="button"
                    className="btn glass-tertiary"
                    style={{ alignSelf: 'flex-start', fontSize: '0.78rem', padding: '6px 10px' }}
                    onClick={() => setCreateForm((p) => ({ ...p, cover_url: '' }))}
                  >
                    <i className="fa-solid fa-rotate-left" /> Убрать обложку
                  </button>
                )}
              </div>

              {/* ── Name ───────────────────────────────────────────────── */}
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Название *</label>
                <input className="input" type="text" value={createForm.name} onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))} required maxLength={80} />
              </div>

              {/* ── Description ────────────────────────────────────────── */}
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Описание</label>
                <textarea
                  className="input"
                  rows={2}
                  value={createForm.description}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))}
                  maxLength={200}
                  style={{ resize: 'vertical', minHeight: 60 }}
                />
              </div>

              {/* ── Genre + max_users ──────────────────────────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Жанр</label>
                  <input
                    className="input"
                    list="room-genre-suggestions"
                    type="text"
                    value={createForm.genre}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, genre: e.target.value }))}
                    maxLength={40}
                    placeholder="Lofi, Hip-Hop, Jazz…"
                  />
                  <datalist id="room-genre-suggestions">
                    {GENRES.map((g) => (
                      <option key={g.name} value={g.name} />
                    ))}
                  </datalist>
                </div>
                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Макс. слушателей</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={100}
                    value={createForm.max_users}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, max_users: e.target.value }))}
                  />
                </div>
              </div>

              {/* ── room_type ──────────────────────────────────────────── */}
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Тип комнаты</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { v: 'public', label: 'Публичная', icon: 'globe' },
                    { v: 'private', label: 'Приватная', icon: 'lock' },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      className={`btn glass-tertiary ${createForm.room_type === opt.v ? 'active' : ''}`}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        fontSize: '0.85rem',
                        outline: createForm.room_type === opt.v ? '2px solid var(--accent, #6c63ff)' : 'none',
                      }}
                      onClick={() => setCreateForm((p) => ({ ...p, room_type: opt.v }))}
                    >
                      <i className={`fa-solid fa-${opt.icon}`} /> {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Password (только для приватных комнат) ──────────────── */}
              {createForm.room_type === 'private' && (
                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                    Пароль <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(для приватной комнаты)</span>
                  </label>
                  <input
                    className="input"
                    type="password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="Введите пароль..."
                    maxLength={50}
                  />
                </div>
              )}

              <button
                type="submit"
                className="btn btn-accent w-full"
                disabled={createSubmitting || !createForm.name.trim()}
                style={{ padding: 13, fontSize: '0.95rem', fontWeight: 600, opacity: createSubmitting ? 0.7 : 1 }}
              >
                {createSubmitting ? 'Создание…' : 'Создать комнату'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
