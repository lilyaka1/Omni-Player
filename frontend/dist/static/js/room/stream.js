// room-stream.js — подключение к радио-стриму и управление воспроизведением

// ── Состояние стрима (module-level) ──────────────────────────────────────────
var _streamLoadingUrl = null;
var _streamCallController = null;
var _stallTimer = null;
var _suppressNextError = false;
var _lastRetryAt = 0;

function resolveApiBase() {
  var proto = window.location.protocol;
  var host = window.location.hostname;
  var port = String(window.location.port || '');
  var isLocalHost = host === '127.0.0.1' || host === 'localhost';
  var isViteDevPort = port === '5173' || port === '5174' || port === '5175';
  var forceDirect = false;

  try {
    forceDirect = localStorage.getItem('omni_stream_direct_backend') === '1';
  } catch {
    forceDirect = false;
  }

  // Always use relative paths - proxy handles the rest
  return '';
}

// ── Главный метод: подключиться к живому стриму ───────────────────────────────
function playStream(streamUrl) {
  var t0 = performance.now();
  console.log('📻 [0ms] playStream: ' + streamUrl);

  if (_streamLoadingUrl === streamUrl) {
    console.log('⏩ Already loading/playing this stream, skipping');
    return;
  }
  _streamLoadingUrl = streamUrl;

  if (_streamCallController) { _streamCallController.abort(); }
  _streamCallController = new AbortController();
  var signal = _streamCallController.signal;

  if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; }

  // Создаём или берём существующий audio элемент
  var streamAudio = document.getElementById('streamAudio');
  if (!streamAudio) {
    streamAudio = new Audio();
    streamAudio.id = 'streamAudio';
    streamAudio.style.display = 'none';
    streamAudio.volume = 1.0;
    document.body.appendChild(streamAudio);
    console.log('✅ Created hidden streamAudio element');

    streamAudio.addEventListener('error', function () {
      var err = streamAudio.error;
      if (!streamAudio.src || streamAudio.src === window.location.href) {
        console.log('🔇 streamAudio error ignored (src cleared)');
        return;
      }
      if (_suppressNextError) {
        _suppressNextError = false;
        console.log('🔇 streamAudio error suppressed (expected abort on src set)');
        return;
      }
      var now = Date.now();
      if (_lastRetryAt && now - _lastRetryAt < 10000) {
        console.warn('⚠️ streamAudio error code=' + (err ? err.code : '?') + ' — throttled, ignoring');
        return;
      }
      console.warn('⚠️ streamAudio error code=' + (err ? err.code : '?') + ' — retrying in 3s...');
      if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; }
      if (_streamLoadingUrl) {
        var retryUrl = _streamLoadingUrl;
        _streamLoadingUrl = null;
        _lastRetryAt = now;
        if (typeof window.onStreamDropped === 'function') window.onStreamDropped();
        // onStreamDropped уже выставил radioConnected=false — не трогаем повторно,
        // иначе 3с-таймер сбивает autoConnectStream, вызванный WS room_state
        setTimeout(function () { playStream(retryUrl); }, 3000);
      }
    });

    streamAudio.addEventListener('ended', function () {
      console.warn('ℹ️ streamAudio ended — signalling drop');
      _streamLoadingUrl = null;
      if (typeof window.onStreamDropped === 'function') window.onStreamDropped();
    });
  }

  // ── Polling статуса ──────────────────────────────────────────────────────
  var statusUrl = streamUrl.replace(/\/stream$/, '/status');

  function _tryConnect() {
    if (signal.aborted) return;
    fetch(statusUrl, { signal: signal })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (signal.aborted) return;
        if (!json || !json.live) {
          console.log('⏳ Stream not live, retry in 1.2s... (status:', json, ')');
          if (typeof window.setLiveStatus === 'function') window.setLiveStatus(false);
          setTimeout(_tryConnect, 1200);
          return;
        }
        console.log('✅ Stream is live, connecting audio...');
        _doConnectAudio();
      })
      .catch(function (err) {
        if (signal.aborted) return;
        console.log('⚠️ Status check failed:', err.message, '— retrying in 1.5s');
        setTimeout(_tryConnect, 1500);
      });
  }

  function _startStallTimer(ms) {
    if (_stallTimer) clearTimeout(_stallTimer);
    _stallTimer = setTimeout(function () {
      console.warn('⏱ STALL: no data for ' + (ms / 1000) + 's, reconnecting...');
      if (_streamLoadingUrl === streamUrl) {
        _streamLoadingUrl = null;
        streamAudio.pause();
        streamAudio.src = '';
        if (typeof window.radioConnected !== 'undefined') window.radioConnected = false;
        setTimeout(function () { playStream(streamUrl); }, 500);
      }
    }, ms);
  }

  function _doConnectAudio() {
    if (signal.aborted) return;

    var ctx = (typeof equalizer !== 'undefined' && equalizer) ? equalizer.audioContext : null;

    // play() с retry на AbortError (браузер отменяет если src ещё загружается)
    function doPlay() {
      if (signal.aborted) return;
      console.log('[' + (performance.now() - t0).toFixed(0) + 'ms] calling play()...');
      streamAudio.play().then(function () {
        console.log('✅ [' + (performance.now() - t0).toFixed(0) + 'ms] play() resolved');
      }).catch(function (err) {
        if (signal.aborted) return;
        if (err.name === 'AbortError') {
          // Браузер сам прервал (src ещё загружается) — ждём canplay/progress и повторим
          console.warn('⚠️ [' + (performance.now() - t0).toFixed(0) + 'ms] play() AbortError — retry on canplaythrough/progress');
          var retryOnData = function () {
            if (signal.aborted || !streamAudio.paused) return;
            doPlay();
          };
          streamAudio.addEventListener('canplaythrough', retryOnData, { once: true, signal: signal });
          streamAudio.addEventListener('canplay', retryOnData, { once: true, signal: signal });
          // Для live-стримов у которых canplay не стреляет — retry по таймеру
          setTimeout(function () {
            if (!signal.aborted && streamAudio.paused && streamAudio.readyState >= 2) {
              console.log('[' + (performance.now() - t0).toFixed(0) + 'ms] AbortError retry (timer, readyState=' + streamAudio.readyState + ')');
              doPlay();
            }
          }, 500);
          return;
        }
        if (err.name === 'NotAllowedError') {
          console.warn('⚠️ Autoplay blocked, waiting for user interaction');
          window._pendingStreamUrl = streamUrl;
          if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
          return;
        }
        console.error('❌ Stream play error:', err);
        if (_streamLoadingUrl === streamUrl) _streamLoadingUrl = null;
      });
    }

    // src уже правильный и элемент не в ended/error состоянии — не сбрасываем поток
    if (streamAudio.src === streamUrl && streamAudio.readyState > 0 && !streamAudio.error && !streamAudio.ended) {
      console.log('[' + (performance.now() - t0).toFixed(0) + 'ms] src already correct, skipping reassignment');
      _resumeAndPlay();
      return;
    }
    // Если элемент в ended состоянии — нужен полный reload (иначе play() моментально резолвится вхолостую)
    if (streamAudio.ended) {
      console.log('[' + (performance.now() - t0).toFixed(0) + 'ms] element ended — forcing reload');
      streamAudio.src = '';
      streamAudio.load();
    }

    if (streamAudio.src && streamAudio.src !== window.location.href) {
      _suppressNextError = true;
    }

    streamAudio.pause();
    console.log('[' + (performance.now() - t0).toFixed(0) + 'ms] setting src...');
    streamAudio.src = streamUrl;

    // Фаза 1: stall-таймер (90с — запас на yt-dlp переподбор URL SoundCloud)
    _startStallTimer(90000);
    streamAudio.addEventListener('progress', function () {
      if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; }
    }, { signal: signal });

    // playing → фаза 2 stall
    // connectAudioElement вызывается ДО play() внутри _resumeAndPlay (Safari-fix)
    streamAudio.addEventListener('playing', function () {
      if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; }
      console.log('✅ [' + (performance.now() - t0).toFixed(0) + 'ms] audio playing');
      // Fallback: если эквалайзер ещё не подключён (AudioContext не был готов до play)
      if (typeof equalizer !== 'undefined' && equalizer && !equalizer.mediaSource) {
        equalizer.connectAudioElement(streamAudio);
      }
      streamAudio.addEventListener('waiting', function () {
        console.log('⌛ [' + (performance.now() - t0).toFixed(0) + 'ms] audio waiting...');
        _startStallTimer(60000);
      }, { signal: signal });
      streamAudio.addEventListener('progress', function () {
        if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; }
      }, { signal: signal });
    }, { once: true, signal: signal });

    // Resume AudioContext и сразу вызываем play()
    // Для live-стримов canplay может не стрелять — play() сам разберётся
    _resumeAndPlay();

    function _resumeAndPlay() {
      if (ctx && ctx.state === 'suspended') {
        console.log('[' + (performance.now() - t0).toFixed(0) + 'ms] AudioContext suspended — resuming...');
        ctx.resume().then(function () {
          console.log('[' + (performance.now() - t0).toFixed(0) + 'ms] AudioContext resumed, connecting equalizer...');
          // Safari-fix: подключаем к Web Audio ДО play(), иначе Safari глушит звук при подключении после начала воспроизведения
          if (typeof equalizer !== 'undefined' && equalizer && !equalizer.mediaSource) {
            equalizer.connectAudioElement(streamAudio);
          }
          doPlay();
        }).catch(function (err) {
          console.warn('⚠️ AudioContext resume failed:', err.name, '— will try play() anyway');
          doPlay();
        });
      } else {
        console.log('[' + (performance.now() - t0).toFixed(0) + 'ms] AudioContext state=' + (ctx ? ctx.state : 'none'));
        // AudioContext уже running — подключаем до play()
        if (ctx && ctx.state === 'running' && typeof equalizer !== 'undefined' && equalizer && !equalizer.mediaSource) {
          equalizer.connectAudioElement(streamAudio);
        }
        doPlay();
      }
    }
  }

  _tryConnect();
}

