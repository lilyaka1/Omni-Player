/**
 * Keyboard shortcuts для локального плеера
 */

export function setupKeyboardShortcuts(handlers) {
  const handleKeyDown = (e) => {
    // Игнорировать если фокус в input/textarea
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      return;
    }

    // Игнорировать если есть модификаторы (кроме Shift для некоторых)
    const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

    switch (e.code) {
      case 'Space':
        if (!hasModifier) {
          e.preventDefault();
          handlers.togglePlay?.();
        }
        break;

      case 'ArrowLeft':
        if (!hasModifier) {
          e.preventDefault();
          if (e.shiftKey) {
            // Shift + ← : предыдущий трек
            handlers.previous?.();
          } else {
            // ← : -5 секунд
            handlers.seekBackward?.(5);
          }
        }
        break;

      case 'ArrowRight':
        if (!hasModifier) {
          e.preventDefault();
          if (e.shiftKey) {
            // Shift + → : следующий трек
            handlers.next?.();
          } else {
            // → : +5 секунд
            handlers.seekForward?.(5);
          }
        }
        break;

      case 'ArrowUp':
        if (!hasModifier) {
          e.preventDefault();
          // ↑ : громкость +10%
          handlers.volumeUp?.(0.1);
        }
        break;

      case 'ArrowDown':
        if (!hasModifier) {
          e.preventDefault();
          // ↓ : громкость -10%
          handlers.volumeDown?.(0.1);
        }
        break;

      case 'KeyM':
        if (!hasModifier) {
          e.preventDefault();
          // M : mute/unmute
          handlers.toggleMute?.();
        }
        break;

      case 'KeyS':
        if (!hasModifier) {
          e.preventDefault();
          // S : shuffle
          handlers.toggleShuffle?.();
        }
        break;

      case 'KeyR':
        if (!hasModifier) {
          e.preventDefault();
          // R : repeat
          handlers.toggleRepeat?.();
        }
        break;

      case 'KeyN':
        if (!hasModifier) {
          e.preventDefault();
          // N : next track
          handlers.next?.();
        }
        break;

      case 'KeyP':
        if (!hasModifier) {
          e.preventDefault();
          // P : previous track
          handlers.previous?.();
        }
        break;

      case 'Digit0':
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
      case 'Digit6':
      case 'Digit7':
      case 'Digit8':
      case 'Digit9':
        if (!hasModifier) {
          e.preventDefault();
          // 0-9 : перемотка на N*10% длительности
          const digit = parseInt(e.code.replace('Digit', ''), 10);
          handlers.seekToPercent?.(digit * 10);
        }
        break;

      default:
        break;
    }
  };

  document.addEventListener('keydown', handleKeyDown);

  // Возвращаем функцию для отписки
  return () => {
    document.removeEventListener('keydown', handleKeyDown);
  };
}

export const SHORTCUTS_HELP = [
  { key: 'Space', description: 'Play / Pause' },
  { key: '←', description: 'Назад 5 сек' },
  { key: '→', description: 'Вперёд 5 сек' },
  { key: 'Shift + ←', description: 'Предыдущий трек' },
  { key: 'Shift + →', description: 'Следующий трек' },
  { key: '↑', description: 'Громкость +10%' },
  { key: '↓', description: 'Громкость -10%' },
  { key: 'M', description: 'Mute / Unmute' },
  { key: 'S', description: 'Shuffle' },
  { key: 'R', description: 'Repeat' },
  { key: 'N', description: 'Next track' },
  { key: 'P', description: 'Previous track' },
  { key: '0-9', description: 'Перемотка на N*10%' },
];
