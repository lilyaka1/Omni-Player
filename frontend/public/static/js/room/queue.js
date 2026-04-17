/**
 * queue.js — Управление очередью треков.
 *
 * Зависимости: globals.js, websocket.js (WSModule.sendWS)
 */

const QueueModule = (function () {

  let _queue = [];

  function trace(step, payload) {
    try {
      if (typeof payload === 'undefined') {
        console.log('[QUEUE-TRACE]', step);
      } else {
        console.log('[QUEUE-TRACE]', step, payload);
      }
    } catch {}
  }

  // ---- Рендер ----

  function setQueue(tracks) {
    _queue = tracks || [];
    GLOBAL.queue = _queue;
    render();
  }

  function render() {
    const list = document.getElementById('queueList');
    if (!list) return;

    if (!_queue.length) {
      list.innerHTML = `<div class="empty-state">
        <i class="fa-solid fa-music"></i>
        <p>Очередь пуста</p>
      </div>`;
      document.dispatchEvent(new CustomEvent('queuechange'));
      return;
    }

    list.innerHTML = _queue.map((track, idx) => {
      const isActive = GLOBAL.currentTrack && GLOBAL.currentTrack.id === track.id;
      return `
        <div class="queue-item ${isActive ? 'active' : ''}" data-id="${track.id}" data-idx="${idx}">
          <div class="queue-thumb">
            ${track.thumbnail
              ? `<img src="${escHtml(track.thumbnail)}" alt="" loading="lazy"
                    onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-music\\'></i>'" />`
              : '<i class="fa-solid fa-music"></i>'
            }
          </div>
          <div class="queue-item-info">
            <div class="queue-item-title">${escHtml(track.title || 'Без названия')}</div>
            <div class="queue-item-dur">${track.duration ? formatTime(track.duration) : '—'}</div>
          </div>
          ${GLOBAL.userRole === 'owner'
            ? `<button class="queue-item-del" data-track-id="${track.id}" title="Удалить">
                <i class="fa-solid fa-xmark"></i>
              </button>`
            : ''}
        </div>
      `;
    }).join('');

    // Клик по треку — переключить
    list.querySelectorAll('.queue-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.queue-item-del')) return;
        const trackId = parseInt(el.dataset.id, 10);
        if (GLOBAL.userRole === 'owner') {
          WSModule.sendWS('track_change', { track_id: trackId });
        }
      });
    });

    // Кнопки удаления
    list.querySelectorAll('.queue-item-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const trackId = parseInt(btn.dataset.trackId, 10);
        await removeTrack(trackId);
      });
    });

    document.dispatchEvent(new CustomEvent('queuechange'));
  }

  // ---- Добавить трек ----

  async function addTrack(url) {
    if (!url || !GLOBAL.roomId) return;
    if (!GLOBAL.token) {
      showToast('Нужно войти, чтобы добавить трек', 'error');
      return;
    }

    try {
      trace('link_received', { roomId: GLOBAL.roomId, url });
      // Build lightweight payload for room queue.
      // stream_url can be empty — backend will prefetch/refresh it asynchronously.
      const source = detectSource(url);
      const sourceTrackId = extractSourceTrackId(url);
      const payload = {
        source,
        source_track_id: sourceTrackId,
        title: inferTitleFromUrl(url, sourceTrackId),
        artist: 'Unknown',
        duration: 0,
        stream_url: '',
        thumbnail: null,
        genre: null,
      };

      trace('queue_add_request', payload);

      const res = await authFetch(`/rooms/${GLOBAL.roomId}/tracks`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const created = await res.json().catch(() => ({}));
        trace('queue_add_success', { status: res.status, trackId: created && created.id });
        showToast('Трек добавлен!', 'success');
        await loadQueue();  // перезагрузить очередь через REST
      } else {
        const err = await res.json().catch(() => ({}));
        trace('queue_add_failed', { status: res.status, detail: err && err.detail });
        showToast(err.detail || 'Ошибка добавления трека', 'error');
      }
    } catch (e) {
      trace('queue_add_exception', { message: e && e.message });
      if (e.message !== 'Unauthorized') showToast('Ошибка сети', 'error');
    }
  }

  function inferTitleFromUrl(url, fallback) {
    try {
      const u = new URL(String(url || ''));
      const last = u.pathname.split('/').filter(Boolean).pop();
      if (last) return decodeURIComponent(last).replace(/[-_]+/g, ' ').trim();
    } catch {}
    return fallback || 'Без названия';
  }

  function detectSource(url) {
    const s = String(url || '').toLowerCase();
    if (s.includes('soundcloud.com')) return 'soundcloud';
    return 'youtube';
  }

  function extractSourceTrackId(url) {
    const s = String(url || '').trim();
    try {
      const u = new URL(s);
      const host = u.hostname.toLowerCase();

      if (host.includes('youtube.com')) {
        const v = u.searchParams.get('v');
        return v ? `https://www.youtube.com/watch?v=${v}` : s;
      }
      if (host.includes('youtu.be')) {
        const id = u.pathname.replace(/^\//, '');
        return id ? `https://www.youtube.com/watch?v=${id}` : s;
      }
      if (host.includes('soundcloud.com')) {
        // Keep full path for provider refresh logic.
        return `${u.origin}${u.pathname}`;
      }
      return s;
    } catch {
      return s;
    }
  }

  // ---- Удалить трек ----

  async function removeTrack(trackId) {
    if (!GLOBAL.roomId || !GLOBAL.token) return;
    try {
      const res = await authFetch(`/rooms/${GLOBAL.roomId}/tracks/${trackId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Трек удалён', '');
        await loadQueue();
      } else {
        showToast('Ошибка удаления', 'error');
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') showToast('Ошибка сети', 'error');
    }
  }

  // ---- Очистить очередь ----

  async function clearQueue() {
    if (!GLOBAL.roomId || !GLOBAL.token) return;
    if (!confirm('Очистить всю очередь?')) return;
    try {
      const res = await authFetch(`/rooms/${GLOBAL.roomId}/tracks`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Очередь очищена', '');
        setQueue([]);
      } else {
        showToast('Ошибка очистки', 'error');
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') showToast('Ошибка сети', 'error');
    }
  }

  // ---- Загрузить очередь через REST ----

  async function loadQueue() {
    if (!GLOBAL.roomId) return;
    try {
      const res = await fetch(`/rooms/${GLOBAL.roomId}/tracks`);
      if (res.ok) {
        const tracks = await res.json();
        trace('queue_loaded', { roomId: GLOBAL.roomId, count: Array.isArray(tracks) ? tracks.length : 0 });
        setQueue(tracks);
      }
    } catch {}
  }

  // ---- Подключение кнопок формы ----

  function bindUI() {
    const addBtn = document.getElementById('addTrackBtn');
    const addInput = document.getElementById('addTrackUrl');
    const clearBtn = document.getElementById('clearQueueBtn');

    addBtn?.addEventListener('click', async () => {
      const url = addInput?.value.trim();
      if (!url) { showToast('Введите ссылку', 'error'); return; }
      addBtn.disabled = true;
      await addTrack(url);
      addBtn.disabled = false;
      if (addInput) addInput.value = '';
    });

    addInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBtn?.click();
    });

    clearBtn?.addEventListener('click', clearQueue);

    // Если не owner — скрыть кнопки управления
    if (GLOBAL.userRole !== 'owner') {
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }

  function init() {
    bindUI();
    loadQueue();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { setQueue, addTrack, removeTrack, loadQueue, render };

})();

window.QueueModule = QueueModule;
