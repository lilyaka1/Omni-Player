// room-stream.js — MVP RADIO-MODE
// Правило: if now_playing_track_id exists → audio.src = /stream/room/{id}/stream → play()
// Никаких /status polling, retry loops, stall timers, broadcast state.

// ── Состояние ─────────────────────────────────────────────────────────────────
var _currentRoomId = null;
var _streamAudio = null;
var _streamConnectInFlight = false;
var _streamConnectUrl = '';
var _streamEndAdvanceRequestedAt = 0;

// ── Audio элемент ─────────────────────────────────────────────────────────────
function _getOrCreateStreamAudio() {
  if (_streamAudio) return _streamAudio;
  _streamAudio = document.getElementById('streamAudio');
  if (_streamAudio) return _streamAudio;
  _streamAudio = new Audio();
  _streamAudio.id = 'streamAudio';
  _streamAudio.style.display = 'none';
  _streamAudio.volume = 1.0;
  document.body.appendChild(_streamAudio);
  _streamAudio.addEventListener('error', function () {
    if (!_streamAudio.src || _streamAudio.src === window.location.href) return;
    console.warn('⚠️ streamAudio error code=' + (_streamAudio.error ? _streamAudio.error.code : '?'));
  });
  _streamAudio.addEventListener('ended', function () {
    console.log('ℹ️ streamAudio ended');
    // SECURITY FIX: Client MUST NOT trigger next track via WS.
    // The server controls the queue and decides when to advance.
    // Client only reports the ended event for UI state updates.
    if (typeof WSModule !== 'undefined' && WSModule && typeof WSModule.sendWS === 'function') {
      WSModule.sendWS('playback_ended', { track_id: GLOBAL && GLOBAL.currentTrack ? GLOBAL.currentTrack.id : null });
    }
  });
  _streamAudio.addEventListener('loadedmetadata', function () {
    var pending = window._pendingRoomStreamSeek;
    if (!pending) return;
    // RELAXED track check after F5: only skip if GLOBAL has a DIFFERENT track
    if (pending.trackId && GLOBAL && GLOBAL.currentTrack && Number(GLOBAL.currentTrack.id) !== Number(pending.trackId)) return;
    try {
      var duration = Number(_streamAudio.duration);
      var target = Number(pending.position);
      if (Number.isFinite(duration) && duration > 0) {
        target = Math.max(0, Math.min(target, Math.max(0, duration - 0.25)));
      }
      if (Math.abs((Number(_streamAudio.currentTime) || 0) - target) > 0.25) {
        _streamAudio.currentTime = target;
      }
      GLOBAL.currentPosition = target;
      window._pendingRoomStreamSeek = null;
    } catch (err) {
      console.warn('⚠️ streamAudio seek failed:', err);
    }
  });

  // FIX: After F5, the stream may not fire loadedmetadata if it's a live HTTP
  // stream. Also listen for 'canplay' and 'timeupdate' as fallbacks.
  _streamAudio.addEventListener('canplay', function () {
    var pending = window._pendingRoomStreamSeek;
    if (!pending) return;
    if (pending.trackId && GLOBAL && GLOBAL.currentTrack && Number(GLOBAL.currentTrack.id) !== Number(pending.trackId)) return;
    try {
      var duration = Number(_streamAudio.duration);
      var target = Number(pending.position);
      if (Number.isFinite(duration) && duration > 0) {
        target = Math.max(0, Math.min(target, Math.max(0, duration - 0.25)));
      }
      if (Math.abs((Number(_streamAudio.currentTime) || 0) - target) > 0.25) {
        _streamAudio.currentTime = target;
      }
      GLOBAL.currentPosition = target;
      window._pendingRoomStreamSeek = null;
    } catch (err) {
      console.warn('⚠️ streamAudio canplay seek failed:', err);
    }
  });
  console.log('✅ streamAudio element created');
  
  // Initialize volume slider now that streamAudio exists
  var volumeSlider = document.getElementById('volumeSlider');
  if (volumeSlider) {
    console.log('[STREAM] Initializing volume slider with streamAudio');
    volumeSlider.value = (_streamAudio.volume ?? 0.8) * 100;
    volumeSlider.addEventListener('input', () => {
      console.log('[STREAM] volume changed via slider to', volumeSlider.value);
      _streamAudio.volume = volumeSlider.value / 100;
    });
  }
  
  return _streamAudio;
}

