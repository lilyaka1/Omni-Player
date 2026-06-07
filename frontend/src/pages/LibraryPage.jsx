import { useEffect, useMemo, useState } from 'react';
import { clearToken, getToken } from '../utils/auth';
import { formatTime } from '../utils/format';
import AudioManager from '../utils/AudioManager';
import QueueStore from '../utils/QueueStore';
import { setupKeyboardShortcuts } from '../utils/keyboardShortcuts';
import { showToast } from '../utils/toast';

// Импорт компонентов
import PlayerControls from '../components/PlayerControls';
import EditTrackModal from '../components/EditTrackModal';

// Импорт хуков
import useLibraryData from '../hooks/useLibraryData';
import useSearch from '../hooks/useSearch';

  function normalizeLibraryTrack(item, token) {
  const t = item && item.track ? item.track : item;
  if (!t || typeof t !== 'object') return null;
  // Определяем source: явное поле, из URL, или из наличия stream_url
  const source = t.source || (t.source_page_url && String(t.source_page_url).includes('soundcloud.com') ? 'soundcloud' : (t.source_page_url && String(t.source_page_url).includes('youtube.com') ? 'youtube' : 'youtube'));
  const playable = Boolean(t.local_file_path || source === 'local' || t.stream_url);
  const sourcePageUrl = t.source_page_url || t.page_url || null;
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album || '',
    genre: t.genre || '',
    year: t.year || null,
    duration: t.duration,
    thumbnail: t.thumbnail || t.thumbnail_url || null,
    source,
    sourcePageUrl,
    canRedownload: Boolean(sourcePageUrl) && !String(sourcePageUrl).startsWith('local-upload://'),
    localFilePath: t.local_file_path || null,
    playable,
    status: t.status || 'ready',
    playUrl: playable ? `/api/player/audio/${t.id}?token=${encodeURIComponent(token || '')}` : null,
  };
}

