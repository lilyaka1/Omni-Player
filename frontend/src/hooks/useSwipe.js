/**
 * useSwipe hook for detecting swipe gestures
 * Detects left/right swipes and calls appropriate callbacks
 */

import { useEffect } from 'react';

export function useSwipe(onSwipeLeft, onSwipeRight, element = null) {
  useEffect(() => {
    const target = element || window;
    let touchStartX = 0;
    let touchEndX = 0;
    let touchStartY = 0;
    let touchEndY = 0;
    const minSwipeDistance = 50;

    function handleTouchStart(e) {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }

    function handleTouchEnd(e) {
      touchEndX = e.changedTouches[0].screenX;
      touchEndY = e.changedTouches[0].screenY;
      handleSwipe();
    }

    function handleSwipe() {
      const distanceX = Math.abs(touchEndX - touchStartX);
      const distanceY = Math.abs(touchEndY - touchStartY);

      // Only process if horizontal distance is greater than vertical (avoid triggering on vertical scrolls)
      if (distanceX > distanceY && distanceX > minSwipeDistance) {
        if (touchEndX < touchStartX - minSwipeDistance) {
          // Swiped left
          onSwipeLeft?.();
        } else if (touchEndX > touchStartX + minSwipeDistance) {
          // Swiped right
          onSwipeRight?.();
        }
      }
    }

    if (target === window) {
      window.addEventListener('touchstart', handleTouchStart, false);
      window.addEventListener('touchend', handleTouchEnd, false);

      return () => {
        window.removeEventListener('touchstart', handleTouchStart);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    } else {
      target.addEventListener('touchstart', handleTouchStart, false);
      target.addEventListener('touchend', handleTouchEnd, false);

      return () => {
        target.removeEventListener('touchstart', handleTouchStart);
        target.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [onSwipeLeft, onSwipeRight, element]);
}
