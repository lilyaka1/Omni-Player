/**
 * auth-ui.js — Проверка авторизации на странице комнаты.
 * Загружает данные пользователя, заполняет список слушателей, 
 * обновляет room info bar.
 *
 * Зависимости: globals.js, websocket.js (WSModule)
 */

(function () {

  let _roomOwnerId = null;

  function sameOriginUrl(path) {
    try {
      const current = window.location.origin;
      const url = new URL(path, current);
      const host = window.location.hostname;
      if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.hostname !== host) {
        url.hostname = host;
      }
      return url.toString();
    } catch {
      return path;
    }
  }

  async function init() {
    if (typeof WSModule === 'undefined') {
      setTimeout(init, 50);
      return;
    }

    if (!GLOBAL.token) {
      window.location.replace('/login');
      return;
    }

    await loadCurrentUser();
    if (!GLOBAL.token || !GLOBAL.currentUser) {
      window.location.replace('/login');
      return;
    }
    await joinRoomIfAuthenticated();
    await loadRoomInfo();

    // После загрузки пользователя — подключаемся к WS
    WSModule.connect();

    window.addEventListener('beforeunload', leaveRoomIfAuthenticated);
  }

  async function joinRoomIfAuthenticated() {
    if (!GLOBAL.roomId || !GLOBAL.token) return;
    try {
      await fetch(sameOriginUrl(`/rooms/${GLOBAL.roomId}/join`), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GLOBAL.token}` },
      });
    } catch {}
  }

  function leaveRoomIfAuthenticated() {
    if (!GLOBAL.roomId || !GLOBAL.token) return;
    try {
      fetch(sameOriginUrl(`/rooms/${GLOBAL.roomId}/leave`), {
        method: 'POST',
        keepalive: true,
        headers: { 'Authorization': `Bearer ${GLOBAL.token}` },
      });
    } catch {}
  }

  async function loadCurrentUser() {
    if (!GLOBAL.token) return;

    try {
      const res = await fetch(sameOriginUrl('/auth/me'), {
        headers: { 'Authorization': `Bearer ${GLOBAL.token}` }
      });
      if (res.ok) {
        GLOBAL.currentUser = await res.json();
      } else if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('access_token');
        GLOBAL.token = null;
        GLOBAL.currentUser = null;
      }
    } catch {}
  }

  async function loadRoomInfo() {
    if (!GLOBAL.roomId) return;

    try {
      const res = await fetch(sameOriginUrl(`/rooms/${GLOBAL.roomId}`));
      if (!res.ok) {
        showToast('Комната не найдена', 'error');
        return;
      }
      const room = await res.json();

      // Заполнить топбар и info bar
      const titleEl = document.getElementById('roomNameTitle');
      if (titleEl) titleEl.textContent = room.name || `Комната #${GLOBAL.roomId}`;
      document.title = `${room.name || 'Комната'} — Omni Player`;

      const roomOwnerId = room.owner_id || room.creator_id;
      _roomOwnerId = roomOwnerId;
      const hostEl = document.getElementById('infoHost');
      if (hostEl) hostEl.textContent = room.owner_username || room.creator_username || roomOwnerId || 'Host';
      const privEl = document.getElementById('infoPrivacy');
      if (privEl) privEl.textContent = room.is_public ? 'Публичная' : 'Приватная';

      // Определить роль: если текущий юзер — владелец комнаты
      if (GLOBAL.currentUser && (
        GLOBAL.currentUser.id === roomOwnerId ||
        GLOBAL.currentUser.is_admin
      )) {
        GLOBAL.userRole = 'owner';
      }

      // Загрузить список слушателей
      loadListeners(roomOwnerId);

    } catch (e) {
      console.error('[auth-ui] Ошибка загрузки комнаты:', e);
    }
  }

  async function loadListeners(roomOwnerId) {
    try {
      const res = await fetch(sameOriginUrl(`/rooms/${GLOBAL.roomId}/users`));
      if (!res.ok) return;
      const payload = await res.json();
      const users = Array.isArray(payload) ? payload : (payload.users || []);
      const mergedUsers = ensureCurrentUserInListeners(users);
      renderListeners(mergedUsers, roomOwnerId);
      const numEl = document.getElementById('infoListeners');
      if (numEl) numEl.textContent = mergedUsers.length;
    } catch {}
  }

  async function refreshListeners() {
    await loadListeners(_roomOwnerId);
  }

  function ensureCurrentUserInListeners(users) {
    if (!GLOBAL.currentUser) return users;
    const exists = users.some(u => u.id === GLOBAL.currentUser.id);
    if (exists) return users;
    return [{ id: GLOBAL.currentUser.id, username: GLOBAL.currentUser.username }, ...users];
  }

  function renderListeners(users, ownerId) {
    const list = document.getElementById('listenersList');
    if (!list) return;

    if (!users || !users.length) {
      list.innerHTML = `<div class="empty-state" style="padding:10px;">
        <i class="fa-solid fa-user-slash"></i>
        <p>Нет слушателей</p>
      </div>`;
      return;
    }

    list.innerHTML = users.map(u => {
      const isOwner = u.id === ownerId;
      const roleLabel = isOwner ? 'Host' : 'User';
      const roleClass = isOwner ? 'role-owner' : 'role-user';
      return `
        <div class="listener-item">
          <div class="listener-avatar">${escHtml((u.username || '?')[0].toUpperCase())}</div>
          <div class="listener-name">${escHtml(u.username || 'Аноним')}</div>
          <span class="listener-role ${roleClass}">${roleLabel}</span>
        </div>
      `;
    }).join('');
  }

  window.RoomAuthUI = { refreshListeners };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
