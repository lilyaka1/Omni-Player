export function createRoomWebSocket({ roomId, token, onMessage, onOpen, onClose }) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/ws/rooms/${roomId}?token=${encodeURIComponent(token)}`,
  );

  socket.onopen = () => onOpen?.();
  socket.onclose = () => onClose?.();
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      onMessage?.(message.data ?? message, message);
    } catch {
      // Ignore malformed messages from the socket.
    }
  };

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
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, reason);
      }
    },
  };
}
