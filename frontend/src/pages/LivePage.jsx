import { useEffect, useMemo, useRef, useState } from 'react';
import { clearToken, getToken } from '../utils/auth';

function fmtSec(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

export default function LivePage() {
  const initialRoomId = useMemo(() => new URLSearchParams(window.location.search).get('room_id'), []);
  const [token, setToken] = useState(getToken());
  const [currentUser, setCurrentUser] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState(initialRoomId || '');
  const [connected, setConnected] = useState(false);
  const [roomStatus, setRoomStatus] = useState('Не подключены');
  const [broadcastLive, setBroadcastLive] = useState(false);
  const [statusText, setStatusText] = useState('Статус: не активно');
  const [queue, setQueue] = useState([]);
  const [nowPlayingId, setNowPlayingId] = useState(null);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [startedAtMs, setStartedAtMs] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const wsRef = useRef(null);
  const dragSourceIdRef = useRef(null);

  useEffect(() => {
    // Всегда загружаем комнаты (не требуют авторизации)
    fetch('/rooms/')
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const allRooms = data.rooms || data;
        setRooms(Array.isArray(allRooms) ? allRooms : []);
      })
      .catch(() => {});

    // Если есть токен - загружаем юзера
    if (!token) return;

    fetch('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) {
          clearToken();
          setToken(null);
          return;
        }
        const user = await res.json();
        setCurrentUser(user);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!selectedRoomId) return;
    checkStatus(selectedRoomId);
    loadQueue(selectedRoomId);
  }, [selectedRoomId]);

  useEffect(() => {
    if (!startedAtMs) {
      setElapsedSec(0);
      return undefined;
    }

    const tick = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAtMs]);

  useEffect(() => () => {
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(1000, 'live-page-unmount'); } catch {}
    }
  }, []);

  function authHeaders(withJson = false) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (withJson) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async function checkStatus(roomId) {
    if (!roomId) return;
    try {
      const res = await fetch(`/stream/room/${roomId}/status`);
      if (!res.ok) return;
      const data = await res.json();
      const isLive = !!(data.live || data.active || data.is_active);
      setBroadcastLive(isLive);
      setStatusText(isLive ? 'Статус: активно' : 'Статус: не активно');
    } catch {
      // noop
    }
  }

  async function loadQueue(roomId) {
    if (!roomId || !token) return;
    try {
      const res = await fetch(`/stream/queue/${roomId}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setQueue(data.tracks || data || []);
    } catch {
      // noop
    }
  }

  async function createRoom() {
    if (!token) {
      window.location.replace('/login');
      return;
    }
    const name = window.prompt('Название:');
    if (!name || !name.trim()) return;

    try {
      const res = await fetch('/rooms/', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ name: name.trim(), description: '' }),
      });
      if (!res.ok) return;
      const room = await res.json();
      setRooms((prev) => [...prev, room]);
      setSelectedRoomId(String(room.id));
    } catch {
      // noop
    }
  }

  function onRoomState(data) {
    const state = data?.data || data;
    if (!state) return;

    if (state.current_track) {
      setNowPlaying(state.current_track);
      setNowPlayingId(state.current_track.id || null);
      setDurationSec(Number(state.current_track.duration) || 0);
      setStartedAtMs(Date.now() - (Number(state.position) || 0) * 1000);
    }

    if (!state.current_track && !state.is_playing) {
      setStartedAtMs(0);
      setDurationSec(0);
    }

    if (typeof state.is_playing === 'boolean') {
      setBroadcastLive(state.is_playing);
      setStatusText(state.is_playing ? 'Статус: активно' : 'Статус: не активно');
    }
  }

  function connectRoom() {
    const roomId = Number(selectedRoomId);
    if (!roomId) {
      alert('Выберите комнату');
      return;
    }
    if (!token) {
      window.location.replace('/login');
      return;
    }

    const prev = wsRef.current;
    if (prev && (prev.readyState === WebSocket.OPEN || prev.readyState === WebSocket.CONNECTING)) {
      try { prev.close(1000, 'reconnect'); } catch {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/rooms/${roomId}?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setRoomStatus(`Подключены: комната ${roomId}`);
      loadQueue(roomId);
    };

    ws.onclose = () => {
      setConnected(false);
      setRoomStatus('Отключены');
    };

    ws.onmessage = (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'room_state') {
        onRoomState(msg);
      }

      if (msg.type === 'chat') {
        setChatMessages((prev) => [...prev, { user: msg.user || '?', content: msg.content || '' }]);
      }

      if (msg.type === 'chat_history' && Array.isArray(msg.messages)) {
        setChatMessages(msg.messages.map((m) => ({ user: m.username || m.user || '?', content: m.message || m.content || '' })));
      }

      if (msg.type === 'track_changed') {
        if (msg.track) {
          setNowPlaying(msg.track);
          setNowPlayingId(msg.track.id || null);
          setStartedAtMs(Date.now());
          setDurationSec(Number(msg.track.duration) || 0);
          setBroadcastLive(true);
          setStatusText('Статус: активно');
        } else {
          setNowPlaying(null);
          setNowPlayingId(null);
          setStartedAtMs(0);
          setDurationSec(0);
          setBroadcastLive(false);
          setStatusText('Статус: не активно');
        }
        loadQueue(roomId);
      }

      if (msg.type === 'track_change' && msg.data?.current_track) {
        setNowPlaying(msg.data.current_track);
        setNowPlayingId(msg.data.current_track.id || null);
        setStartedAtMs(Date.now());
        setDurationSec(Number(msg.data.current_track.duration) || 0);
        loadQueue(roomId);
      }

      if (msg.type === 'queue_updated') {
        loadQueue(roomId);
      }

      if (msg.type === 'thumbnail_updated' && msg.track_id && msg.thumbnail) {
        setQueue((prev) => prev.map((t) => (t.id === msg.track_id ? { ...t, thumbnail: msg.thumbnail } : t)));
        if (msg.track_id === nowPlayingId && nowPlaying) {
          setNowPlaying({ ...nowPlaying, thumbnail: msg.thumbnail });
        }
      }
    };
  }

  function wsSend(payload) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert('Подключитесь к комнате');
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }

  function selectTrack(trackId) {
    const ok = wsSend({ type: 'playback_control', action: 'play', track_id: trackId });
    if (!ok) return;
    setNowPlayingId(trackId);
    const localTrack = queue.find((t) => t.id === trackId);
    if (localTrack) {
      setNowPlaying(localTrack);
      setStartedAtMs(Date.now());
      setDurationSec(Number(localTrack.duration) || 0);
    }
    setBroadcastLive(true);
    setStatusText('Статус: активно');
  }

  async function deleteTrack(trackId) {
    if (!selectedRoomId || !token) return;
    try {
      await fetch(`/rooms/${selectedRoomId}/tracks/${trackId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setQueue((prev) => prev.filter((t) => t.id !== trackId));
    } catch {
      // noop
    }
  }

  async function clearQueue() {
    if (!selectedRoomId || !token) return;
    if (!window.confirm('Удалить все треки из очереди?')) return;
    try {
      await fetch(`/rooms/${selectedRoomId}/tracks`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setQueue([]);
      setNowPlaying(null);
      setNowPlayingId(null);
      setBroadcastLive(false);
      setStartedAtMs(0);
      setDurationSec(0);
      setStatusText('Статус: не активно');
    } catch {
      // noop
    }
  }

  function skipNext() {
    if (!queue.length) {
      alert('Нет треков в очереди');
      return;
    }
    const currentIdx = queue.findIndex((t) => t.id === nowPlayingId);
    const next = queue[currentIdx + 1] || queue[0];
    if (next) selectTrack(next.id);
  }

  async function doPlay() {
    if (!selectedRoomId) {
      alert('Подключитесь к комнате');
      return;
    }

    if (!nowPlayingId && queue.length) {
      selectTrack(queue[0].id);
      return;
    }

    if (!nowPlayingId) {
      alert('Добавьте треки в очередь');
      return;
    }

    wsSend({ type: 'playback_control', action: 'play', track_id: nowPlayingId });
    setBroadcastLive(true);
    setStatusText('Статус: активно');
  }

  function doPause() {
    wsSend({ type: 'playback_control', action: 'pause' });
    setBroadcastLive(false);
    setStatusText('Статус: не активно');
  }

  async function doStartStream() {
    if (!token) {
      window.location.replace('/login');
      return;
    }
    if (!selectedRoomId) return;

    try {
      const res = await fetch(`/stream/room/${selectedRoomId}/start`, {
        method: 'POST',
        headers: authHeaders(),
      });

      if (res.ok) {
        checkStatus(selectedRoomId);
      } else if (res.status === 404 || res.status === 405) {
        setStatusText('Статус: управление запуском из комнаты');
      }
    } catch {
      // noop
    }
  }

  async function doStopStream() {
    if (!token || !selectedRoomId) return;
    try {
      const res = await fetch(`/stream/room/${selectedRoomId}/stop`, {
        method: 'POST',
        headers: authHeaders(),
      });

      if (res.ok) {
        checkStatus(selectedRoomId);
      } else if (res.status === 404 || res.status === 405) {
        setStatusText('Статус: остановка из комнаты');
      }
    } catch {
      // noop
    }
  }

  async function doSearch() {
    const q = searchQuery.trim();
    if (!q) return;

    setSearchLoading(true);
    try {
      const res = await fetch(`/stream/search/soundcloud?query=${encodeURIComponent(q)}&limit=20`, {
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      setSearchResults(data.tracks || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  function addToQueue(track) {
    const trackToSend = {
      ...track,
      source_track_id: track.track_page_url || track.source_track_id || String(track.id || ''),
    };
    const ok = wsSend({ type: 'track_change', track: trackToSend });
    if (ok) {
      setTimeout(() => loadQueue(selectedRoomId), 700);
    }
  }

  function sendChat() {
    const content = chatText.trim();
    if (!content) return;
    const ok = wsSend({ type: 'chat', content });
    if (ok) setChatText('');
  }

  function onDragStart(trackId) {
    dragSourceIdRef.current = trackId;
  }

  async function onDrop(targetId) {
    const sourceId = dragSourceIdRef.current;
    if (!sourceId || sourceId === targetId) return;

    const srcIdx = queue.findIndex((t) => t.id === sourceId);
    const dstIdx = queue.findIndex((t) => t.id === targetId);
    if (srcIdx < 0 || dstIdx < 0) return;

    const next = [...queue];
    const [moved] = next.splice(srcIdx, 1);
    next.splice(dstIdx, 0, moved);
    setQueue(next);

    try {
      await fetch(`/rooms/${selectedRoomId}/tracks/reorder`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ order: next.map((t) => t.id) }),
      });
    } catch {
      // noop
    }
  }

  function doLogout() {
    clearToken();
    setToken(null);
    window.location.replace('/login');
  }

  if (!token) {
    return (
      <div className="live-page">
        <div className="glass glass-primary live-card">
          <h1>Live Admin</h1>
          <p>Для доступа к админ-панели нужна авторизация.</p>
          <button className="btn btn-accent" onClick={() => window.location.replace('/login')}>Войти</button>
        </div>
      </div>
    );
  }

  return (
    <div className="live-page live-admin-page">
      <div className="live-admin-shell glass glass-primary">
        <header className="live-admin-header">
          <h1>Omni Player - Admin</h1>
          <div className="live-admin-user">
            <span>{currentUser?.username || 'Пользователь'}</span>
            <button className="btn btn-accent" onClick={doLogout}>Выйти</button>
          </div>
        </header>

        <div className="live-admin-main">
          <aside className="live-admin-left">
            <section className="live-admin-section">
              <h3>Комната</h3>
              <select className="input" value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)}>
                <option value="">- выберите -</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <div className="live-admin-row">
                <button className="btn" onClick={connectRoom}>Подключиться</button>
                <button className="btn btn-accent" onClick={createRoom}>+ Создать</button>
              </div>
              <div className="live-admin-hint">{roomStatus}</div>
            </section>

            <section className="live-admin-section">
              <h3>Воспроизведение</h3>
              <div className="live-admin-hint">{statusText}</div>
              <div className="live-admin-row">
                <button className="btn" onClick={doPlay}>Play</button>
                <button className="btn" onClick={doPause}>Pause</button>
              </div>
              <div className="live-admin-row">
                {!broadcastLive && <button className="btn btn-accent" onClick={doStartStream}>Начать трансляцию</button>}
                {broadcastLive && <button className="btn" onClick={doStopStream}>Остановить трансляцию</button>}
                <button className="btn" onClick={skipNext}>Следующий</button>
              </div>
            </section>

            <section className="live-admin-section live-admin-queue">
              <div className="live-admin-queue-head">
                <h3>Очередь ({queue.length})</h3>
                <button className="btn" onClick={clearQueue}>Очистить</button>
              </div>
              <div className="live-admin-queue-list">
                {!queue.length && <div className="empty-state"><p>Очередь пуста</p></div>}
                {queue.map((t) => (
                  <div
                    key={t.id}
                    className={`live-admin-queue-item ${t.id === nowPlayingId ? 'playing' : ''}`}
                    draggable
                    onDragStart={() => onDragStart(t.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(t.id)}
                  >
                    <span className="drag">☰</span>
                    {t.thumbnail ? <img src={t.thumbnail} alt="" /> : <div className="ph">🎵</div>}
                    <div className="meta">
                      <div className="title">{t.title}</div>
                      <div className="artist">{t.artist || '-'}</div>
                    </div>
                    <button className="btn btn-icon" onClick={() => selectTrack(t.id)}><i className="fa-solid fa-play" /></button>
                    <button className="btn btn-icon" onClick={() => deleteTrack(t.id)}><i className="fa-solid fa-xmark" /></button>
                  </div>
                ))}
              </div>
            </section>
          </aside>

          <section className="live-admin-right">
            <div className="live-admin-now glass glass-secondary">
              {nowPlaying?.thumbnail ? <img className="cover" src={nowPlaying.thumbnail} alt="" /> : <div className="cover ph">🎵</div>}
              <div className="np-meta">
                <div className="np-title">{nowPlaying?.title || 'Ничего не играет'}</div>
                <div className="np-artist">{nowPlaying?.artist || '-'}</div>
                <div className="np-extra">{nowPlaying?.genre || ''}</div>
                <div className="np-time">{startedAtMs ? `${fmtSec(elapsedSec)}${durationSec ? ` / ${fmtSec(durationSec)}` : ''}` : ''}</div>
              </div>
            </div>

            <div className="live-admin-search glass glass-secondary">
              <div className="live-admin-row">
                <input
                  className="input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск на SoundCloud..."
                  onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                />
                <button className="btn btn-accent" onClick={doSearch}>Найти</button>
              </div>

              <div className="live-admin-results">
                {searchLoading && <div className="empty-state"><p>Поиск...</p></div>}
                {!searchLoading && !searchResults.length && <div className="empty-state"><p>Введите запрос для поиска</p></div>}
                {!searchLoading && searchResults.map((t, idx) => (
                  <div className="live-admin-result" key={`${t.title}-${idx}`}>
                    <div className="meta">
                      <div className="title">{t.title}</div>
                      <div className="artist">{t.artist || '-'}</div>
                    </div>
                    <button className="btn" onClick={() => addToQueue(t)}>+ В очередь</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="live-admin-chat glass glass-secondary">
              <div className="live-admin-chat-messages">
                {!chatMessages.length && <div className="empty-state"><p>Начните разговор</p></div>}
                {chatMessages.map((m, idx) => (
                  <div className="msg" key={`${m.user}-${idx}`}>
                    <span className="u">{m.user}:</span> {m.content}
                  </div>
                ))}
              </div>
              <div className="live-admin-row">
                <input
                  className="input"
                  type="text"
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Сообщение..."
                  onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                />
                <button className="btn btn-accent" onClick={sendChat}>Отправить</button>
              </div>
            </div>
          </section>
        </div>
      </div>
      {!connected && selectedRoomId && <div className="room-id-hint">Подключитесь к комнате для управления через WebSocket</div>}
    </div>
  );
}
