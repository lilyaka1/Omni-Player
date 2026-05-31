/**
 * websocket.js — WebSocket соединение и диспетчер сообщений.
<<<<<<< HEAD
 * MVP RADIO-MODE: никакого is_playing inference, hasIsPlaying, player.applyState
 * с grace window. Только чистый current_track → play.
 *
 * Зависимости: globals.js (GLOBAL, showToast)
=======
 *
 * Зависимости: globals.js (GLOBAL, showToast)
 *              player.js (PlayerModule) — опционально
 *              queue.js  (QueueModule)  — опционально
 *              chat.js   (ChatModule)   — опционально
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
 */

const WSModule = (function () {

  let _lifecycleBound = false;
  let _isConnecting = false;
  let _wsCooldownUntil = 0;
  let _pendingMessages = [];
  let _lastMessageAt = 0;
  let _watchdogTimer = null;
<<<<<<< HEAD
  const _staleTimeoutMs = 60000;

  function syncRoomStreamFromPayload(payload) {
    if (!payload) return;

    const trackId = Number(payload.track_id || (GLOBAL.currentTrack && GLOBAL.currentTrack.id) || 0);
    const position = Number(payload.position);
    if (!Number.isFinite(position) || position < 0) return;

    const streamAudio = document.getElementById('streamAudio');
    if (!streamAudio) {
      window._pendingRoomStreamSeek = { trackId, position };
      return;
    }

    if (trackId && GLOBAL.currentTrack && Number(GLOBAL.currentTrack.id) !== trackId) {
      return;
    }

    const applySeek = () => {
      try {
        const duration = Number(streamAudio.duration);
        let target = position;
        if (Number.isFinite(duration) && duration > 0) {
          target = Math.max(0, Math.min(position, Math.max(0, duration - 0.25)));
        }
        if (Math.abs((Number(streamAudio.currentTime) || 0) - target) > 0.35) {
          streamAudio.currentTime = target;
        }
        GLOBAL.currentPosition = target;
      } catch {
        window._pendingRoomStreamSeek = { trackId, position };
      }
    };

    if (streamAudio.readyState >= 1) {
      applySeek();
      return;
    }

    window._pendingRoomStreamSeek = { trackId, position };
    if (streamAudio.__roomTrackSyncBound) return;

    const flushPendingSeek = () => {
      const pending = window._pendingRoomStreamSeek;
      if (!pending) return;
      if (pending.trackId && GLOBAL.currentTrack && Number(GLOBAL.currentTrack.id) !== Number(pending.trackId)) return;
      try {
        const duration = Number(streamAudio.duration);
        let target = Number(pending.position);
        if (Number.isFinite(duration) && duration > 0) {
          target = Math.max(0, Math.min(target, Math.max(0, duration - 0.25)));
        }
        if (Math.abs((Number(streamAudio.currentTime) || 0) - target) > 0.35) {
          streamAudio.currentTime = target;
        }
        GLOBAL.currentPosition = target;
        window._pendingRoomStreamSeek = null;
      } catch {
        return;
      }
    };

    streamAudio.addEventListener('loadedmetadata', flushPendingSeek);
    streamAudio.addEventListener('canplay', flushPendingSeek);
    streamAudio.__roomTrackSyncBound = true;
  }

  // ── connect ────────────────────────────────────────────────────────────────
  function connect() {
    if (!GLOBAL.roomId) return;
    if (document.hidden || document.visibilityState !== 'visible') { _isConnecting = false; return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { _isConnecting = false; return; }
    if (Date.now() < _wsCooldownUntil) { _isConnecting = false; return; }
    if (GLOBAL.ws && (GLOBAL.ws.readyState === WebSocket.OPEN || GLOBAL.ws.readyState === WebSocket.CONNECTING)) return;
    if (_isConnecting) return;
    _isConnecting = true;

    bindLifecycleReconnect();

=======
  let _stateSyncTimer = null;
  let _stateSyncInFlight = false;
  let _delayedTrackTimer = null;
  let _delayedTrackSeq = 0;
  let _trackMetaHoldUntil = 0;

  function getTrackMetaDelayMs() {
    const v = Number((window.GLOBAL && GLOBAL.trackMetaDelayMs) || 4000);
    if (!Number.isFinite(v)) return 4000;
    return Math.max(0, v);
  }

  function cancelDelayedTrackApply() {
    _delayedTrackSeq += 1;
    if (_delayedTrackTimer) {
      clearTimeout(_delayedTrackTimer);
      _delayedTrackTimer = null;
    }
  }

  function flushPendingMessages() {
    if (!GLOBAL.ws || GLOBAL.ws.readyState !== WebSocket.OPEN) return;
    if (!_pendingMessages.length) return;
    const batch = _pendingMessages;
    _pendingMessages = [];
    batch.forEach((payload) => {
      try {
        GLOBAL.ws.send(JSON.stringify(payload));
      } catch {
        _pendingMessages.push(payload);
      }
    });
  }

  function inferPlayingFromPayload(data, hasIsPlaying) {
    if (hasIsPlaying) {
      return !!(data.is_playing ?? data.playing);
    }
    const track = data.current_track || data.track || null;
    const startedAt = Number(track && track.started_at);
    if (track && Number.isFinite(startedAt) && startedAt > 0) {
      return true;
    }
    return !!GLOBAL.isPlaying;
  }

  function resolveWsBase() {
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.hostname;
    const port = String(location.port || '');
    const isLocalHost = host === '127.0.0.1' || host === 'localhost';
    const isViteDevPort = port === '5173' || port === '5174' || port === '5175';
<<<<<<< HEAD
    const base = (isLocalHost && isViteDevPort) ? `${proto}://${host}:5173` : `${proto}://${location.host}`;
    const token = GLOBAL.token ? `?token=${encodeURIComponent(GLOBAL.token)}` : '';
    const url = `${base}/ws/rooms/${GLOBAL.roomId}${token}`;

    console.log('[WS] Подключение к', url);
=======

    // In local Vite dev, connect through proxy to backend WS.
    if (isLocalHost && isViteDevPort) {
      return `${proto}://${host}:5173`;
    }
    return `${proto}://${location.host}`;
  }

  // ---- Подключение ----

  function connect() {
    if (!GLOBAL.roomId) {
      console.warn('[WS] roomId не задан');
      return;
    }

    if (document.hidden || document.visibilityState !== 'visible') {
      _isConnecting = false;
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      _isConnecting = false;
      return;
    }
    if (Date.now() < _wsCooldownUntil) {
      _isConnecting = false;
      return;
    }

    if (GLOBAL.ws && (GLOBAL.ws.readyState === WebSocket.OPEN || GLOBAL.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (_isConnecting) return;
    _isConnecting = true;

    bindLifecycleReconnect();

    const base  = resolveWsBase();
    const token = GLOBAL.token ? `?token=${encodeURIComponent(GLOBAL.token)}` : '';
    const url   = `${base}/ws/rooms/${GLOBAL.roomId}${token}`;

    console.log('[WS] Подключение к', url);
    if (typeof roomTrace === 'function') roomTrace('ws.connect.start', { url });

>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    const ws = new WebSocket(url);
    GLOBAL.ws = ws;

    ws.onopen = () => {
      _isConnecting = false;
      _lastMessageAt = Date.now();
      console.log('[WS] Соединение установлено');
<<<<<<< HEAD
=======
      if (typeof roomTrace === 'function') roomTrace('ws.open', { roomId: GLOBAL.roomId });
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      GLOBAL._wsReconnectDelay = 2000;
      clearTimeout(GLOBAL._wsReconnectTimer);
      flushPendingMessages();
      startWatchdog();
<<<<<<< HEAD
      ws._pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
          _lastMessageAt = Date.now();
=======
      startStateResync();
      // Keep-alive ping каждые 25с
      ws._pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
        }
      }, 25000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      _lastMessageAt = Date.now();
<<<<<<< HEAD
      dispatch(msg);
    };

    ws.onerror = () => {
      _isConnecting = false;
      if (document.hidden || ws.__intentionalClose) return;
=======
      if (typeof roomTrace === 'function') {
        roomTrace('ws.message.in', {
          type: msg.type,
          hasData: Boolean(msg.data),
          isPlaying: msg?.data?.is_playing ?? msg?.is_playing,
          trackId: (msg?.data?.current_track || msg?.data?.track || msg?.track || {}).id || null,
        });
      }
      dispatch(msg);
    };

    ws.onerror = (err) => {
      _isConnecting = false;
      if (document.hidden || ws.__intentionalClose) {
        return;
      }
      if (typeof roomTrace === 'function') roomTrace('ws.error', { roomId: GLOBAL.roomId });
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      console.warn('[WS] Ошибка соединения, будет переподключение');
    };

    ws.onclose = (ev) => {
      _isConnecting = false;
      const intentionalClose = Boolean(ws.__intentionalClose);
      if (intentionalClose) {
        clearInterval(ws._pingInterval);
<<<<<<< HEAD
        GLOBAL.ws = null;
        return;
      }
      clearInterval(ws._pingInterval);
=======
        if (typeof roomTrace === 'function') roomTrace('ws.close.intentional', { reason: ev.reason || '' });
        GLOBAL.ws = null;
        return;
      }
      if (String(ev.reason || '').toLowerCase().includes('suspension')) {
        console.log('[WS] Закрыто из-за suspension, восстановим при возврате во вкладку');
      } else {
        console.warn('[WS] Соединение закрыто, код:', ev.code);
      }
      clearInterval(ws._pingInterval);
      if (typeof roomTrace === 'function') roomTrace('ws.close', { code: ev.code, reason: ev.reason || '' });
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      GLOBAL.ws = null;
      scheduleReconnect();
    };
  }

<<<<<<< HEAD
  // ── Watchdog ────────────────────────────────────────────────────────────
=======
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
  function startWatchdog() {
    if (_watchdogTimer) return;
    _watchdogTimer = setInterval(() => {
      if (document.hidden || document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
<<<<<<< HEAD
=======

>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      const ws = GLOBAL.ws;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        clearTimeout(GLOBAL._wsReconnectTimer);
        GLOBAL._wsReconnectDelay = 1200;
        connect();
        return;
      }
<<<<<<< HEAD
      if (ws.readyState !== WebSocket.OPEN) return;
      const silentForMs = Date.now() - (_lastMessageAt || 0);
      if (silentForMs > _staleTimeoutMs) {
=======

      if (ws.readyState !== WebSocket.OPEN) return;

      const silentForMs = Date.now() - (_lastMessageAt || 0);
      if (silentForMs > 20000) {
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
        console.warn('[WS] Watchdog: socket stale, reconnecting...');
        ws.__intentionalClose = true;
        try { ws.close(1000, 'watchdog-stale'); } catch {}
        GLOBAL.ws = null;
        clearTimeout(GLOBAL._wsReconnectTimer);
        GLOBAL._wsReconnectDelay = 1200;
        connect();
      }
    }, 5000);
  }

<<<<<<< HEAD
  // ── Reconnect ───────────────────────────────────────────────────────────
  function scheduleReconnect() {
    if (document.hidden || document.visibilityState !== 'visible') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const delay = GLOBAL._wsReconnectDelay;
    console.log(`[WS] Переподключение через ${delay}мс...`);
    GLOBAL._wsReconnectTimer = setTimeout(() => {
=======
  function startStateResync() {
    if (_stateSyncTimer) return;
    _stateSyncTimer = setInterval(async () => {
      if (!GLOBAL.roomId) return;
      if (document.hidden || document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (_stateSyncInFlight) return;

      _stateSyncInFlight = true;
      try {
        const res = await fetch(`/rooms/${GLOBAL.roomId}/playback-state`, { cache: 'no-store' });
        if (!res.ok) return;
        const state = await res.json();
        if (!state || typeof state !== 'object') return;

        const normalized = {
          current_track: state.current_track || null,
          is_playing: Boolean(state.is_playing),
          position: Number(state.position || 0),
          current_time: Number(state.position || 0),
        };

        const incomingId = normalized.current_track && Number(normalized.current_track.id);
        const currentId = GLOBAL.currentTrack && Number(GLOBAL.currentTrack.id);
        if (
          Number.isFinite(incomingId) && Number.isFinite(currentId)
          && incomingId !== currentId
          && Date.now() < _trackMetaHoldUntil
        ) {
          return;
        }

        if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.applyState === 'function') {
          PlayerModule.applyState(normalized);
        }
      } catch {
        // noop
      } finally {
        _stateSyncInFlight = false;
      }
    }, 2500);
  }

  function scheduleReconnect() {
    if (document.hidden || document.visibilityState !== 'visible') {
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }
    const delay = GLOBAL._wsReconnectDelay;
    console.log(`[WS] Переподключение через ${delay}мс...`);
    GLOBAL._wsReconnectTimer = setTimeout(() => {
      // Экспоненциальный backoff, не больше 30с
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      GLOBAL._wsReconnectDelay = Math.min(GLOBAL._wsReconnectDelay * 1.5, 30000);
      connect();
    }, delay);
  }

  function bindLifecycleReconnect() {
    if (_lifecycleBound) return;
    _lifecycleBound = true;

    const closeIfOpen = (reason) => {
      if (GLOBAL.ws && (GLOBAL.ws.readyState === WebSocket.OPEN || GLOBAL.ws.readyState === WebSocket.CONNECTING)) {
        GLOBAL.ws.__intentionalClose = true;
        try { GLOBAL.ws.close(1000, reason); } catch {}
      }
    };

    const reconnectNow = () => {
<<<<<<< HEAD
      if (document.hidden || document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { closeIfOpen('offline'); return; }
=======
      if (document.hidden || document.visibilityState !== 'visible') {
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        closeIfOpen('offline');
        return;
      }
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      if (!GLOBAL.ws || GLOBAL.ws.readyState === WebSocket.CLOSED) {
        clearTimeout(GLOBAL._wsReconnectTimer);
        GLOBAL._wsReconnectDelay = 2000;
        _wsCooldownUntil = Date.now() + 250;
        connect();
      }
    };

    document.addEventListener('visibilitychange', reconnectNow);
    window.addEventListener('focus', reconnectNow);
    window.addEventListener('pageshow', reconnectNow);
    window.addEventListener('online', reconnectNow);
<<<<<<< HEAD
    window.addEventListener('offline', () => { closeIfOpen('offline'); });
    window.addEventListener('pagehide', () => { closeIfOpen('page-hide'); });
  }

  // ── Send ─────────────────────────────────────────────────────────────────
  function flushPendingMessages() {
    if (!GLOBAL.ws || GLOBAL.ws.readyState !== WebSocket.OPEN) return;
    if (!_pendingMessages.length) return;
    const batch = _pendingMessages;
    _pendingMessages = [];
    batch.forEach(payload => {
      try { GLOBAL.ws.send(JSON.stringify(payload)); }
      catch { _pendingMessages.push(payload); }
    });
  }

=======
    window.addEventListener('offline', () => {
      closeIfOpen('offline');
    });

    window.addEventListener('pagehide', () => {
      closeIfOpen('page-hide');
    });
  }

  // ---- Отправка ----

  /**
   * Отправить сообщение на сервер.
   * @param {string} type
   * @param {object} data — дополнительные поля
   */
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
  function sendWS(type, data) {
    const payload = { type, ...data };

    if (!GLOBAL.ws || GLOBAL.ws.readyState !== WebSocket.OPEN) {
      if (_pendingMessages.length > 20) _pendingMessages.shift();
      _pendingMessages.push(payload);
<<<<<<< HEAD
=======

>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      if (!GLOBAL.ws || GLOBAL.ws.readyState === WebSocket.CLOSED) {
        clearTimeout(GLOBAL._wsReconnectTimer);
        GLOBAL._wsReconnectDelay = 800;
        connect();
      }
<<<<<<< HEAD
=======

>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
      console.warn('[WS] Не подключён, сообщение поставлено в очередь:', type);
      return false;
    }

    GLOBAL.ws.send(JSON.stringify(payload));
<<<<<<< HEAD
    return true;
  }

  // ── Dispatch ───────────────────────────────────────────────────────────
=======
    if (typeof roomTrace === 'function') {
      roomTrace('ws.message.out', {
        type,
        action: data && data.action,
        track_id: data && data.track_id,
      });
    }
    return true;
  }

  // ---- Диспетчер входящих сообщений ----

>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
  function dispatch(msg) {
    switch (msg.type) {

      case 'room_state':
        handleRoomState(msg.data);
        break;

      case 'track_change':
        handleTrackChange(msg.data);
        break;

      case 'track_changed':
<<<<<<< HEAD
        handleTrackChanged(msg);
        break;

      case 'track_sync':
        handleTrackSync(msg);
=======
        handleTrackChangedLegacy(msg);
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
        break;

      case 'queue_updated':
        if (typeof QueueModule !== 'undefined') {
          if (Array.isArray(msg.data)) {
            QueueModule.setQueue(msg.data);
          } else {
<<<<<<< HEAD
=======
            // Backend often sends incremental payload {track_added, queue_position}.
            // Reload full queue instead of wiping it with a non-array payload.
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
            QueueModule.loadQueue();
          }
        }
        break;

      case 'chat':
<<<<<<< HEAD
        if (typeof ChatModule !== 'undefined') ChatModule.appendMessage(msg);
=======
        if (typeof ChatModule !== 'undefined') {
          ChatModule.appendMessage(msg);
        }
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
        break;

      case 'chat_history':
        if (typeof ChatModule !== 'undefined' && typeof ChatModule.setHistory === 'function') {
          ChatModule.setHistory(msg.data || []);
        }
        break;

      case 'user_count':
        updateOnlineCount(msg.count);
        break;

      case 'error':
        showToast(msg.message || 'Ошибка сервера', 'error');
        break;

      case 'pong':
<<<<<<< HEAD
        break;

      case 'playback_started':
        GLOBAL.isPlaying = true;
        // Обновляем UI если есть PlayerModule
        if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.applyState === 'function') {
          PlayerModule.applyState({ is_playing: true, current_track: GLOBAL.currentTrack });
        }
=======
        // keep-alive ответ, игнорируем
        break;

      case 'playback_started':
        handlePlaybackStarted(msg.data || msg);
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
        break;

      case 'thumbnail_updated':
        handleThumbnailUpdated(msg);
        break;

      default:
<<<<<<< HEAD
        console.log('[WS] Неизвестный тип:', msg.type);
    }
  }

  // ── Handlers (Radio Mode) ─────────────────────────────────────────────────
  function handleRoomState(data) {
    if (!data) return;
    const track = data.current_track || data.track || null;
    const isPlaying = data.is_playing;
    setGlobalFromTrack(track, isPlaying);
    if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.applyState === 'function') {
      PlayerModule.applyState(data);
    }
    // User role
=======
        console.log('[WS] Неизвестный тип:', msg.type, msg);
    }
  }

  // ---- Обработчики событий ----

  function handleRoomState(data) {
    if (!data) return;
    cancelDelayedTrackApply();

    const hasIsPlaying = Object.prototype.hasOwnProperty.call(data, 'is_playing')
      || Object.prototype.hasOwnProperty.call(data, 'playing');
    const hasPosition = Object.prototype.hasOwnProperty.call(data, 'position')
      || Object.prototype.hasOwnProperty.call(data, 'current_time');

    const incomingTrack = data.current_track || data.track || null;
    const incomingPlaying = inferPlayingFromPayload(data, hasIsPlaying);
    if (hasPosition) {
      const pos = Number(data.position ?? data.current_time);
      GLOBAL.currentPosition = Number.isFinite(pos) ? pos : (GLOBAL.currentPosition || 0);
    } else {
      // Fallback for "radio mode": backend may send track.started_at without position.
      const startedAt = Number((data.current_track || data.track || {}).started_at);
      if (Number.isFinite(startedAt) && startedAt > 0) {
        const nowSec = Date.now() / 1000;
        GLOBAL.currentPosition = Math.max(0, nowSec - startedAt);
      }
    }

    // Backend may send user role as role/user_role, and values differ by enum.
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    const incomingRole = String(data.user_role || data.role || '').toLowerCase();
    if (incomingRole.includes('admin') || incomingRole.includes('owner')) {
      GLOBAL.userRole = 'owner';
    } else if (incomingRole.includes('user') || incomingRole.includes('listener')) {
      GLOBAL.userRole = 'listener';
    }
<<<<<<< HEAD
    // Online count
=======

    if (typeof PlayerModule !== 'undefined') {
      PlayerModule.applyState(data);
    }

    GLOBAL.currentTrack = incomingTrack;
    GLOBAL.isPlaying = incomingPlaying;

    // Do not clobber queue if room_state does not carry full queue payload.
    if (typeof QueueModule !== 'undefined' && Array.isArray(data.queue)) {
      QueueModule.setQueue(data.queue || []);
    } else if (typeof QueueModule !== 'undefined' && (!GLOBAL.queue || !GLOBAL.queue.length)) {
      QueueModule.loadQueue();
    }

>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    updateOnlineCount(data.users || 0);
  }

  function handleTrackChange(data) {
    if (!data) return;
<<<<<<< HEAD
    const track = data.current_track || data.track || null;
    const isPlaying = data.is_playing;
    setGlobalFromTrack(track, isPlaying);
    if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.applyState === 'function') {
      PlayerModule.applyState(data);
    }
  }

  function handleTrackChanged(msg) {
=======
    cancelDelayedTrackApply();
    _trackMetaHoldUntil = 0;
    const hasIsPlaying = Object.prototype.hasOwnProperty.call(data, 'is_playing')
      || Object.prototype.hasOwnProperty.call(data, 'playing');
    const hasPosition = Object.prototype.hasOwnProperty.call(data, 'position')
      || Object.prototype.hasOwnProperty.call(data, 'current_time');

    const incomingTrack = data.current_track || data.track || null;
    const incomingPlaying = inferPlayingFromPayload(data, hasIsPlaying);
    if (hasPosition) {
      const pos = Number(data.position ?? data.current_time);
      GLOBAL.currentPosition = Number.isFinite(pos) ? pos : (GLOBAL.currentPosition || 0);
    } else {
      const startedAt = Number((data.current_track || data.track || {}).started_at);
      if (Number.isFinite(startedAt) && startedAt > 0) {
        const nowSec = Date.now() / 1000;
        GLOBAL.currentPosition = Math.max(0, nowSec - startedAt);
      }
    }

    if (typeof PlayerModule !== 'undefined') {
      PlayerModule.applyState(data);
    }

    GLOBAL.currentTrack = incomingTrack;
    GLOBAL.isPlaying = incomingPlaying;
  }

  function handleTrackChangedLegacy(msg) {
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    const track = msg.track || (msg.data && (msg.data.current_track || msg.data.track)) || null;
    const base = msg.data || {};
    const normalized = {
      ...base,
      current_track: track,
<<<<<<< HEAD
      track: track,
    };
    // Для track_changed события, если трек есть - значит он играет
    const isPlaying = Boolean(track);
    setGlobalFromTrack(track, isPlaying);
    if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.applyState === 'function') {
      PlayerModule.applyState(normalized);
    }
  }

  function handleTrackSync(msg) {
    const payload = msg.payload || msg.data || msg || {};
    if (!payload) return;
    syncRoomStreamFromPayload(payload);

    const streamAudio = document.getElementById('streamAudio');
    if (!streamAudio) return;

    if (payload.is_playing === false) {
      streamAudio.pause();
      GLOBAL.isPlaying = false;
      return;
    }

    if (payload.is_playing === true && streamAudio.src && streamAudio.paused) {
      streamAudio.play().catch(function (err) {
        if (err && err.name === 'NotAllowedError') {
          window._pendingStreamUrl = streamAudio.src;
          if (typeof window.showPlayPrompt === 'function') window.showPlayPrompt();
        }
      });
      GLOBAL.isPlaying = true;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function setGlobalFromTrack(track, isPlaying = null) {
    GLOBAL.currentTrack = track;
    // Используем явно переданное состояние, если есть, иначе определяем по наличию трека
    if (isPlaying !== null) {
      GLOBAL.isPlaying = Boolean(isPlaying);
    } else {
      GLOBAL.isPlaying = Boolean(track);
=======
      track,
      is_playing: true,
      current_time: typeof base.current_time !== 'undefined' ? base.current_time : 0,
    };

    const delayMs = getTrackMetaDelayMs();
    if (delayMs <= 0) {
      handleTrackChange(normalized);
      return;
    }

    cancelDelayedTrackApply();
    _trackMetaHoldUntil = Date.now() + delayMs;
    const seq = _delayedTrackSeq;
    if (typeof roomTrace === 'function') {
      roomTrace('ws.track_changed.delayed', {
        delayMs,
        trackId: track && track.id ? track.id : null,
      });
    }

    _delayedTrackTimer = setTimeout(() => {
      if (seq !== _delayedTrackSeq) return;
      _delayedTrackTimer = null;
      handleTrackChange(normalized);
    }, delayMs);
  }

  function handlePlaybackStarted(data) {
    GLOBAL.isPlaying = true;
    if (typeof PlayerModule !== 'undefined' && GLOBAL.currentTrack) {
      PlayerModule.applyState({
        current_track: GLOBAL.currentTrack,
        is_playing: true,
        current_time: GLOBAL.currentPosition || 0,
        ...(data || {}),
      });
    }
  }

  function handleThumbnailUpdated(msg) {
    if (!msg) return;
    const trackId = Number(msg.track_id);
    const thumbnail = msg.thumbnail || '';
    if (!trackId || !thumbnail) return;

    if (GLOBAL.currentTrack && Number(GLOBAL.currentTrack.id) === trackId) {
      GLOBAL.currentTrack = { ...GLOBAL.currentTrack, thumbnail };
      if (typeof PlayerModule !== 'undefined') {
        PlayerModule.applyState({
          current_track: GLOBAL.currentTrack,
          is_playing: GLOBAL.isPlaying,
          current_time: GLOBAL.currentPosition || 0,
        });
      }
    }

    if (typeof QueueModule !== 'undefined' && typeof QueueModule.loadQueue === 'function') {
      QueueModule.loadQueue();
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    }
  }

  function updateOnlineCount(count) {
    const el = document.getElementById('onlineCount');
    if (el) el.textContent = count;
    const badge = document.getElementById('listenersBadge');
    if (badge) badge.textContent = `${count} online`;
    const info = document.getElementById('infoListeners');
    if (info) info.textContent = count;
    GLOBAL.listenerCount = count;
<<<<<<< HEAD
=======

>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
    if (window.RoomAuthUI && typeof window.RoomAuthUI.refreshListeners === 'function') {
      window.RoomAuthUI.refreshListeners();
    }
  }

<<<<<<< HEAD
  function handleThumbnailUpdated(msg) {
    if (!msg) return;
    const trackId = Number(msg.track_id);
    const thumb = msg.thumbnail || '';
    if (!trackId || !thumb) return;
    if (GLOBAL.currentTrack && Number(GLOBAL.currentTrack.id) === trackId) {
      GLOBAL.currentTrack = { ...GLOBAL.currentTrack, thumbnail: thumb };
      if (typeof PlayerModule !== 'undefined') {
        PlayerModule.applyState({ current_track: GLOBAL.currentTrack });
      }
    }
    if (typeof QueueModule !== 'undefined' && typeof QueueModule.loadQueue === 'function') {
      QueueModule.loadQueue();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
=======
  // ---- Public API ----
>>>>>>> d4dd9ca612c6180feed89c9f9ee3fe56f157947c
  return { connect, sendWS };

})();

window.WSModule = WSModule;
