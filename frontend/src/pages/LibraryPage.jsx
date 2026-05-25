import { useEffect, useMemo, useState } from 'react';
import { clearToken, getToken } from '../utils/auth';
import { formatTime } from '../utils/format';
import AudioManager from '../utils/AudioManager';
import QueueStore from '../utils/QueueStore';
import { setupKeyboardShortcuts } from '../utils/keyboardShortcuts';
import { showToast } from '../utils/toast';

// Импорт компонентов
import PlayerControls from '../components/PlayerControls';
import TrackList from '../components/TrackList';
import SearchPanel from '../components/SearchPanel';
import EditTrackModal from '../components/EditTrackModal';

// Импорт хуков
import useLibraryData from '../hooks/useLibraryData';
import useSearch from '../hooks/useSearch';

function normalizeLibraryTrack(item, token) {
  const t = item && item.track ? item.track : item;
  if (!t || typeof t !== 'object') return null;
  const playable = Boolean(t.local_file_path || t.source === 'local');
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
    source: t.source,
    sourcePageUrl,
    canRedownload: Boolean(sourcePageUrl) && !String(sourcePageUrl).startsWith('local-upload://'),
    localFilePath: t.local_file_path || null,
    playable,
    playUrl: playable ? `/api/player/audio/${t.id}?token=${encodeURIComponent(token || '')}` : null,
  };
}

