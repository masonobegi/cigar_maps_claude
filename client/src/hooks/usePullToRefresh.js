import { useEffect, useRef, useState } from 'react';

export function usePullToRefresh(onRefresh, threshold = 80) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current || window;

    function onTouchStart(e) {
      const scrollTop = containerRef.current
        ? containerRef.current.scrollTop
        : window.scrollY;
      if (scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
    }

    function onTouchMove(e) {
      if (startY.current === null) return;
      const dist = Math.max(0, e.touches[0].clientY - startY.current);
      if (dist > 5) {
        setPulling(true);
        setPullDistance(Math.min(dist * 0.5, threshold * 1.5));
      }
    }

    async function onTouchEnd() {
      if (pullDistance >= threshold) {
        setRefreshing(true);
        try { await onRefresh(); } catch {}
        setRefreshing(false);
      }
      startY.current = null;
      setPulling(false);
      setPullDistance(0);
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [onRefresh, threshold, pullDistance]);

  const progress = Math.min(pullDistance / threshold, 1);

  return { pulling, pullDistance, refreshing, progress, containerRef };
}
