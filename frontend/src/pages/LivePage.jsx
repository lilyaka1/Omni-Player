import { useEffect, useMemo, useRef, useState } from 'react';
import { clearToken, getToken } from '../utils/auth';
import { showToast } from '../utils/toast';

function fmtSec(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

function normalizeTrackMeta(track) {
  const next = { ...(track || {}) };
  const title = String(next.title || '').trim();
  const artist = String(next.artist || '').trim();

  // Always try to split "Artist – Track" from the title, even if artist is already set.
  // This handles cases like "MAYOT – Забывай" where artist may be unknown/empty.
  for (const sep of [' — ', ' – ', ' - ']) {
    if (!title.includes(sep)) continue;
    const [left, ...rest] = title.split(sep);
    const right = rest.join(sep).trim();
    if (left.trim() && right) return { ...next, artist: left.trim(), title: right };
  }

  // Fall back to provided artist if it is meaningful
  const unknownArtists = ['', 'unknown', 'неизвестно', '—', '-'];
  if (!unknownArtists.includes(artist.toLowerCase())) return next;

  return next;
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
  const [inserts, setInserts] = useState([]);
  const [insertText, setInsertText] = useState('');
  const [insertVoice, setInsertVoice] = useState('en_US-libritts-high');
  const [insertAfterTrackId, setInsertAfterTrackId] = useState('');
  const [insertSending, setInsertSending] = useState(false);
  const [ttsStatus, setTtsStatus] = useState(null);
  const wsRef = useRef(null);
  const dragSourceIdRef = useRef(null);
  const lastRoomStateRef = useRef(null);

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
    fetch('/api/voice/status')
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data) setTtsStatus(data);
      })
      .catch(() => {});
  }, []);

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
      setQueue((data.tracks || data || []).map(normalizeTrackMeta));
    } catch {
      // noop
    }
  }

  function getTrackQueueStatus(track) {
    const trackStatus = String(track?.download_status || track?.status || '').toLowerCase();
    const streamUrl = String(track?.stream_url || '').trim();
    const isDownloading = trackStatus
      ? ['pending', 'generating', 'downloading', 'queued'].includes(trackStatus)
      : (!streamUrl || streamUrl === 'pending://local-upload');

    return {
      key: isDownloading ? 'downloading' : 'ready',
      label: isDownloading ? 'Скачивается' : 'Готово',
    };
  }

  function buildRoomTrackPayload(track) {
    return normalizeTrackMeta({
      source: track.source || (track.source_track_id ? 'soundcloud' : 'youtube'),
      source_track_id: track.source_track_id || track.track_page_url || track.page_url || String(track.id || ''),
      title: track.title || 'Без названия',
      artist: track.artist || 'Unknown',
      duration: Number(track.duration) || 0,
      stream_url: track.stream_url || track.url || '',
      thumbnail: track.thumbnail || track.thumb_url || null,
      genre: track.genre || null,
    });
  }

  function isTrackReadyForQueue(track) {
    const status = String(track?.download_status || track?.status || '').toLowerCase();
    const stream = String(track?.stream_url || track?.url || '').trim();
    if (status && ['pending', 'generating', 'downloading', 'queued'].includes(status)) return false;
    if (!stream || stream === 'pending://local-upload') return false;
    return true;
  }

  async function addTrackToEnd(track) {
    if (!selectedRoomId) return;

    if (!isTrackReadyForQueue(track)) {
      showToast('Сначала дождитесь загрузки трека', 'error');
      return;
    }

    const trackId = Number(track?.id);
    const existingIdx = queue.findIndex((item) => Number(item.id) === trackId);

    if (existingIdx >= 0) {
      const nextQueue = [
        ...queue.slice(0, existingIdx),
        ...queue.slice(existingIdx + 1),
        queue[existingIdx],
      ];
      setQueue(nextQueue);
      wsSend({
        type: 'reorder_queue',
        order: nextQueue.map((item) => item.id),
      });
      return;
    }

    const payload = buildRoomTrackPayload(track);
    try {
      const res = await fetch(`/rooms/${selectedRoomId}/tracks`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || 'Ошибка добавления трека', 'error');
        return;
      }

      await loadQueue(selectedRoomId);
      if (searchQuery.trim()) {
        setSearchResults((prev) => prev.filter((item) => Number(item.id) !== trackId));
      }
    } catch {
      showToast('Ошибка сети', 'error');
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
      try { ws.send(JSON.stringify({ type: 'insert_list' })); } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      setRoomStatus('Отключены');
      setInserts([]);
    };

    ws.onmessage = (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'room_state') {
        lastRoomStateRef.current = msg.data || msg;
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
          // started_at — UNIX timestamp от сервера, используем для точной синхронизации
          const startedAt = Number(msg.track.started_at);
          setNowPlaying(msg.track);
          setNowPlayingId(msg.track.id || null);
          setStartedAtMs(
            Number.isFinite(startedAt) && startedAt > 0
              ? startedAt * 1000  // сервер шлёт секунды → JS ожидает миллисекунды
              : Date.now()
          );
          setDurationSec(Number(msg.track.duration) || 0);
          setBroadcastLive(true);
          setStatusText('Статус: активно');
          // Не удаляем текущий трек — очередь показывает все треки, nowPlayingId выделяет играющий
        } else {
          setNowPlaying(null);
          setNowPlayingId(null);
          setStartedAtMs(0);
          setDurationSec(0);
          setBroadcastLive(false);
          setStatusText('Статус: не активно');
        }
      }

      if (msg.type === 'track_change' && msg.data?.current_track) {
        const startedAt = Number(msg.data.current_track.started_at);
        setNowPlaying(msg.data.current_track);
        setNowPlayingId(msg.data.current_track.id || null);
        setStartedAtMs(
          Number.isFinite(startedAt) && startedAt > 0
            ? startedAt * 1000
            : Date.now()
        );
        setDurationSec(Number(msg.data.current_track.duration) || 0);
        // Не удаляем текущий трек — очередь показывает все треки, nowPlayingId выделяет играющий
      }

      if (msg.type === 'queue_updated') {
        // WS-сервер не присылает тело очереди — берём из последнего room_state,
        // или запрашиваем через HTTP
        const lastState = lastRoomStateRef.current;
        if (lastState && Array.isArray(lastState.queue) && lastState.queue.length) {
          setQueue(lastState.queue.map(normalizeTrackMeta));
        } else {
          // Фоллбэк: HTTP запрос очереди
          loadQueue(selectedRoomId);
        }
      }

      if (msg.type === 'queue_reordered' && Array.isArray(msg.queue)) {
        // Обновляем локальную копию очереди из WS payload
        setQueue(msg.queue.map(normalizeTrackMeta));
      }

      if (msg.type === 'thumbnail_updated' && msg.track_id && msg.thumbnail) {
        setQueue((prev) => prev.map((t) => (t.id === msg.track_id ? { ...t, thumbnail: msg.thumbnail } : t)));
        if (msg.track_id === nowPlayingId && nowPlaying) {
          setNowPlaying({ ...nowPlaying, thumbnail: msg.thumbnail });
        }
      }

      // ── Voice insert (TTS) события ─────────────────────────────────
      if (msg.type === 'insert_list' && Array.isArray(msg.inserts)) {
        setInserts(msg.inserts.map((i) => ({
          id: i.id,
          text: i.text,
          status: i.status,
          scheduled_at: i.scheduled_at,
          audio_url: i.audio_url || null,
          duration_sec: i.duration_sec || null,
          play_after_track_id: i.play_after_track_id || null,
        })));
      }

      if (msg.type === 'insert_created' && msg.insert) {
        setInserts((prev) => {
          if (prev.some((p) => p.id === msg.insert.id)) return prev;
          return [...prev, {
            id: msg.insert.id,
            text: msg.insert.text,
            status: msg.insert.status || 'pending',
            scheduled_at: msg.insert.scheduled_at,
            play_after_track_id: msg.insert.play_after_track_id || insertAfterTrackId || null,
          }];
        });
      }

      if (msg.type === 'insert_ready' && msg.insert) {
        setInserts((prev) => prev.map((i) => i.id === msg.insert.id
          ? { ...i, status: 'ready', audio_url: msg.insert.audio_url || i.audio_url, duration_sec: msg.insert.duration_sec || i.duration_sec }
          : i));
      }

      if (msg.type === 'insert_failed' && msg.insert) {
        setInserts((prev) => prev.map((i) => i.id === msg.insert.id
          ? { ...i, status: 'failed', error: msg.insert.error || 'TTS failed' }
          : i));
      }

      if (msg.type === 'insert_timeout' && msg.insert) {
        setInserts((prev) => prev.map((i) => i.id === msg.insert.id
          ? { ...i, status: 'timeout' }
          : i));
      }

      if (msg.type === 'insert_cancelled') {
        const id = msg.insert_id || msg.id;
        if (id) {
          setInserts((prev) => prev.map((i) => i.id === id ? { ...i, status: 'cancelled' } : i));
        }
      }

      if (msg.type === 'insert_cleared') {
        setInserts((prev) => prev.map((i) => (
          ['pending', 'generating', 'ready'].includes(i.status) ? { ...i, status: 'cancelled' } : i
        )));
      }

      if (msg.type === 'voice_insert_status') {
        const id = msg.insert_id;
        const status = msg.status;
        if (id && status) {
          setInserts((prev) => prev.map((i) => i.id === id ? { ...i, status } : i));
        }
      }

      if (msg.type === 'error' && msg.msg) {
        setInserts((prev) => prev);
        // Не критично — просто оповещаем в чате как системку
        // alert(`TTS error: ${msg.msg}`);
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
    return addTrackToEnd(track);
  }

  function sendChat() {
    const content = chatText.trim();
    if (!content) return;
    const ok = wsSend({ type: 'chat', content });
    if (ok) setChatText('');
  }

  // ── Voice insert (TTS) helpers ────────────────────────────────────────
  function sendInsert() {
    const text = insertText.trim();
    if (!text) {
      alert('Введите текст вставки');
      return;
    }
    if (text.length < 2) {
      alert('Минимум 2 символа');
      return;
    }
    if (text.length > 500) {
      alert('Максимум 500 символов');
      return;
    }
    if (!connected) {
      alert('Подключитесь к комнате');
      return;
    }
    setInsertSending(true);
    const ok = wsSend({
      type: 'insert_create',
      text,
      voice_id: insertVoice || 'en_US-libritts-high',
      play_after_track_id: insertAfterTrackId ? Number(insertAfterTrackId) : null,
    });
    if (ok) {
      setInsertText('');
    }
    setTimeout(() => setInsertSending(false), 400);
  }

  function cancelInsert(insertId) {
    if (!insertId) return;
    wsSend({ type: 'insert_cancel', insert_id: insertId });
  }

  function clearAllInserts() {
    if (!connected) return;
    if (!window.confirm('Очистить все активные TTS-вставки?')) return;
    wsSend({ type: 'insert_clear' });
  }

  function previewInsertAudio(audioUrl) {
    if (!audioUrl) return;
    try {
      const audio = new Audio(audioUrl);
      audio.play().catch(() => {});
    } catch {
      // noop
    }
  }

  function insertStatusLabel(status) {
    switch (status) {
      case 'pending': return 'В очереди';
      case 'generating': return 'Генерация…';
      case 'ready': return 'Готова';
      case 'playing': return 'Играет';
      case 'played': return 'Отыграна';
      case 'failed': return 'Ошибка';
      case 'timeout': return 'Таймаут';
      case 'cancelled': return 'Отменена';
      default: return status || '—';
    }
  }

  function queueFlowItems() {
    const activeInserts = inserts.filter((i) => !['cancelled', 'failed', 'timeout'].includes(i.status));
    const attached = new Set();
    const flow = [];
    queue.forEach((track) => {
      flow.push({ kind: 'track', ...track });
      activeInserts
        .filter((ins) => Number(ins.play_after_track_id) === Number(track.id))
        .forEach((ins) => {
          attached.add(ins.id);
          flow.push({ kind: 'insert', ...ins });
        });
    });
    activeInserts
      .filter((ins) => !ins.play_after_track_id || !attached.has(ins.id))
      .forEach((ins) => flow.push({ kind: 'insert', ...ins }));
    return flow;
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

    // Reorder через WebSocket вместо HTTP PUT (который может не поддерживаться)
    try {
      wsSend({
        type: 'reorder_queue',
        order: next.map((t) => t.id),
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


  const searchPanelItems = searchQuery.trim() ? searchResults : queue;
  const isSearchPanelEmpty = searchQuery.trim() ? !searchResults.length : !queue.length;
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
              <h3>Комната</h3>
              {selectedRoomId && currentUser && (
                <button
                  className="btn"
                  style={{ background: '#ff5050', color: '#fff', marginTop: 8, width: '100%' }}
                  onClick={async () => {
                    if (!window.confirm('Удалить эту комнату? Это действие необратимо.')) return;
                    if (!token) return;
                    try {
                      const res = await fetch(`/rooms/${selectedRoomId}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      if (res.ok) {
                        showToast('Комната удалена', 'success');
                        setRooms((prev) => prev.filter((r) => r.id !== Number(selectedRoomId)));
                        setSelectedRoomId('');
                      } else {
                        const err = await res.json().catch(() => ({}));
                        showToast(err.detail || 'Ошибка удаления', 'error');
                      }
                    } catch {
                      showToast('Ошибка сети', 'error');
                    }
                  }}
                >
                  <i className="fa-solid fa-trash-can" /> Удалить комнату
                </button>
              )}
            </section>

            <section className="live-admin-section">
              <h3>Управление комнатой</h3>
              <div className="live-admin-row" style={{ marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <span style={{ fontSize: '0.85rem' }}>Комната активна</span>
                  <input
                    type="checkbox"
                    checked={broadcastLive}
                    onChange={async (e) => {
                      if (e.target.checked) {
                        await doStartStream();
                      } else {
                        await doStopStream();
                      }
                    }}
                    style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                  />
                </label>
              </div>
            </section>

            <section className="live-admin-section">
              <h3>Воспроизведение</h3>
              <div className="live-admin-hint">{statusText}</div>
              <div className="live-admin-row">
                <button className="btn" onClick={doPlay}>Play</button>
                <button className="btn" onClick={doPause}>Pause</button>
              </div>
              <div className="live-admin-row">
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
                {queueFlowItems().map((t) => t.kind === 'insert' ? (
                  <div className={`live-admin-queue-item voice-insert status-${t.status}`} key={`insert-${t.id}`}>
                    <span className="drag"><i className="fa-solid fa-microphone-lines" /></span>
                    <div className="ph"><i className="fa-solid fa-wave-square" /></div>
                    <div className="meta">
                      <div className="title">{t.text}</div>
                      <div className="artist">TTS · {insertStatusLabel(t.status)}{t.duration_sec ? ` · ${Math.round(t.duration_sec)}s` : ''}</div>
                    </div>
                    {t.audio_url && (
                      <button className="btn btn-icon" title="Прослушать" onClick={() => previewInsertAudio(t.audio_url)}>
                        <i className="fa-solid fa-play" />
                      </button>
                    )}
                    {['pending', 'generating', 'ready'].includes(t.status) && (
                      <button className="btn btn-icon" title="Отменить" onClick={() => cancelInsert(t.id)}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    )}
                  </div>
                ) : (
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
                {!searchLoading && isSearchPanelEmpty && (
                  <div className="empty-state">
                    <p>{searchQuery.trim() ? 'Ничего не найдено' : 'Очередь пуста'}</p>
                  </div>
                )}
                {!searchLoading && searchPanelItems.map((t, idx) => {
                  const shown = normalizeTrackMeta(t);
                  const status = getTrackQueueStatus(t);
                  return (
                    <div className="live-admin-result" key={`${shown.id || shown.title}-${idx}`}>
                      <div className="meta">
                        <div className="title">{shown.title}</div>
                        <div className="artist">
                          {shown.artist || '-'}
                          <span className={`live-admin-track-status live-admin-track-status-${status.key}`}>
                            {status.label}
                          </span>
                        </div>
                      </div>
                      <button className="btn" onClick={() => addTrackToEnd(t)}>В конец очереди</button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="live-admin-tts glass glass-secondary">
              <div className="live-admin-tts-head">
                <h3>Голосовые вставки (TTS)</h3>
                {ttsStatus && (
                  <span className={`live-admin-tts-badge ${ttsStatus.rvc_enabled ? 'on' : 'off'}`}>
                    {ttsStatus.rvc_enabled ? 'RVC: вкл' : 'RVC: выкл'}
                    {ttsStatus.device ? ` · ${ttsStatus.device}` : ''}
                  </span>
                )}
              </div>

              <div className="live-admin-row">
                <input
                  className="input"
                  type="text"
                  value={insertText}
                  onChange={(e) => setInsertText(e.target.value)}
                  placeholder="Текст вставки (English, 2–500 символов)"
                  maxLength={500}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendInsert())}
                  disabled={!connected || insertSending}
                />
                <select
                  className="input"
                  value={insertVoice}
                  onChange={(e) => setInsertVoice(e.target.value)}
                  disabled={!connected || insertSending}
                  style={{ maxWidth: 180 }}
                >
                  <option value="en_US-libritts-high">en_US-libritts-high</option>
                </select>
                <select
                  className="input"
                  value={insertAfterTrackId}
                  onChange={(e) => setInsertAfterTrackId(e.target.value)}
                  disabled={!connected || insertSending}
                  style={{ maxWidth: 220 }}
                  title="Позиция в очереди"
                >
                  <option value="">В конец / без привязки</option>
                  {queue.map((t) => (
                    <option key={t.id} value={t.id}>После: {t.title}</option>
                  ))}
                </select>
                <button
                  className="btn btn-accent"
                  onClick={sendInsert}
                  disabled={!connected || insertSending || !insertText.trim()}
                >
                  Отправить
                </button>
              </div>

              <div className="live-admin-tts-meta">
                <span className="live-admin-hint">{insertText.length}/500</span>
                <button
                  className="btn"
                  onClick={clearAllInserts}
                  disabled={!connected || !inserts.some((i) => ['pending', 'generating', 'ready'].includes(i.status))}
                >
                  Очистить активные
                </button>
              </div>

              <div className="live-admin-tts-list">
                {!inserts.length && <div className="empty-state"><p>Пока нет вставок</p></div>}
                {inserts.map((ins) => {
                  const canCancel = ['pending', 'generating', 'ready'].includes(ins.status);
                  const canPlay = ins.audio_url && ['ready', 'playing', 'played'].includes(ins.status);
                  return (
                    <div className={`live-admin-tts-item status-${ins.status}`} key={ins.id}>
                      <div className="meta">
                        <div className="title">{ins.text}</div>
                        <div className="artist">
                          {insertStatusLabel(ins.status)}
                          {ins.duration_sec ? ` · ${Math.round(ins.duration_sec)}s` : ''}
                          {ins.error ? ` · ${ins.error}` : ''}
                        </div>
                      </div>
                      {canPlay && (
                        <button
                          className="btn btn-icon"
                          title="Прослушать"
                          onClick={() => previewInsertAudio(ins.audio_url)}
                        >
                          <i className="fa-solid fa-play" />
                        </button>
                      )}
                      {canCancel && (
                        <button
                          className="btn btn-icon"
                          title="Отменить"
                          onClick={() => cancelInsert(ins.id)}
                        >
                          <i className="fa-solid fa-xmark" />
                        </button>
                      )}
                    </div>
                  );
                })}
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
      {!connected && selectedRoomId && <div className="room-id-hint"></div>}
    </div>
  );
}
