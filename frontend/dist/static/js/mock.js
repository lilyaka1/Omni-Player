/**
 * mock.js — перехват fetch() и WebSocket для работы без бэкенда.
 * Подключается ПЕРВЫМ скриптом на всех страницах.
 * Удалите этот файл и его <script> теги когда бэкенд будет готов.
 */

// ---- Фиктивные данные ----

if (!localStorage.getItem('token')) {
  localStorage.setItem('token', 'mock-token-preview');
}

const MOCK_USER = {
  id: 1, username: 'SilverYare', email: 'demo@omniplayer.app',
  is_admin: false, can_create_rooms: true
};

const MOCK_ROOMS = [
  { id: 1, name: 'Lo-Fi Chill',     description: 'Расслабляющий поток',  is_public: true,  owner_id: 1, listener_count: 7 },
  { id: 2, name: 'Hip-Hop Cypher',  description: 'Бит за битом',         is_public: true,  owner_id: 2, listener_count: 12 },
  { id: 3, name: 'Phonk Drive',     description: 'Ночная езда',           is_public: true,  owner_id: 1, listener_count: 4 },
  { id: 4, name: 'Indie Vibes',     description: 'Независимая сцена',     is_public: true,  owner_id: 3, listener_count: 2 },
  { id: 5, name: 'Jazz Club',       description: 'Живая импровизация',    is_public: false, owner_id: 2, listener_count: 5 },
  { id: 6, name: 'Trap Session',    description: 'Heavy 808s',            is_public: true,  owner_id: 1, listener_count: 9 },
  { id: 7, name: 'Ambient Space',   description: 'Звуки космоса',         is_public: true,  owner_id: 3, listener_count: 1 },
  { id: 8, name: 'R&B Sundown',     description: 'Вечерние ритмы',        is_public: true,  owner_id: 2, listener_count: 3 },
];

const MOCK_TRACKS = [
  { id: 1, title: 'Blinding Lights',  artist: 'The Weeknd',        duration: 200, thumbnail: null, source: 'youtube',     url: '' },
  { id: 2, title: 'SICKO MODE',       artist: 'Travis Scott',      duration: 312, thumbnail: null, source: 'youtube',     url: '' },
  { id: 3, title: 'Runaway',          artist: 'Kanye West',        duration: 559, thumbnail: null, source: 'soundcloud',  url: '' },
  { id: 4, title: 'Bad Guy',          artist: 'Billie Eilish',     duration: 194, thumbnail: null, source: 'youtube',     url: '' },
  { id: 5, title: 'Redbone',          artist: 'Childish Gambino',  duration: 327, thumbnail: null, source: 'soundcloud',  url: '' },
];

// Очередь — отдельная копия чтобы можно было изменять
const MOCK_QUEUE = MOCK_TRACKS.map(t => ({...t}));

