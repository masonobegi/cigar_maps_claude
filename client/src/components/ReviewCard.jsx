import { Star, Clock, User } from 'lucide-react';

const FLAVOR_COLORS = {
  'cedar': 'bg-amber-900/30 text-amber-400',
  'leather': 'bg-yellow-900/30 text-yellow-500',
  'earth': 'bg-stone-700/50 text-stone-400',
  'coffee': 'bg-yellow-950/50 text-yellow-700',
  'chocolate': 'bg-amber-950/50 text-amber-700',
  'dark chocolate': 'bg-amber-950/60 text-amber-600',
  'espresso': 'bg-stone-800 text-stone-400',
  'pepper': 'bg-red-900/30 text-red-400',
  'cream': 'bg-stone-600/30 text-stone-300',
  'nuts': 'bg-yellow-900/30 text-yellow-400',
  'spice': 'bg-orange-900/30 text-orange-400',
  'floral': 'bg-pink-900/30 text-pink-400',
  'fruity': 'bg-purple-900/30 text-purple-400',
  'honey': 'bg-amber-800/30 text-amber-300',
  'default': 'bg-stone-800 text-stone-400',
};

function FlavorTag({ note }) {
  const cls = FLAVOR_COLORS[note.toLowerCase()] || FLAVOR_COLORS.default;
  return <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cls}`}>{note}</span>;
}

function MiniStars({ value, max = 5 }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i} className={`w-3 h-3 ${i < value ? 'text-amber-400 fill-amber-400' : 'text-stone-700'}`} />
      ))}
    </div>
  );
}

export default function ReviewCard({ review, showCigar = false }) {
  const date = new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="card p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-amber-900/50 flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-amber-500" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-stone-200 truncate">{review.user_name || 'Anonymous'}</p>
            {showCigar && (
              <p className="text-xs text-stone-500 truncate">{review.brand} {review.cigar_name} — {review.vitola_name}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-1.5 bg-amber-900/20 border border-amber-800/30 rounded-lg px-2 py-1">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span className="text-amber-300 font-bold text-sm">{review.rating}</span>
          </div>
          <p className="text-[10px] text-stone-600">{date}</p>
        </div>
      </div>

      {/* Vitola + pairing */}
      {(review.vitola_name || review.pairing || review.smoke_time) && (
        <div className="flex flex-wrap gap-2 text-xs text-stone-500">
          {review.vitola_name && <span>📏 {review.vitola_name}</span>}
          {review.smoke_time > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> {review.smoke_time}min
            </span>
          )}
          {review.pairing && <span>🥃 {review.pairing}</span>}
        </div>
      )}

      {/* Sub-ratings */}
      {(review.draw_rating || review.burn_rating || review.appearance_rating) && (
        <div className="grid grid-cols-3 gap-2 bg-stone-900/50 rounded-lg p-2">
          {review.draw_rating && (
            <div className="flex flex-col gap-0.5 items-center">
              <p className="text-[9px] text-stone-600 uppercase tracking-wider">Draw</p>
              <MiniStars value={review.draw_rating} />
            </div>
          )}
          {review.burn_rating && (
            <div className="flex flex-col gap-0.5 items-center">
              <p className="text-[9px] text-stone-600 uppercase tracking-wider">Burn</p>
              <MiniStars value={review.burn_rating} />
            </div>
          )}
          {review.appearance_rating && (
            <div className="flex flex-col gap-0.5 items-center">
              <p className="text-[9px] text-stone-600 uppercase tracking-wider">Look</p>
              <MiniStars value={review.appearance_rating} />
            </div>
          )}
        </div>
      )}

      {/* Review text */}
      {review.review_text && (
        <p className="text-sm text-stone-300 leading-relaxed">{review.review_text}</p>
      )}

      {/* Flavor notes */}
      {review.flavor_notes?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {review.flavor_notes.map(n => <FlavorTag key={n} note={n} />)}
        </div>
      )}
    </div>
  );
}
