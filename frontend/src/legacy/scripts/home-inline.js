    const API_BASE = '';  // relative, FastAPI serves on same origin

    // ---- Toast ----
    function showToast(msg, type = '') {
      const c = document.getElementById('toast-container');
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.textContent = msg;
      c.appendChild(t);
      setTimeout(() => {
        t.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => t.remove(), 300);
      }, 3000);
    }

    // ---- Auth check ----
    const token = localStorage.getItem('token');
    let currentUser = null;

    async function loadCurrentUser() {
      if (!token) {
        showGuestUI();
        return;
      }
      try {
        const res = await fetch('/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
          currentUser = await res.json();
          showUserUI(currentUser);
        } else {
          localStorage.removeItem('token');
          showGuestUI();
        }
      } catch {
        showGuestUI();
      }
    }

    function showUserUI(user) {
      document.getElementById('userCard').style.display = 'flex';
      document.getElementById('loginNavBtn').style.display = 'none';
      document.getElementById('sidebarUsername').textContent = user.username;
      document.getElementById('sidebarRole').textContent = user.is_admin ? 'Администратор' : 'Пользователь';
      document.getElementById('userAvatarLetter').textContent = user.username[0].toUpperCase();
      if (user.can_create_rooms || user.is_admin) {
        document.getElementById('createRoomBtn').style.display = 'flex';
        const btn2 = document.getElementById('createRoomBtn2');
        if (btn2) btn2.style.display = 'flex';
      }
      loadMyRooms();
    }

    function showGuestUI() {
      document.getElementById('userCard').style.display = 'none';
      document.getElementById('loginNavBtn').style.display = 'flex';
    }

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      localStorage.removeItem('token');
      window.location.href = '/login';
    });

    // ---- My Rooms ----
    async function loadMyRooms() {
      if (!token) return;
      try {
        const res = await fetch('/rooms/my/rooms', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return;
        const rooms = await res.json();
        const list = document.getElementById('myRoomsList');
        if (rooms.length > 0) {
          document.getElementById('myRoomsSection').style.display = 'block';
          list.innerHTML = rooms.slice(0, 5).map(r => `
            <div class="nav-item" style="justify-content:space-between;gap:8px;">
              <button onclick="enterRoom(${r.id})" style="all:unset;display:flex;align-items:center;gap:10px;flex:1;cursor:pointer;">
                <i class="fa-solid fa-music"></i>
                <span class="truncate" style="flex:1;text-align:left;">${escHtml(r.name)}</span>
              </button>
              <button onclick="deleteMyRoom(event, ${r.id})" title="Удалить комнату" style="all:unset;cursor:pointer;color:#ff6b6b;padding:2px 4px;border-radius:8px;">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          `).join('');
        }
      } catch {}
    }

    async function deleteMyRoom(e, roomId) {
      e.preventDefault();
      e.stopPropagation();
      if (!token) return;
      if (!confirm('Удалить комнату?')) return;
      try {
        const res = await fetch(`/rooms/${roomId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          showToast('Комната удалена', 'success');
          loadMyRooms();
          loadRooms();
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(err.detail || 'Не удалось удалить комнату', 'error');
        }
      } catch {
        showToast('Ошибка сети', 'error');
      }
    }

    // ---- Rooms list ----
    let allRooms = [];

    async function loadRooms() {
      try {
        const res = await fetch('/rooms/');
        if (!res.ok) throw new Error();
        allRooms = await res.json();
        renderRooms(allRooms);
        renderHomeStrip(allRooms);
        const sub = document.getElementById('featuredSub');
        if (sub) sub.textContent = `${allRooms.length} комнат · ${allRooms.reduce((s,r)=>s+(r.listener_count||0),0)} слушателей`;
        const badge = document.getElementById('roomsCountBadge');
        if (badge && allRooms.length) { badge.textContent = allRooms.length; badge.style.display = ''; }
      } catch {
        document.getElementById('roomsGrid').innerHTML =
          `<div class="empty-state" style="grid-column:1/-1">
            <i class="fa-solid fa-wifi"></i>
            <p>Не удалось загрузить комнаты</p>
            <button class="btn" onclick="loadRooms()">Повторить</button>
          </div>`;
        const strip = document.getElementById('homeRoomsStrip');
        if (strip) strip.innerHTML = `<div style="color:var(--text-muted);font-size:0.82rem;padding:20px 0;">Нет подключения к серверу</div>`;
        const sub = document.getElementById('featuredSub');
        if (sub) sub.textContent = 'Нет данных';
      }
    }

    function renderHomeStrip(rooms) {
      const strip = document.getElementById('homeRoomsStrip');
      if (!strip) return;
      if (!rooms.length) { strip.innerHTML = `<div style="color:var(--text-muted);font-size:0.82rem;padding:20px 0;">Комнат пока нет</div>`; return; }
      strip.innerHTML = rooms.slice(0, 8).map(r => `
        <div class="room-card room-sm glass glass-secondary" onclick="enterRoom(${r.id})" style="width:160px;">
          <div class="room-artwork">
            <div class="artwork-placeholder"><i class="fa-solid fa-music"></i></div>
            ${(r.listener_count||0) > 5 ? '<div class="live-badge">LIVE</div>' : ''}
            <div class="room-listeners-badge"><i class="fa-solid fa-headphones"></i> ${r.listener_count||0}</div>
          </div>
          <div class="room-info">
            <div class="room-title">${escHtml(r.name)}</div>
            <div class="room-meta">
              <span class="room-genre">${escHtml(r.description||'—')}</span>
              <span class="room-privacy"><i class="fa-solid ${r.is_public?'fa-globe':'fa-lock'}" style="font-size:.6rem;"></i></span>
            </div>
          </div>
        </div>
      `).join('');
    }

    function renderRooms(rooms) {
      const grid = document.getElementById('roomsGrid');
      if (!rooms.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
          <i class="fa-solid fa-door-closed"></i>
          <p>Комнат пока нет</p>
        </div>`;
        return;
      }
      grid.innerHTML = rooms.map(r => `
        <div class="room-card glass glass-secondary" onclick="enterRoom(${r.id})">
          <div class="room-artwork">
            <div class="artwork-placeholder"><i class="fa-solid fa-music"></i></div>
            ${(r.listener_count||0) > 5 ? '<div class="live-badge">LIVE</div>' : ''}
            <div class="room-listeners-badge">
              <i class="fa-solid fa-headphones"></i>
              <span>${r.listener_count || 0}</span>
            </div>
          </div>
          <div class="room-info">
            <div class="room-title">${escHtml(r.name)}</div>
            <div class="room-meta">
              <span class="room-genre">${escHtml(r.description || 'Без описания')}</span>
              <span class="room-privacy">
                <i class="fa-solid ${r.is_public ? 'fa-globe' : 'fa-lock'}" style="font-size:0.65rem;"></i>
              </span>
            </div>
          </div>
        </div>
      `).join('');
    }

    document.getElementById('roomSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      renderRooms(allRooms.filter(r => r.name.toLowerCase().includes(q)));
    });

    function enterRoom(roomId) {
      window.location.href = `/user?room_id=${roomId}`;
    }

    // ---- Create room ----
    const createRoomBtn = document.getElementById('createRoomBtn');
    const createRoomBtn2 = document.getElementById('createRoomBtn2');
    const createRoomModal = document.getElementById('createRoomModal');
    const closeModal = document.getElementById('closeModal');

    createRoomBtn?.addEventListener('click', () => createRoomModal.classList.add('open'));
    createRoomBtn2?.addEventListener('click', () => createRoomModal.classList.add('open'));
    closeModal?.addEventListener('click', () => createRoomModal.classList.remove('open'));
    createRoomModal?.addEventListener('click', (e) => {
      if (e.target === createRoomModal) createRoomModal.classList.remove('open');
    });

    document.getElementById('createRoomForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('newRoomName').value.trim();
      const description = document.getElementById('newRoomDesc').value.trim();
      const is_public = document.getElementById('newRoomPublic').checked;
      if (!name) return;

      try {
        const res = await fetch('/rooms/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ name, description, is_public })
        });
        if (res.ok) {
          const room = await res.json();
          createRoomModal.classList.remove('open');
          showToast('Комната создана!', 'success');
          enterRoom(room.id);
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(err.detail || 'Ошибка создания комнаты', 'error');
        }
      } catch {
        showToast('Ошибка сети', 'error');
      }
    });

    // ---- Genres (static, rooms filtered from API) ----
    const GENRES = [
      { name: 'Lofi',       color: '#6c63ff,#a855f7', icon: '🎵' },
      { name: 'Hip-Hop',    color: '#f59e0b,#ef4444', icon: '🎤' },
      { name: 'Electronic', color: '#3b82f6,#8b5cf6', icon: '🎛' },
      { name: 'Indie',      color: '#10b981,#059669', icon: '🎸' },
      { name: 'Jazz',       color: '#f97316,#eab308', icon: '🎺' },
      { name: 'Pop',        color: '#ec4899,#f43f5e', icon: '⭐' },
      { name: 'Metal',      color: '#6b7280,#374151', icon: '🤘' },
      { name: 'Acoustic',   color: '#84cc16,#16a34a', icon: '🪕' },
      { name: 'R&B',        color: '#0ea5e9,#6c63ff', icon: '🎙' },
      { name: 'Classical',  color: '#d97706,#92400e', icon: '🎻' },
    ];
    const genresGrid = document.getElementById('genresGrid');
    if (genresGrid) {
      GENRES.forEach(g => {
        const [c1, c2] = g.color.split(',');
        const btn = document.createElement('button');
        btn.className = 'genre-chip';
        btn.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
        btn.innerHTML = `<span>${g.icon} ${g.name}</span>`;
        btn.addEventListener('click', () => showGenreRooms(g));
        genresGrid.appendChild(btn);
      });
    }

    function showGenreRooms(g) {
      document.getElementById('genreRoomsBlock').style.display = 'block';
      document.getElementById('genreRoomsTitle').textContent = `Комнаты — ${g.name}`;
      const filtered = allRooms.filter(r =>
        (r.genre || r.name || '').toLowerCase().includes(g.name.toLowerCase())
      );
      const grid = document.getElementById('genreRoomsGrid');
      grid.innerHTML = filtered.length
        ? filtered.map(r => `
            <div class="room-card glass glass-secondary" onclick="enterRoom(${r.id})">
              <div class="room-artwork">
                <div class="artwork-placeholder"><i class="fa-solid fa-music"></i></div>
                <div class="room-listeners-badge"><i class="fa-solid fa-headphones"></i> ${r.listener_count||0}</div>
              </div>
              <div class="room-info">
                <div class="room-title">${escHtml(r.name)}</div>
                <div class="room-meta">
                  <span class="room-genre">${escHtml(r.description||'—')}</span>
                  <span class="room-privacy"><i class="fa-solid ${r.is_public?'fa-globe':'fa-lock'}" style="font-size:.6rem;"></i></span>
                </div>
              </div>
            </div>`).join('')
        : `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-door-closed"></i><p>Нет комнат в жанре «${escHtml(g.name)}»</p></div>`;
      document.getElementById('genreRoomsBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function hideGenreRooms() { document.getElementById('genreRoomsBlock').style.display = 'none'; }

    // ---- Search page ----
    let searchSource = 'youtube';
    document.querySelectorAll('.src-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.src-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        searchSource = tab.dataset.src;
      });
    });
    document.getElementById('searchBtn')?.addEventListener('click', doSearch);
    document.getElementById('searchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    async function doSearch() {
      const q = (document.getElementById('searchInput')?.value || '').trim();
      const results = document.getElementById('searchResults');
      if (!q) {
        results.innerHTML = `<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i><p>Введите запрос</p></div>`;
        return;
      }
      results.innerHTML = `<div style="display:flex;justify-content:center;padding:30px;"><div class="spinner" style="width:28px;height:28px;border-width:2px;"></div></div>`;
      try {
        const url = searchSource === 'youtube'
          ? `/api/player/search/youtube?query=${encodeURIComponent(q)}`
          : `/api/player/search/soundcloud?query=${encodeURIComponent(q)}`;
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const tracks = data.tracks || data;
        if (!tracks.length) throw new Error('empty');
        results.innerHTML = tracks.map(t => `
          <div class="search-result-item">
            <div class="sri-thumb">🎵</div>
            <div class="sri-info">
              <div class="sri-title">${escHtml(t.title||t.name||'—')}</div>
              <div class="sri-sub">${escHtml(t.artist||t.uploader||'—')}${t.duration?' · '+fmtTime(t.duration):''}</div>
            </div>
            <span class="src-badge glass-flat ${searchSource==='youtube'?'yt':'sc'}">${searchSource==='youtube'?'YT':'SC'}</span>
          </div>`).join('');
      } catch {
        results.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Ошибка поиска. Сервер недоступен.</p></div>`;
      }
    }
    function fmtTime(s) { const m=Math.floor(s/60),sc=Math.floor(s%60); return `${m}:${sc.toString().padStart(2,'0')}`; }

    // ---- Page navigation ----
    const PAGE_IDS = { home:'pageHome', rooms:'pageRooms', search:'pageSearch', genres:'pageGenres' };
    function switchPage(name) {
      Object.values(PAGE_IDS).forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('active'); });
      const target = document.getElementById(PAGE_IDS[name]||'pageHome');
      if (target) target.classList.add('active');
      document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page===name));
      window.scrollTo({top:0,behavior:'smooth'});
    }
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => switchPage(btn.dataset.page));
    });

    // ---- Greeting ----
    const _hr = new Date().getHours();
    const greetEl = document.getElementById('greetingText');
    if (greetEl) greetEl.textContent = _hr < 12 ? 'Доброе утро ☀️' : _hr < 18 ? 'Добрый день 👋' : 'Добрый вечер 🌙';

    // ---- Utils ----
    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // ---- Init ----
    loadCurrentUser();
    loadRooms();
