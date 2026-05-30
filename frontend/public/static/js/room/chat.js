/**
 * chat.js — Чат комнаты.
 *
 * Зависимости: globals.js, websocket.js (WSModule.sendWS)
 */

const ChatModule = (function () {

  let _messages = [];
  const _seenMessageIds = new Set();
  const MAX_MESSAGES = 100;

  // Helper: Get fresh user data with avatar
  async function getCurrentUserWithAvatar() {
    try {
      const res = await fetch('/auth/me', {
        headers: { 'Authorization': `Bearer ${GLOBAL.token}` }
      });
      if (res.ok) {
        const userData = await res.json();
        GLOBAL.currentUser = userData;
        return userData;
      }
    } catch {}
    return GLOBAL.currentUser;
  }

  function storageKey() {
    return `room-chat-${GLOBAL.roomId || 'unknown'}`;
  }

  function saveMessages() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(_messages.slice(-MAX_MESSAGES)));
    } catch {}
  }

  function normalizeMessagePayload(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    if (raw.data && typeof raw.data === 'object') {
      return raw.data;
    }
    return raw;
  }

  function restoreMessages() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) return;
      _messages = list.slice(-MAX_MESSAGES);
      _seenMessageIds.clear();
      _messages.forEach((m) => {
        if (m && (typeof m.id === 'number' || typeof m.id === 'string')) {
          _seenMessageIds.add(String(m.id));
        }
      });

      const container = document.getElementById('chatMessages');
      if (!container) return;
      const emptyState = container.querySelector('.empty-state');
      if (emptyState) emptyState.remove();

      _messages.forEach((msg) => renderMessage(msg));
      container.scrollTop = container.scrollHeight;
    } catch {}
  }

  function setHistory(list) {
    if (!Array.isArray(list)) return;
    const normalized = list.slice(-MAX_MESSAGES).map(normalizeMessagePayload);
    _messages = normalized;

    _seenMessageIds.clear();
    _messages.forEach((m) => {
      if (m && (typeof m.id === 'number' || typeof m.id === 'string')) {
        _seenMessageIds.add(String(m.id));
      }
    });

    const container = document.getElementById('chatMessages');
    if (!container) {
      saveMessages();
      return;
    }

    container.innerHTML = '';
    if (!_messages.length) {
      container.innerHTML = '<div class="empty-state" style="padding: 20px"><i class="fa-solid fa-comments"></i><p>Начните разговор</p></div>';
      saveMessages();
      return;
    }

    _messages.forEach((msg) => renderMessage(msg));
    container.scrollTop = container.scrollHeight;
    saveMessages();
  }

  function init() {
    const sendBtn  = document.getElementById('chatSendBtn');
    const chatInput = document.getElementById('chatInput');

    sendBtn?.addEventListener('click', sendMessage);

    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    restoreMessages();
  }

  function sendMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;

    if (!GLOBAL.token) {
      showToast('Войдите, чтобы писать в чат', 'error');
      return;
    }

    // Get fresh user data to ensure avatar_url is included
    getCurrentUserWithAvatar().then(userData => {
      const payload = { content: msg };
      // Add avatar_url if available
      if (userData?.avatar_url) {
        payload.avatar_url = userData.avatar_url;
        console.log('✅ Adding avatar_url to payload:', payload.avatar_url);
      } else {
        console.log('❌ No avatar_url in userData:', userData);
      }
      console.log('📤 Sending chat payload:', payload);

      const sent = WSModule.sendWS('chat', payload);
      if (sent) {
        input.value = '';
      }
    });
  }

  // ---- Вставить сообщение ----

  function appendMessage(data) {
    data = normalizeMessagePayload(data);
    const id = data && (typeof data.id === 'number' || typeof data.id === 'string') ? String(data.id) : null;
    if (id && _seenMessageIds.has(id)) {
      return;
    }

    if (id) _seenMessageIds.add(id);
    _messages.push(data);
    if (_messages.length > MAX_MESSAGES) _messages.shift();
    renderMessage(data);
    saveMessages();
  }

  function renderMessage(data) {
    data = normalizeMessagePayload(data);
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // Убираем заглушку при первом сообщении
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const author = data.display_name || data.user || data.username || data.author || 'Аноним';
    const text = data.content || data.message || '';
    const isMine = GLOBAL.currentUser && [GLOBAL.currentUser.username, GLOBAL.currentUser.display_name].filter(Boolean).includes(author);

    console.log('📨 Rendering message:', { author, avatar_url: data.avatar_url, isMine });

    const time = data.timestamp
      ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const avatarContent = data.avatar_url 
      ? `<img src="${data.avatar_url}" alt="" style="width: 100%; height: 100%; object-fit: cover;">` 
      : escHtml((author || '?')[0].toUpperCase());

    const el = document.createElement('div');
    el.className = `chat-msg ${isMine ? 'chat-msg-mine' : ''}`;
    el.innerHTML = `
      <div class="chat-avatar">${avatarContent}</div>
      <div class="chat-bubble">
        <div class="chat-meta">
          <span class="chat-username">${escHtml(author)}</span>
          <span class="chat-time">${escHtml(time)}</span>
        </div>
        <div class="chat-text">${escHtml(text)}</div>
      </div>
    `;
    container.appendChild(el);

    // Прокрутить вниз
    container.scrollTop = container.scrollHeight;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { appendMessage, setHistory };

})();

window.ChatModule = ChatModule;