export default function LibraryPage() {
  const token = getToken();
  const [authState, setAuthState] = useState('checking');
  
  // Используем хуки для управления данными
  const {
    libraryTracks: rawLibraryTracks,
    downloadsDir,
    downloadsPath,
    loadLibrary,
    loadDownloadSettings,
    saveDownloadSettings,
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

  // Состояние плеера
  const [currentTrack, setCurrentTrack] = useState(QueueStore.getCurrentTrack());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(AudioManager.getVolume());
  const [shuffle, setShuffle] = useState(QueueStore.isShuffle());
  const [repeatMode, setRepeatMode] = useState(QueueStore.getRepeatMode());

  // Состояние модалок
  const [showAddUrlModal, setShowAddUrlModal] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [downloadsDirInput, setDownloadsDirInput] = useState('');
  const [savingDownloadsDir, setSavingDownloadsDir] = useState(false);
  const [editTrack, setEditTrack] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', artist: '', album: '', genre: '', year: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

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
        if (!res.ok) {
          throw new Error('unauthorized');
        }
        if (cancelled) return;
        setAuthState('authorized');
        await loadDownloadSettings().catch(() => null);
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
  }, [token, loadLibrary, loadDownloadSettings]);

  useEffect(() => {
    setDownloadsDirInput(downloadsDir || '');
  }, [downloadsDir]);

  const playableTracks = useMemo(() => libraryTracks.filter((track) => track.playUrl), [libraryTracks]);
  const totalCount = useMemo(() => libraryTracks.length, [libraryTracks]);

  // Подписка на события AudioManager
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

  // Подписка на события QueueStore
  useEffect(() => {
    const onQueueChange = () => {
      setCurrentTrack(QueueStore.getCurrentTrack());
    };

    const onIndexChange = () => {
      setCurrentTrack(QueueStore.getCurrentTrack());
    };

    const onShuffleChange = ({ shuffle: shuffleEnabled }) => {
      setShuffle(shuffleEnabled);
    };

    const onRepeatChange = ({ repeatMode: mode }) => {
      setRepeatMode(mode);
    };

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

  // Синхронизация библиотеки с QueueStore
  useEffect(() => {
    QueueStore.setQueue(libraryTracks);
  }, [libraryTracks]);

  // Загрузка трека в AudioManager при изменении currentTrack
  useEffect(() => {
    if (currentTrack?.playUrl) {
      AudioManager.loadTrack(currentTrack);
      setDuration(Number(currentTrack.duration) || 0);
    } else {
      AudioManager.loadTrack(null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
    }
  }, [currentTrack?.id]);

  // Автовоспроизведение при изменении isPlaying
  useEffect(() => {
    if (!currentTrack?.playUrl) return;

    if (isPlaying) {
      AudioManager.play().catch(() => setIsPlaying(false));
    } else {
      AudioManager.pause();
    }
  }, [isPlaying, currentTrack?.playUrl]);

  // Preload следующего трека
  useEffect(() => {
    const currentIndex = QueueStore.getCurrentIndex();
    const nextIndex = QueueStore.findNextPlayableIndex(1);
    
    // Если нет следующего трека или это тот же трек
    if (nextIndex < 0 || nextIndex === currentIndex) {
      return;
    }

    const nextTrack = QueueStore.getQueue()[nextIndex];
    if (!nextTrack?.playUrl) {
      return;
    }

    // Создаём скрытый audio элемент для preload
    const preloadAudio = document.createElement('audio');
    preloadAudio.preload = 'auto';
    preloadAudio.src = nextTrack.playUrl;
    preloadAudio.style.display = 'none';
    
    // Добавляем в DOM
    document.body.appendChild(preloadAudio);

    // Cleanup при unmount или изменении currentTrack
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
      togglePlay: () => {
        AudioManager.togglePlay();
      },

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

      seekForward: (seconds) => {
        const newTime = AudioManager.getCurrentTime() + seconds;
        AudioManager.seek(newTime);
      },

      seekBackward: (seconds) => {
        const newTime = AudioManager.getCurrentTime() - seconds;
        AudioManager.seek(newTime);
      },

      volumeUp: (delta) => {
        const newVolume = Math.min(1, volume + delta);
        setVolume(newVolume);
        AudioManager.setVolume(newVolume);
      },

      volumeDown: (delta) => {
        const newVolume = Math.max(0, volume - delta);
        setVolume(newVolume);
        AudioManager.setVolume(newVolume);
      },

      toggleMute: () => {
        if (volume > 0) {
          savedVolume = volume;
          setVolume(0);
          AudioManager.setVolume(0);
        } else {
          const restoreVolume = savedVolume > 0 ? savedVolume : 0.85;
          setVolume(restoreVolume);
          AudioManager.setVolume(restoreVolume);
        }
      },

      toggleShuffle: () => {
        QueueStore.setShuffle(!shuffle);
      },

      toggleRepeat: () => {
        const modes = ['off', 'one', 'all'];
        const currentIdx = modes.indexOf(repeatMode);
        const nextMode = modes[(currentIdx + 1) % modes.length];
        QueueStore.setRepeatMode(nextMode);
      },

      seekToPercent: (percent) => {
        const targetTime = (duration || 0) * (percent / 100);
        AudioManager.seek(targetTime);
      },
    };

    const cleanup = setupKeyboardShortcuts(handlers);

    return cleanup;
  }, [volume, shuffle, repeatMode, duration]);

  // Функции управления плеером
  function playTrackByIndex(index) {
    if (index < 0 || index >= libraryTracks.length) return;
    const track = libraryTracks[index];
    if (!track?.playUrl) {
      showToast('Этот трек пока не доступен для локального прослушивания', 'error');
      return;
    }
    QueueStore.setCurrentIndex(index);
    setIsPlaying(true);
  }

  function playNext() {
    if (!libraryTracks.length) return;
    const nextTrack = QueueStore.next();
    if (nextTrack) {
      setIsPlaying(true);
    }
  }

  function playPrev() {
    if (!libraryTracks.length) return;
    const prevTrack = QueueStore.previous();
    if (prevTrack) {
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
    const nextTime = Math.max(0, Math.min(Number(value) || 0, duration || 0));
    AudioManager.seek(nextTime);
    setCurrentTime(nextTime);
  }

  function handleVolumeChange(value) {
    const vol = Number(value);
    setVolume(vol);
    AudioManager.setVolume(vol);
  }

  function handleShuffleToggle() {
    const newShuffle = !shuffle;
    QueueStore.setShuffle(newShuffle);
  }

  function handleRepeatToggle() {
    const modes = ['off', 'one', 'all'];
    const currentIdx = modes.indexOf(repeatMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    QueueStore.setRepeatMode(nextMode);
  }

  // Обработчики для TrackList
  function handlePlayTrack(track) {
    const index = libraryTracks.findIndex((t) => t.id === track.id);
    if (index >= 0) {
      playTrackByIndex(index);
    }
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
      // Ошибка уже обработана в хуке
    }
  }

  async function handleRemoveTrack(track) {
    try {
      await removeTrack(track.id);
      await loadLibrary();
    } catch {
      // Ошибка уже обработана в хуке
    }
  }

  // Обработчики для SearchPanel
  async function handleAddTrackFromSearch(result) {
    const pageUrl = result.page_url || result.track_page_url || '';
    if (!pageUrl) {
      showToast('Не удалось получить URL трека', 'error');
      return;
    }
    try {
      await addByUrlHook(pageUrl);
    } catch {
      // Ошибка уже обработана в хуке
    }
  }

  // Обработчики для загрузки файлов
  async function uploadFiles(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    event.target.value = '';

    try {
      await uploadFilesHook(files);
    } catch {
      // Ошибка уже обработана в хуке
    }
  }

  // Обработчики для модалки добавления по URL
  async function addByUrl(url) {
    try {
      await addByUrlHook(url);
      return true;
    } catch {
      return false;
    }
  }

  async function saveDownloadsFolder() {
    if (savingDownloadsDir) return;
    setSavingDownloadsDir(true);
    try {
      await saveDownloadSettings(downloadsDirInput.trim());
    } finally {
      setSavingDownloadsDir(false);
    }
  }

  // Обработчики для EditTrackModal
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
      // Ошибка уже обработана в хуке
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
      // Обновить превью прямо в открытой модалке
      setEditTrack((t) => (t ? { ...t, thumbnail: coverUrl || t.thumbnail } : t));
    } catch {
      // Ошибка уже обработана в хуке
    } finally {
      setCoverUploading(false);
    }
  }

  // Рендер состояний авторизации
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

          <div className="glass glass-secondary" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ minWidth: 170, color: 'var(--text-secondary)', fontSize: 13 }}>
                Папка загрузки пользователя
              </label>
              <input
                className="input"
                value={downloadsDirInput}
                onChange={(e) => setDownloadsDirInput(e.target.value)}
                placeholder="users/1"
                style={{ minWidth: 260, flex: '1 1 260px' }}
              />
              <button className="btn" onClick={saveDownloadsFolder} disabled={savingDownloadsDir}>
                {savingDownloadsDir ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              Фактический путь в контейнере: {downloadsPath || '—'}
            </div>
          </div>

          {/* Используем компонент PlayerControls */}
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

          {/* Используем компонент SearchPanel */}
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
                      <button className="search-result-add" onClick={() => handleAddTrackFromSearch(t)}><i className="fa-solid fa-bookmark" /> В библиотеку</button>
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

            {/* Используем компонент TrackList */}
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
                    <button className="track-act-btn" onClick={() => handleEditTrack(track)} title="Редактировать">
                      <i className="fa-solid fa-pen" />
                    </button>
                    {track.canRedownload && (
                      <button
                        className="track-act-btn"
                        onClick={() => handleRedownloadTrack(track)}
                        title="Скачать заново"
                        disabled={redownloadingId === track.id}
                      >
                        <i className={`fa-solid ${redownloadingId === track.id ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}`} />
                      </button>
                    )}
                    <button className="track-act-btn del" onClick={() => handleRemoveTrack(track)} title="Удалить"><i className="fa-solid fa-trash-can" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </main>
      </div>

      {/* Используем компонент EditTrackModal */}
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

      {/* Модалка добавления по URL */}
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