// ── Остановить стрим ──────────────────────────────────────────────────────────
function pauseStream() {
  console.log('⏸️ pauseStream');
  if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
  if (_streamCallController) { _streamCallController.abort(); _streamCallController = null; }
  if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; }
  _streamLoadingUrl = null;
  var streamAudio = document.getElementById('streamAudio');
  if (streamAudio) {
    streamAudio.pause();
    streamAudio.src = '';   // Очищаем src — чтобы следующий playStream
    streamAudio.load();     // сделал полный HTTP reconnect, а не resume буфера
    console.log('✅ Stream paused');
  }
}

// ── Высокоуровневые функции ───────────────────────────────────────────────────
function autoConnectStream() {
  var roomId = (typeof GLOBAL !== 'undefined' && GLOBAL && GLOBAL.roomId)
    ? GLOBAL.roomId
    : (typeof window.currentRoomId !== 'undefined' ? window.currentRoomId : null);
  var connected = (typeof window.radioConnected !== 'undefined') ? !!window.radioConnected : false;
  var apiBase = resolveApiBase();

  console.log('[autoConnectStream] called, currentRoomId:', roomId, 'radioConnected:', connected);
  if (!roomId) {
    console.warn('[autoConnectStream] no currentRoomId, skipping');
    return;
  }
  if (connected) {
    console.log('[autoConnectStream] already connected, skipping');
    return;
  }
  window.radioConnected = true;
  var url = apiBase + '/stream/room/' + roomId + '/stream';
  var statusDot = document.getElementById('statusDot');
  if (statusDot) {
    statusDot.innerHTML = '<span class="live-dot">&#9679; Подключение...</span>';
  }
  console.log('[autoConnectStream] starting playStream with URL:', url);
  playStream(url);
  if (typeof window.setLiveStatus === 'function') window.setLiveStatus(true);
}

