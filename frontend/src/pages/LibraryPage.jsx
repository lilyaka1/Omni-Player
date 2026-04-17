import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch, clearToken, getToken } from '../utils/auth';
import { formatTime } from '../utils/format';
import { showToast } from '../utils/toast';

function normalizeLibraryTrack(item, token) {
  const t = item && item.track ? item.track : item;
  if (!t || typeof t !== 'object') return null;
  const playable = Boolean(t.local_file_path || t.source === 'local');
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    duration: t.duration,
    thumbnail: t.thumbnail || t.thumbnail_url || null,
    source: t.source,
    localFilePath: t.local_file_path || null,
    playable,
    playUrl: playable ? `/api/player/audio/${t.id}?token=${encodeURIComponent(token || '')}` : null,
  };
}

export default function LibraryPage() {
  const token = getToken();
  const audioRef = useRef(null);
  const [authState, setAuthState] = useState('checking');
  const [libraryTracks, setLibraryTracks] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [shuffle, setShuffle] = useState(false);
  const [repeatOne, setRepeatOne] = useState(false);
  const [searchSource, setSearchSource] = useState('youtube');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showAddUrlModal, setShowAddUrlModal] = useState(false);
  const [addUrl, setAddUrl] = useState('');

  useEffect(() => {
    if (!token) {
      setAuthState('unauthorized');
      return;
    }
    let cancelled = false;

    async function validateAuth() {
      try {
        const res = await authFetch('/auth/me');
        if (!res.ok) {
          throw new Error('unauthorized');
        }
        if (cancelled) return;
        setAuthState('authorized');
        loadLibrary();
      } catch {
        if (cancelled) return;
        clearToken();
        setAuthState('unauthorized');
      }
    }

    validateAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  const currentTrack = libraryTracks[currentIndex] || null;
  const playableTracks = useMemo(() => libraryTracks.filter((track) => track.playUrl), [libraryTracks]);
  const totalCount = useMemo(() => libraryTracks.length, [libraryTracks]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };

    const onEnded = () => {
      if (repeatOne) {
        audio.currentTime = 0;
        audio.play().catch(() => setIsPlaying(false));
        return;
      }
      playNext();
    };

    const onError = () => {
      setIsPlaying(false);
      showToast('Не удалось воспроизвести трек', 'error');
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [repeatOne, libraryTracks.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentTrack?.playUrl) {
      audio.removeAttribute('src');
      audio.load();
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
      return;
    }

    audio.volume = volume;
    audio.src = currentTrack.playUrl;
    audio.load();
    setCurrentTime(0);
    setDuration(Number(currentTrack.duration) || 0);
  }, [currentTrack?.playUrl, currentTrack?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack?.playUrl) return;

    if (isPlaying) {
      const tryPlay = async () => {
        try {
          await audio.play();
        } catch {
          setIsPlaying(false);
        }
      };
      tryPlay();
      return;
    }

    audio.pause();
  }, [isPlaying, currentTrack?.playUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (currentIndex >= libraryTracks.length) {
      setCurrentIndex(0);
    }
  }, [libraryTracks.length, currentIndex]);

  function playTrackByIndex(index) {
    if (index < 0 || index >= libraryTracks.length) return;
    const track = libraryTracks[index];
    if (!track?.playUrl) {
      showToast('Этот трек пока не доступен для локального прослушивания', 'error');
      return;
    }
    setCurrentIndex(index);
    setIsPlaying(true);
  }

  function findNextPlayableIndex(direction = 1) {
    if (!libraryTracks.length) return -1;
    const start = currentIndex;
    for (let step = 1; step <= libraryTracks.length; step += 1) {
      const nextIndex = (start + direction * step + libraryTracks.length) % libraryTracks.length;
      if (libraryTracks[nextIndex]?.playUrl) return nextIndex;
    }
    return -1;
  }

  function playNext() {
    if (!libraryTracks.length) return;
    if (shuffle && playableTracks.length > 1) {
      const pool = playableTracks.filter((track) => track.id !== currentTrack?.id);
      const picked = pool[Math.floor(Math.random() * pool.length)];
      if (!picked) return;
      const index = libraryTracks.findIndex((track) => track.id === picked.id);
      if (index >= 0) setCurrentIndex(index);
      setIsPlaying(true);
      return;
    }
    const nextIndex = findNextPlayableIndex(1);
    if (nextIndex >= 0) {
      setCurrentIndex(nextIndex);
      setIsPlaying(true);
    }
  }

  function playPrev() {
    if (!libraryTracks.length) return;
    const prevIndex = findNextPlayableIndex(-1);
    if (prevIndex >= 0) {
      setCurrentIndex(prevIndex);
      setIsPlaying(true);
    }
  }

  function togglePlay() {
    if (!currentTrack?.playUrl) {
      const firstPlayable = libraryTracks.findIndex((track) => track.playUrl);
      if (firstPlayable >= 0) {
        playTrackByIndex(firstPlayable);
      }
      return;
    }
    setIsPlaying((prev) => !prev);
  }

  function seekTo(value) {
    const audio = audioRef.current;
    if (!audio) return;
    const maxDuration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : (duration || 0);
    const nextTime = Math.max(0, Math.min(Number(value) || 0, maxDuration));
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function formatSeekLabel(seconds) {
    if (!seconds) return '0:00';
    return formatTime(seconds);
  }

  async function loadLibrary() {
    try {
      const res = await authFetch('/api/player/library');
      if (!res.ok) return;
      const payload = await res.json();
      const raw = Array.isArray(payload) ? payload : payload.tracks || [];
      setLibraryTracks(raw.map((item) => normalizeLibraryTrack(item, token)).filter(Boolean));
    } catch {
      // noop
    }
  }

  async function removeTrack(trackId) {
    try {
      const res = await authFetch(`/api/player/library/${trackId}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast('Ошибка удаления', 'error');
        return;
      }
      showToast('Трек удалён');
      loadLibrary();
    } catch {
      // noop
    }
  }

  async function uploadFiles(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    event.target.value = '';

    try {
      const res = await authFetch('/api/player/library/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Ошибка загрузки файлов', 'error');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      showToast(`Файлы добавлены в коллекцию: ${Number(payload.added || 0)}`, 'success');
      loadLibrary();
    } catch {
      showToast('Ошибка загрузки файлов', 'error');
    }
  }

  async function addByUrl(url) {
    try {
      const res = await authFetch('/api/player/library', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Ошибка', 'error');
        return false;
      }
      showToast('Трек добавлен!', 'success');
      loadLibrary();
      return true;
    } catch {
      return false;
    }
  }

  async function doSearch() {
    const q = searchQuery.trim();
    if (!q) return;

    setSearchLoading(true);
    try {
      const url = searchSource === 'youtube'
        ? `/api/player/search/youtube?query=${encodeURIComponent(q)}`
        : `/api/player/search/soundcloud?query=${encodeURIComponent(q)}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error('search');
      const data = await res.json();
      setSearchResults(data.tracks || []);
    } catch {
      setSearchResults([]);
      showToast('Ошибка поиска', 'error');
    } finally {
      setSearchLoading(false);
    }
  }

  if (authState === 'checking') {
    return (
      <div className="auth-page-wrap">
        <div className="auth-card glass glass-primary" style={{ maxWidth: 520 }}>
          <div className="auth-head">
            <div className="auth-brand">
              <div className="auth-logo"><i className="fa-solid fa-circle-play" /></div>
              <div>
                <h1>Omni Player</h1>
                <p>Проверяем доступ...</p>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0 8px' }}>
            <div className="spinner" style={{ width: 30, height: 30, borderWidth: 3 }} />
          </div>
        </div>
      </div>
    );
  }

  if (authState === 'unauthorized') {
    return (
      <div className="auth-page-wrap">
        <div className="auth-card glass glass-primary" style={{ maxWidth: 520 }}>
          <div className="auth-head">
            <div className="auth-brand">
              <div className="auth-logo"><i className="fa-solid fa-circle-play" /></div>
              <div>
                <h1>Локальный плеер</h1>
                <p>Нужен вход в аккаунт</p>
              </div>
            </div>
          </div>

          <div className="auth-error" style={{ marginBottom: 16 }}>
            Эта страница доступна только после авторизации.
          </div>

          <p style={{ color: 'var(--text-secondary)', marginBottom: 18 }}>
            Войдите в аккаунт, чтобы загружать файлы в папку downloads и слушать их в локальном плеере.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-accent" onClick={() => (window.location.href = '/login')}>
              <i className="fa-solid fa-right-to-bracket" /> Войти
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Проверить снова
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div id="toast-container" />

      <div className="library-layout">
        <aside className="sidebar glass glass-secondary">
          <div className="sidebar-logo">
            <div className="logo-icon"><i className="fa-solid fa-circle-play" /></div>
            <span>Omni Player</span>
          </div>
          <nav>
            <button className="nav-item" onClick={() => (window.location.href = '/')}>
              <i className="fa-solid fa-door-open" /> Комнаты
            </button>
            <button className="nav-item active">
              <i className="fa-solid fa-music" /> Локальный плеер
            </button>
            <button className="nav-item" id="themeToggle">
              <i className="fa-solid fa-moon" id="themeIcon" /> Тема
            </button>
          </nav>
        </aside>

        <main className="library-main">
          <div className="page-header-wrap">
            <div>
              <h2>Локальный плеер</h2>
              <p className="text-sm text-muted" style={{ marginTop: 2 }}>Слушайте сохранённые треки как в обычном аудиоплеере</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="btn" htmlFor="localFileInput"><i className="fa-solid fa-file-audio" /> Загрузить файл</label>
              <button className="btn" onClick={() => setShowAddUrlModal(true)}><i className="fa-solid fa-plus" /> Добавить по ссылке</button>
            </div>
          </div>

          <section className="player-hero glass glass-secondary">
            <div className="player-hero-cover">
              {currentTrack?.thumbnail
                ? <img src={currentTrack.thumbnail} alt="" loading="lazy" />
                : <div className="player-hero-cover-placeholder"><i className="fa-solid fa-music" /></div>}
            </div>

            <div className="player-hero-body">
              <div className="player-kicker">Сейчас играет</div>
              <h3 className="player-title">{currentTrack?.title || 'Выберите трек из очереди'}</h3>
              <div className="player-artist">{currentTrack?.artist || 'Локальная библиотека'}</div>

              <div className="player-progress-row">
                <span>{formatSeekLabel(currentTime)}</span>
                <div className="player-progress">
                  <input
                    type="range"
                    min="0"
                    max={Math.max(duration || currentTrack?.duration || 1, 1)}
                    value={Math.min(currentTime, duration || currentTrack?.duration || 1)}
                    onChange={(e) => seekTo(e.target.value)}
                    disabled={!currentTrack?.playUrl}
                  />
                </div>
                <span>{formatSeekLabel(duration || currentTrack?.duration || 0)}</span>
              </div>

              <div className="player-controls-row">
                <button className="player-icon-btn" onClick={playPrev} disabled={!playableTracks.length} title="Предыдущий">
                  <i className="fa-solid fa-backward-step" />
                </button>
                <button className="player-main-btn" onClick={togglePlay} disabled={!playableTracks.length} title={isPlaying ? 'Пауза' : 'Воспроизвести'}>
                  <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`} />
                </button>
                <button className="player-icon-btn" onClick={playNext} disabled={!playableTracks.length} title="Следующий">
                  <i className="fa-solid fa-forward-step" />
                </button>
                <button className={`player-chip ${shuffle ? 'active' : ''}`} onClick={() => setShuffle((v) => !v)} title="Случайный порядок">
                  <i className="fa-solid fa-shuffle" /> Shuffle
                </button>
                <button className={`player-chip ${repeatOne ? 'active' : ''}`} onClick={() => setRepeatOne((v) => !v)} title="Повтор одного трека">
                  <i className="fa-solid fa-repeat" /> Repeat
                </button>
              </div>

              <div className="player-volume-row">
                <i className="fa-solid fa-volume-low" />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
                <i className="fa-solid fa-volume-high" />
              </div>
            </div>
          </section>

          <input id="localFileInput" type="file" accept="audio/*" multiple style={{ display: 'none' }} onChange={uploadFiles} />

          <div className="search-section glass glass-secondary">
            <div className="search-bar-row">
              <input className="input" type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} placeholder="Поиск YouTube / SoundCloud..." />
              <button className="btn btn-accent" onClick={doSearch}><i className="fa-solid fa-magnifying-glass" /> Найти</button>
            </div>
            <div className="search-tabs">
              <button className={`search-tab glass-tertiary ${searchSource === 'youtube' ? 'active' : ''}`} onClick={() => setSearchSource('youtube')}><i className="fa-brands fa-youtube" /> YouTube</button>
              <button className={`search-tab glass-tertiary ${searchSource === 'soundcloud' ? 'active' : ''}`} onClick={() => setSearchSource('soundcloud')}><i className="fa-brands fa-soundcloud" /> SoundCloud</button>
            </div>

            <div className="search-results" id="searchResults">
              {searchLoading && <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'center', padding: 30 }}><div className="spinner" style={{ width: 28, height: 28, borderWidth: 2 }} /></div>}
              {!searchLoading && !searchResults.length && <div className="empty-state" style={{ gridColumn: '1/-1' }}><i className="fa-solid fa-music" /><p>Ничего не найдено</p></div>}
              {!searchLoading && searchResults.map((t, index) => {
                const pageUrl = t.page_url || t.track_page_url || '';
                return (
                  <div key={`${t.title}-${index}`} className="search-result-card glass glass-secondary">
                    <div className="search-result-thumb">
                      {t.thumbnail ? <img src={t.thumbnail} alt="" loading="lazy" /> : <i className="fa-solid fa-music" style={{ fontSize: '2rem', color: 'var(--accent)', opacity: 0.4 }} />}
                    </div>
                    <div className="search-result-info">
                      <div className="search-result-title">{t.title}</div>
                      <div className="search-result-sub">{t.duration ? formatTime(t.duration) : '—'}</div>
                      <button className="search-result-add" onClick={() => addByUrl(pageUrl)}><i className="fa-solid fa-bookmark" /> В библиотеку</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section-panel glass glass-secondary">
            <div className="section-panel-header">
              <div className="section-panel-title"><i className="fa-solid fa-list-music" /> Очередь плеера</div>
              <span className="badge glass-flat">{totalCount}</span>
            </div>

            <div className="track-list player-queue-list" id="libraryList">
              {!libraryTracks.length && <div className="empty-state"><i className="fa-solid fa-music" /><p>Библиотека пуста</p></div>}
              {libraryTracks.map((track, index) => (
                <div className={`track-item player-queue-item ${currentTrack?.id === track.id ? 'active' : ''}`} key={track.id}>
                  <div className="track-thumb">
                    {track.thumbnail ? <img src={track.thumbnail} alt="" loading="lazy" /> : <i className="fa-solid fa-music" />}
                  </div>
                  <div className="track-item-body">
                    <div className="track-item-title">{track.title || 'Без названия'}</div>
                    <div className="track-item-meta">
                      {track.duration ? formatTime(track.duration) : '—'}
                      <span className={`source-badge glass-flat ${track.source === 'youtube' ? 'source-yt' : (track.source === 'local' ? 'source-local' : 'source-sc')}`} style={{ marginLeft: 4 }}>
                        {track.source === 'youtube' ? 'YT' : (track.source === 'local' ? 'FILE' : 'SC')}
                      </span>
                    </div>
                  </div>
                  <div className="track-actions">
                    {track.playUrl && <button className="track-act-btn" onClick={() => playTrackByIndex(index)} title="Слушать"><i className="fa-solid fa-play" /></button>}
                    <button className="track-act-btn del" onClick={() => removeTrack(track.id)} title="Удалить"><i className="fa-solid fa-trash-can" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <audio ref={audioRef} preload="metadata" style={{ display: 'none' }} />
        </main>
      </div>

      {showAddUrlModal && (
        <div style={{ display: 'flex', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', zIndex: 1000, alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass glass-primary" style={{ width: '100%', maxWidth: 420, padding: 32, margin: 20 }}>
            <h3 style={{ marginBottom: 18, fontSize: '1rem', fontWeight: 700 }}>Добавить трек</h3>
            <input className="input" type="url" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="https://www.youtube.com/..." style={{ marginBottom: 14 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-accent w-full" onClick={async () => {
                const ok = await addByUrl(addUrl.trim());
                if (ok) {
                  setShowAddUrlModal(false);
                  setAddUrl('');
                }
              }}>Добавить</button>
              <button className="btn w-full" onClick={() => setShowAddUrlModal(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
