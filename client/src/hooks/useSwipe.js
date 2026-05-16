import { useRef } from 'react';

export function useSwipeAction({ onSwipeLeft, onSwipeRight, threshold = 60 }) {
  const startX = useRef(null);
  const startY = useRef(null);
  const el = useRef(null);

  function onTouchStart(e) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    if (el.current) el.current.style.transition = 'none';
  }

  function onTouchMove(e) {
    if (startX.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = Math.abs(e.touches[0].clientY - startY.current);
    if (dy > 20) return; // vertical scroll, ignore
    if (el.current) el.current.style.transform = `translateX(${dx * 0.6}px)`;
  }

  function onTouchEnd(e) {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (el.current) {
      el.current.style.transition = 'transform 0.25s ease';
      el.current.style.transform = 'translateX(0)';
    }
    if (dx < -threshold && onSwipeLeft) onSwipeLeft();
    if (dx > threshold && onSwipeRight) onSwipeRight();
    startX.current = null;
  }

  return {
    ref: el,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
