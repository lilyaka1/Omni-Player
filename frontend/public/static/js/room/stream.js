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
  // Убран ended→next: сервер сам переключает через loop. Клиент только переподключается.
  _streamAudio.addEventListener('ended', function () {
    console.log('ℹ️ streamAudio ended → re-connecting');
    // Перезагружаем тот же URL — сервер уже переключил на новый трек
    if (_streamAudio) {
      _streamAudio.load();
      _streamAudio.play().catch(function(){});
    }
  });
  _streamAudio.addEventListener('loadedmetadata', function () {
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
      console.warn('⚠️ streamAudio seek failed:', err);
    }
  });
  console.log('✅ streamAudio element created');
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

  if (_streamConnectInFlight && _streamConnectUrl === url) return;

  var absoluteUrl = new URL(url, window.location.href).href;
  if (audio.src === absoluteUrl && !audio.paused && audio.readyState > 0) return;

  if (audio.readyState > 0) {
    audio.pause();
    audio.src = '';
    audio.load();
  }

  _streamConnectInFlight = true;
  _streamConnectUrl = url;
  audio.src = url;
  audio.load();
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
