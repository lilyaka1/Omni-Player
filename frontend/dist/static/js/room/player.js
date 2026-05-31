/**
<<<<<<< HEAD
 * player.js — MVP RADIO-MODE для комнаты.
 *
 * Единственное правило:
 *   WS message: room_state / track_change / track_changed
 *   → если current_track есть → audio.src = /stream/room/{id}/stream → play()
 *   → если current_track нет → audio.src = '' → stop()
 *
 * УБРАНО: playback_control WS-команды, shouldAutoPlay, serverSaysPlaying,
 *         grace window, serverSaysPlaying override, state machine.
 *
 * Зависимости: globals.js, websocket.js (WSModule.sendWS), stream.js (StreamModule)
=======
 * player.js — Управление воспроизведением.
 *
 * Зависимости: globals.js, websocket.js (WSModule.sendWS)
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
 */

const PlayerModule = (function () {

<<<<<<< HEAD
  // ── DOM ───────────────────────────────────────────────────────────────────────
=======
  // DOM-узлы
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
  let audio, btnPlay, playIcon, btnPrev, btnNext,
      btnSeekBack, btnSeekFwd,
      progressWrap, progressFill,
      timeCurrent, timeDuration,
      trackTitle, trackArtist,
      artworkBox, artworkContainer,
      volumeSlider;

  let _seekDragging = false;
<<<<<<< HEAD
  let _progressTimer = null;

  // ── Утилиты ───────────────────────────────────────────────────────────────
  function isRoomMode() {
    return Boolean(GLOBAL && GLOBAL.roomId);
  }

  function getRoomStreamUrl() {
    if (GLOBAL && GLOBAL.roomId) {
      return '/stream/room/' + GLOBAL.roomId + '/stream';
    }
    return '';
  }

  function syncRoomStreamPosition(streamAudio, position, trackId) {
    if (!streamAudio) return;

    var numericPosition = Number(position);
    if (!Number.isFinite(numericPosition) || numericPosition < 0) return;

    var applySeek = function () {
      try {
        var duration = Number(streamAudio.duration);
        var target = numericPosition;
        if (Number.isFinite(duration) && duration > 0) {
          target = Math.max(0, Math.min(numericPosition, Math.max(0, duration - 0.25)));
        }
        if (Math.abs((Number(streamAudio.currentTime) || 0) - target) > 0.25) {
          streamAudio.currentTime = target;
        }
        GLOBAL.currentPosition = target;
        window._pendingRoomStreamSeek = null;
      } catch (err) {
        window._pendingRoomStreamSeek = { trackId: trackId, position: numericPosition };
      }
    };

    if (streamAudio.readyState >= 1) {
      applySeek();
      return;
    }

    window._pendingRoomStreamSeek = { trackId: trackId, position: numericPosition };
    if (streamAudio.__roomSeekListenerBound) return;

    var flushPendingSeek = function () {
      var pending = window._pendingRoomStreamSeek;
      if (!pending) return;
      if (pending.trackId && GLOBAL.currentTrack && Number(GLOBAL.currentTrack.id) !== Number(pending.trackId)) return;
      applySeek();
    };

    streamAudio.addEventListener('loadedmetadata', flushPendingSeek);
    streamAudio.addEventListener('canplay', flushPendingSeek);
    streamAudio.__roomSeekListenerBound = true;
=======
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

  function canControlRoomPlayback() {
    return GLOBAL.userRole === 'owner'
      || GLOBAL.userRole === 'admin'
      || GLOBAL.userRole === 'dj';
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
  }

  function ensureProgressTicker() {
    if (_progressTimer) return;
    _progressTimer = setInterval(() => {
      if (_seekDragging) return;
<<<<<<< HEAD
      if (isRoomMode()) {
        var streamAudio = document.getElementById('streamAudio');
        if (streamAudio && !streamAudio.paused && streamAudio.currentTime > 0) {
          var _p = Number(streamAudio.currentTime) || 0;
          var _d = Number(GLOBAL.currentDuration) || 0;
          GLOBAL.currentPosition = _p;
          updateProgress(_p, _d);
          return;
        }
      }
      const _dur = Number(GLOBAL.currentDuration || 0);
      const _p2 = Number(GLOBAL.currentPosition || 0);
      updateProgress(_p2, _dur);
    }, 250);
  }

  function syncControlsByRole() {
    const canControl = isRoomMode() ? (GLOBAL.userRole === 'owner' || GLOBAL.userRole === 'admin') : (GLOBAL.userRole === 'owner');
    [btnPlay, btnPrev, btnNext].forEach(btn => { if (btn) { btn.disabled = !canControl; btn.classList.toggle('ctrl-btn-disabled', !canControl); } });
    [btnSeekBack, btnSeekFwd].forEach(btn => { if (btn) { btn.disabled = !canControl; btn.classList.toggle('ctrl-btn-disabled', !canControl); } });
    if (progressWrap) progressWrap.classList.toggle('progress-disabled', !canControl);
  }

  // ── init ──────────────────────────────────────────────────────────────────
  function init() {
    audio            = document.getElementById('audioPlayer');
    btnPlay          = document.getElementById('btnPlayPause');
    playIcon         = document.getElementById('playIcon');
    btnPrev          = document.getElementById('btnPrev');
    btnNext          = document.getElementById('btnNext');
    btnSeekBack      = document.getElementById('btnSeekBack');
    btnSeekFwd       = document.getElementById('btnSeekFwd');
    progressWrap     = document.getElementById('progressWrap');
    progressFill     = document.getElementById('progressFill');
    timeCurrent      = document.getElementById('timeCurrent');
    timeDuration     = document.getElementById('timeDuration');
    trackTitle       = document.getElementById('trackTitle');
    trackArtist      = document.getElementById('trackArtist');
    artworkBox       = document.getElementById('artworkBox');
    artworkContainer = document.getElementById('artworkContainer');
    volumeSlider     = document.getElementById('volumeSlider');

=======

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
    if (_autoNextTimer) return;
    _autoNextTimer = setInterval(() => {
      if (isRoomRadioMode()) return;
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
    const canControlRoom = canControlRoomPlayback();
    const roomMode = isRoomRadioMode();
    const canSeek = isOwner && !roomMode;
    const canToggleListen = roomMode || isOwner;

    [btnPlay, btnPrev, btnNext].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !roomMode && !isOwner;
      btn.classList.toggle('ctrl-btn-disabled', !roomMode && !isOwner);
    });
    if (btnPlay) {
      btnPlay.disabled = !canToggleListen;
      btnPlay.classList.toggle('ctrl-btn-disabled', !canToggleListen);
    }

    [btnPrev, btnNext].forEach((btn) => {
      if (!btn) return;
      const canTransport = roomMode ? canControlRoom : isOwner;
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
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    btnPlay?.addEventListener('click', togglePlay);
    btnNext?.addEventListener('click', nextTrack);
    btnPrev?.addEventListener('click', prevTrack);
    btnSeekBack?.addEventListener('click', () => seekRelative(-10));
    btnSeekFwd?.addEventListener('click',  () => seekRelative(+10));

<<<<<<< HEAD
=======
    // ---- Прогресс-бар: клик для перемотки ----
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    progressWrap?.addEventListener('click', (e) => {
      if (!GLOBAL.currentDuration) return;
      const rect = progressWrap.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
<<<<<<< HEAD
      seekTo(ratio * GLOBAL.currentDuration);
    });

=======
      const pos = ratio * GLOBAL.currentDuration;
      seekTo(pos);
    });

    // ---- Громкость ----
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    if (volumeSlider) {
      volumeSlider.value = (audio?.volume ?? 0.8) * 100;
      volumeSlider.addEventListener('input', () => {
        if (audio) audio.volume = volumeSlider.value / 100;
      });
    }

<<<<<<< HEAD
    // Progress update для non-room mode
    audio?.addEventListener('timeupdate', () => {
      if (_seekDragging) return;
      if (isRoomMode()) return;
=======
    // ---- Обновление прогресса из audio.timeupdate ----
    audio?.addEventListener('timeupdate', () => {
      if (_seekDragging) return;
      // Для room broadcast не используем local audio.currentTime как источник истины:
      // синхронизация позиции идёт от серверного state + локального тикера.
      if (isRoomRadioMode()) return;

>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      const pos = Number(audio.currentTime || 0);
      GLOBAL.currentPosition = pos;
      if (!isNaN(audio.duration)) GLOBAL.currentDuration = audio.duration;
      updateProgress(pos, GLOBAL.currentDuration);
    });

    audio?.addEventListener('ended', () => {
<<<<<<< HEAD
      if (isRoomMode()) return;
      nextTrack();
    });

    // Room mode: показывать состояние playing с streamAudio
    if (isRoomMode()) {
      attachStreamAudioListeners();
    }

=======
      if (isRoomRadioMode()) {
        return;
      }
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
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    ensureProgressTicker();
    syncControlsByRole();
  }

<<<<<<< HEAD
  // ── Подключение streamAudio ─────────────────────────────────────────────
  function attachStreamAudioListeners() {
    var streamAudio = document.getElementById('streamAudio');
    if (!streamAudio) return;
    streamAudio.addEventListener('playing', () => {
      GLOBAL.isPlaying = true;
      setPlayIcon(true);
      artworkContainer?.classList.add('spinning');
    });
    streamAudio.addEventListener('pause', () => {
      GLOBAL.isPlaying = false;
      setPlayIcon(false);
      artworkContainer?.classList.remove('spinning');
    });
  }

  // ── applyState: единственный источник истины — current_track ──────────────
  function applyState(data) {
    if (!data) return;

    const track = data.current_track || data.track || null;
    syncControlsByRole();

    if (track) {
      applyTrack(track, data);
    } else {
      applyNoTrack();
    }
  }

  function applyTrack(track, data) {
    const prevId = GLOBAL.currentTrack && GLOBAL.currentTrack.id;
    const incomingId = track.id;
    const trackChanged = !prevId || prevId !== incomingId;
    const shouldPlay = data?.is_playing !== false;

    GLOBAL.currentTrack = track;
    GLOBAL.currentDuration = Number(track.duration || 0) || 0;

    // UI: title, artist, artwork
    if (trackTitle) trackTitle.textContent = track.title || 'Без названия';
    if (trackArtist) trackArtist.textContent = track.artist || track.uploader || '—';
    renderArtwork(track.thumbnail || null);
    document.title = `${track.title || '…'} — Omni Player`;

    document.dispatchEvent(new CustomEvent('trackchange'));

    // Room mode: играем единый room stream
    if (isRoomMode()) {
      var streamAudio = document.getElementById('streamAudio');
      var url = getRoomStreamUrl();
        var absUrl = new URL(url, window.location.href).href;
      var serverPosition = Number(data?.position);
      if (streamAudio) {
          if (streamAudio.src !== absUrl || trackChanged) {
          streamAudio.pause();
            streamAudio.src = absUrl;
          streamAudio.load();
        }
        if (Number.isFinite(serverPosition) && serverPosition >= 0) {
          syncRoomStreamPosition(streamAudio, serverPosition, incomingId);
        }
        if (shouldPlay) {
          streamAudio.play().catch(function (err) {
            if (err && err.name === 'NotAllowedError') {
              window._pendingStreamUrl = url;
              if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
            }
          });
        } else {
          streamAudio.pause();
        }
      } else {
        // stream.js ещё не создал элемент — попросим только если надо играть.
        if (Number.isFinite(serverPosition) && serverPosition >= 0) {
          window._pendingRoomStreamSeek = { trackId: incomingId, position: serverPosition };
        }
        if (shouldPlay) {
          autoConnectStream();
        }
      }
      GLOBAL.isPlaying = shouldPlay;
      setPlayIcon(shouldPlay);
      artworkContainer?.classList.toggle('spinning', shouldPlay);
      return;
    }

    // Non-room mode: per-track playback
    if (audio) {
      if (typeof StreamModule !== 'undefined') {
        if (trackChanged) {
          StreamModule.assignAudio(audio, track, true);
        }
      } else {
        var src = track.stream_url || track.url || '';
        if (!src) { showToast('У трека нет stream URL', 'error'); return; }
        var abs = new URL(src, window.location.href).href;
        if (audio.src !== abs || trackChanged) {
            audio.src = abs;
          audio.load();
        }
        audio.play().catch(() => {});
      }
      GLOBAL.isPlaying = true;
      setPlayIcon(true);
      artworkContainer?.classList.add('spinning');
    }

    updateProgress(GLOBAL.currentPosition || 0, GLOBAL.currentDuration);
  }

  function applyNoTrack() {
    GLOBAL.currentTrack = null;
    GLOBAL.currentDuration = 0;
    GLOBAL.isPlaying = false;
=======
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

    if (isRoomRadioMode() && GLOBAL.userRole === 'listener' && GLOBAL.listenerAttached === false) {
      shouldAutoPlay = false;
    }

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

    const shouldStartAudio = shouldAutoPlay && (trackChanged || !wasPlayingBefore);
    const preserveSamePlayingAudio = shouldAutoPlay && wasPlayingBefore && !trackChanged;

    // Обновить трек
    if (currentTrack) {
      setTrack(currentTrack, position, shouldStartAudio, !preserveSamePlayingAudio);
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

  function setTrack(track, position, autoPlay, allowPause = true) {
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
          else if (allowPause) audio.pause();
        }
      } else {
        // Не перезагружаем одинаковый трек, только синхронизируем play/pause.
        if (autoPlay && audio.paused) {
          if (typeof StreamModule !== 'undefined' && !isRoomRadioMode()) {
            StreamModule.assignAudio(audio, track, true);
          } else {
            audio.play().catch(() => {});
          }
        }
        if (!autoPlay && allowPause && !audio.paused) audio.pause();
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
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    document.dispatchEvent(new CustomEvent('trackchange'));
    if (trackTitle)  trackTitle.textContent  = 'Нет треков в очереди';
    if (trackArtist) trackArtist.textContent = '—';
    renderArtwork(null);
<<<<<<< HEAD
    if (isRoomMode()) {
      var streamAudio = document.getElementById('streamAudio');
      if (streamAudio) { streamAudio.pause(); streamAudio.src = ''; streamAudio.load(); }
    } else {
      if (audio) { audio.pause(); audio.src = ''; }
    }
    updateProgress(0, 0);
    setPlayIcon(false);
    artworkContainer?.classList.remove('spinning');
  }

  // ── UI helpers ───────────────────────────────────────────────────────────
  function updateProgress(pos, dur) {
    if (timeCurrent)  timeCurrent.textContent  = formatTime(pos);
    if (timeDuration) timeDuration.textContent = formatTime(dur);
    if (progressFill) {
      progressFill.style.width = (dur > 0 ? Math.min(100, (pos / dur) * 100) : 0) + '%';
    }
  }

  function setPlayIcon(playing) {
    if (playIcon) playIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
=======
    if (audio) { audio.pause(); audio.src = ''; }
    updateProgress(0, 0);
    setPlayIcon(false);
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
  }

  function renderArtwork(url) {
    if (!artworkBox) return;
    if (url) {
      artworkBox.innerHTML = `<img src="${escHtml(url)}" alt="Обложка" loading="lazy"
<<<<<<< HEAD
        onerror="this.parentElement.innerHTML='<div class=\\'artwork-placeholder-icon\'><i class=\'fa-solid fa-music\'></i></div>'" />`;
=======
        onerror="this.parentElement.innerHTML='<div class=\\'artwork-placeholder-icon\\'><i class=\\'fa-solid fa-music\\'></i></div>'" />`;
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      artworkBox.classList.add('playing');
    } else {
      artworkBox.innerHTML = '<div class="artwork-placeholder-icon"><i class="fa-solid fa-music"></i></div>';
      artworkBox.classList.remove('playing');
    }
  }

<<<<<<< HEAD
  // ── Команды (отправляем через WebSocket) ────────────────────────────────
  function togglePlay() {
    if (isRoomMode()) {
      if (GLOBAL.userRole !== 'owner' && GLOBAL.userRole !== 'admin') {
        showToast('Управление доступно только для админа', 'error');
        return;
      }
      var streamAudio = document.getElementById('streamAudio');
      if (streamAudio && !streamAudio.paused && streamAudio.src) {
        streamAudio.pause();
        GLOBAL.isPlaying = false;
        setPlayIcon(false);
        artworkContainer?.classList.remove('spinning');
        WSModule.sendWS('playback_control', { action: 'pause' });
      } else {
        WSModule.sendWS('playback_control', { action: 'play' });
        if (streamAudio && streamAudio.src) {
          streamAudio.play().catch(function (err) {
            if (err && err.name === 'NotAllowedError') {
              window._pendingStreamUrl = streamAudio.src;
              if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
            }
          });
        } else {
          autoConnectStream();
=======
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

    if (roomMode && !canControlRoomPlayback()) {
      const shouldAttach = GLOBAL.localStreamPaused || !localPlaying;

      if (shouldAttach) {
        GLOBAL.localStreamPaused = false;
        GLOBAL.listenerAttached = true;
        _playIntentUntil = now + 12000;

        const selectedId = pickPlayableTrackId();
        const candidateTrack = (GLOBAL.currentTrack && GLOBAL.currentTrack.id)
          ? GLOBAL.currentTrack
          : (Array.isArray(GLOBAL.queue) ? (GLOBAL.queue.find(t => t.id === selectedId) || GLOBAL.queue[0]) : null);

        if (!candidateTrack || !audio) {
          showToast('Не удалось подключиться к стриму', 'error');
          return;
        }

        if (typeof StreamModule !== 'undefined') {
          StreamModule.assignAudio(audio, candidateTrack, true);
        } else {
          const resolvedSrc = candidateTrack.stream_url || candidateTrack.url || '';
          if (!resolvedSrc) {
            showToast('У трека пока нет stream URL, попробуйте следующий', 'error');
            return;
          }
          audio.src = resolvedSrc;
          audio.load();
          audio.play().catch(() => {});
        }

        if (typeof roomTrace === 'function') {
          roomTrace('player.togglePlay.listener', { action: 'attach', track_id: selectedId || null });
        }
      } else {
        GLOBAL.localStreamPaused = true;
        GLOBAL.listenerAttached = false;
        _playIntentUntil = 0;
        if (audio) {
          audio.pause();
          audio.src = '';
          audio.load();
        }
        if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
        if (typeof roomTrace === 'function') {
          roomTrace('player.togglePlay.listener', { action: 'detach' });
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
        }
      }
      return;
    }

<<<<<<< HEAD
    if (GLOBAL.userRole !== 'owner') {
      showToast('Только владелец может управлять', 'error');
      return;
    }
    WSModule.sendWS('playback_control', { action: GLOBAL.isPlaying ? 'pause' : 'play' });
  }

  function nextTrack() {
    if (isRoomMode()) {
      if (GLOBAL.userRole !== 'owner' && GLOBAL.userRole !== 'admin') {
        showToast('Переключение доступно только для админа', 'error');
        return;
      }
    } else {
      if (GLOBAL.userRole !== 'owner') return;
    }
=======
    let action = 'play';
    let shouldSendCommand = true;

    // Non-room mode: If server says playing but local audio isn't playing, try to recover locally
    if (serverPlaying && !localPlaying && audio) {
      if (!GLOBAL.streamConnected && (justSentPlay || waitingForStreamStart)) {
        audio.play().catch(() => {});
        shouldSendCommand = false;
      } else if (!GLOBAL.streamConnected) {
        const selectedId = pickPlayableTrackId();
        _playIntentUntil = now + 12000;
        _lastControlAction = 'play';
        _lastControlAt = now;
        console.log('[togglePlay] Stream down, resyncing play');
        if (typeof roomTrace === 'function') {
          roomTrace('player.togglePlay.resync', { action: 'play', track_id: selectedId || null });
        }
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
        audio.play().catch(() => {});
        shouldSendCommand = false;
      }
    }

    // Determine action based on current state (non-room mode)
    if (shouldSendCommand) {
      if (serverPlaying || localPlaying) {
        if (justSentPlay || waitingForStreamStart) {
          console.log('[togglePlay] Ignoring toggle during play startup window');
          if (typeof roomTrace === 'function') {
            roomTrace('player.togglePlay.ignore', { reason: 'startup-window' });
          }
          return;
        }
        action = 'pause';
      } else {
        action = 'play';
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
      if (!canControlRoomPlayback()) {
        showToast('В режиме радио переключение треков доступно только для control-ролей', 'error');
        return;
      }
    }
    if (!isRoomRadioMode() && GLOBAL.userRole !== 'owner') {
      return;
    }
    const now = Date.now();
    if (now - _lastNextAt < 1800) return;
    _lastNextAt = now;
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    WSModule.sendWS('playback_control', { action: 'next' });
  }

  function prevTrack() {
<<<<<<< HEAD
    if (isRoomMode()) return; // нет смысла в radio mode
    if (GLOBAL.userRole !== 'owner') return;
    if (audio && audio.currentTime > 3) {
      seekTo(0);
    } else {
=======
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
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      WSModule.sendWS('playback_control', { action: 'seek', position: 0 });
    }
  }

  function seekTo(position) {
    if (GLOBAL.userRole !== 'owner') return;
<<<<<<< HEAD
    if (isRoomMode()) { showToast('Перемотка недоступна в режиме радио', 'error'); return; }
=======
    if (isRoomRadioMode()) {
      showToast('Перемотка недоступна в режиме комнаты', 'error');
      return;
    }
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    WSModule.sendWS('playback_control', { action: 'seek', position });
  }

  function seekRelative(delta) {
<<<<<<< HEAD
    seekTo(Math.max(0, (GLOBAL.currentPosition || 0) + delta));
  }

  // ── Инициализация ──────────────────────────────────────────────────────────
=======
    if (GLOBAL.userRole !== 'owner') return;
    const newPos = Math.max(0, (GLOBAL.currentPosition || 0) + delta);
    seekTo(newPos);
  }

  // ---- Инициализация для SSR/React-injected legacy scripts ----
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { applyState, togglePlay, nextTrack, prevTrack, init };

})();

window.PlayerModule = PlayerModule;