function doListen() {
  var roomId = (typeof GLOBAL !== 'undefined' && GLOBAL && GLOBAL.roomId)
    ? GLOBAL.roomId
    : (typeof window.currentRoomId !== 'undefined' ? window.currentRoomId : null);
  var apiBase = resolveApiBase();
  if (!roomId) { alert('Подключитесь к комнате'); return; }
  var url = apiBase + '/stream/room/' + roomId + '/stream';
  if (_streamLoadingUrl === url) {
    console.log('⏩ doListen: already loading this stream, skipping');
    return;
  }
  window.radioConnected = false;
  _streamLoadingUrl = null;
  autoConnectStream();
}

function showPlayPrompt() {
  var prompt = document.getElementById('playPrompt');
  if (prompt) prompt.style.display = 'block';
}

function onPlayPromptClick() {
  var prompt = document.getElementById('playPrompt');
  if (prompt) prompt.style.display = 'none';

  var audio = document.getElementById('streamAudio');
  if (typeof equalizer !== 'undefined' && equalizer && equalizer.audioContext) {
    equalizer.audioContext.resume().then(function () {
      // Safari-fix: connect to WebAudio while still in user gesture handler.
      if (audio && audio.src && !equalizer.mediaSource) {
        equalizer.connectAudioElement(audio);
      }
    }).catch(function () {});
  }

  if (audio && audio.paused && audio.src) {
    audio.play().catch(function (err) { console.error('Retry play error:', err); });
  } else {
    window.radioConnected = false;
    autoConnectStream();
  }
  window._pendingStreamUrl = null;
}