// ── Подключить стрим комнаты по roomId ───────────────────────────────────────
function autoConnectStream() {
  var roomId = (typeof GLOBAL !== 'undefined' && GLOBAL && GLOBAL.roomId)
    ? GLOBAL.roomId
    : (typeof window.currentRoomId !== 'undefined' ? window.currentRoomId : null);
  if (!roomId) return;
  if (!GLOBAL || !GLOBAL.currentTrack) return;

  _currentRoomId = roomId;
  var url = '/stream/room/' + roomId + '/stream';
  var audio = _getOrCreateStreamAudio();

  if (_streamConnectInFlight && _streamConnectUrl === url) {
    // Even if already connected, check if there's a pending seek to apply
    var pending = window._pendingRoomStreamSeek;
    if (pending && audio.readyState >= 1) {
      _applyPendingSeek(audio, pending);
    }
    return;
  }

  var absoluteUrl = new URL(url, window.location.href).href;
  if (audio.src === absoluteUrl && !audio.paused && audio.readyState > 0) {
    // Stream already loaded and playing - check for pending seek
    var pending = window._pendingRoomStreamSeek;
    if (pending) {
      _applyPendingSeek(audio, pending);
    }
    return;
  }

  if (audio.readyState > 0) {
    audio.pause();
    audio.src = '';
    audio.load();
  }

  _streamConnectInFlight = true;
  _streamConnectUrl = url;
  audio.src = url;
  audio.load();

  // FIX: After F5, there may be a pending seek from room_state.position.
  // Apply it once the stream is loaded.
  var pending = window._pendingRoomStreamSeek;
  if (pending) {
    var pendingTrackId = pending.trackId;
    if (!pendingTrackId || !GLOBAL.currentTrack || Number(GLOBAL.currentTrack.id) === Number(pendingTrackId)) {
      var applySeekWhenReady = function () {
        _applyPendingSeek(audio, window._pendingRoomStreamSeek);
      };
      if (audio.readyState >= 2) {
        applySeekWhenReady();
      } else {
        audio.addEventListener('loadedmetadata', applySeekWhenReady, { once: true });
        audio.addEventListener('canplay', applySeekWhenReady, { once: true });
      }
    }
  }

  audio.play().catch(function (err) {
    if (err.name === 'NotAllowedError') {
      window._pendingStreamUrl = url;
      if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
      return;
    }
    if (err.name === 'AbortError') return;
    console.error('❌ playStream error:', err);
  }).finally(function () {
    _streamConnectInFlight = false;
  });
}

// Helper to apply pending seek to stream audio
function _applyPendingSeek(audio, pending) {
  if (!pending || !audio) return;
  try {
    var duration = Number(audio.duration);
    var target = Number(pending.position);
    if (Number.isFinite(duration) && duration > 0) {
      target = Math.max(0, Math.min(target, Math.max(0, duration - 0.25)));
    }
    if (Math.abs((Number(audio.currentTime) || 0) - target) > 0.25) {
      audio.currentTime = target;
    }
    GLOBAL.currentPosition = target;
    window._pendingRoomStreamSeek = null;
  } catch (err) {
    console.warn('⚠️ autoConnectStream seek failed:', err);
  }
}

// ── Остановить стрим ──────────────────────────────────────────────────────────
function doStop() {
  _currentRoomId = null;
  _streamConnectInFlight = false;
  _streamConnectUrl = '';
  if (_streamAudio) {
    _streamAudio.pause();
    _streamAudio.src = '';
    _streamAudio.load();
  }
}

function pauseStream() {
  doStop();
}

// ── Play prompt (автоблокировка) ─────────────────────────────────────────────
function showPlayPrompt() {
  var p = document.getElementById('playPrompt');
  if (p) p.style.display = 'block';
}

function onPlayPromptClick() {
  var p = document.getElementById('playPrompt');
  if (p) p.style.display = 'none';
  if (_streamAudio && _streamAudio.src && _streamAudio.paused) {
    _streamAudio.play().catch(function () {});
  } else {
    autoConnectStream();
  }
  window._pendingStreamUrl = null;
}

// ── Safari/iOS AudioContext unlock ───────────────────────────────────────────
(function bindOneTapAudioUnlock() {
  function unlock() {
    var a = document.getElementById('audioPlayer') || _streamAudio;
    if (a) {
      var prev = a.muted;
      a.muted = true;
      a.play().then(function () { a.pause(); a.currentTime = 0; a.muted = prev; }).catch(function () { a.muted = prev; });
    }
    if (typeof equalizer !== 'undefined' && equalizer && equalizer.audioContext && equalizer.audioContext.state === 'suspended') {
      equalizer.audioContext.resume().catch(function () {});
    }
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('touchstart', unlock, true);
    document.removeEventListener('click', unlock, true);
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('touchstart', unlock, true);
  document.addEventListener('click', unlock, true);
})();

// ── Legacy StreamModule API ───────────────────────────────────────────────────
if (typeof window.StreamModule === 'undefined') {
  window.StreamModule = (function () {
    function resolveStreamUrl(track) {
      if (!track) return '';
      if (GLOBAL && GLOBAL.roomId) {
        return '/stream/room/' + GLOBAL.roomId + '/stream';
      }
      return '';
    }

    function assignAudio(audioEl, track, autoPlay) {
      if (!audioEl || !track) return;
      var url = resolveStreamUrl(track);
      if (!url) return;
      if (audioEl.src !== url) {
        audioEl.src = url;
        audioEl.load();
      }
      if (autoPlay) {
        audioEl.play().catch(function (err) {
          if (err && err.name === 'NotAllowedError') {
            window._pendingStreamUrl = url;
            if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
          }
        });
      }
    }

    function stopLegacyStreamAudio() { /* noop — один audio элемент */ }

    return { resolveStreamUrl, assignAudio, stopLegacyStreamAudio };
  })();
}
