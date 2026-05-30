/**
 * websocket.js — WebSocket соединение и диспетчер сообщений.
 * MVP RADIO-MODE: никакого is_playing inference, hasIsPlaying, player.applyState
 * с grace window. Только чистый current_track → play.
 *
 * Зависимости: globals.js (GLOBAL, showToast)
 */

const WSModule = (function () {

  let _lifecycleBound = false;
  let _isConnecting = false;
  let _wsCooldownUntil = 0;
  let _pendingMessages = [];
  let _lastMessageAt = 0;
  let _watchdogTimer = null;
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

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.hostname;
    const port = String(location.port || '');
    const isLocalHost = host === '127.0.0.1' || host === 'localhost';
    const isViteDevPort = port === '5173' || port === '5174' || port === '5175';
    const base = (isLocalHost && isViteDevPort) ? `${proto}://${host}:5173` : `${proto}://${location.host}`;
    const token = GLOBAL.token ? `?token=${encodeURIComponent(GLOBAL.token)}` : '';
    const url = `${base}/ws/rooms/${GLOBAL.roomId}${token}`;

    console.log('[WS] Подключение к', url);
    const ws = new WebSocket(url);
    GLOBAL.ws = ws;

    ws.onopen = () => {
      _isConnecting = false;
      _lastMessageAt = Date.now();
      console.log('[WS] Соединение установлено');
      GLOBAL._wsReconnectDelay = 2000;
      clearTimeout(GLOBAL._wsReconnectTimer);
      flushPendingMessages();
      startWatchdog();
      ws._pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
          _lastMessageAt = Date.now();
        }
      }, 25000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      _lastMessageAt = Date.now();
      dispatch(msg);
    };

    ws.onerror = () => {
      _isConnecting = false;
      if (document.hidden || ws.__intentionalClose) return;
      console.warn('[WS] Ошибка соединения, будет переподключение');
    };

    ws.onclose = (ev) => {
      _isConnecting = false;
      const intentionalClose = Boolean(ws.__intentionalClose);
      if (intentionalClose) {
        clearInterval(ws._pingInterval);
        GLOBAL.ws = null;
        return;
      }
      clearInterval(ws._pingInterval);
      GLOBAL.ws = null;
      scheduleReconnect();
    };
  }

  // ── Watchdog ────────────────────────────────────────────────────────────
  function startWatchdog() {
    if (_watchdogTimer) return;
    _watchdogTimer = setInterval(() => {
      if (document.hidden || document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const ws = GLOBAL.ws;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        clearTimeout(GLOBAL._wsReconnectTimer);
        GLOBAL._wsReconnectDelay = 1200;
        connect();
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      const silentForMs = Date.now() - (_lastMessageAt || 0);
      if (silentForMs > _staleTimeoutMs) {
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

  // ── Reconnect ───────────────────────────────────────────────────────────
  function scheduleReconnect() {
    if (document.hidden || document.visibilityState !== 'visible') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const delay = GLOBAL._wsReconnectDelay;
    console.log(`[WS] Переподключение через ${delay}мс...`);
    GLOBAL._wsReconnectTimer = setTimeout(() => {
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
      if (document.hidden || document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { closeIfOpen('offline'); return; }
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

  function sendWS(type, data) {
    const payload = { type, ...data };

    if (!GLOBAL.ws || GLOBAL.ws.readyState !== WebSocket.OPEN) {
      if (_pendingMessages.length > 20) _pendingMessages.shift();
      _pendingMessages.push(payload);
      if (!GLOBAL.ws || GLOBAL.ws.readyState === WebSocket.CLOSED) {
        clearTimeout(GLOBAL._wsReconnectTimer);
        GLOBAL._wsReconnectDelay = 800;
        connect();
      }
      console.warn('[WS] Не подключён, сообщение поставлено в очередь:', type);
      return false;
    }

    GLOBAL.ws.send(JSON.stringify(payload));
    return true;
  }

  // ── Dispatch ───────────────────────────────────────────────────────────
  function dispatch(msg) {
    switch (msg.type) {

      case 'room_state':
        handleRoomState(msg.data);
        break;

      case 'track_change':
        handleTrackChange(msg.data);
        break;

      case 'track_changed':
        handleTrackChanged(msg);
        break;

      case 'track_sync':
        handleTrackSync(msg);
        break;

      case 'queue_updated':
        if (typeof QueueModule !== 'undefined') {
          if (Array.isArray(msg.data)) {
            QueueModule.setQueue(msg.data);
          } else {
            QueueModule.loadQueue();
          }
        }
        break;

      case 'chat':
        if (typeof ChatModule !== 'undefined') ChatModule.appendMessage(msg);
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
        break;

      case 'playback_started':
        GLOBAL.isPlaying = true;
        // Обновляем UI если есть PlayerModule
        if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.applyState === 'function') {
          PlayerModule.applyState({ is_playing: true, current_track: GLOBAL.currentTrack });
        }
        break;

      case 'thumbnail_updated':
        handleThumbnailUpdated(msg);
        break;

      default:
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
    const incomingRole = String(data.user_role || data.role || '').toLowerCase();
    if (incomingRole.includes('admin') || incomingRole.includes('owner')) {
      GLOBAL.userRole = 'owner';
    } else if (incomingRole.includes('user') || incomingRole.includes('listener')) {
      GLOBAL.userRole = 'listener';
    }
    // Online count
    updateOnlineCount(data.users || 0);
  }

  function handleTrackChange(data) {
    if (!data) return;
    const track = data.current_track || data.track || null;
    const isPlaying = data.is_playing;
    setGlobalFromTrack(track, isPlaying);
    if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.applyState === 'function') {
      PlayerModule.applyState(data);
    }
  }

  function handleTrackChanged(msg) {
    const track = msg.track || (msg.data && (msg.data.current_track || msg.data.track)) || null;
    const base = msg.data || {};
    const normalized = {
      ...base,
      current_track: track,
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
    if (window.RoomAuthUI && typeof window.RoomAuthUI.refreshListeners === 'function') {
      window.RoomAuthUI.refreshListeners();
    }
  }

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
  return { connect, sendWS };

})();

window.WSModule = WSModule;
