import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Tag, Store, Calendar, Percent } from 'lucide-react';
import { api } from '../services/api';

const NAVY  = '#E8DDD0';
const MUTED = '#9E8E7E';
const AMBER = '#D4882A';

export default function Deals() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDeals().then(setDeals).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold mb-1" style={{color: NAVY}}>Deals & Events</h1>
        <p className="text-sm" style={{color: MUTED}}>Current promotions from verified retailers</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-4">
          {[1,2,3].map(i => <div key={i} className="card h-28 skeleton" />)}
        </div>
      ) : deals.length === 0 ? (
        <div className="text-center py-16">
          <Tag className="w-10 h-10 mx-auto mb-3" style={{color: '#D4CFC8'}} />
          <p style={{color: MUTED}}>No active deals right now. Check back soon.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {deals.map(d => (
            <Link key={d.id} to={`/stores/${d.store_id}?tab=deals`} className="card p-5 transition-colors block"
              onMouseEnter={e => e.currentTarget.style.borderColor = '#C8C0B8'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#E8E4DE'}>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{backgroundColor: '#FEF3C7'}}>
                  {d.discount_percent
                    ? <Percent className="w-5 h-5" style={{color: AMBER}} />
                    : <Calendar className="w-5 h-5" style={{color: AMBER}} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold leading-tight" style={{color: NAVY}}>{d.title}</h2>
                    {d.discount_percent && (
                      <span className="bg-amber-700 text-white text-sm font-bold px-2.5 py-1 rounded-full flex-shrink-0">
                        -{d.discount_percent}%
                      </span>
                    )}
                  </div>
                  {d.description && (
                    <p className="text-sm mt-1.5 leading-relaxed" style={{color: MUTED}}>{d.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 mt-3 text-xs" style={{color: '#9CA3AF'}}>
                    <Link to={`/stores/${d.store_id}?tab=deals`} className="flex items-center gap-1 transition-colors"
                      onClick={e => e.stopPropagation()}
                      onMouseEnter={e => e.currentTarget.style.color = AMBER}
                      onMouseLeave={e => e.currentTarget.style.color = '#9CA3AF'}>
                      <Store className="w-3 h-3" />{d.store_name}
                    </Link>
                    {d.cigar_name && (
                      <Link to={`/cigars/${d.cigar_id}`} className="flex items-center gap-1 transition-colors"
                        onClick={e => e.stopPropagation()}
                        onMouseEnter={e => e.currentTarget.style.color = AMBER}
                        onMouseLeave={e => e.currentTarget.style.color = '#9CA3AF'}>
                        <Tag className="w-3 h-3" />{d.brand} {d.cigar_name}
                      </Link>
                    )}
                    {d.expires_at && (
                      <span>Expires {new Date(d.expires_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
