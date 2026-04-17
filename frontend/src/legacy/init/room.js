import inlineCode from '../scripts/room-inline.js?raw';
import { executeInlineScript } from '../utils/executeInlineScript';
import { loadScriptsSequentially } from '../utils/scripts';

const roomScriptUrls = [
  '/static/js/room/globals.js',
  '/static/js/room/websocket.js',
  '/static/js/room/auth-ui.js',
  '/static/js/room/stream.js',
  '/static/js/room/player.js',
  '/static/js/room/queue.js',
  '/static/js/room/chat.js',
  '/static/js/room/equalizer.js',
  '/static/js/room/equalizer-ui.js',
];

export function initRoomPage() {
  let cleanupInline = null;

  loadScriptsSequentially(roomScriptUrls)
    .then(() => {
      cleanupInline = executeInlineScript(inlineCode, 'room-page');
    })
    .catch((err) => {
      console.error('Failed to init room scripts', err);
    });

  return () => {
    cleanupInline?.();
  };
}
