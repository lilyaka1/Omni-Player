export function createRoomWebSocket({ roomId, token, onMessage, onOpen, onClose }) {
  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let closedManually = false;

  const connect = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(
      `${protocol}//${window.location.host}/ws/rooms/${roomId}?token=${encodeURIComponent(token)}`,
    );

    socket.onopen = () => {
      reconnectAttempts = 0;
      onOpen?.();
    };
    socket.onclose = () => {
      onClose?.();
      if (closedManually) return;

      const delay = Math.min(1000 * (2 ** reconnectAttempts), 10000);
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        onMessage?.(message.data ?? message.payload ?? message, message);
      } catch {
        // Ignore malformed messages from the socket.
      }
    };
  };

  connect();

  return {
    get readyState() {
      return socket.readyState;
    },
    send(type, payload = {}) {
      if (socket.readyState !== WebSocket.OPEN) return false;
      const message = typeof type === 'string' ? { type, ...payload } : type;
      socket.send(JSON.stringify(message));
      return true;
    },
    close(reason = 'page-unmount') {
      closedManually = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, reason);
      }
    },
  };
}
