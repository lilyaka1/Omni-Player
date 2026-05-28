/**
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
 */

const PlayerModule = (function () {

  // ── DOM ───────────────────────────────────────────────────────────────────────
  let audio, btnPlay, playIcon, btnPrev, btnNext,
      btnSeekBack, btnSeekFwd,
      progressWrap, progressFill,
      timeCurrent, timeDuration,
      trackTitle, trackArtist,
      artworkBox, artworkContainer,
      volumeSlider;

  let _seekDragging = false;
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

  function ensureProgressTicker() {
    if (_progressTimer) return;
    _progressTimer = setInterval(() => {
      if (_seekDragging) return;
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

    btnPlay?.addEventListener('click', togglePlay);
    btnNext?.addEventListener('click', nextTrack);
    btnPrev?.addEventListener('click', prevTrack);
    btnSeekBack?.addEventListener('click', () => seekRelative(-10));
    btnSeekFwd?.addEventListener('click',  () => seekRelative(+10));

    progressWrap?.addEventListener('click', (e) => {
      if (!GLOBAL.currentDuration) return;
      const rect = progressWrap.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekTo(ratio * GLOBAL.currentDuration);
    });

    if (volumeSlider) {
      volumeSlider.value = (audio?.volume ?? 0.8) * 100;
      volumeSlider.addEventListener('input', () => {
        if (audio) audio.volume = volumeSlider.value / 100;
      });
    }

    // Progress update для non-room mode
    audio?.addEventListener('timeupdate', () => {
      if (_seekDragging) return;
      if (isRoomMode()) return;
      const pos = Number(audio.currentTime || 0);
      GLOBAL.currentPosition = pos;
      if (!isNaN(audio.duration)) GLOBAL.currentDuration = audio.duration;
      updateProgress(pos, GLOBAL.currentDuration);
    });

    audio?.addEventListener('ended', () => {
      if (isRoomMode()) return;
      nextTrack();
    });

    // Room mode: показывать состояние playing с streamAudio
    if (isRoomMode()) {
      attachStreamAudioListeners();
    }

    ensureProgressTicker();
    syncControlsByRole();
  }

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
      if (streamAudio) {
        if (streamAudio.src !== url || trackChanged) {
          streamAudio.pause();
          streamAudio.src = url;
          streamAudio.load();
          streamAudio.play().catch(function (err) {
            if (err && err.name === 'NotAllowedError') {
              window._pendingStreamUrl = url;
              if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
            }
          });
        }
      } else {
        // stream.js ещё не создал элемент — попросим
        autoConnectStream();
      }
      GLOBAL.isPlaying = true;
      setPlayIcon(true);
      artworkContainer?.classList.add('spinning');
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
          audio.src = src;
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
    document.dispatchEvent(new CustomEvent('trackchange'));
    if (trackTitle)  trackTitle.textContent  = 'Нет треков в очереди';
    if (trackArtist) trackArtist.textContent = '—';
    renderArtwork(null);
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
  }

  function renderArtwork(url) {
    if (!artworkBox) return;
    if (url) {
      artworkBox.innerHTML = `<img src="${escHtml(url)}" alt="Обложка" loading="lazy"
        onerror="this.parentElement.innerHTML='<div class=\\'artwork-placeholder-icon\'><i class=\'fa-solid fa-music\'></i></div>'" />`;
      artworkBox.classList.add('playing');
    } else {
      artworkBox.innerHTML = '<div class="artwork-placeholder-icon"><i class="fa-solid fa-music"></i></div>';
      artworkBox.classList.remove('playing');
    }
  }

  // ── Команды (отправляем через WebSocket) ────────────────────────────────
  function togglePlay() {
    if (isRoomMode()) {
      if (GLOBAL.userRole !== 'owner' && GLOBAL.userRole !== 'admin') {
        showToast('Управление доступно только для админа', 'error');
        return;
      }
      // В radio mode нет local play/pause — всё решает now_playing_track_id на бэкенде.
      // Просто переключаем стрим (connect/disconnect).
      var streamAudio = document.getElementById('streamAudio');
      if (streamAudio && !streamAudio.paused && streamAudio.src) {
        streamAudio.pause();
        GLOBAL.isPlaying = false;
        setPlayIcon(false);
      } else {
        autoConnectStream();
      }
      return;
    }

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
    WSModule.sendWS('playback_control', { action: 'next' });
  }

  function prevTrack() {
    if (isRoomMode()) return; // нет смысла в radio mode
    if (GLOBAL.userRole !== 'owner') return;
    if (audio && audio.currentTime > 3) {
      seekTo(0);
    } else {
      WSModule.sendWS('playback_control', { action: 'seek', position: 0 });
    }
  }

  function seekTo(position) {
    if (GLOBAL.userRole !== 'owner') return;
    if (isRoomMode()) { showToast('Перемотка недоступна в режиме радио', 'error'); return; }
    WSModule.sendWS('playback_control', { action: 'seek', position });
  }

  function seekRelative(delta) {
    seekTo(Math.max(0, (GLOBAL.currentPosition || 0) + delta));
  }

  // ── Инициализация ──────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { applyState, togglePlay, nextTrack, prevTrack, init };

})();

window.PlayerModule = PlayerModule;
