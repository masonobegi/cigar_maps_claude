import { usePullToRefresh } from '../hooks/usePullToRefresh';

export default function PullToRefresh({ onRefresh, children }) {
  const { pulling, pullDistance, refreshing, progress } = usePullToRefresh(onRefresh);

  return (
    <div className="relative">
      {/* Pull indicator */}
      {(pulling || refreshing) && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-center z-10 transition-all pointer-events-none"
          style={{ height: `${Math.max(pullDistance, refreshing ? 48 : 0)}px` }}
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full border-2 border-amber-500 ${refreshing ? 'border-t-transparent animate-spin' : 'border-t-transparent'}`}
              style={!refreshing ? { transform: `rotate(${progress * 360}deg)` } : {}}
            />
            {refreshing && <span className="text-xs text-amber-500 font-medium">Refreshing...</span>}
          </div>
        </div>
      )}
      <div style={{ transform: pulling || refreshing ? `translateY(${Math.max(pullDistance, refreshing ? 48 : 0)}px)` : 'none', transition: refreshing ? 'none' : 'transform 0.2s ease' }}>
        {children}
      </div>
    </div>
  );
}
