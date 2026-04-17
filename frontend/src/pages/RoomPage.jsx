import { useEffect } from 'react';
import { loadScriptsSequentially } from '../legacy/utils/scripts';

const roomScriptUrls = [
  '/static/js/room/globals.js?v=20260406',
  '/static/js/room/websocket.js?v=20260406',
  '/static/js/room/auth-ui.js?v=20260406',
  '/static/js/room/stream.js?v=20260406',
  '/static/js/room/player.js?v=20260406',
  '/static/js/room/queue.js?v=20260406',
  '/static/js/room/chat.js?v=20260406',
  '/static/js/room/equalizer.js?v=20260406',
  '/static/js/room/equalizer-ui.js?v=20260406',
];

export default function RoomPage() {
  useEffect(() => {
    let cancelled = false;

    async function initRoom() {
      await loadScriptsSequentially(roomScriptUrls);
      if (cancelled) return;

      const cfStage = document.getElementById('coverflowStage');
      if (!cfStage) return;

      function getCFData() {
        const items = (typeof window.GLOBAL !== 'undefined' && Array.isArray(window.GLOBAL.queue)) ? window.GLOBAL.queue : [];
        let current = 0;
        if (window.GLOBAL?.currentTrack && items.length) {
          const idx = items.findIndex((t) => t.id === window.GLOBAL.currentTrack.id);
          if (idx >= 0) current = idx;
        }
        return { items, current };
      }

      function renderCF() {
        const { items, current } = getCFData();
        if (!items.length) {
          cfStage.innerHTML = '<div class="cf-cover" data-pos="0" style="cursor:default;"><div class="cf-cover-img"><i class="fa-solid fa-music"></i></div></div>';
          const t = document.getElementById('cfTitle');
          const a = document.getElementById('cfArtist');
          if (t) t.textContent = 'Нет треков в очереди';
          if (a) a.textContent = 'Добавьте треки →';
          return;
        }

        cfStage.innerHTML = [-2, -1, 0, 1, 2].map((pos) => {
          const idx = current + pos;
          if (idx < 0 || idx >= items.length) return `<div class="cf-cover cf-cover-empty" data-pos="${pos}"></div>`;

          const item = items[idx];
          const thumb = item.thumb_url || item.thumbnail || null;
          const img = thumb ? `<img src="${thumb}" alt="" />` : '<i class="fa-solid fa-music"></i>';
          const safe = (item.title || '').replace(/"/g, '&quot;');
          return `<div class="cf-cover" data-pos="${pos}" onclick="window.__cfClick(${pos})" title="${safe}"><div class="cf-cover-img">${img}</div></div>`;
        }).join('');

        const cur = items[current];
        if (cur) {
          const t = document.getElementById('cfTitle');
          const a = document.getElementById('cfArtist');
          if (t) t.textContent = cur.title || '—';
          if (a) a.textContent = cur.artist || cur.uploader || '—';
        }
      }

      window.__cfClick = function cfClick(pos) {
        if (pos === 0 || typeof window.PlayerModule === 'undefined') return;
        const fn = pos < 0 ? () => window.PlayerModule.prevTrack() : () => window.PlayerModule.nextTrack();
        const steps = Math.abs(pos);
        for (let i = 0; i < steps; i += 1) fn();
      };

      document.addEventListener('queuechange', renderCF);
      document.addEventListener('trackchange', renderCF);
      renderCF();

      document.getElementById('eqToggleBtn')?.addEventListener('click', () => {
        const p = document.getElementById('eqPanel');
        if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
      });
    }

    initRoom().catch((err) => console.error('Room init failed', err));

    return () => {
      cancelled = true;
      if (window.GLOBAL?.ws && (window.GLOBAL.ws.readyState === WebSocket.OPEN || window.GLOBAL.ws.readyState === WebSocket.CONNECTING)) {
        window.GLOBAL.ws.__intentionalClose = true;
        try { window.GLOBAL.ws.close(1000, 'room-page-unmount'); } catch {}
      }
      if (window.GLOBAL?._wsReconnectTimer) {
        clearTimeout(window.GLOBAL._wsReconnectTimer);
      }
      delete window.__cfClick;
    };
  }, []);

  return (
    <>
      <div id="toast-container" />

      <div className="room-topbar glass glass-secondary glass-refract">
        <button className="topbar-back glass-tertiary" onClick={() => (window.location.href = '/')}>
          <i className="fa-solid fa-arrow-left" />
        </button>
        <div className="topbar-title" id="roomNameTitle">Загрузка...</div>
        <div className="topbar-online"><div className="online-dot" /><span id="onlineCount">0</span> online</div>
        <button className="eq-toggle-btn glass-tertiary" id="eqToggleBtn"><i className="fa-solid fa-sliders" /> EQ</button>
        <button className="topbar-back glass-tertiary" id="themeToggle" title="Переключить тему"><i className="fa-solid fa-moon" id="themeIcon" /></button>
      </div>

      <div className="room-layout">
        <div className="room-left">
          <div className="glass glass-primary player-card">
            <div className="artwork-container" id="artworkContainer">
              <div className="artwork-img" id="artworkBox"><div className="artwork-placeholder-icon"><i className="fa-solid fa-music" /></div></div>
            </div>

            <div className="track-info">
              <div className="track-title" id="trackTitle">Нет треков в очереди</div>
              <div className="track-artist text-secondary" id="trackArtist">—</div>
            </div>

            <div className="progress-section" style={{ width: '100%', maxWidth: 380 }}>
              <div className="progress-times"><span id="timeCurrent">0:00</span><span id="timeDuration">0:00</span></div>
              <div className="progress-bar-wrap" id="progressWrap"><div className="progress-bar-fill" id="progressFill" style={{ width: '0%' }} /></div>
            </div>

            <div className="controls">
              <button className="ctrl-btn ctrl-btn-sm" id="btnPrev" title="Предыдущий"><i className="fa-solid fa-backward-step" /></button>
              <button className="ctrl-btn ctrl-btn-md" id="btnSeekBack" title="-10с"><i className="fa-solid fa-rotate-left" /></button>
              <button className="ctrl-btn ctrl-btn-lg" id="btnPlayPause"><i className="fa-solid fa-play" id="playIcon" /></button>
              <button className="ctrl-btn ctrl-btn-md" id="btnSeekFwd" title="+10с"><i className="fa-solid fa-rotate-right" /></button>
              <button className="ctrl-btn ctrl-btn-sm" id="btnNext" title="Следующий"><i className="fa-solid fa-forward-step" /></button>
            </div>

            <div className="volume-row" style={{ maxWidth: 280, width: '100%' }}>
              <i className="fa-solid fa-volume-low" />
              <input type="range" className="volume-slider" id="volumeSlider" min="0" max="100" defaultValue="80" />
              <i className="fa-solid fa-volume-high" />
            </div>
          </div>

          <div className="glass glass-secondary coverflow-section" id="coverflowSection">
            <div className="coverflow-stage-wrap"><div className="coverflow-stage" id="coverflowStage"><div className="cf-cover" data-pos="0"><div className="cf-cover-img"><i className="fa-solid fa-music" /></div></div></div></div>
            <div className="cf-info"><div className="cf-title" id="cfTitle">Нет треков в очереди</div><div className="cf-artist" id="cfArtist">Добавьте треки →</div></div>
          </div>
        </div>

        <div className="room-right">
          <div className="glass glass-secondary queue-panel">
            <div className="panel-header">
              <div className="panel-title"><i className="fa-solid fa-list-music" /> Очередь</div>
              <button className="btn btn-icon glass-tertiary" id="clearQueueBtn" title="Очистить очередь" style={{ width: 30, height: 30, fontSize: '0.75rem' }}><i className="fa-solid fa-trash-can" /></button>
            </div>

            <div className="queue-list" id="queueList"><div className="empty-state"><i className="fa-solid fa-music" /><p>Очередь пуста</p></div></div>
            <div className="add-track-row"><input className="input" type="text" id="addTrackUrl" placeholder="Вставьте ссылку YouTube/SoundCloud" /><button className="btn btn-accent" id="addTrackBtn"><i className="fa-solid fa-plus" /></button></div>
          </div>

          <div className="glass glass-secondary chat-panel">
            <div className="panel-header" style={{ marginBottom: 10 }}><div className="panel-title"><i className="fa-solid fa-comments" /> Чат комнаты</div></div>
            <div className="chat-messages" id="chatMessages"><div className="empty-state" style={{ padding: 20 }}><i className="fa-solid fa-comments" /><p>Начните разговор</p></div></div>
            <div className="chat-input-row"><input className="input" type="text" id="chatInput" placeholder="Сообщение..." maxLength="500" /><button className="btn btn-accent btn-icon" id="chatSendBtn" title="Отправить"><i className="fa-solid fa-paper-plane" /></button></div>
          </div>

          <div className="glass glass-secondary listeners-panel">
            <div className="panel-header"><div className="panel-title"><i className="fa-solid fa-headphones" /> Слушатели</div><span className="badge glass-tertiary" id="listenersBadge">0 online</span></div>
            <div className="listeners-list" id="listenersList"><div className="empty-state" style={{ padding: 10 }}><i className="fa-solid fa-user-slash" /><p>Нет слушателей</p></div></div>
          </div>

          <div className="glass glass-secondary room-info-bar" id="roomInfoBar">
            <div className="info-pill glass-tertiary"><i className="fa-solid fa-crown" /> <span id="infoHost">—</span></div>
            <div className="info-pill glass-tertiary"><i className="fa-solid fa-globe" /> <span id="infoPrivacy">—</span></div>
            <div className="info-pill glass-tertiary"><i className="fa-solid fa-headphones" /> <span id="infoListeners">0</span></div>
          </div>
        </div>
      </div>

      <div id="eqPanel" style={{ display: 'none', position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 500, padding: '20px 24px', minWidth: 360 }} />
      <audio id="audioPlayer" preload="none" />
    </>
  );
}