export default function LibraryPage() {
  const token = getToken();
  const [authState, setAuthState] = useState('checking');

  const {
    libraryTracks: rawLibraryTracks,
    loadLibrary,
    uploadFiles: uploadFilesHook,
    addByUrl: addByUrlHook,
    removeTrack,
    updateTrackMetadata,
    uploadCover,
    redownloadTrack: redownloadTrackHook,
    redownloadingId,
  } = useLibraryData();

  const {
    searchQuery,
    setSearchQuery,
    searchSource,
    setSearchSource,
    searchResults,
    searchLoading,
    doSearch,
  } = useSearch();

  // Нормализуем треки библиотеки
  const libraryTracks = useMemo(
    () => rawLibraryTracks.map((item) => normalizeLibraryTrack(item, token)).filter(Boolean),
    [rawLibraryTracks, token]
  );

  // Плеер
  const [currentTrack, setCurrentTrack] = useState(QueueStore.getCurrentTrack());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(AudioManager.getVolume());
  const [shuffle, setShuffle] = useState(QueueStore.isShuffle());
  const [repeatMode, setRepeatMode] = useState(QueueStore.getRepeatMode());

  // Вкладки
  const [activeTab, setActiveTab] = useState('library');
  const [queueTracks, setQueueTracks] = useState(QueueStore.getQueue());

  // Модалки
  const [showAddUrlModal, setShowAddUrlModal] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [editTrack, setEditTrack] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', artist: '', album: '', genre: '', year: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

  const totalCount = useMemo(() => libraryTracks.length, [libraryTracks]);

  // Проверка авторизации
  useEffect(() => {
    if (!token) {
      setAuthState('unauthorized');
      return;
    }
    let cancelled = false;

    async function validateAuth() {
      try {
        const res = await fetch('/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('unauthorized');
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
  }, [token, loadLibrary]);

  // AudioManager события
  useEffect(() => {
    const onLoadedMetadata = ({ duration: dur }) => {
      setDuration(Number.isFinite(dur) ? dur : 0);
    };
    const onTimeUpdate = ({ currentTime: time }) => {
      setCurrentTime(time || 0);
    };
    const onEnded = () => {
      if (repeatMode === 'one') {
        AudioManager.seek(0);
        AudioManager.play();
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

    AudioManager.on('loadedmetadata', onLoadedMetadata);
    AudioManager.on('timeupdate', onTimeUpdate);
    AudioManager.on('ended', onEnded);
    AudioManager.on('error', onError);
    AudioManager.on('play', onPlay);
    AudioManager.on('pause', onPause);

    return () => {
      AudioManager.off('loadedmetadata', onLoadedMetadata);
      AudioManager.off('timeupdate', onTimeUpdate);
      AudioManager.off('ended', onEnded);
      AudioManager.off('error', onError);
      AudioManager.off('play', onPlay);
      AudioManager.off('pause', onPause);
    };
  }, [repeatMode]);

  // QueueStore события
  useEffect(() => {
    const onQueueChange = () => {
      setQueueTracks(QueueStore.getQueue());
      setCurrentTrack(QueueStore.getCurrentTrack());
    };
    const onIndexChange = () => {
      setCurrentTrack(QueueStore.getCurrentTrack());
    };
    const onShuffleChange = ({ shuffle: enabled }) => setShuffle(enabled);
    const onRepeatChange = ({ repeatMode: mode }) => setRepeatMode(mode);

    QueueStore.on('queuechange', onQueueChange);
    QueueStore.on('indexchange', onIndexChange);
    QueueStore.on('shufflechange', onShuffleChange);
    QueueStore.on('repeatchange', onRepeatChange);

    return () => {
      QueueStore.off('queuechange', onQueueChange);
      QueueStore.off('indexchange', onIndexChange);
      QueueStore.off('shufflechange', onShuffleChange);
      QueueStore.off('repeatchange', onRepeatChange);
    };
  }, []);

  const isCurrentTrackReady = currentTrack?.status ? currentTrack.status === 'ready' : true;

  // Загрузка трека в AudioManager
  useEffect(() => {
    const shouldLoad = currentTrack?.playUrl && isCurrentTrackReady;
    if (shouldLoad) {
      AudioManager.loadTrack(currentTrack);
      setDuration(Number(currentTrack.duration) || 0);
    } else {
      AudioManager.loadTrack(null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
    }
  }, [currentTrack?.id, currentTrack?.playUrl, currentTrack?.status]);

  // Автовоспроизведение
  useEffect(() => {
    if (!currentTrack?.playUrl || !isCurrentTrackReady) return;
    if (isPlaying) {
      AudioManager.play().catch(() => setIsPlaying(false));
    } else {
      AudioManager.pause();
    }
  }, [isPlaying, currentTrack?.playUrl, currentTrack?.status]);

  // Preload следующего трека
  useEffect(() => {
    const currentIndex = QueueStore.getCurrentIndex();
    const nextIndex = QueueStore.findNextPlayableIndex(1);
    if (nextIndex < 0 || nextIndex === currentIndex) return;
    const nextTrack = QueueStore.getQueue()[nextIndex];
    if (!nextTrack?.playUrl || (nextTrack.status && nextTrack.status !== 'ready')) return;

    const preloadAudio = document.createElement('audio');
    preloadAudio.preload = 'auto';
    preloadAudio.src = nextTrack.playUrl;
    preloadAudio.style.display = 'none';
    document.body.appendChild(preloadAudio);

    return () => {
      preloadAudio.pause();
      preloadAudio.src = '';
      document.body.removeChild(preloadAudio);
    };
  }, [currentTrack?.id]);

  // Keyboard shortcuts
  useEffect(() => {
    let savedVolume = volume;
    const handlers = {
      togglePlay: () => AudioManager.togglePlay(),
      next: () => {
        const nextTrack = QueueStore.next();
        if (nextTrack) {
          AudioManager.loadTrack(nextTrack);
          setIsPlaying(true);
        }
      },
      previous: () => {
        const prevTrack = QueueStore.previous();
        if (prevTrack) {
          AudioManager.loadTrack(prevTrack);
          setIsPlaying(true);
        }
      },
      seekForward: (seconds) => AudioManager.seek(AudioManager.getCurrentTime() + seconds),
      seekBackward: (seconds) => AudioManager.seek(AudioManager.getCurrentTime() - seconds),
      volumeUp: (delta) => {
        const v = Math.min(1, volume + delta);
        setVolume(v);
        AudioManager.setVolume(v);
      },
      volumeDown: (delta) => {
        const v = Math.max(0, volume - delta);
        setVolume(v);
        AudioManager.setVolume(v);
      },
      toggleMute: () => {
        if (volume > 0) {
          savedVolume = volume;
          setVolume(0);
          AudioManager.setVolume(0);
        } else {
          const restore = savedVolume > 0 ? savedVolume : 0.85;
          setVolume(restore);
          AudioManager.setVolume(restore);
        }
      },
      toggleShuffle: () => QueueStore.setShuffle(!shuffle),
      toggleRepeat: () => {
        const modes = ['off', 'one', 'all'];
        const next = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
        QueueStore.setRepeatMode(next);
      },
      seekToPercent: (percent) => AudioManager.seek((duration || 0) * (percent / 100)),
    };
    return setupKeyboardShortcuts(handlers);
  }, [volume, shuffle, repeatMode, duration]);

  // --- Функции управления плеером ---
  function playTrackByIndex(index) {
    const q = QueueStore.getQueue();
    if (index < 0 || index >= q.length) return;
    const track = q[index];
    if (track?.status && track.status !== 'ready') {
      showToast(`Трек ещё не готов: ${track.status}`, 'error');
      return;
    }
    if (!track?.playUrl) {
      showToast('Этот трек пока не доступен для локального прослушивания', 'error');
      return;
    }
    QueueStore.setCurrentIndex(index);
    setIsPlaying(true);
  }

  function playNext() {
    const q = QueueStore.getQueue();
    if (!q.length) return;
    const nextTrack = QueueStore.next();
    if (nextTrack) setIsPlaying(true);
  }

  function playPrev() {
    const q = QueueStore.getQueue();
    if (!q.length) return;
    const prevTrack = QueueStore.previous();
    if (prevTrack) setIsPlaying(true);
  }

  function togglePlay() {
    if (!currentTrack?.playUrl) {
      const q = QueueStore.getQueue();
      const firstPlayable = q.findIndex((track) => track.playUrl);
      if (firstPlayable >= 0) playTrackByIndex(firstPlayable);
      return;
    }
    setIsPlaying((prev) => !prev);
  }

  function seekTo(value) {
    const nextTime = Math.max(0, Math.min(Number(value) || 0, duration || 0));
    AudioManager.seek(nextTime);
    setCurrentTime(nextTime);
  }

  function handleVolumeChange(value) {
    const v = Number(value);
    setVolume(v);
    AudioManager.setVolume(v);
  }

  function handleShuffleToggle() {
    QueueStore.setShuffle(!shuffle);
  }

  function handleRepeatToggle() {
    const modes = ['off', 'one', 'all'];
    const next = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    QueueStore.setRepeatMode(next);
  }

  // --- Библиотека / Очередь ---
  function handlePlayTrack(track) {
    const index = queueTracks.findIndex((t) => t.id === track.id);
    if (index >= 0) playTrackByIndex(index);
  }

  function handlePlayFromLibrary(track) {
    const idx = queueTracks.findIndex((t) => t.id === track.id);
    if (idx >= 0) {
      playTrackByIndex(idx);
      return;
    }
    QueueStore.addTrack(track);
    setQueueTracks(QueueStore.getQueue());
    const newIdx = QueueStore.getQueue().length - 1;
    QueueStore.setCurrentIndex(newIdx);
    setIsPlaying(true);
  }

  function handleAddToQueue(track) {
    const idx = queueTracks.findIndex((t) => t.id === track.id);
    if (idx >= 0) {
      showToast('Трек уже в очереди', 'info');
      return;
    }
    QueueStore.addTrack(track);
    setQueueTracks(QueueStore.getQueue());
    showToast('Трек добавлен в очередь', 'success');
  }

  function handleRemoveFromQueue(trackId) {
    QueueStore.removeTrack(trackId);
    setQueueTracks(QueueStore.getQueue());
  }

  function handleClearQueue() {
    QueueStore.clearQueue();
    setQueueTracks([]);
  }

  function handleEditTrack(track) {
    setEditTrack(track);
    setEditForm({
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      genre: track.genre || '',
      year: track.year ? String(track.year) : '',
    });
  }

  async function handleRedownloadTrack(track) {
    if (!track.canRedownload) {
      showToast('У трека нет источника для повторного скачивания', 'error');
      return;
    }
    try {
      await redownloadTrackHook(track.id);
      await loadLibrary();
    } catch {
      // ошибка в хуке
    }
  }

  async function handleRemoveTrack(track) {
    try {
      await removeTrack(track.id, track);
    } catch {
      // ошибка в хуке
    }
  }

  // --- Поиск ---
  async function handleAddTrackFromSearch(result) {
    const pageUrl = result.page_url || result.track_page_url || '';
    console.log('[handleAddTrackFromSearch] result:', result, 'pageUrl:', pageUrl);
    if (!pageUrl) {
      showToast('Не удалось получить URL трека', 'error');
      return;
    }
    try {
      const data = await addByUrlHook(pageUrl);
      console.log('[handleAddTrackFromSearch] addByUrlHook returned:', data);
      await loadLibrary();
      showToast('Трек добавлен в библиотеку', 'success');
    } catch (error) {
      console.error('handleAddTrackFromSearch error:', error);
      showToast(`Ошибка: ${error.message || 'Не удалось добавить трек'}`, 'error');
    }
  }

  async function handleAddSearchToQueue(result) {
    const pageUrl = result.page_url || result.track_page_url || '';
    console.log('[handleAddSearchToQueue] result:', result, 'pageUrl:', pageUrl);
    if (!pageUrl) {
      showToast('Не удалось получить URL трека', 'error');
      return;
    }
    try {
      const data = await addByUrlHook(pageUrl);
      console.log('[handleAddSearchToQueue] addByUrlHook returned:', data);
      await loadLibrary();
      const newTrack = data?.track;
      if (newTrack) {
        const normalized = normalizeLibraryTrack(newTrack, token);
        const alreadyInQueue = QueueStore.getQueue().find((t) => t.id === normalized.id);
        if (!alreadyInQueue) {
          QueueStore.addTrack(normalized);
          setQueueTracks(QueueStore.getQueue());
        }
        showToast('Трек добавлен в очередь', 'success');
      } else {
        showToast('Трек добавлен в библиотеку', 'success');
      }
    } catch (error) {
      console.error('handleAddSearchToQueue error:', error);
      showToast(`Ошибка: ${error.message || 'Не удалось добавить трек в очередь'}`, 'error');
    }
  }

  // --- Загрузка файлов ---
  async function uploadFiles(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    event.target.value = '';
    try {
      await uploadFilesHook(files);
    } catch {
      // ошибка в хуке
    }
  }

  // --- Модалка добавления по URL ---
  async function addByUrl(url) {
    try {
      await addByUrlHook(url);
      await loadLibrary();
      return true;
    } catch {
      return false;
    }
  }

  // --- EditTrackModal ---
  async function saveEditModal() {
    if (!editTrack || editSaving) return;
    setEditSaving(true);
    try {
      const metadata = {
        title: editForm.title.trim() || null,
        artist: editForm.artist.trim() || null,
        album: editForm.album.trim() || null,
        genre: editForm.genre.trim() || null,
        year: editForm.year ? Number(editForm.year) || null : null,
      };
      await updateTrackMetadata(editTrack.id, metadata);
      await loadLibrary();
      setEditTrack(null);
    } catch {
      // ошибка в хуке
    } finally {
      setEditSaving(false);
    }
  }

  async function uploadCoverForEdited(file) {
    if (!editTrack || !file) return;
    setCoverUploading(true);
    try {
      const coverUrl = await uploadCover(editTrack.id, file);
      await loadLibrary();
      setEditTrack((t) => (t ? { ...t, thumbnail: coverUrl || t.thumbnail } : t));
    } catch {
      // ошибка в хуке
    } finally {
      setCoverUploading(false);
    }
  }

  // --- Рендер ---
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
            Войдите в аккаунт, чтобы загружать файлы и слушать их в локальном плеере.
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
              <i className="fa-solid fa-music" /> Медиотека
            </button>
            <button className="nav-item" id="themeToggle">
              <i className="fa-solid fa-moon" id="themeIcon" /> Тема
            </button>
          </nav>
        </aside>

        <main className="library-main">
          <div className="page-header-wrap">
            <div>
              <h2>Медиотека</h2>
              <p className="text-sm text-muted" style={{ marginTop: 2 }}>Слушайте сохранённые треки как в обычном аудиоплеере</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="btn" htmlFor="localFileInput"><i className="fa-solid fa-file-audio" /> Загрузить файл</label>
              <button className="btn" onClick={() => setShowAddUrlModal(true)}><i className="fa-solid fa-plus" /> Добавить по ссылке</button>
            </div>
          </div>

          <PlayerControls
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            volume={volume}
            shuffle={shuffle}
            repeatMode={repeatMode}
            onTogglePlay={togglePlay}
            onNext={playNext}
            onPrev={playPrev}
            onSeek={seekTo}
            onVolumeChange={handleVolumeChange}
            onToggleShuffle={handleShuffleToggle}
            onToggleRepeat={handleRepeatToggle}
          />

          <input id="localFileInput" type="file" accept="audio/*" multiple style={{ display: 'none' }} onChange={uploadFiles} />

          {/* Поиск */}
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
                const avail = (t.availability || 'UNKNOWN').toUpperCase();
                const isAllowed = t.source !== 'soundcloud' || avail === 'FULL' || avail === 'UNKNOWN';
                const reasonMap = {
                  'PREVIEW_ONLY': 'SoundCloud preview only',
                  'RESTRICTED': 'Requires SoundCloud Go+',
                  'UNKNOWN': 'Track unavailable',
                };
                const reason = isAllowed ? '' : (reasonMap[avail] || 'Track unavailable');
                return (
                  <div key={`${t.title}-${index}`} className="search-result-card glass glass-secondary">
                    <div className="search-result-thumb">
                      {t.thumbnail ? <img src={t.thumbnail} alt="" loading="lazy" /> : <i className="fa-solid fa-music" style={{ fontSize: '2rem', color: 'var(--accent)', opacity: 0.4 }} />}
                    </div>
                    <div className="search-result-info">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div className="search-result-title">{t.title}</div>
                        {t.source === 'soundcloud' && t.availability && t.availability !== 'FULL' && (
                          <span className={`badge glass-flat availability-${String(t.availability).toLowerCase()}`} title={reason}>
                            {t.availability === 'PREVIEW_ONLY' ? 'Preview only' : (t.availability === 'RESTRICTED' ? 'Restricted' : 'Unknown')}
                          </span>
                        )}
                      </div>
                      <div className="search-result-sub">{t.duration ? formatTime(t.duration) : '—'}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="search-result-add" onClick={() => handleAddTrackFromSearch(t)} disabled={!isAllowed} title={!isAllowed ? reason : 'Добавить в библиотеку'}>
                          <i className="fa-solid fa-bookmark" /> В библиотеку
                        </button>
                        <button className="search-result-add" onClick={() => handleAddSearchToQueue(t)} disabled={!isAllowed} style={{ background: 'var(--accent)', color: '#fff' }} title={!isAllowed ? reason : 'Добавить в очередь'}>
                          <i className="fa-solid fa-plus" /> В очередь
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Вкладки Библиотека / Очередь */}
          <div className="library-tabs">
            <button className={`library-tab ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>
              <i className="fa-solid fa-book" /> Библиотека
              <span className="badge glass-flat" style={{ marginLeft: 8 }}>{totalCount}</span>
            </button>
            <button className={`library-tab ${activeTab === 'queue' ? 'active' : ''}`} onClick={() => setActiveTab('queue')}>
              <i className="fa-solid fa-list-music" /> Очередь
              <span className="badge glass-flat" style={{ marginLeft: 8 }}>{queueTracks.length}</span>
            </button>
          </div>

          {activeTab === 'library' && (
            <div className="section-panel glass glass-secondary">
              <div className="section-panel-header">
                <div className="section-panel-title"><i className="fa-solid fa-book" /> Библиотека</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => { QueueStore.clearQueue(); libraryTracks.forEach((t) => QueueStore.addTrack(t)); setQueueTracks(QueueStore.getQueue()); showToast('Все треки добавлены в очередь', 'success'); }}>
                    <i className="fa-solid fa-plus" /> В очередь всё
                  </button>
                </div>
              </div>
              <div className="track-list player-queue-list" id="libraryList">
                {!libraryTracks.length && <div className="empty-state"><i className="fa-solid fa-music" /><p>Библиотека пуста</p></div>}
                {libraryTracks.map((track) => (
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
                        {track.source === 'soundcloud' && track.availability && track.availability !== 'FULL' && (
                          <span className={`badge glass-flat availability-${String(track.availability).toLowerCase()}`} style={{ marginLeft: 8 }} title={
                            track.availability === 'PREVIEW_ONLY' ? 'SoundCloud preview only' : (track.availability === 'RESTRICTED' ? 'Requires SoundCloud Go+' : 'Track unavailable')
                          }>
                            {track.availability === 'PREVIEW_ONLY' ? 'Preview only' : (track.availability === 'RESTRICTED' ? 'Restricted' : 'Unknown')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="track-actions">
                      {(track.playUrl && (!track.availability || track.availability === 'FULL')) && (
                        <button className="track-act-btn" onClick={() => handlePlayFromLibrary(track)} title="Слушать"><i className="fa-solid fa-play" /></button>
                      )}
                      <button className="track-act-btn" onClick={() => handleAddToQueue(track)} title="Добавить в очередь"><i className="fa-solid fa-plus" /></button>
                      <button className="track-act-btn" onClick={() => handleEditTrack(track)} title="Редактировать"><i className="fa-solid fa-pen" /></button>
                      {track.canRedownload && (
                        <button className="track-act-btn" onClick={() => handleRedownloadTrack(track)} title="Скачать заново" disabled={redownloadingId === track.id}>
                          <i className={`fa-solid ${redownloadingId === track.id ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}`} />
                        </button>
                      )}
                      <button className="track-act-btn del" onClick={() => handleRemoveTrack(track)} title="Удалить из библиотеки"><i className="fa-solid fa-trash-can" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'queue' && (
            <div className="section-panel glass glass-secondary">
              <div className="section-panel-header">
                <div className="section-panel-title"><i className="fa-solid fa-list-music" /> Очередь</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" onClick={handleClearQueue} disabled={!queueTracks.length}><i className="fa-solid fa-trash" /> Очистить</button>
                </div>
              </div>
              <div className="track-list player-queue-list" id="libraryList">
                {!queueTracks.length && <div className="empty-state"><i className="fa-solid fa-music" /><p>Очередь пуста</p></div>}
                {queueTracks.map((track, index) => (
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
                        {track.source === 'soundcloud' && track.availability && track.availability !== 'FULL' && (
                          <span className={`badge glass-flat availability-${String(track.availability).toLowerCase()}`} style={{ marginLeft: 8 }} title={
                            track.availability === 'PREVIEW_ONLY' ? 'SoundCloud preview only' : (track.availability === 'RESTRICTED' ? 'Requires SoundCloud Go+' : 'Track unavailable')
                          }>
                            {track.availability === 'PREVIEW_ONLY' ? 'Preview only' : (track.availability === 'RESTRICTED' ? 'Restricted' : 'Unknown')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="track-actions">
                      {(track.playUrl && (!track.availability || track.availability === 'FULL')) && (
                        <button className="track-act-btn" onClick={() => playTrackByIndex(index)} title={(!track.availability || track.availability === 'FULL') ? 'Слушать' : 'Трек недоступен'}><i className="fa-solid fa-play" /></button>
                      )}
                      <button className="track-act-btn del" onClick={() => handleRemoveFromQueue(track.id)} title="Удалить из очереди"><i className="fa-solid fa-xmark" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      <EditTrackModal
        track={editTrack}
        isOpen={!!editTrack}
        onClose={() => !editSaving && !coverUploading && setEditTrack(null)}
        onSave={saveEditModal}
        onUploadCover={uploadCoverForEdited}
        editForm={editForm}
        onFormChange={setEditForm}
        isSaving={editSaving}
        isUploadingCover={coverUploading}
      />

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
