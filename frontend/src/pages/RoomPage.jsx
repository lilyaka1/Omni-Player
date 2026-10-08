import { useEffect, useMemo, useRef, useState } from 'react';
import RoomLobby from '../components/RoomLobby';
import Equalizer from '../components/Equalizer';
import { getToken } from '../utils/auth';
import { createRoomWebSocket } from '../utils/roomWebSocket';
import { showToast } from '../utils/toast';

function normalizeTrack(track) {
  const next = { ...(track || {}) };
  const title = String(next.title || '').trim();
  const artist = String(next.artist || '').trim();
  if (artist && !['unknown', '-', '—'].includes(artist.toLowerCase())) return next;

  for (const separator of [' — ', ' – ', ' - ']) {
    if (!title.includes(separator)) continue;
    const [left, ...rest] = title.split(separator);
    const right = rest.join(separator).trim();
    if (left.trim() && right) return { ...next, artist: left.trim(), title: right };
  }
  return next;
}

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function roomIdFromUrl() {
  return new URLSearchParams(window.location.search).get('room_id');
}

export default function RoomPage() {
  const roomId = useMemo(roomIdFromUrl, []);
  const token = getToken();
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('listener');
  const [queue, setQueue] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [listeners, setListeners] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState('');
  const [trackUrl, setTrackUrl] = useState('');
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const audioRef = useRef(null);
  const currentTrackIdRef = useRef(null);

  const canControl = role === 'owner' || role === 'admin';
  const authHeaders = { Authorization: `Bearer ${token}` };

  async function loadRoom() {
    const response = await fetch(`/rooms/${roomId}`);
    if (!response.ok) throw new Error('Комната не найдена');
    const data = await response.json();
    setRoom(data);
    document.title = `${data.name || 'Комната'} - Omni Player`;
  }

  async function loadListeners() {
    const response = await fetch(`/rooms/${roomId}/users`);
    if (!response.ok) return;
    const data = await response.json();
    setListeners(Array.isArray(data) ? data : data.users || []);
  }

  function applySnapshot(snapshot) {
    const data = snapshot?.data || snapshot || {};
    if (Array.isArray(data.queue)) setQueue(data.queue.map(normalizeTrack));
    if (data.current_track !== undefined) setCurrentTrack(data.current_track ? normalizeTrack(data.current_track) : null);
    if (typeof data.is_playing === 'boolean') setIsPlaying(data.is_playing);
    if (data.position !== undefined) setPosition(Number(data.position) || 0);
    if (data.user_role) {
      const nextRole = String(data.user_role).toLowerCase();
      setRole(nextRole.includes('admin') || nextRole.includes('owner') ? 'owner' : 'listener');
    }
  }

  useEffect(() => {
    if (!joined || !roomId || !token) return undefined;
    let cancelled = false;

    (async () => {
      try {
        await fetch(`/rooms/${roomId}/join`, { method: 'POST', headers: authHeaders });
        const [roomResponse, userResponse] = await Promise.all([
          fetch(`/rooms/${roomId}`),
          fetch('/auth/me', { headers: authHeaders }),
        ]);
        if (cancelled) return;
        if (roomResponse.ok) {
          const data = await roomResponse.json();
          setRoom(data);
          document.title = `${data.name || 'Комната'} - Omni Player`;
        }
        if (userResponse.ok) setUser(await userResponse.json());
        await loadListeners();
      } catch {
        if (!cancelled) showToast('Не удалось загрузить комнату', 'error');
      }
    })();

    const websocket = createRoomWebSocket({
      roomId,
      token,
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onMessage: (data, message) => {
        if (message.type === 'room_state' || message.type === 'track_change' || message.type === 'track_changed') {
        applySnapshot(data);
        }
        if (message.type === 'queue_updated' || message.type === 'queue_reordered') {
        if (Array.isArray(data.queue)) setQueue(data.queue.map(normalizeTrack));
        }
        if (message.type === 'chat') {
        setChatMessages((previous) => [...previous, data]);
        }
        if (message.type === 'chat_history') {
        setChatMessages(Array.isArray(data) ? data : data.messages || []);
        }
        if (message.type === 'user_count') loadListeners();
      },
    });
    wsRef.current = websocket;

    return () => {
      cancelled = true;
      websocket.close('room-page-unmount');
      fetch(`/rooms/${roomId}/leave`, { method: 'POST', keepalive: true, headers: authHeaders }).catch(() => {});
    };
  }, [joined, roomId, token]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    const trackId = Number(currentTrack.id);
    if (currentTrackIdRef.current !== trackId) {
      currentTrackIdRef.current = trackId;
      audio.src = `/stream/room/${roomId}/stream?track=${trackId}&t=${Date.now()}`;
      audio.load();
    }
    if (isPlaying) {
      audio.play().catch(() => showToast('Нажмите Play, чтобы разрешить воспроизведение', 'error'));
    } else {
      audio.pause();
    }
  }, [currentTrack, isPlaying, roomId]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = setInterval(() => {
      const audio = audioRef.current;
      if (audio && !audio.paused) setPosition(audio.currentTime);
      else setPosition((value) => value + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isPlaying]);

  function send(type, payload = {}) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      showToast('Подключение к комнате недоступно', 'error');
      return false;
    }
    wsRef.current.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  function control(action, extra = {}) {
    if (canControl) send('playback_control', { action, ...extra });
  }

  function addTrack() {
    const url = trackUrl.trim();
    if (!url) return;
    let source = 'youtube';
    if (url.toLowerCase().includes('soundcloud.com')) source = 'soundcloud';
    const payload = {
      source,
      source_track_id: url,
      title: url.split('/').filter(Boolean).pop() || 'Без названия',
      artist: 'Unknown',
      duration: 0,
      stream_url: '',
      thumbnail: null,
      genre: null,
    };
    fetch(`/rooms/${roomId}/tracks`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((response) => {
      if (!response.ok) throw new Error();
      setTrackUrl('');
      showToast('Трек добавлен', 'success');
    }).catch(() => showToast('Не удалось добавить трек', 'error'));
  }

  function removeTrack(trackId) {
    fetch(`/rooms/${roomId}/tracks/${trackId}`, { method: 'DELETE', headers: authHeaders })
      .then(() => setQueue((items) => items.filter((item) => item.id !== trackId)));
  }

  function clearQueue() {
    if (!window.confirm('Очистить всю очередь?')) return;
    fetch(`/rooms/${roomId}/tracks`, { method: 'DELETE', headers: authHeaders })
      .then(() => setQueue([]));
  }

  function sendChat() {
    const content = chatText.trim();
    if (content && send('chat', { content })) setChatText('');
  }

  if (!joined) {
    return <RoomLobby roomId={roomId} onBack={() => { window.location.href = '/'; }} onJoin={() => setJoined(true)} />;
  }

  return (
    <div className="room-page">
      <div className="room-topbar glass glass-secondary glass-refract">
        <button className="topbar-back glass-tertiary" onClick={() => { window.location.href = '/'; }}><i className="fa-solid fa-arrow-left" /></button>
        <div className="topbar-title">{room?.name || 'Комната'}</div>
        <div className="topbar-online"><span className="online-dot" />{listeners.length} online</div>
        <Equalizer audioRef={audioRef} />
        <button className="topbar-back glass-tertiary" id="themeToggle" title="Переключить тему"><i className="fa-solid fa-moon" id="themeIcon" /></button>
      </div>

      <div className="room-layout">
        <main className="room-left">
          <section className="glass glass-primary player-card">
            <div className={`artwork-container ${isPlaying ? 'spinning' : ''}`}>
              <div className="artwork-img">
                {currentTrack?.thumbnail ? <img src={currentTrack.thumbnail} alt="" /> : <div className="artwork-placeholder-icon"><i className="fa-solid fa-music" /></div>}
              </div>
            </div>
            <div className="track-info">
              <div className="track-title">{currentTrack?.title || 'Нет треков в очереди'}</div>
              <div className="track-artist text-secondary">{currentTrack?.artist || '-'}</div>
            </div>
            <div className="progress-section">
              <div className="progress-times"><span>{formatTime(position)}</span><span>{formatTime(currentTrack?.duration)}</span></div>
              <div className="progress-bar-wrap"><div className="progress-bar-fill" style={{ width: `${currentTrack?.duration ? Math.min(100, (position / currentTrack.duration) * 100) : 0}%` }} /></div>
            </div>
            <div className="controls">
              <button className="ctrl-btn ctrl-btn-sm" disabled={!canControl} onClick={() => control('seek', { seek_position: 0 })}><i className="fa-solid fa-backward-step" /></button>
              <button className="ctrl-btn ctrl-btn-lg" disabled={!canControl} onClick={() => control(isPlaying ? 'pause' : 'play')}><i className={`fa-solid fa-${isPlaying ? 'pause' : 'play'}`} /></button>
              <button className="ctrl-btn ctrl-btn-sm" disabled={!canControl} onClick={() => control('next')}><i className="fa-solid fa-forward-step" /></button>
            </div>
            <div className="volume-row"><i className="fa-solid fa-volume-low" /><input className="volume-slider" type="range" min="0" max="100" defaultValue="80" onChange={(event) => { if (audioRef.current) audioRef.current.volume = Number(event.target.value) / 100; }} /><i className="fa-solid fa-volume-high" /></div>
            <audio id="audioPlayer" ref={audioRef} preload="none" />
          </section>

          <section className="glass glass-secondary coverflow-section">
            <div className="coverflow-stage-wrap"><div className="coverflow-stage">
              {[-2, -1, 0, 1, 2].map((offset) => {
                const index = queue.findIndex((track) => track.id === currentTrack?.id) + offset;
                const track = queue[index];
                return <div className={`cf-cover ${track ? '' : 'cf-cover-empty'}`} data-pos={offset} key={offset}><div className="cf-cover-img">{track?.thumbnail ? <img src={track.thumbnail} alt="" /> : <i className="fa-solid fa-music" />}</div></div>;
              })}
            </div></div>
            <div className="cf-info"><div className="cf-title">{currentTrack?.title || 'Нет треков в очереди'}</div><div className="cf-artist">{currentTrack?.artist || 'Добавьте треки'}</div></div>
          </section>
        </main>

        <aside className="room-right">
          <section className="glass glass-secondary queue-panel">
            <div className="panel-header"><div className="panel-title"><i className="fa-solid fa-list-music" /> Очередь</div>{canControl && <button className="btn btn-icon" onClick={clearQueue}><i className="fa-solid fa-trash-can" /></button>}</div>
            <div className="queue-list">
              {!queue.length && <div className="empty-state"><i className="fa-solid fa-music" /><p>Очередь пуста</p></div>}
              {queue.map((track) => (
                <div className={`queue-item ${currentTrack?.id === track.id ? 'active' : ''}`} key={track.id} onClick={() => canControl && send('track_change', { track_id: track.id })}>
                  <div className="queue-thumb">{track.thumbnail ? <img src={track.thumbnail} alt="" /> : <i className="fa-solid fa-music" />}</div>
                  <div className="queue-item-info"><div className="queue-item-title">{track.title || 'Без названия'}</div><div className="queue-item-dur">{formatTime(track.duration)}</div></div>
                  {canControl && <button className="queue-item-del" onClick={(event) => { event.stopPropagation(); removeTrack(track.id); }}><i className="fa-solid fa-xmark" /></button>}
                </div>
              ))}
            </div>
            {canControl && <div className="add-track-row"><input className="input" value={trackUrl} onChange={(event) => setTrackUrl(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addTrack()} placeholder="Ссылка YouTube/SoundCloud" /><button className="btn btn-accent" onClick={addTrack}><i className="fa-solid fa-plus" /></button></div>}
          </section>

          <section className="glass glass-secondary chat-panel">
            <div className="panel-header"><div className="panel-title"><i className="fa-solid fa-comments" /> Чат комнаты</div></div>
            <div className="chat-messages">{!chatMessages.length && <div className="empty-state"><p>Начните разговор</p></div>}{chatMessages.map((message, index) => <div className="chat-msg" key={`${message.id || index}-${index}`}><div className="chat-avatar">{(message.user || message.username || '?')[0].toUpperCase()}</div><div className="chat-bubble"><div className="chat-meta"><span className="chat-username">{message.user || message.username || 'Аноним'}</span></div><div className="chat-text">{message.content || message.message}</div></div></div>)}</div>
            <div className="chat-input-row"><input className="input" value={chatText} onChange={(event) => setChatText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sendChat()} placeholder="Сообщение..." /><button className="btn btn-accent btn-icon" onClick={sendChat}><i className="fa-solid fa-paper-plane" /></button></div>
          </section>

          <section className="glass glass-secondary listeners-panel">
            <div className="panel-header"><div className="panel-title"><i className="fa-solid fa-headphones" /> Слушатели</div><span className="badge">{listeners.length} online</span></div>
            <div className="listeners-list">{!listeners.length && <div className="empty-state"><p>Нет слушателей</p></div>}{listeners.map((listener) => <div className="listener-item" key={listener.id}><div className="listener-avatar">{(listener.username || '?')[0].toUpperCase()}</div><div className="listener-name">{listener.username || 'Аноним'}</div><span className="listener-role role-user">User</span></div>)}</div>
          </section>
          <section className="glass glass-secondary room-info-bar"><div className="info-pill glass-tertiary"><i className="fa-solid fa-crown" /> <span>{room?.creator_username || room?.creator_id || 'Host'}</span></div><div className="info-pill glass-tertiary"><i className="fa-solid fa-globe" /> <span>{room?.room_type === 'private' ? 'Приватная' : 'Публичная'}</span></div><div className="info-pill glass-tertiary"><i className="fa-solid fa-headphones" /> <span>{listeners.length}</span></div></section>
        </aside>
      </div>
    </div>
  );
}
