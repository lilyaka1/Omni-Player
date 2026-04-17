    // ---- Toast ----
    function showToast(msg, type) {
      const c = document.getElementById('toast-container');
      const t = document.createElement('div');
      t.className = `toast ${type || ''}`;
      t.textContent = msg;
      c.appendChild(t);
      setTimeout(() => { t.style.animation='toastOut .3s ease forwards'; setTimeout(()=>t.remove(),300); }, 3500);
    }

    // ---- Auth guard ----
    // Поддержка legacy-ключа access_token, чтобы не зациклиться после старого логина.
    const legacyToken = localStorage.getItem('access_token');
    const storedToken = localStorage.getItem('token');
    const token = storedToken || legacyToken;

    if (!storedToken && legacyToken) {
      localStorage.setItem('token', legacyToken);
      localStorage.removeItem('access_token');
    }

    if (!token) {
      window.location.replace('/login');
    }

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function formatTime(s) {
      if (!s) return '—';
      const m = Math.floor(s/60), sec = Math.floor(s%60);
      return `${m}:${sec.toString().padStart(2,'0')}`;
    }

    async function authFetch(url, opts={}) {
      const headers = {'Content-Type':'application/json', ...opts.headers};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, {...opts, headers});
      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('access_token');
        window.location.replace('/login');
        throw new Error('Unauthorized');
      }
      return res;
    }

    // ---- Library ----
    let libraryTracks = [];
    let localTracks = [];

    function normalizeLibraryTrack(item) {
      // Backend returns either flat track objects or {track, user_data} items.
      const t = item && item.track ? item.track : item;
      if (!t || typeof t !== 'object') return null;
      const isLocal = t.source === 'local';
      return {
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        thumbnail: t.thumbnail || t.thumbnail_url || null,
        source: t.source,
        isLocal,
        playUrl: isLocal ? `/api/player/audio/${t.id}?token=${encodeURIComponent(token || '')}` : null,
      };
    }

    async function loadLibrary() {
      try {
        const res = await authFetch('/api/player/library');
        if (res.ok) {
          const payload = await res.json();
          const raw = Array.isArray(payload) ? payload : (payload.tracks || []);
          libraryTracks = raw.map(normalizeLibraryTrack).filter(Boolean);
          renderLibrary();
        }
      } catch {}
    }

    function renderLibrary() {
      const list = document.getElementById('libraryList');
      const badge = document.getElementById('libCount');
      const allTracks = [...localTracks, ...libraryTracks];
      if (badge) badge.textContent = allTracks.length;
      if (!allTracks.length) {
        list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-music"></i><p>Библиотека пуста</p></div>`;
        return;
      }
      list.innerHTML = allTracks.map(t => `
        <div class="track-item" data-id="${t.id}" data-local="${t.isLocal ? '1' : '0'}">
          <div class="track-thumb">
            ${t.thumbnail
              ? `<img src="${escHtml(t.thumbnail)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-music\\'></i>'">`
              : '<i class="fa-solid fa-music"></i>'
            }
          </div>
          <div class="track-item-body">
            <div class="track-item-title">${escHtml(t.title || 'Без названия')}</div>
            <div class="track-item-meta">
              ${t.duration ? formatTime(t.duration) : '—'}
              <span class="source-badge glass-flat ${t.source === 'youtube' ? 'source-yt' : (t.source === 'local' ? 'source-local' : 'source-sc')}" style="margin-left:4px;">
                ${t.source === 'youtube' ? 'YT' : (t.source === 'local' ? 'FILE' : 'SC')}
              </span>
            </div>
          </div>
          <div class="track-actions">
            ${t.isLocal ? `
              <button class="track-act-btn play-local" data-id="${t.id}" title="Слушать">
                <i class="fa-solid fa-play"></i>
              </button>
            ` : ''}
            <button class="track-act-btn del" data-id="${t.id}" title="Удалить">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.track-act-btn.play-local').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const track = allTracks.find(t => String(t.id) === String(id));
          if (!track) return;
          const audio = document.getElementById('localPreviewAudio');
          if (track.localUrl) {
            audio.src = track.localUrl;
          } else if (track.playUrl) {
            audio.src = track.playUrl;
          } else {
            return;
          }
          audio.play().catch(() => {});
          showToast(`Сейчас играет: ${track.title}`, 'success');
        });
      });

      list.querySelectorAll('.track-act-btn.del').forEach(btn => {
        btn.addEventListener('click', async () => {
          const rawId = btn.dataset.id;
            const isTempLocal = String(rawId).startsWith('local-');
            if (isTempLocal) {
            const idx = localTracks.findIndex(t => String(t.id) === String(rawId));
            if (idx >= 0) {
              const [removed] = localTracks.splice(idx, 1);
              if (removed && removed.localUrl) URL.revokeObjectURL(removed.localUrl);
              showToast('Локальный трек удалён', '');
              renderLibrary();
            }
            return;
          }

          const id = parseInt(rawId, 10);
          try {
            const res = await authFetch(`/api/player/library/${id}`, { method: 'DELETE' });
            if (res.ok) { showToast('Трек удалён', ''); loadLibrary(); }
            else showToast('Ошибка удаления', 'error');
          } catch {}
        });
      });
    }

    // ---- Search ----
    let searchSource = 'youtube';
    document.querySelectorAll('.search-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        searchSource = tab.dataset.src;
        document.getElementById('searchResults').innerHTML = '';
      });
    });

    document.getElementById('searchBtn').addEventListener('click', doSearch);
    document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    async function doSearch() {
      const q = document.getElementById('searchInput').value.trim();
      if (!q) return;
      const resultsEl = document.getElementById('searchResults');
      resultsEl.innerHTML = `<div style="grid-column:1/-1;display:flex;justify-content:center;padding:30px;"><div class="spinner" style="width:28px;height:28px;border-width:2px;"></div></div>`;

      try {
        const url = searchSource === 'youtube'
          ? `/api/player/search/youtube?query=${encodeURIComponent(q)}`
          : `/api/player/search/soundcloud?query=${encodeURIComponent(q)}`;
        const res = await authFetch(url);
        if (!res.ok) throw new Error();
        const data = await res.json();
        renderSearchResults(data.tracks || []);
      } catch {
        resultsEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa-solid fa-wifi"></i><p>Ошибка поиска</p></div>`;
      }
    }

    function renderSearchResults(tracks) {
      const el = document.getElementById('searchResults');
      if (!tracks.length) {
        el.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa-solid fa-music"></i><p>Ничего не найдено</p></div>`;
        return;
      }
      el.innerHTML = tracks.map(t => {
        // SoundCloud использует track_page_url, YouTube — page_url
        const pageUrl = t.page_url || t.track_page_url || '';
        return `
          <div class="search-result-card glass glass-secondary">
            <div class="search-result-thumb">
              ${t.thumbnail
                ? `<img src="${escHtml(t.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : '<i class="fa-solid fa-music" style="font-size:2rem;color:var(--accent);opacity:.4;"></i>'
              }
            </div>
            <div class="search-result-info">
              <div class="search-result-title">${escHtml(t.title)}</div>
              <div class="search-result-sub">${t.duration ? formatTime(t.duration) : '—'}</div>
              <button class="search-result-add" data-url="${escHtml(pageUrl)}">
                <i class="fa-solid fa-bookmark"></i> В библиотеку
              </button>
            </div>
          </div>
        `;
      }).join('');

      el.querySelectorAll('.search-result-add').forEach(btn => {
        btn.addEventListener('click', async () => {
          const url = btn.dataset.url;
          if (!url) return;
          btn.disabled = true;
          btn.textContent = 'Добавляю...';
          try {
            const res = await authFetch('/api/player/library', {
              method: 'POST',
              body: JSON.stringify({ url })
            });
            if (res.ok) {
              showToast('Добавлено в библиотеку!', 'success');
              btn.innerHTML = '<i class="fa-solid fa-check"></i> Добавлено';
              loadLibrary();
            } else {
              const err = await res.json().catch(() => ({}));
              showToast(err.detail || 'Ошибка', 'error');
              btn.disabled = false;
              btn.innerHTML = '<i class="fa-solid fa-bookmark"></i> В библиотеку';
            }
          } catch { btn.disabled = false; }
        });
      });
    }

    // ---- Add URL modal ----
    document.getElementById('addLocalBtn').addEventListener('click', () => {
      document.getElementById('localFileInput').click();
    });
    document.getElementById('localFileInput').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      const formData = new FormData();
      files.forEach(file => formData.append('files', file));

      e.target.value = '';

      try {
        const res = await fetch('/api/player/library/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showToast(err.detail || 'Ошибка загрузки файлов', 'error');
          return;
        }

        const payload = await res.json().catch(() => ({}));
        const added = Number(payload.added || 0);
        showToast(`Файлы добавлены в коллекцию: ${added}`, 'success');
        await loadLibrary();
      } catch {
        showToast('Ошибка загрузки файлов', 'error');
      }
    });

    document.getElementById('addToLibBtn').addEventListener('click', () => {
      const m = document.getElementById('addUrlModal');
      m.style.display = 'flex';
    });
    document.getElementById('addUrlCancel').addEventListener('click', () => {
      document.getElementById('addUrlModal').style.display = 'none';
    });
    document.getElementById('addUrlConfirm').addEventListener('click', async () => {
      const url = document.getElementById('addUrlInput').value.trim();
      if (!url) return;
      try {
        const res = await authFetch('/api/player/library', { method:'POST', body:JSON.stringify({url}) });
        if (res.ok) {
          showToast('Трек добавлен!', 'success');
          document.getElementById('addUrlModal').style.display = 'none';
          document.getElementById('addUrlInput').value = '';
          loadLibrary();
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(err.detail || 'Ошибка', 'error');
        }
      } catch {}
    });

    // ---- Init ----
    loadLibrary();
