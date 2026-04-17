/**
 * player.js — Управление воспроизведением.
 *
 * Зависимости: globals.js, websocket.js (WSModule.sendWS)
 */

const PlayerModule = (function () {

  // DOM-узлы
  let audio, btnPlay, playIcon, btnPrev, btnNext,
      btnSeekBack, btnSeekFwd,
      progressWrap, progressFill,
      timeCurrent, timeDuration,
      trackTitle, trackArtist,
      artworkBox, artworkContainer,
      volumeSlider;

  let _seekDragging = false;
  let _pendingAutoNext = false;
  let _autoNextTimer = null;
  let _progressTimer = null;
  let _syncBasePosition = 0;
  let _syncAtMs = 0;
  let _autoNextSentForTrackId = null;
  let _lastControlAction = '';
  let _lastControlAt = 0;
  let _lastNextAt = 0;
  let _playIntentUntil = 0;

  function hasUsableAudioSource() {
    if (!audio) return false;
    const src = String(audio.currentSrc || audio.src || '').trim();
    if (!src) return false;
    if (src === window.location.href) return false;
    return audio.readyState > 0;
  }

  function getLocalPlayingState() {
    if (!audio) return false;
    return !audio.paused && hasUsableAudioSource();
  }

  function markSyncPosition(position) {
    const p = Number(position);
    _syncBasePosition = Number.isFinite(p) ? Math.max(0, p) : 0;
    _syncAtMs = Date.now();
  }

  function getEstimatedPosition() {
    if (!_syncAtMs) return GLOBAL.currentPosition || 0;
    if (!GLOBAL.isPlaying) return _syncBasePosition;
    const elapsed = (Date.now() - _syncAtMs) / 1000;
    return Math.max(0, _syncBasePosition + elapsed);
  }

  function isRoomRadioMode() {
    return Boolean(GLOBAL.roomId && GLOBAL.currentTrack);
  }

  function ensureProgressTicker() {
    if (_progressTimer) return;
    _progressTimer = setInterval(() => {
      if (_seekDragging) return;

      const duration = Number(GLOBAL.currentDuration || (GLOBAL.currentTrack && GLOBAL.currentTrack.duration) || 0) || 0;
      // Room mode: always advance if playing, even if streamConnected is delayed
      const roomCanAdvance = !isRoomRadioMode() || GLOBAL.isPlaying;
      const pos = isRoomRadioMode()
        ? (roomCanAdvance ? getEstimatedPosition() : (GLOBAL.currentPosition || 0))
        : ((audio && Number.isFinite(audio.currentTime)) ? audio.currentTime : (GLOBAL.currentPosition || 0));

      GLOBAL.currentPosition = pos;
      updateProgress(pos, duration);
    }, 300);
  }

  function ensureAutoNextWatcher() {
    // Room mode: server controls all track transitions, never auto-skip
    if (isRoomRadioMode()) return;
    
    if (_autoNextTimer) return;
    _autoNextTimer = setInterval(() => {
      // Extra safety: also check here
      if (isRoomRadioMode()) {
        clearInterval(_autoNextTimer);
        _autoNextTimer = null;
        return;
      }
      if (GLOBAL.userRole !== 'owner') return;
      if (!GLOBAL.isPlaying) return;
      if (!GLOBAL.currentTrack || !GLOBAL.currentTrack.id) return;
      const duration = Number(GLOBAL.currentDuration || GLOBAL.currentTrack.duration || 0);
      if (!Number.isFinite(duration) || duration <= 1) return;

      const estimated = getEstimatedPosition();
      if (estimated < duration - 0.6) return;
      if (_autoNextSentForTrackId === GLOBAL.currentTrack.id) return;

      _autoNextSentForTrackId = GLOBAL.currentTrack.id;
      _pendingAutoNext = true;
      WSModule.sendWS('playback_control', { action: 'next' });
    }, 500);
  }

  function syncControlsByRole() {
    const isOwner = GLOBAL.userRole === 'owner';
    const roomMode = isRoomRadioMode();
    const canSeek = isOwner && !roomMode;
    const canTransport = isOwner && !roomMode;
    const canToggleListen = roomMode || isOwner;

    [btnPlay, btnPrev, btnNext].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !isOwner;
      btn.classList.toggle('ctrl-btn-disabled', !isOwner);
    });
    if (btnPlay) {
      btnPlay.disabled = !canToggleListen;
      btnPlay.classList.toggle('ctrl-btn-disabled', !canToggleListen);
    }

    [btnPrev, btnNext].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !canTransport;
      btn.classList.toggle('ctrl-btn-disabled', !canTransport);
    });

    [btnSeekBack, btnSeekFwd].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !canSeek;
      btn.classList.toggle('ctrl-btn-disabled', !canSeek);
    });

    if (progressWrap) {
      progressWrap.classList.toggle('progress-disabled', !canSeek);
    }
  }

  function init() {
    audio          = document.getElementById('audioPlayer');
    btnPlay        = document.getElementById('btnPlayPause');
    playIcon       = document.getElementById('playIcon');
    btnPrev        = document.getElementById('btnPrev');
    btnNext        = document.getElementById('btnNext');
    btnSeekBack    = document.getElementById('btnSeekBack');
    btnSeekFwd     = document.getElementById('btnSeekFwd');
    progressWrap   = document.getElementById('progressWrap');
    progressFill   = document.getElementById('progressFill');
    timeCurrent    = document.getElementById('timeCurrent');
    timeDuration   = document.getElementById('timeDuration');
    trackTitle     = document.getElementById('trackTitle');
    trackArtist    = document.getElementById('trackArtist');
    artworkBox     = document.getElementById('artworkBox');
    artworkContainer = document.getElementById('artworkContainer');
    volumeSlider   = document.getElementById('volumeSlider');

    // ---- Кнопки управления ----
    btnPlay?.addEventListener('click', togglePlay);
    btnNext?.addEventListener('click', nextTrack);
    btnPrev?.addEventListener('click', prevTrack);
    btnSeekBack?.addEventListener('click', () => seekRelative(-10));
    btnSeekFwd?.addEventListener('click',  () => seekRelative(+10));

    // ---- Прогресс-бар: клик для перемотки ----
    progressWrap?.addEventListener('click', (e) => {
      if (!GLOBAL.currentDuration) return;
      const rect = progressWrap.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const pos = ratio * GLOBAL.currentDuration;
      seekTo(pos);
    });

    // ---- Громкость ----
    if (volumeSlider) {
      volumeSlider.value = (audio?.volume ?? 0.8) * 100;
      volumeSlider.addEventListener('input', () => {
        if (audio) audio.volume = volumeSlider.value / 100;
      });
    }

    // ---- Обновление прогресса из audio.timeupdate ----
    audio?.addEventListener('timeupdate', () => {
      if (_seekDragging) return;
      // Для room broadcast не используем local audio.currentTime как источник истины:
      // синхронизация позиции идёт от серверного state + локального тикера.
      if (isRoomRadioMode()) return;

      const pos = Number(audio.currentTime || 0);
      GLOBAL.currentPosition = pos;
      if (!isNaN(audio.duration)) GLOBAL.currentDuration = audio.duration;
      updateProgress(pos, GLOBAL.currentDuration);
    });

    audio?.addEventListener('ended', () => {
      // Для room-radio сервер сам управляет переходом треков.
      if (isRoomRadioMode()) return;
      // Для локального режима: автоматически переходим к следующему треку через WS.
      _pendingAutoNext = true;
      nextTrack();
    });

    audio?.addEventListener('play', () => {
      if (typeof roomTrace === 'function') {
        roomTrace('audio.play', {
          src: audio.currentSrc || audio.src || '',
          currentTime: Number(audio.currentTime || 0),
        });
      }
      if (!isRoomRadioMode()) {
        GLOBAL.isPlaying = true;
      }
      if (isRoomRadioMode()) {
        GLOBAL.localStreamPaused = false;
        setPlayIcon(true);
      } else {
        setPlayIcon(Boolean(GLOBAL.isPlaying));
      }
      artworkContainer?.classList.add('spinning');
      if (!isRoomRadioMode()) {
        markSyncPosition(audio.currentTime || GLOBAL.currentPosition || 0);
      }
    });

    audio?.addEventListener('pause', () => {
      if (typeof roomTrace === 'function') {
        roomTrace('audio.pause', {
          src: audio.currentSrc || audio.src || '',
          currentTime: Number(audio.currentTime || 0),
        });
      }
      if (!isRoomRadioMode()) {
        GLOBAL.isPlaying = false;
      }
      if (isRoomRadioMode()) {
        setPlayIcon(false);
      } else {
        setPlayIcon(Boolean(GLOBAL.isPlaying));
      }
      artworkContainer?.classList.remove('spinning');
      if (!isRoomRadioMode()) {
        markSyncPosition(audio.currentTime || GLOBAL.currentPosition || 0);
      }
    });

    audio?.addEventListener('waiting', () => {
      if (typeof roomTrace === 'function') {
        roomTrace('audio.waiting', {
          currentTime: Number(audio.currentTime || 0),
          readyState: Number(audio.readyState || 0),
          networkState: Number(audio.networkState || 0),
        });
      }
    });

    audio?.addEventListener('error', () => {
      if (typeof roomTrace === 'function') {
        roomTrace('audio.error', {
          code: audio.error ? audio.error.code : null,
          src: audio.currentSrc || audio.src || '',
        });
      }
    });

    ensureAutoNextWatcher();
    ensureProgressTicker();
    syncControlsByRole();
  }

  // ---- Применить состояние от сервера ----
  function applyState(data) {
    if (!data) return;

    syncControlsByRole();

    const hasIsPlaying = Object.prototype.hasOwnProperty.call(data, 'is_playing')
      || Object.prototype.hasOwnProperty.call(data, 'playing');
    const hasPosition = Object.prototype.hasOwnProperty.call(data, 'position')
      || Object.prototype.hasOwnProperty.call(data, 'current_time');

    const prevTrackId = GLOBAL.currentTrack && GLOBAL.currentTrack.id;
    const wasPlayingBefore = GLOBAL.isPlaying || !!(audio && !audio.paused);
    const position = hasPosition ? Number(data.position ?? data.current_time) : NaN;
    const currentTrack = data.current_track || data.track || null;
    const incomingTrackId = currentTrack && currentTrack.id;
    const startedAt = Number(currentTrack && currentTrack.started_at);
    const trackChanged = Boolean(prevTrackId && incomingTrackId && prevTrackId !== incomingTrackId);
    const incomingPlaying = data.is_playing ?? data.playing;
    const startupPlayGrace = Date.now() < _playIntentUntil;
    const explicitServerPause = hasIsPlaying && !Boolean(incomingPlaying);
    const shouldIgnorePauseFromServer = startupPlayGrace && explicitServerPause && !trackChanged;

    const serverSaysPlaying = shouldIgnorePauseFromServer
      ? true
      : (hasIsPlaying
      ? Boolean(incomingPlaying)
      : ((Number.isFinite(startedAt) && startedAt > 0) ? true : wasPlayingBefore));
    
    // Дополнительная защита: если мы только отправили pause (в течение 2s), 
    // не доверяем серверу если он говорит playing=true
    const justSentPause = _lastControlAction === 'pause' && (Date.now() - _lastControlAt) < 2000;
    const shouldIgnorePlayFromServer = justSentPause && serverSaysPlaying && !hasIsPlaying;
    
    let shouldAutoPlay = (shouldIgnorePlayFromServer ? false : serverSaysPlaying)
      || (_pendingAutoNext && trackChanged)
      || (trackChanged && wasPlayingBefore && GLOBAL.userRole === 'listener');

    if (isRoomRadioMode() && GLOBAL.localStreamPaused) {
      shouldAutoPlay = false;
    }

    if (typeof roomTrace === 'function') {
      roomTrace('player.applyState', {
        hasIsPlaying,
        incomingPlaying: hasIsPlaying ? Boolean(incomingPlaying) : null,
        serverSaysPlaying,
        shouldAutoPlay,
        trackChanged,
        trackId: incomingTrackId || null,
        position: Number.isFinite(position) ? position : null,
      });
    }

    if (shouldIgnorePauseFromServer) {
      console.log('[applyState] Ignoring transient server pause during play startup grace window');
    }

    if (trackChanged) {
      _autoNextSentForTrackId = null;
    }

    // Обновить трек
    if (currentTrack) {
      setTrack(currentTrack, position, shouldAutoPlay);
    } else {
      setNoTrack();
    }

    if (_pendingAutoNext && trackChanged) {
      _pendingAutoNext = false;
    }

    GLOBAL.isPlaying = shouldAutoPlay;
    // Всегда пересинхронизировать позицию если есть startedAt (для room mode)
    // или если явно передана позиция
    if (Number.isFinite(position)) {
      markSyncPosition(position);
    } else if (Number.isFinite(startedAt) && startedAt > 0) {
      // Room broadcast mode: calculate position from started_at
      const nowSec = Date.now() / 1000;
      const calcPos = Math.max(0, nowSec - startedAt);
      markSyncPosition(calcPos);
    } else {
      markSyncPosition(GLOBAL.currentPosition || 0);
    }
    setPlayIcon(GLOBAL.isPlaying);
  }

  function setTrack(track, position, autoPlay) {
    const prevTrackId = GLOBAL.currentTrack && GLOBAL.currentTrack.id;
    const incomingTrackId = track && track.id;
    const trackChanged = !prevTrackId || !incomingTrackId || prevTrackId !== incomingTrackId;

    GLOBAL.currentTrack = track;
    GLOBAL.currentDuration = Number(track.duration || GLOBAL.currentDuration || 0) || 0;
    document.dispatchEvent(new CustomEvent('trackchange'));

    // Заголовок и артист
    if (trackTitle) trackTitle.textContent = track.title || 'Без названия';
    if (trackArtist) trackArtist.textContent = track.artist || track.uploader || '—';

    // Artwork
    renderArtwork(track.thumbnail || null);

    // Звук
    if (audio) {
      const resolvedSrc = (typeof StreamModule !== 'undefined')
        ? StreamModule.resolveStreamUrl(track)
        : (track.stream_url || track.url || '');

      if (!resolvedSrc) {
        showToast('У трека пока нет stream URL, попробуйте следующий', 'error');
        return;
      }

      const absResolvedSrc = new URL(resolvedSrc, window.location.href).href;
      const srcChanged = audio.src !== absResolvedSrc;

      if (srcChanged || trackChanged) {
        if (typeof StreamModule !== 'undefined') {
          StreamModule.assignAudio(audio, track, !!autoPlay);
        } else {
          audio.src = resolvedSrc;
          audio.load();
          if (autoPlay) audio.play().catch(() => {});
          else audio.pause();
        }
      } else {
        // Не перезагружаем одинаковый трек, только синхронизируем play/pause.
        if (autoPlay && audio.paused) {
          if (typeof StreamModule !== 'undefined') {
            // В room-mode это активирует retry после раннего 503 до старта эфира.
            StreamModule.assignAudio(audio, track, true);
          } else {
            audio.play().catch(() => {});
          }
        }
        if (!autoPlay && !audio.paused) audio.pause();
      }

      if (Number.isFinite(position)) {
        const seekPos = Number(position);
        const drift = Math.abs((audio.currentTime || 0) - seekPos);
        markSyncPosition(seekPos);
        if (!isRoomRadioMode() && (trackChanged || drift > 2.5)) {
          const onReadySeek = () => {
            try { audio.currentTime = seekPos; } catch {}
            audio.removeEventListener('loadedmetadata', onReadySeek);
          };
          if (audio.readyState >= 1) {
            try { audio.currentTime = seekPos; } catch {}
          } else {
            audio.addEventListener('loadedmetadata', onReadySeek);
          }
        }
      }
    }

    // Обновить заголовок страницы
    document.title = `${track.title || '…'} — Omni Player`;
  }

  function setNoTrack() {
    GLOBAL.currentTrack = null;
    GLOBAL.currentDuration = 0;
    _autoNextSentForTrackId = null;
    _pendingAutoNext = false;
    document.dispatchEvent(new CustomEvent('trackchange'));
    if (trackTitle)  trackTitle.textContent  = 'Нет треков в очереди';
    if (trackArtist) trackArtist.textContent = '—';
    renderArtwork(null);
    if (audio) { audio.pause(); audio.src = ''; }
    updateProgress(0, 0);
    setPlayIcon(false);
  }

  function renderArtwork(url) {
    if (!artworkBox) return;
    if (url) {
      artworkBox.innerHTML = `<img src="${escHtml(url)}" alt="Обложка" loading="lazy"
        onerror="this.parentElement.innerHTML='<div class=\\'artwork-placeholder-icon\\'><i class=\\'fa-solid fa-music\\'></i></div>'" />`;
      artworkBox.classList.add('playing');
    } else {
      artworkBox.innerHTML = '<div class="artwork-placeholder-icon"><i class="fa-solid fa-music"></i></div>';
      artworkBox.classList.remove('playing');
    }
  }

  // ---- UI ----
  function updateProgress(pos, dur) {
    if (timeCurrent)  timeCurrent.textContent  = formatTime(pos);
    if (timeDuration) timeDuration.textContent = formatTime(dur);
    if (progressFill) {
      const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
      progressFill.style.width = `${pct}%`;
    }
  }

  function setPlayIcon(playing) {
    if (playIcon) playIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
  }

  // ---- Команды (отправляем через WebSocket) ----
  function togglePlay() {
    const roomMode = isRoomRadioMode();
    if (!roomMode && GLOBAL.userRole === 'listener') {
      showToast('Только host может управлять воспроизведением', 'error');
      return;
    }

    const now = Date.now();
    if (typeof roomTrace === 'function') {
      roomTrace('player.togglePlay.click', {
        role: GLOBAL.userRole,
        serverPlaying: !!GLOBAL.isPlaying,
        localPlaying: !!(audio && !audio.paused),
        streamConnected: !!GLOBAL.streamConnected,
        trackId: GLOBAL.currentTrack && GLOBAL.currentTrack.id,
      });
    }
    
    // Throttle rapid successive play commands (< 1.2s apart)
    if (_lastControlAction === 'play' && (now - _lastControlAt) < 1200) {
      console.log('[togglePlay] Throttled: play sent recently (' + (now - _lastControlAt) + 'ms ago)');
      return;
    }

    const serverPlaying = !!GLOBAL.isPlaying;
    const localPlaying = getLocalPlayingState();
    const justSentPlay = _lastControlAction === 'play' && (now - _lastControlAt) < 2500;
    const waitingForStreamStart = now < _playIntentUntil;

    let action = 'play';
    let shouldSendCommand = true;
    if (roomMode) {
      const shouldStartLocal = GLOBAL.localStreamPaused || !localPlaying;

      if (shouldStartLocal) {
        GLOBAL.localStreamPaused = false;
        _playIntentUntil = now + 12000;
        const selectedId = pickPlayableTrackId();
        const candidateTrack = (GLOBAL.currentTrack && GLOBAL.currentTrack.id)
          ? GLOBAL.currentTrack
          : (Array.isArray(GLOBAL.queue) ? (GLOBAL.queue.find(t => t.id === selectedId) || GLOBAL.queue[0]) : null);

        if (candidateTrack && audio && typeof StreamModule !== 'undefined') {
          StreamModule.assignAudio(audio, candidateTrack, true);
        }
        if (typeof roomTrace === 'function') {
          roomTrace('player.togglePlay.local', { action: 'play-local', track_id: selectedId || null });
        }
      } else {
        GLOBAL.localStreamPaused = true;
        _playIntentUntil = 0;
        if (audio && !audio.paused) {
          audio.pause();
        }
        if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
        if (typeof roomTrace === 'function') {
          roomTrace('player.togglePlay.local', { action: 'pause-local' });
        }
      }
      return;
    }

    // If server says playing but local audio isn't playing, try to recover locally
    if (serverPlaying && !localPlaying && audio) {
      if (!GLOBAL.streamConnected && (justSentPlay || waitingForStreamStart)) {
        // Stream still connecting, try to play locally but DON'T send pause command
        audio.play().catch(() => {});
        shouldSendCommand = false; // Don't toggle to pause
      } else if (!GLOBAL.streamConnected) {
        // Stream completely down, resync with server
        const selectedId = pickPlayableTrackId();
        _playIntentUntil = now + 12000;
        _lastControlAction = 'play';
        _lastControlAt = now;
        console.log('[togglePlay] Stream down, resyncing play');
        WSModule.sendWS('playback_control', selectedId ? { action: 'play', track_id: selectedId } : { action: 'play' });
        if (typeof StreamModule !== 'undefined') {
          const candidateTrack = (GLOBAL.currentTrack && GLOBAL.currentTrack.id)
            ? GLOBAL.currentTrack
            : (Array.isArray(GLOBAL.queue) ? (GLOBAL.queue.find(t => t.id === selectedId) || GLOBAL.queue[0]) : null);
          if (candidateTrack) {
            StreamModule.assignAudio(audio, candidateTrack, true);
          }
        }
        return;
      } else {
        // Stream connected, safely play local audio
        audio.play().catch(() => {});
        shouldSendCommand = false;
      }
    }

    // Determine action based on current state
    if (shouldSendCommand) {
      if (roomMode) {
        // In room mode backend room_state is authoritative.
        if (serverPlaying) {
          if (justSentPlay || waitingForStreamStart) {
            console.log('[togglePlay] Ignoring pause during play startup window');
            return;
          }
          action = 'pause';
        } else {
          action = 'play';
        }
      } else {
      // In room mode, trust local playback readiness over stale server flag.
      // If button shows "play" and local audio is not playing, force a play command.
      if (roomMode && !localPlaying && !GLOBAL.streamConnected) {
        action = 'play';
      } else if (serverPlaying || localPlaying) {
        // Already playing, toggle to pause (unless we just sent play)
        if (justSentPlay || waitingForStreamStart) {
          // We just started play, don't immediately pause
          console.log('[togglePlay] Ignoring toggle during play startup window');
          return;
        }
        action = 'pause';
      } else {
        // Not playing, toggle to play
        action = 'play';
      }
      }
    }

    _lastControlAction = action;
    _lastControlAt = now;

    if (action === 'play') {
      _playIntentUntil = now + 12000;
      const selectedId = pickPlayableTrackId();
      console.log('[togglePlay] Sending play');
      if (typeof roomTrace === 'function') {
        roomTrace('player.togglePlay.send', { action: 'play', track_id: selectedId || null });
      }
      WSModule.sendWS('playback_control', selectedId ? { action, track_id: selectedId } : { action });

      if (audio && typeof StreamModule !== 'undefined') {
        const candidateTrack = (GLOBAL.currentTrack && GLOBAL.currentTrack.id)
          ? GLOBAL.currentTrack
          : (Array.isArray(GLOBAL.queue) ? (GLOBAL.queue.find(t => t.id === selectedId) || GLOBAL.queue[0]) : null);
        if (candidateTrack) {
          StreamModule.assignAudio(audio, candidateTrack, true);
        }
      }
    } else if (action === 'pause') {
      _playIntentUntil = 0;
      console.log('[togglePlay] Sending pause');
      if (typeof roomTrace === 'function') {
        roomTrace('player.togglePlay.send', { action: 'pause' });
      }
      WSModule.sendWS('playback_control', { action });
    }
  }

  function pickPlayableTrackId() {
    if (GLOBAL.currentTrack && GLOBAL.currentTrack.id) return GLOBAL.currentTrack.id;
    if (!Array.isArray(GLOBAL.queue) || !GLOBAL.queue.length) return null;

    const looksPlayable = (t) => {
      const sid = String(t.source_track_id || '');
      if (t.stream_url) return true;
      if (sid.startsWith('http://') || sid.startsWith('https://')) return true;
      return false;
    };

    const candidate = GLOBAL.queue.find(looksPlayable) || GLOBAL.queue[0];
    return candidate && candidate.id ? candidate.id : null;
  }

  function nextTrack() {
    if (isRoomRadioMode()) {
      showToast('В режиме радио переключение треков доступно только в live admin', 'error');
      return;
    }
    if (GLOBAL.userRole !== 'owner') return;
    const now = Date.now();
    if (now - _lastNextAt < 1800) return;
    _lastNextAt = now;
    WSModule.sendWS('playback_control', { action: 'next' });
  }

  function prevTrack() {
    if (isRoomRadioMode()) {
      showToast('В режиме радио переключение треков доступно только в live admin', 'error');
      return;
    }
    if (GLOBAL.userRole !== 'owner') return;
    // Перемотка в начало текущего трека если прошло > 3с, иначе prev
    if (audio && audio.currentTime > 3) {
      seekTo(0);
    } else {
      // Сервер не имеет prev endpoint, используем seek to 0
      WSModule.sendWS('playback_control', { action: 'seek', position: 0 });
    }
  }

  function seekTo(position) {
    if (GLOBAL.userRole !== 'owner') return;
    if (isRoomRadioMode()) {
      showToast('Перемотка недоступна в режиме комнаты', 'error');
      return;
    }
    WSModule.sendWS('playback_control', { action: 'seek', position });
  }

  function seekRelative(delta) {
    if (GLOBAL.userRole !== 'owner') return;
    const newPos = Math.max(0, (GLOBAL.currentPosition || 0) + delta);
    seekTo(newPos);
  }

  // ---- Инициализация для SSR/React-injected legacy scripts ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { applyState, togglePlay, nextTrack, prevTrack, init };

})();

window.PlayerModule = PlayerModule;
