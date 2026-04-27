/**
 * websocket.js — WebSocket соединение и диспетчер сообщений.
 *
 * Зависимости: globals.js (GLOBAL, showToast)
 *              player.js (PlayerModule) — опционально
 *              queue.js  (QueueModule)  — опционально
 *              chat.js   (ChatModule)   — опционально
 */

const WSModule = (function () {

  let _lifecycleBound = false;
  let _isConnecting = false;
  let _wsCooldownUntil = 0;
  let _pendingMessages = [];
  let _lastMessageAt = 0;
  let _watchdogTimer = null;
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
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.hostname;
    const port = String(location.port || '');
    const isLocalHost = host === '127.0.0.1' || host === 'localhost';
    const isViteDevPort = port === '5173' || port === '5174' || port === '5175';

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

    const ws = new WebSocket(url);
    GLOBAL.ws = ws;

    ws.onopen = () => {
      _isConnecting = false;
      _lastMessageAt = Date.now();
      console.log('[WS] Соединение установлено');
      if (typeof roomTrace === 'function') roomTrace('ws.open', { roomId: GLOBAL.roomId });
      GLOBAL._wsReconnectDelay = 2000;
      clearTimeout(GLOBAL._wsReconnectTimer);
      flushPendingMessages();
      startWatchdog();
      startStateResync();
      // Keep-alive ping каждые 25с
      ws._pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      _lastMessageAt = Date.now();
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
      console.warn('[WS] Ошибка соединения, будет переподключение');
    };

    ws.onclose = (ev) => {
      _isConnecting = false;
      const intentionalClose = Boolean(ws.__intentionalClose);
      if (intentionalClose) {
        clearInterval(ws._pingInterval);
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
      GLOBAL.ws = null;
      scheduleReconnect();
    };
  }

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
      if (silentForMs > 20000) {
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
      if (document.hidden || document.visibilityState !== 'visible') {
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        closeIfOpen('offline');
        return;
      }
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

  function dispatch(msg) {
    switch (msg.type) {

      case 'room_state':
        handleRoomState(msg.data);
        break;

      case 'track_change':
        handleTrackChange(msg.data);
        break;

      case 'track_changed':
        handleTrackChangedLegacy(msg);
        break;

      case 'queue_updated':
        if (typeof QueueModule !== 'undefined') {
          if (Array.isArray(msg.data)) {
            QueueModule.setQueue(msg.data);
          } else {
            // Backend often sends incremental payload {track_added, queue_position}.
            // Reload full queue instead of wiping it with a non-array payload.
            QueueModule.loadQueue();
          }
        }
        break;

      case 'chat':
        if (typeof ChatModule !== 'undefined') {
          ChatModule.appendMessage(msg);
        }
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
        // keep-alive ответ, игнорируем
        break;

      case 'playback_started':
        handlePlaybackStarted(msg.data || msg);
        break;

      case 'thumbnail_updated':
        handleThumbnailUpdated(msg);
        break;

      default:
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

    GLOBAL.currentTrack = data.current_track || data.track || null;
    GLOBAL.isPlaying = inferPlayingFromPayload(data, hasIsPlaying);
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
    const incomingRole = String(data.user_role || data.role || '').toLowerCase();
    if (incomingRole.includes('admin') || incomingRole.includes('owner')) {
      GLOBAL.userRole = 'owner';
    } else if (incomingRole.includes('user') || incomingRole.includes('listener')) {
      GLOBAL.userRole = 'listener';
    }

    if (typeof PlayerModule !== 'undefined') {
      PlayerModule.applyState(data);
    }

    // Do not clobber queue if room_state does not carry full queue payload.
    if (typeof QueueModule !== 'undefined' && Array.isArray(data.queue)) {
      QueueModule.setQueue(data.queue || []);
    } else if (typeof QueueModule !== 'undefined' && (!GLOBAL.queue || !GLOBAL.queue.length)) {
      QueueModule.loadQueue();
    }

    updateOnlineCount(data.users || 0);
  }

  function handleTrackChange(data) {
    if (!data) return;
    cancelDelayedTrackApply();
    _trackMetaHoldUntil = 0;
    const hasIsPlaying = Object.prototype.hasOwnProperty.call(data, 'is_playing')
      || Object.prototype.hasOwnProperty.call(data, 'playing');
    const hasPosition = Object.prototype.hasOwnProperty.call(data, 'position')
      || Object.prototype.hasOwnProperty.call(data, 'current_time');

    GLOBAL.currentTrack = data.current_track || data.track || null;
    GLOBAL.isPlaying = inferPlayingFromPayload(data, hasIsPlaying);
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
  }

  function handleTrackChangedLegacy(msg) {
    const track = msg.track || (msg.data && (msg.data.current_track || msg.data.track)) || null;
    const base = msg.data || {};
    const normalized = {
      ...base,
      current_track: track,
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

  // ---- Public API ----
  return { connect, sendWS };

})();

window.WSModule = WSModule;
