import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Tag, Store, Calendar, Percent } from 'lucide-react';
import { api } from '../services/api';

export default function Deals() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDeals().then(setDeals).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-stone-100 mb-1">Deals & Events</h1>
        <p className="text-stone-500 text-sm">Current promotions from verified retailers</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-4">
          {[1,2,3].map(i => <div key={i} className="card h-28 animate-pulse bg-stone-800" />)}
        </div>
      ) : deals.length === 0 ? (
        <div className="text-center py-16">
          <Tag className="w-10 h-10 text-stone-700 mx-auto mb-3" />
          <p className="text-stone-400">No active deals right now. Check back soon.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {deals.map(d => (
            <div key={d.id} className="card p-5 border-amber-900/20 hover:border-amber-800/40 transition-colors">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {d.discount_percent ? <Percent className="w-5 h-5 text-amber-500" /> : <Calendar className="w-5 h-5 text-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold text-stone-100 leading-tight">{d.title}</h2>
                    {d.discount_percent && (
                      <span className="bg-amber-600 text-white text-sm font-bold px-2.5 py-1 rounded-full flex-shrink-0">
                        -{d.discount_percent}%
                      </span>
                    )}
                  </div>
                  {d.description && <p className="text-sm text-stone-400 mt-1.5 leading-relaxed">{d.description}</p>}
                  <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-stone-500">
                    <Link to={`/stores/${d.store_id}`} className="flex items-center gap-1 hover:text-amber-400 transition-colors">
                      <Store className="w-3 h-3" />{d.store_name}
                    </Link>
                    {d.cigar_name && (
                      <Link to={`/cigars/${d.cigar_id}`} className="flex items-center gap-1 hover:text-amber-400 transition-colors">
                        <Tag className="w-3 h-3" />{d.brand} {d.cigar_name}
                      </Link>
                    )}
                    {d.expires_at && (
                      <span>Expires {new Date(d.expires_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
