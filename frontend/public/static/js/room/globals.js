/**
 * globals.js — Глобальное состояние приложения комнаты.
 * Все модули читают и пишут сюда через объект GLOBAL.
 */

var GLOBAL = window.GLOBAL || {
  // Идентификатор комнаты (берётся из query-параметра ?room_id=)
  roomId: null,

  // JWT-токен из localStorage (с миграцией legacy access_token)
  token: (function readToken() {
    const legacy = localStorage.getItem('access_token');
    const current = localStorage.getItem('token') || legacy;
    if (!localStorage.getItem('token') && legacy) {
      localStorage.setItem('token', legacy);
      localStorage.removeItem('access_token');
    }
    return current;
  })(),

  // Данные текущего пользователя (загружаются через /auth/me)
  currentUser: null,

  // Роль пользователя в комнате: 'owner' | 'listener'
  userRole: 'listener',

  // Воспроизведение
  isPlaying: false,
  currentPosition: 0,
  currentDuration: 0,

  // Текущий трек
  currentTrack: null,

  // Очередь треков
  queue: [],

  // WebSocket соединение
  ws: null,

  // Reconnect timer
  _wsReconnectTimer: null,
  _wsReconnectDelay: 2000,  // ms, grows on repeated failures

  // Базовый URL API
  API_BASE: '',  // пустая строка = относительный путь (FastAPI на том же origin)
};

window.GLOBAL = GLOBAL;

// ---- Room trace logs ----
window.ROOM_TRACE = window.ROOM_TRACE || [];

function roomTrace(event, payload) {
  const entry = {
    ts: new Date().toISOString(),
    roomId: GLOBAL.roomId || null,
    event: String(event || 'unknown'),
    payload: payload || {},
  };
  window.ROOM_TRACE.push(entry);
  if (window.ROOM_TRACE.length > 500) {
    window.ROOM_TRACE.splice(0, window.ROOM_TRACE.length - 500);
  }
  try {
    console.log('[ROOM-TRACE]', entry.ts, entry.event, entry.payload);
  } catch {
    console.log('[ROOM-TRACE]', entry.ts, entry.event);
  }
  return entry;
}

window.roomTrace = roomTrace;
window.dumpRoomTrace = function dumpRoomTrace() {
  const rows = window.ROOM_TRACE.map((e) => ({
    ts: e.ts,
    roomId: e.roomId,
    event: e.event,
    payload: JSON.stringify(e.payload || {}),
  }));
  console.table(rows);
  return rows;
};

// ---- Утилиты ----

/**
 * Безопасное экранирование HTML (для отрисовки данных из сети).
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Форматирование секунд в MM:SS.
 */
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Показ всплывающего уведомления (Toast).
 * @param {string} msg
 * @param {'success'|'error'|''} type
 */
function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type || ''}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

/**
 * Авторизованный fetch: добавляет Bearer токен и обрабатывает 401.
 */
async function authFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (GLOBAL.token) {
    headers['Authorization'] = `Bearer ${GLOBAL.token}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return res;
}

// ---- Считать roomId из URL ----
(function readRoomId() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('room_id');
  if (id) {
    GLOBAL.roomId = parseInt(id, 10);
  }
})();
