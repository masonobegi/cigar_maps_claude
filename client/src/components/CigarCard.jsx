import { Link } from 'react-router-dom';
import { Star, Store, MapPin } from 'lucide-react';

const NAVY  = '#12213D';
const AMBER = '#92510A';
const MUTED = '#6B7280';
const LABEL = '#4B5563';

const STRENGTH_CONFIG = {
  'mild':        { label: 'Mild',     bar: 'w-1/5',  barColor: '#22C55E',  textColor: '#166534' },
  'mild-medium': { label: 'Mild-Med', bar: 'w-2/5',  barColor: '#84CC16',  textColor: '#3F6212' },
  'medium':      { label: 'Medium',   bar: 'w-3/5',  barColor: '#F59E0B',  textColor: '#92400E' },
  'medium-full': { label: 'Med-Full', bar: 'w-4/5',  barColor: '#F97316',  textColor: '#9A3412' },
  'full':        { label: 'Full',     bar: 'w-full', barColor: '#EF4444',  textColor: '#991B1B' },
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
    <div className="w-3 h-3 rounded-full flex-shrink-0"
      style={{ backgroundColor: color, border: '1px solid #D4CFC8' }} title={wrapper} />
  ) : null;
}

function ScoreRing({ value, size = 36 }) {
  if (!value) return null;
  const color = value >= 95 ? '#059669' : value >= 90 ? '#D97706' : value >= 85 ? '#EA580C' : '#6B7280';
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="#E8E4DE" strokeWidth="3.5" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold" style={{ color }}>{value}</span>
      </div>
    </div>
  );
}

export default function CigarCard({ cigar }) {
  const sc = STRENGTH_CONFIG[cigar.strength];
  const rating = cigar.avg_rating || 0;

  return (
    <Link to={`/cigars/${cigar.id}`}
      className="card hover:shadow-md active:scale-[0.98] transition-all duration-150 group flex flex-col overflow-hidden">
      {/* Wrapper color strip */}
      <div className="h-1.5 w-full flex-shrink-0"
        style={{ backgroundColor:
          cigar.wrapper
            ? Object.entries(WRAPPER_COLORS).find(([k]) => cigar.wrapper?.toLowerCase().includes(k.toLowerCase()))?.[1] ?? '#4a3020'
            : '#4a3020'
        }} />

      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider truncate leading-none mb-1"
              style={{ color: AMBER }}>{cigar.brand}</p>
            <h3 className="font-semibold text-sm leading-tight line-clamp-2 transition-colors"
              style={{ color: NAVY }}
              onMouseEnter={e => e.currentTarget.style.color = AMBER}
              onMouseLeave={e => e.currentTarget.style.color = NAVY}>
              {cigar.name}
            </h3>
          </div>
          {rating > 0 && <ScoreRing value={rating} />}
        </div>

        {/* Strength bar */}
        {sc && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#E8E4DE' }}>
              <div className={`h-full ${sc.bar} rounded-full`} style={{ backgroundColor: sc.barColor }} />
            </div>
            <span className="text-xs font-semibold flex-shrink-0" style={{ color: sc.textColor }}>
              {sc.label}
            </span>
          </div>
        )}

        {/* Wrapper / country */}
        <div className="flex items-center gap-2 flex-wrap">
          {cigar.wrapper && (
            <div className="flex items-center gap-1">
              <WrapperSwatch wrapper={cigar.wrapper} />
              <span className="text-xs truncate max-w-20" style={{ color: LABEL }}>{cigar.wrapper}</span>
            </div>
          )}
          {cigar.country && (
            <span className="text-xs flex items-center gap-0.5 truncate" style={{ color: MUTED }}>
              <MapPin className="w-2.5 h-2.5" />{cigar.country.split(' ')[0]}
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-1.5"
          style={{ borderTop: '1px solid #EAE6E0' }}>
          {cigar.store_count > 0 ? (
            <span className="text-xs flex items-center gap-1" style={{ color: MUTED }}>
              <Store className="w-2.5 h-2.5" style={{ color: '#059669' }} />
              <span className="font-medium" style={{ color: '#059669' }}>{cigar.store_count}</span>
              {cigar.store_count === 1 ? ' store' : ' stores'}
            </span>
          ) : (
            <span className="text-xs" style={{ color: MUTED }}>Not stocked</span>
          )}
          {cigar.min_price > 0 ? (
            <span className="text-xs" style={{ color: MUTED }}>
              from <span className="font-semibold" style={{ color: AMBER }}>${cigar.min_price.toFixed(2)}</span>
            </span>
          ) : cigar.review_count > 0 ? (
            <span className="text-xs flex items-center gap-0.5" style={{ color: MUTED }}>
              <Star className="w-2.5 h-2.5" style={{ color: '#D97706' }} />{cigar.review_count}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