function doStop() {
  window.radioConnected = false;
  _pendingStreamUrl = null;
  var el = document.getElementById('playPrompt');
  if (el) el.style.display = 'none';
  pauseStream();
  if (typeof window.setLiveStatus === 'function') window.setLiveStatus(false);
}

// Safari/iOS: разблокируем аудио-контекст по первому пользовательскому жесту.
(function bindOneTapAudioUnlock() {
  function unlock() {
    var audio = document.getElementById('audioPlayer') || document.getElementById('streamAudio');
    if (audio) {
      var prevMuted = audio.muted;
      audio.muted = true;
      audio.play()
        .then(function () {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = prevMuted;
        })
        .catch(function () {
          audio.muted = prevMuted;
        });
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

// ---- Совместимость с комнатным PlayerModule ----
// Этот слой нужен, чтобы player.js всегда мог получить URL для трека,
// даже если stream_url ещё не проставлен backend-ом.
if (typeof window.StreamModule === 'undefined') {
  window.StreamModule = (function () {
    const roomRetryTimers = new WeakMap();
    const roomRetryMeta = new WeakMap();

    async function isRoomLive(roomId) {
      if (!roomId) return false;
      try {
        const res = await fetch(resolveApiBase() + '/stream/room/' + roomId + '/status');
        if (!res.ok) return false;
        const data = await res.json();
        return !!(data && data.live);
      } catch {
        return false;
      }
    }

    function stopLegacyStreamAudio() {
      var legacy = document.getElementById('streamAudio');
      if (!legacy) return;
      try {
        legacy.pause();
        legacy.src = '';
        legacy.load();
      } catch {}
      if (typeof window.radioConnected !== 'undefined') window.radioConnected = false;
    }

    function clearRoomRetry(audioEl) {
      const t = roomRetryTimers.get(audioEl);
      if (t) {
        clearTimeout(t);
        roomRetryTimers.delete(audioEl);
      }
      roomRetryMeta.delete(audioEl);
    }

    function scheduleRoomRetry(audioEl, url, attempt) {
      clearRoomRetry(audioEl);
      const nextAttempt = (attempt || 0) + 1;
      if (nextAttempt > 24) {
        console.warn('[StreamModule] retry limit reached for room stream');
        return;
      }
      const delayMs = Math.min(250 + nextAttempt * 220, 1800);
      const timer = setTimeout(() => {
        if (!GLOBAL || !GLOBAL.roomId) return;
        if (!GLOBAL.isPlaying) return;
        const reqId = Date.now();
        roomRetryMeta.set(audioEl, { reqId: reqId });
        isRoomLive(GLOBAL.roomId).then((live) => {
          const meta = roomRetryMeta.get(audioEl);
          if (!meta || meta.reqId !== reqId) return;
          if (!live) {
            // Пока эфир не запущен, не дергаем /stream и не спамим 503.
            scheduleRoomRetry(audioEl, url, Math.max(1, nextAttempt - 1));
            return;
          }
          const absUrl = new URL(url, window.location.href).href;
          if (audioEl.src !== absUrl) {
            audioEl.src = url;
          }
          audioEl.load();
          audioEl.play()
            .then(() => clearRoomRetry(audioEl))
            .catch((err) => {
              if (err && err.name === 'NotAllowedError') {
                window._pendingStreamUrl = url;
                if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
                return;
              }
              scheduleRoomRetry(audioEl, url, nextAttempt);
            });
        });
      }, delayMs);
      roomRetryTimers.set(audioEl, timer);
    }
    function resolveStreamUrl(track) {
      if (!track) return '';

      // Критично для синхронизации: в комнате все слушают один broadcast-поток.
      if (GLOBAL && GLOBAL.roomId) {
        return resolveApiBase() + '/stream/room/' + GLOBAL.roomId + '/stream';
      }

      var direct = String(track.stream_url || track.url || '').trim();
      if (direct) return direct;

      if (track.id) {
        return '/stream/' + track.id + '/soundcloud-proxy';
      }

      var sourceId = String(track.source_track_id || '').trim();
      if (/^https?:\/\//i.test(sourceId)) return sourceId;

      return '';
    }

    async function refreshUrl(trackId) {
      if (!GLOBAL.roomId || !GLOBAL.token || !trackId) return null;
      try {
        const res = await authFetch('/rooms/' + GLOBAL.roomId + '/tracks/' + trackId + '/refresh-url', {
          method: 'POST',
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.stream_url || null;
      } catch {
        return null;
      }
    }

    function assignAudio(audioEl, track, autoPlay) {
      if (!audioEl || !track) return;

      const url = resolveStreamUrl(track);
      if (!url) return;

      const roomMode = !!(GLOBAL && GLOBAL.roomId);

      // Hard gate in room mode: never touch /stream endpoint until backend reports live.
      if (roomMode && autoPlay) {
        isRoomLive(GLOBAL.roomId).then((live) => {
          if (!live) {
            if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
            scheduleRoomRetry(audioEl, url, 0);
            return;
          }

          const absUrlLive = new URL(url, window.location.href).href;
          if (audioEl.src !== absUrlLive) {
            if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
            audioEl.src = url;
            audioEl.load();
          }

          audioEl.play().catch((err) => {
            if (err && err.name === 'NotAllowedError') {
              window._pendingStreamUrl = url;
              if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
              return;
            }
            scheduleRoomRetry(audioEl, url, 0);
          });
        });
        return;
      }

      if (roomMode && !autoPlay && !GLOBAL.isPlaying) {
        // В паузе/до старта эфира не инициируем загрузку live stream URL.
        clearRoomRetry(audioEl);
        return;
      }

      if (roomMode) {
        // Принудительно гасим legacy hidden player, чтобы в комнате
        // существовало только одно HTTP-подключение к live stream на вкладку.
        stopLegacyStreamAudio();
      }

      const absUrl = new URL(url, window.location.href).href;
      const srcChanged = audioEl.src !== absUrl;

      if (srcChanged) {
        if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
        audioEl.src = url;
        audioEl.load();
      }

      if (roomMode && !audioEl.__roomStreamBound) {
        audioEl.__roomStreamBound = true;
        audioEl.addEventListener('playing', () => {
          if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = true;
        });
        audioEl.addEventListener('waiting', () => {
          if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
        });
        audioEl.addEventListener('stalled', () => {
          if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
        });
        audioEl.addEventListener('pause', () => {
          if (typeof GLOBAL !== 'undefined' && !GLOBAL.isPlaying) GLOBAL.streamConnected = false;
        });
        audioEl.addEventListener('error', () => {
          if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
        });
        audioEl.addEventListener('ended', () => {
          if (typeof GLOBAL !== 'undefined') GLOBAL.streamConnected = false;
        });
      }

      if (roomMode) {
        audioEl.onerror = () => {
          if (GLOBAL && GLOBAL.isPlaying) {
            scheduleRoomRetry(audioEl, url, 0);
          }
        };
      }

      if (autoPlay) {
        audioEl.play().catch(async (err) => {
          // Для комнаты не переключаем источник на per-track URL при ошибке play,
          // иначе пользователи разъедутся по разным потокам.
          if (roomMode) {
            if (err && err.name === 'NotAllowedError') {
              window._pendingStreamUrl = url;
              if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
              return;
            }
            scheduleRoomRetry(audioEl, url, 0);
            return;
          }
          const refreshed = await refreshUrl(track.id);
          if (!refreshed) return;
          const refreshedAbs = new URL(refreshed, window.location.href).href;
          if (audioEl.src !== refreshedAbs) {
            audioEl.src = refreshed;
            audioEl.load();
          }
          audioEl.play().catch(() => {});
        });

        if (roomMode) {
          setTimeout(() => {
            if (!GLOBAL || !GLOBAL.isPlaying) return;
            if (!audioEl.paused) return;
            scheduleRoomRetry(audioEl, url, 0);
          }, 120);
        }
      }
    }

    return { resolveStreamUrl, refreshUrl, assignAudio };
  })();
}