/**
 * chat.js — Чат комнаты.
 *
 * Зависимости: globals.js, websocket.js (WSModule.sendWS)
 */

const ChatModule = (function () {

  let _messages = [];
  const _seenMessageIds = new Set();
  const MAX_MESSAGES = 100;

  function storageKey() {
    return `room-chat-${GLOBAL.roomId || 'unknown'}`;
  }

  function saveMessages() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(_messages.slice(-MAX_MESSAGES)));
    } catch {}
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
    const normalized = list.slice(-MAX_MESSAGES);
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

    const sent = WSModule.sendWS('chat', { content: msg });
    if (sent) {
      input.value = '';
    }
  }

  // ---- Вставить сообщение ----

  function appendMessage(data) {
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
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // Убираем заглушку при первом сообщении
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const author = data.user || data.username || 'Аноним';
    const text = data.content || data.message || '';
    const isMine = GLOBAL.currentUser && author === GLOBAL.currentUser.username;

    const time = data.timestamp
      ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const el = document.createElement('div');
    el.className = `chat-msg ${isMine ? 'chat-msg-mine' : ''}`;
    el.innerHTML = `
      <div class="chat-avatar">${escHtml((author || '?')[0].toUpperCase())}</div>
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
