import { Link } from 'react-router-dom';
import { Star, Store, MapPin } from 'lucide-react';

const STRENGTH_CONFIG = {
  'mild':        { label: 'Mild',        bar: 'w-1/5',  color: 'bg-green-400',  text: 'text-green-400',  bg: 'bg-green-900/30' },
  'mild-medium': { label: 'Mild-Med',    bar: 'w-2/5',  color: 'bg-lime-400',   text: 'text-lime-400',   bg: 'bg-lime-900/30' },
  'medium':      { label: 'Medium',      bar: 'w-3/5',  color: 'bg-amber-400',  text: 'text-amber-400',  bg: 'bg-amber-900/30' },
  'medium-full': { label: 'Med-Full',    bar: 'w-4/5',  color: 'bg-orange-400', text: 'text-orange-400', bg: 'bg-orange-900/30' },
  'full':        { label: 'Full',        bar: 'w-full', color: 'bg-red-400',    text: 'text-red-400',    bg: 'bg-red-900/30' },
};

const WRAPPER_COLORS = {
  'Connecticut': '#d4c5a0', 'Ecuador': '#c8b87a', 'Cameroon': '#9e7c4a',
  'Maduro': '#3d2010', 'Broadleaf Maduro': '#2a1508', 'Connecticut Broadleaf': '#2a1508',
  'Brazilian Maduro': '#1e0c04', 'Double Maduro': '#150802', 'Oscuro': '#100600',
  'Habano': '#8b6030', 'Ecuador Habano': '#7a5228', 'Nicaraguan': '#a07040',
  'Corojo': '#9e6832', 'Rosado': '#c4844a', 'Dominican': '#b89060',
  'Costa Rican': '#c0a060', 'Claro': '#e0d0a0', 'Candela': '#6a9040',
};

function WrapperSwatch({ wrapper }) {
  const color = wrapper
    ? Object.entries(WRAPPER_COLORS).find(([k]) => wrapper.toLowerCase().includes(k.toLowerCase()))?.[1]
    : null;
  return color ? (
    <div className="w-3 h-3 rounded-full border border-stone-700 flex-shrink-0" style={{ backgroundColor: color }} title={wrapper} />
  ) : null;
}

function ScoreRing({ value, size = 36 }) {
  if (!value) return null;
  const color = value >= 95 ? '#10b981' : value >= 90 ? '#f59e0b' : value >= 85 ? '#fb923c' : '#94a3b8';
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="#292524" strokeWidth="3.5" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[9px] font-bold" style={{ color }}>{value}</span>
      </div>
    </div>
  );
}

export default function CigarCard({ cigar }) {
  const sc = STRENGTH_CONFIG[cigar.strength];
  const rating = cigar.avg_rating || 0;

  return (
    <Link to={`/cigars/${cigar.id}`} className="card hover:border-stone-600 active:scale-[0.98] transition-all duration-150 group flex flex-col overflow-hidden">
      {/* Wrapper color strip */}
      <div className="h-1.5 w-full flex-shrink-0"
        style={{ backgroundColor: cigar.wrapper
          ? Object.entries(WRAPPER_COLORS).find(([k]) => cigar.wrapper?.toLowerCase().includes(k.toLowerCase()))?.[1] ?? '#4a3020'
          : '#4a3020'
        }} />

      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-amber-500/80 font-semibold uppercase tracking-wider truncate leading-none mb-1">{cigar.brand}</p>
            <h3 className="font-semibold text-stone-100 text-sm leading-tight group-hover:text-amber-300 transition-colors line-clamp-2">
              {cigar.name}
            </h3>
          </div>
          {rating > 0 && <ScoreRing value={rating} />}
        </div>

        {/* Strength bar */}
        {sc && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-stone-800 rounded-full overflow-hidden">
              <div className={`h-full ${sc.bar} ${sc.color} rounded-full transition-all`} />
            </div>
            <span className={`text-[9px] font-semibold ${sc.text} flex-shrink-0`}>{sc.label}</span>
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-2 flex-wrap">
          {cigar.wrapper && (
            <div className="flex items-center gap-1">
              <WrapperSwatch wrapper={cigar.wrapper} />
              <span className="text-[9px] text-stone-500 truncate max-w-20">{cigar.wrapper}</span>
            </div>
          )}
          {cigar.country && (
            <span className="text-[9px] text-stone-600 flex items-center gap-0.5 truncate">
              <MapPin className="w-2.5 h-2.5" />{cigar.country.split(' ')[0]}
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-stone-800/60">
          {cigar.store_count > 0 ? (
            <span className="text-[9px] text-stone-500 flex items-center gap-1">
              <Store className="w-2.5 h-2.5 text-emerald-600" />
              <span className="text-emerald-600 font-medium">{cigar.store_count}</span> {cigar.store_count === 1 ? 'store' : 'stores'}
            </span>
          ) : (
            <span className="text-[9px] text-stone-700">Not stocked nearby</span>
          )}
          {cigar.min_price > 0 ? (
            <span className="text-[10px] text-stone-400">
              from <span className="text-amber-400 font-semibold">${cigar.min_price.toFixed(2)}</span>
            </span>
          ) : cigar.review_count > 0 ? (
            <span className="text-[9px] text-stone-600 flex items-center gap-0.5">
              <Star className="w-2.5 h-2.5" />{cigar.review_count}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