const MOCK_SEARCH = {
  youtube: { tracks: [
    { id: 'dQw4w9WgXcQ', title: 'Rick Astley — Never Gonna Give You Up', duration: 213, thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg', page_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', source: 'youtube' },
    { id: 'kJQP7kiw5Fk', title: 'Luis Fonsi — Despacito ft. Daddy Yankee',  duration: 229, thumbnail: 'https://img.youtube.com/vi/kJQP7kiw5Fk/mqdefault.jpg', page_url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk', source: 'youtube' },
    { id: '9bZkp7q19f0', title: 'PSY — GANGNAM STYLE',                       duration: 252, thumbnail: 'https://img.youtube.com/vi/9bZkp7q19f0/mqdefault.jpg', page_url: 'https://www.youtube.com/watch?v=9bZkp7q19f0', source: 'youtube' },
    { id: 'JGwWNGJdvx8', title: 'Ed Sheeran — Shape of You',                 duration: 234, thumbnail: 'https://img.youtube.com/vi/JGwWNGJdvx8/mqdefault.jpg', page_url: 'https://www.youtube.com/watch?v=JGwWNGJdvx8', source: 'youtube' },
  ]},
  soundcloud: { tracks: [
    { id: '111', title: 'Kanye West — Heartless',          duration: 213, thumbnail: null, track_page_url: 'https://soundcloud.com/kanyewest/heartless',          source: 'soundcloud' },
    { id: '222', title: 'Frank Ocean — Thinking Bout You', duration: 200, thumbnail: null, track_page_url: 'https://soundcloud.com/frankocean/thinking-bout-you', source: 'soundcloud' },
    { id: '333', title: 'Tyler, The Creator — EARFQUAKE', duration: 187, thumbnail: null, track_page_url: 'https://soundcloud.com/tylerthecreator/earfquake',     source: 'soundcloud' },
  ]}
};

const MOCK_USERS = [
  { id: 1, username: 'SilverYare' },
  { id: 2, username: 'DJ_Phantom' },
  { id: 3, username: 'LucidDreamer' },
];

const MOCK_ROOM_STATE = {
  current_track: { ...MOCK_TRACKS[0] },
  is_playing: false,
  position: 0,
  queue: MOCK_QUEUE,
  users: 3,
  role: 'owner'
};

// ---- Перехват fetch ----

const _realFetch = window.fetch.bind(window);

window.fetch = async function(url, options = {}) {
  const urlStr = typeof url === 'string' ? url : url.toString();
  const path   = urlStr.split('?')[0].replace(/\/+$/, '');
  const method = (options.method || 'GET').toUpperCase();

  await delay(80); // имитация сетевой задержки

  // Auth
  if (path.endsWith('/auth/login')    && method === 'POST') return ok({ access_token: 'mock-token-preview', token_type: 'bearer' });
  if (path.endsWith('/auth/register') && method === 'POST') return ok({ id: 1, username: 'demo' });
  if (path.endsWith('/auth/me'))                            return ok(MOCK_USER);

  // Rooms list
  if (/\/rooms$/.test(path) && method === 'GET')  return ok(MOCK_ROOMS);
  if (/\/rooms$/.test(path) && method === 'POST') {
    const b = body(options.body);
    const r = { id: Date.now() % 10000, listener_count: 0, is_public: true, owner_id: 1, owner_username: 'SilverYare', ...b };
    MOCK_ROOMS.push(r);
    return ok(r);
  }
  if (/\/rooms\/my\/rooms/.test(path))   return ok(MOCK_ROOMS.filter(r => r.owner_id === 1));

  // Single room
  if (/\/rooms\/\d+$/.test(path) && method === 'GET') {
    const id = +path.split('/').pop();
    const r  = MOCK_ROOMS.find(r => r.id === id) || { id, name: `Комната #${id}`, is_public: true, owner_id: 1 };
    return ok({ owner_username: 'SilverYare', ...r });
  }
  if (/\/rooms\/\d+\/playback-state/.test(path)) return ok(MOCK_ROOM_STATE);

  // Tracks / Queue
  if (/\/rooms\/\d+\/tracks$/.test(path) && method === 'GET')    return ok(MOCK_QUEUE);
  if (/\/rooms\/\d+\/tracks$/.test(path) && method === 'DELETE') { MOCK_QUEUE.length = 0; return ok({}); }
  if (/\/rooms\/\d+\/tracks$/.test(path) && method === 'POST') {
    const b = body(options.body);
    const t = { id: Date.now(), title: 'Новый трек', duration: 180, source: 'youtube', thumbnail: null, url: b.url || '' };
    MOCK_QUEUE.push(t);
    return ok(t);
  }
  if (/\/rooms\/\d+\/tracks\/\d+$/.test(path) && method === 'DELETE') {
    const tid = +path.split('/').pop();
    const i   = MOCK_QUEUE.findIndex(t => t.id === tid);
    if (i !== -1) MOCK_QUEUE.splice(i, 1);
    return ok({});
  }
  if (/\/rooms\/\d+\/tracks\/\d+\/refresh-url/.test(path))  return ok({ stream_url: '' });
  if (/\/rooms\/\d+\/users/.test(path))                     return ok(MOCK_USERS);
  if (/\/rooms\/\d+\/join/.test(path))                      return ok({});
  if (/\/rooms\/\d+\/leave/.test(path))                     return ok({});

  // Library
  if (/\/api\/player\/library$/.test(path) && method === 'GET')  return ok(MOCK_TRACKS);
  if (/\/api\/player\/library$/.test(path) && method === 'POST') {
    const b = body(options.body);
    const t = { id: Date.now(), title: decodeTitle(b.url), duration: 210, source: 'youtube', thumbnail: null, url: b.url };
    MOCK_TRACKS.push(t);
    return ok(t);
  }
  if (/\/api\/player\/library\/\d+$/.test(path) && method === 'DELETE') {
    const tid = +path.split('/').pop();
    const i   = MOCK_TRACKS.findIndex(t => t.id === tid);
    if (i !== -1) MOCK_TRACKS.splice(i, 1);
    return ok({});
  }

  // Search
  if (urlStr.includes('/stream/search/youtube'))    return ok(MOCK_SEARCH.youtube);
  if (urlStr.includes('/stream/search/soundcloud')) return ok(MOCK_SEARCH.soundcloud);

  // Live stream
  if (/\/stream\/room\/\d+\/status/.test(path)) return ok({ active: false });
  if (/\/stream\/room\/\d+\/start/.test(path))  return ok({ active: true });
  if (/\/stream\/room\/\d+\/stop/.test(path))   return ok({ active: false });

  // Всё остальное
  return ok({ detail: 'mock: not found' }, 404);
};

// ---- Перехват WebSocket ----

class MockWebSocket {
  constructor(url) {
    this.url  = url;
    this.readyState = 0;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen && this.onopen({});

      // Начальное состояние комнаты
      this._send({ type: 'room_state', data: { ...MOCK_ROOM_STATE, queue: MOCK_QUEUE.map(t=>({...t})) } });
      this._send({ type: 'user_count', count: 3 });

      // Приветственное чат-сообщение
      setTimeout(() => this._send({ type: 'chat', username: 'DJ_Phantom',    message: 'всем привет! 🎵', timestamp: now() }), 800);
      setTimeout(() => this._send({ type: 'chat', username: 'LucidDreamer',  message: 'огонь трек', timestamp: now() }), 2200);
    }, 120);
  }

  send(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'ping') return; // pong не нужен для mock

    if (msg.type === 'playback_control') {
      const { action, position } = msg;
      if (action === 'play') {
        MOCK_ROOM_STATE.is_playing = true;
        setTimeout(() => this._send({ type: 'room_state', data: { ...MOCK_ROOM_STATE } }), 80);
      }
      if (action === 'pause') {
        MOCK_ROOM_STATE.is_playing = false;
        setTimeout(() => this._send({ type: 'room_state', data: { ...MOCK_ROOM_STATE } }), 80);
      }
      if (action === 'next') {
        const next = MOCK_TRACKS[1] || MOCK_TRACKS[0];
        MOCK_ROOM_STATE.current_track = { ...next };
        MOCK_ROOM_STATE.is_playing = true;
        MOCK_ROOM_STATE.position = 0;
        setTimeout(() => this._send({ type: 'track_change', data: { current_track: { ...next }, is_playing: true, position: 0 } }), 80);
      }
      if (action === 'seek') {
        MOCK_ROOM_STATE.position = position || 0;
        setTimeout(() => this._send({ type: 'room_state', data: { ...MOCK_ROOM_STATE } }), 80);
      }
    }

    if (msg.type === 'chat') {
      // Эхо нашего сообщения
      setTimeout(() => this._send({ type: 'chat', username: MOCK_USER.username, message: msg.message, timestamp: now() }), 60);
    }

    if (msg.type === 'track_change') {
      const t = MOCK_QUEUE.find(t => t.id === msg.track_id) || MOCK_TRACKS[0];
      MOCK_ROOM_STATE.current_track = { ...t };
      setTimeout(() => this._send({ type: 'track_change', data: { current_track: { ...t }, is_playing: true, position: 0 } }), 80);
    }
  }

  close() { this.readyState = 3; this.onclose && this.onclose({ code: 1000 }); }

  _send(data) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }
}

// Заменяем глобальный WebSocket
window._OriginalWebSocket = window.WebSocket;
window.WebSocket = MockWebSocket;

// ---- Вспомогательные функции ----

function ok(data, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  }));
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function body(raw) { try { return JSON.parse(raw); } catch { return {}; } }
function now() { return new Date().toISOString(); }
function decodeTitle(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/-/g,' ') || 'Трек'; }
  catch { return 'Трек'; }
}

console.log('%c[MOCK MODE] Фронтенд работает без бэкенда', 'color:#a89cff;font-weight:700;font-size:13px;');
