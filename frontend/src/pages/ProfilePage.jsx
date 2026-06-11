import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch, clearToken, getToken } from '../utils/auth';
import { showToast } from '../utils/toast';
import { formatTime } from '../utils/format';
import { SkeletonProfileCard, SkeletonCardGrid } from '../components/Skeleton';
import Sidebar from '../components/Sidebar';

function getProfileTargetFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      username: params.get('user') || params.get('username') || null,
      userId: params.get('id') ? Number(params.get('id')) : null,
    };
  } catch {
    return { username: null, userId: null };
  }
}

export default function ProfilePage() {
  const token = getToken();
  const fileInputRef = useRef(null);
  const target = useMemo(() => getProfileTargetFromUrl(), []);

  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [likes, setLikes] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('likes'); // likes | playlists
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ display_name: '', bio: '', location: '', website: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const isOwnProfile = !!profile && !!me && profile.id === me.id;

  useEffect(() => {
    if (!token && !target.username && !target.userId) {
      window.location.replace('/login');
      return;
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap() {
    setLoading(true);
    try {
      // 1) кто я
      let myData = null;
      if (token) {
        const meRes = await authFetch('/auth/me');
        if (meRes.ok) myData = await meRes.json();
      }
      setMe(myData);

      // 2) чей профиль смотрим
      let url = '/api/profiles/me';
      if (target.username) {
        url = `/api/profiles/by-username/${encodeURIComponent(target.username)}`;
      } else if (target.userId) {
        url = `/api/profiles/${target.userId}`;
      } else if (!myData) {
        window.location.replace('/login');
        return;
      }

      const res = token ? await authFetch(url) : await fetch(url);
      if (!res.ok) {
        showToast('Профиль не найден', 'error');
        return;
      }
      const data = await res.json();
      setProfile(data);
      document.title = `${data.display_name || data.username} — Omni Player`;

      // 3) лайки и плейлисты
      const [likesRes, plsRes] = await Promise.all([
        fetch(`/api/profiles/${data.id}/likes`),
        fetch(`/api/profiles/${data.id}/playlists`),
      ]);
      if (likesRes.ok) {
        const j = await likesRes.json();
        setLikes(j.items || []);
      }
      if (plsRes.ok) {
        const j = await plsRes.json();
        setPlaylists(j.items || []);
      }
    } catch {
      showToast('Не удалось загрузить профиль', 'error');
    } finally {
      setLoading(false);
    }
  }

  function startEdit() {
    if (!profile) return;
    setEditForm({
      display_name: profile.display_name || '',
      bio: profile.bio || '',
      location: profile.location || '',
      website: profile.website || '',
    });
    setEditing(true);
  }

  async function saveProfile() {
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      const res = await authFetch('/api/profiles/me', {
        method: 'PUT',
        body: JSON.stringify({
          display_name: editForm.display_name.trim() || null,
          bio: editForm.bio.trim() || null,
          location: editForm.location.trim() || null,
          website: editForm.website.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Не удалось сохранить', 'error');
        return;
      }
      const updated = await res.json();
      setProfile(updated);
      showToast('Профиль обновлён', 'success');
      setEditing(false);
    } catch {
      showToast('Ошибка сети', 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadAvatar(file) {
    if (!file || avatarUploading) return;
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/api/profiles/me/avatar', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Не удалось загрузить аватар', 'error');
        return;
      }
      const data = await res.json();
      setProfile((p) => (p ? { ...p, avatar_url: data.avatar_url } : p));
      showToast('Аватар обновлён', 'success');
    } catch {
      showToast('Ошибка сети', 'error');
    } finally {
      setAvatarUploading(false);
    }
  }

  function logout() {
    if (!window.confirm('Выйти из аккаунта?')) return;
    clearToken();
    window.location.replace('/login');
  }

  if (loading) {
    return (
      <div className="app-shell">
        <Sidebar activePage="profile" />
        <main className="main-content">
          <div className="page-section active">
            <div className="profile-page">
              <SkeletonProfileCard />
              <div style={{ marginTop: '32px', width: '100%' }}>
                <SkeletonCardGrid count={6} />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="app-shell">
        <Sidebar activePage="profile" />
        <main className="main-content">
          <div className="profile-page">
            <div className="glass glass-primary profile-card" style={{ textAlign: 'center' }}>
              <div className="empty-state"><i className="fa-solid fa-user-slash" /><p>Пользователь не найден</p></div>
              <button className="btn btn-accent" onClick={() => (window.location.href = '/')}>На главную</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const initials = (profile.display_name || profile.username || '?').slice(0, 1).toUpperCase();

  return (
    <>
      <div className="app-shell">
        <Sidebar activePage="profile" />
        <main className="main-content">
          <div id="toast-container" />
          <div className="page-section active">
            <div className="profile-page">
          {/* ───── Шапка профиля ───── */}
          <div className="glass glass-primary profile-card" style={{ position: 'relative' }}>
          <div className="profile-card-tools">
            <button className="btn btn-icon glass-tertiary" id="themeToggle" title="Переключить тему" style={{ width: 38, height: 38, fontSize: '0.9rem' }}>
              <i className="fa-solid fa-moon" id="themeIcon" />
            </button>
            {isOwnProfile && (
              <button className="btn btn-icon glass-tertiary" title="Редактировать" onClick={startEdit} style={{ width: 38, height: 38, fontSize: '0.9rem' }}>
                <i className="fa-solid fa-pen" />
              </button>
            )}
          </div>

          {/* Avatar */}
          <div
            className="profile-avatar"
            style={{ position: 'relative', overflow: 'hidden', cursor: isOwnProfile ? 'pointer' : 'default' }}
            onClick={() => isOwnProfile && fileInputRef.current?.click()}
            title={isOwnProfile ? 'Нажми, чтобы сменить аватар' : ''}
          >
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span>{initials}</span>}
            {avatarUploading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
                <div className="spinner" style={{ width: 22, height: 22, borderWidth: 2 }} />
              </div>
            )}
            {isOwnProfile && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 0', textAlign: 'center', background: 'rgba(0,0,0,0.55)', fontSize: '0.7rem' }}>
                <i className="fa-solid fa-camera" /> сменить
              </div>
            )}
          </div>
          {isOwnProfile && (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadAvatar(file);
                e.target.value = '';
              }}
            />
          )}

          <div className="profile-name">{profile.display_name || profile.username}</div>
          <div className="profile-email">@{profile.username}</div>

          {profile.bio && (
            <div style={{ margin: '12px 0 4px', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.45, textAlign: 'center', whiteSpace: 'pre-wrap' }}>
              {profile.bio}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', margin: '8px 0 14px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {profile.location && (<span><i className="fa-solid fa-location-dot" /> {profile.location}</span>)}
            {profile.website && (
              <a href={profile.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent, #6c63ff)', textDecoration: 'none' }}>
                <i className="fa-solid fa-link" /> {profile.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>

          <div className="profile-badges" style={{ marginBottom: 6 }}>
            {profile.role && <span className="badge glass-tertiary"><i className="fa-solid fa-shield-halved" /> {profile.role}</span>}
            <span className="badge glass-tertiary"><i className="fa-solid fa-heart" /> {profile.stats?.likes ?? likes.length}</span>
            <span className="badge glass-tertiary"><i className="fa-solid fa-list-music" /> {profile.stats?.playlists ?? playlists.length}</span>
          </div>

          <div className="profile-actions" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => (window.location.href = '/')}><i className="fa-solid fa-door-open" /> Комнаты</button>
            <button className="btn" onClick={() => (window.location.href = '/player')}><i className="fa-solid fa-music" /> Локальный плеер</button>
            {isOwnProfile && (
              <button className="btn" style={{ color: '#ff5050', borderColor: 'rgba(255,80,80,0.3)' }} onClick={logout}>
                <i className="fa-solid fa-right-from-bracket" /> Выйти
              </button>
            )}
          </div>
        </div>

        {/* ───── Tabs ───── */}
        <div className="glass glass-secondary" style={{ marginTop: 16, padding: 14, borderRadius: 14 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button
              className={`btn glass-tertiary ${tab === 'likes' ? 'active' : ''}`}
              onClick={() => setTab('likes')}
              style={{ flex: 1, outline: tab === 'likes' ? '2px solid var(--accent, #6c63ff)' : 'none' }}
            >
              <i className="fa-solid fa-heart" /> Лайки <span className="badge glass-flat" style={{ marginLeft: 6 }}>{likes.length}</span>
            </button>
            <button
              className={`btn glass-tertiary ${tab === 'playlists' ? 'active' : ''}`}
              onClick={() => setTab('playlists')}
              style={{ flex: 1, outline: tab === 'playlists' ? '2px solid var(--accent, #6c63ff)' : 'none' }}
            >
              <i className="fa-solid fa-list-music" /> Плейлисты <span className="badge glass-flat" style={{ marginLeft: 6 }}>{playlists.length}</span>
            </button>
          </div>

          {tab === 'likes' && (
            <div className="track-list">
              {!likes.length && <div className="empty-state"><i className="fa-solid fa-heart" /><p>Пока нет сохранённых треков</p></div>}
              {likes.map((t) => (
                <div className="track-item" key={t.id}>
                  <div className="track-thumb">
                    {t.thumbnail_url ? <img src={t.thumbnail_url} alt="" loading="lazy" /> : <i className="fa-solid fa-music" />}
                  </div>
                  <div className="track-item-body">
                    <div className="track-item-title">{t.title || 'Без названия'}</div>
                    <div className="track-item-meta">
                      {t.artist || '—'}
                      {t.duration ? ` · ${formatTime(t.duration)}` : ''}
                      <span className={`source-badge glass-flat ${t.source === 'youtube' ? 'source-yt' : (t.source === 'local' ? 'source-local' : 'source-sc')}`} style={{ marginLeft: 6 }}>
                        {t.source === 'youtube' ? 'YT' : (t.source === 'local' ? 'FILE' : 'SC')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'playlists' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
              {!playlists.length && <div className="empty-state" style={{ gridColumn: '1/-1' }}><i className="fa-solid fa-list-music" /><p>Плейлистов пока нет</p></div>}
              {playlists.map((p) => (
                <div key={p.id} className="glass glass-tertiary" style={{ padding: 12, borderRadius: 12 }}>
                  <div style={{ width: '100%', aspectRatio: '1/1', borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.04)', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {p.thumbnail
                      ? <img src={p.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <i className="fa-solid fa-list-music" style={{ fontSize: '1.6rem', opacity: 0.6 }} />}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.92rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {p.is_album ? 'Альбом' : 'Плейлист'} · {p.track_count || 0} треков
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
            </div>
          </div>
        </main>
      </div>

      {/* ───── Edit profile modal ───── */}
      {editing && (
        <div
          style={{ display: 'flex', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', zIndex: 1100, alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget && !savingProfile) setEditing(false); }}
        >
          <div className="glass glass-primary" style={{ width: '100%', maxWidth: 480, padding: 28, margin: 20, borderRadius: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Редактировать профиль</h3>
              <button
                className="btn btn-icon glass-tertiary"
                style={{ width: 30, height: 30 }}
                disabled={savingProfile}
                onClick={() => setEditing(false)}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="form-group">
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Имя</label>
                <input className="input" type="text" value={editForm.display_name} onChange={(e) => setEditForm((p) => ({ ...p, display_name: e.target.value }))} maxLength={80} />
              </div>
              <div className="form-group">
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>О себе</label>
                <textarea
                  className="input"
                  rows={3}
                  value={editForm.bio}
                  onChange={(e) => setEditForm((p) => ({ ...p, bio: e.target.value }))}
                  maxLength={500}
                  style={{ resize: 'vertical', minHeight: 70 }}
                />
              </div>
              <div className="form-group">
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Местоположение</label>
                <input className="input" type="text" value={editForm.location} onChange={(e) => setEditForm((p) => ({ ...p, location: e.target.value }))} maxLength={100} />
              </div>
              <div className="form-group">
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Сайт</label>
                <input
                  className="input"
                  type="url"
                  value={editForm.website}
                  onChange={(e) => setEditForm((p) => ({ ...p, website: e.target.value }))}
                  placeholder="https://..."
                  maxLength={200}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="btn btn-accent w-full" onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <button className="btn w-full" onClick={() => setEditing(false)} disabled={savingProfile}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
