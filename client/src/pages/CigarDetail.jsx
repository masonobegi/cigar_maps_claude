import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Star, MapPin, Store, Plus, Clock, BookOpen, ListChecks, Bell, BellOff } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ReviewCard from '../components/ReviewCard';
import ReviewLogbookForm from '../components/ReviewLogbookForm';
import ShareButton from '../components/ShareButton';
import BackButton from '../components/BackButton';
import { useRecentlyViewed } from '../hooks/useRecentlyViewed';

const STRENGTH_LABEL = { 'mild': 'Mild', 'mild-medium': 'Mild-Medium', 'medium': 'Medium', 'medium-full': 'Medium-Full', 'full': 'Full' };
const FLAVOR_COLORS = {
  'cedar': 'bg-amber-900/30 text-amber-400', 'leather': 'bg-yellow-900/30 text-yellow-500',
  'earth': 'bg-stone-700/40 text-stone-300', 'coffee': 'bg-yellow-950/60 text-yellow-600',
  'chocolate': 'bg-amber-950/50 text-amber-600', 'dark chocolate': 'bg-amber-950/60 text-amber-500',
  'espresso': 'bg-stone-800 text-stone-300', 'pepper': 'bg-red-900/30 text-red-400',
  'cream': 'bg-stone-600/30 text-stone-300', 'nuts': 'bg-yellow-900/30 text-yellow-400',
  'spice': 'bg-orange-900/30 text-orange-400', 'dark fruit': 'bg-purple-900/30 text-purple-400',
  'default': 'bg-stone-800 text-stone-400',
};

const ALL_FLAVOR_NOTES = ['cedar', 'leather', 'earth', 'coffee', 'chocolate', 'dark chocolate',
  'espresso', 'pepper', 'cream', 'nuts', 'spice', 'floral', 'fruity', 'honey', 'dark fruit', 'cocoa', 'salt'];

function ScoreGauge({ value }) {
  const color = value >= 95 ? '#10b981' : value >= 90 ? '#f59e0b' : value >= 85 ? '#fb923c' : '#94a3b8';
  return (
    <div className="relative w-20 h-20">
      <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#292524" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="15.9" fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={`${value} 100`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-stone-100">{value}</span>
        <span className="text-[9px] text-stone-500 uppercase tracking-wider">rating</span>
      </div>
    </div>
  );
}

export default function CigarDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { add: addRecentlyViewed } = useRecentlyViewed();
  const [data, setData] = useState(null);
  const [availability, setAvailability] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [humidorModal, setHumidorModal] = useState(false);
  const [reviewModal, setReviewModal] = useState(false);
  const [humidorForm, setHumidorForm] = useState({ vitola_id: '', status: 'humidor', quantity: 1, purchase_price: '', purchase_date: '', notes: '' });
  const [stores, setStores] = useState([]);
  const [saving, setSaving] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);

  useEffect(() => {
    Promise.all([
      api.getCigar(id),
      api.getCigarAvailability(id),
      api.getCigarReviews(id, { limit: 20 }),
      api.searchStores(),
      api.getCigarFollowStatus(id),
    ]).then(([d, avail, rev, storeList, followStatus]) => {
      setData(d);
      setAvailability(avail);
      setReviews(rev.reviews);
      setStores(storeList);
      setFollowing(followStatus.following);
      setFollowerCount(followStatus.follower_count);
      addRecentlyViewed(d.cigar);
      if (d.vitolas.length > 0) {
        setHumidorForm(f => ({ ...f, vitola_id: d.vitolas[0].id }));
      }
    }).finally(() => setLoading(false));
  }, [id]);

  async function addToHumidor() {
    if (!user) return navigate('/login');
    setSaving(true);
    try {
      await api.addToHumidor({ cigar_id: id, ...humidorForm });
      setHumidorModal(false);
      toast('Added to your collection');
      
    } catch (e) {
      toast(e.message, 'error');
    } finally { setSaving(false); }
  }

  async function submitReview(form) {
    if (!user) return navigate('/login');
    setSaving(true);
    try {
      await api.postReview(id, form);
      const rev = await api.getCigarReviews(id, { limit: 20 });
      setReviews(rev.reviews);
      setReviewModal(false);
      toast('Saved to your journal');
      
    } catch (e) {
      toast(e.message, 'error');
    } finally { setSaving(false); }
  }

  async function addToSmokeList() {
    if (!user) return navigate('/login');
    try {
      await api.addToSmokeList({ cigar_id: id });
      toast('Added to Smoke List');
      
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function toggleFollow() {
    if (!user) return navigate('/login');
    const { following: newVal } = await api.followCigar(id);
    setFollowing(newVal);
    setFollowerCount(c => newVal ? c + 1 : Math.max(0, c - 1));
    toast(newVal ? "Following — you'll be notified when stores stock this." : 'Unfollowed.');
  }

  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-stone-800 rounded w-64" />
        <div className="h-4 bg-stone-800 rounded w-40" />
        <div className="h-48 bg-stone-800 rounded" />
      </div>
    </div>
  );

  if (!data) return <div className="text-center py-20 text-stone-500">Cigar not found</div>;

  const { cigar, vitolas, stats, top_flavors } = data;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <BackButton />

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <p className="text-amber-500 text-sm font-semibold uppercase tracking-wider mb-1">{cigar.brand}</p>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-stone-50 leading-tight mb-2">{cigar.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
            {cigar.country && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{cigar.country}</span>}
            {cigar.wrapper && <span>· {cigar.wrapper} wrapper</span>}
            {cigar.year_introduced && <span>· Est. {cigar.year_introduced}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {stats.review_count > 0 && <ScoreGauge value={stats.avg_rating} />}
          <ShareButton title={`${cigar.brand} ${cigar.name}`} text={`Check out ${cigar.brand} ${cigar.name} on CigarBuddy`} />
        </div>
      </div>

      {/* Quick info pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {cigar.strength && (
          <span className={`badge capitalize border ${
            { mild: 'bg-green-900/40 text-green-400 border-green-800/50', 'mild-medium': 'bg-lime-900/40 text-lime-400 border-lime-800/50', medium: 'bg-amber-900/40 text-amber-400 border-amber-800/50', 'medium-full': 'bg-orange-900/40 text-orange-400 border-orange-800/50', full: 'bg-red-900/40 text-red-400 border-red-800/50' }[cigar.strength]
          }`}>
            {STRENGTH_LABEL[cigar.strength]} Body
          </span>
        )}
        {cigar.wrapper && <span className="badge bg-stone-800 text-stone-300 border border-stone-700">{cigar.wrapper}</span>}
        {availability.length > 0 && (
          <span className="badge bg-emerald-900/30 text-emerald-400 border border-emerald-800/40">
            <Store className="w-3 h-3 mr-1" /> Available at {availability.length} store{availability.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Action buttons — mobile: 2-col grid, desktop: row */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mb-8">
        <button onClick={() => setHumidorModal(true)} className="btn-primary flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> Add to Humidor
        </button>
        <button onClick={() => setReviewModal(true)} className="btn-secondary flex items-center justify-center gap-2">
          <BookOpen className="w-4 h-4" /> Log to Journal
        </button>
        <button onClick={addToSmokeList} className="btn-secondary flex items-center justify-center gap-2">
          <ListChecks className="w-4 h-4" /> Smoke List
        </button>
        <button
          onClick={toggleFollow}
          className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-semibold transition-all ${
            following ? 'border-amber-700 bg-amber-900/20 text-amber-400' : 'btn-secondary'
          }`}
        >
          {following ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          {following ? 'Following' : 'Follow'}
          {followerCount > 0 && <span className="text-xs text-stone-500 ml-1">({followerCount})</span>}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-stone-800 mb-6 gap-1 overflow-x-auto">
        {['overview', 'vitolas', 'where to buy', 'reviews'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors capitalize ${
              tab === t ? 'text-amber-400 border-b-2 border-amber-400' : 'text-stone-500 hover:text-stone-300'
            }`}
          >
            {t === 'reviews' ? `Reviews (${stats.review_count})` : t}
            {t === 'where to buy' && availability.length > 0 && (
              <span className="ml-1 bg-emerald-800 text-emerald-300 text-[10px] px-1.5 rounded-full">{availability.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-6">
          {cigar.description && (
            <div className="card p-5">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">About</h3>
              <p className="text-stone-300 leading-relaxed">{cigar.description}</p>
            </div>
          )}

          {/* Blend */}
          <div className="card p-5">
            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-4">Blend Details</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: 'Wrapper', value: cigar.wrapper },
                { label: 'Binder', value: cigar.binder },
                { label: 'Filler', value: cigar.filler },
                { label: 'Origin', value: cigar.country },
                { label: 'Strength', value: STRENGTH_LABEL[cigar.strength] },
                { label: 'Est.', value: cigar.year_introduced },
              ].filter(i => i.value).map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] text-stone-600 uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="text-sm text-stone-300 font-medium">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Flavor profile */}
          {(cigar.flavor_notes.length > 0 || top_flavors.length > 0) && (
            <div className="card p-5">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Flavor Profile</h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {cigar.flavor_notes.map(n => (
                  <span key={n} className={`text-xs font-medium px-2.5 py-1 rounded-full ${FLAVOR_COLORS[n] || FLAVOR_COLORS.default}`}>
                    {n}
                  </span>
                ))}
              </div>
              {top_flavors.length > 0 && (
                <>
                  <p className="text-[10px] text-stone-600 uppercase tracking-wider mb-2 mt-4">Reported by smokers</p>
                  <div className="flex flex-col gap-1.5">
                    {top_flavors.slice(0, 5).map(({ note, count }) => (
                      <div key={note} className="flex items-center gap-2">
                        <span className="text-xs text-stone-400 w-24 capitalize">{note}</span>
                        <div className="flex-1 h-1.5 bg-stone-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-600 rounded-full"
                            style={{ width: `${(count / top_flavors[0].count) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-stone-600 w-6 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Score breakdown */}
          {stats.review_count > 0 && (
            <div className="card p-5">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-4">Score Breakdown</h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Overall', value: stats.avg_rating, max: 100 },
                  { label: 'Draw', value: stats.avg_draw * 20, max: 100 },
                  { label: 'Burn', value: stats.avg_burn * 20, max: 100 },
                  { label: 'Appearance', value: stats.avg_appearance * 20, max: 100 },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-stone-500">{label}</span>
                      <span className="text-stone-300 font-medium">{Math.round(value)}</span>
                    </div>
                    <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-600 rounded-full" style={{ width: `${value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              {stats.avg_smoke_time > 0 && (
                <p className="text-xs text-stone-500 mt-4 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Average smoke time: {stats.avg_smoke_time} minutes
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Vitolas tab */}
      {tab === 'vitolas' && (
        <div className="flex flex-col gap-3">
          {vitolas.length === 0 ? (
            <p className="text-stone-500 text-center py-10">No sizes listed yet.</p>
          ) : vitolas.map(v => (
            <div key={v.id} className="card p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-stone-200">{v.name}</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  {v.length}" × {v.ring_gauge} ring gauge
                </p>
              </div>
              {v.msrp && (
                <div className="text-right">
                  <p className="text-[10px] text-stone-600 uppercase tracking-wider">MSRP</p>
                  <p className="font-bold text-amber-400">${v.msrp.toFixed(2)}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Where to buy tab */}
      {tab === 'where to buy' && (
        <div className="flex flex-col gap-4">
          {availability.length === 0 ? (
            <div className="text-center py-12">
              <Store className="w-10 h-10 text-stone-700 mx-auto mb-3" />
              <p className="text-stone-400 font-medium">Not currently listed at any stores</p>
              <p className="text-stone-600 text-sm mt-1">Check back later or search nearby shops</p>
            </div>
          ) : availability.map(store => (
            <div key={store.store_id} className="card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-stone-200">{store.name}</h3>
                    {store.verified && <span className="text-[10px] bg-emerald-900/40 text-emerald-400 border border-emerald-800/40 px-1.5 py-0.5 rounded-full">Verified</span>}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">{store.city}, {store.state}</p>
                </div>
                {store.phone && (
                  <a href={`tel:${store.phone}`} className="text-xs text-amber-400 hover:underline whitespace-nowrap">
                    {store.phone}
                  </a>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {store.vitolas.map(v => (
                  <div key={v.vitola_id} className="flex items-center justify-between text-sm border-t border-stone-800/50 pt-2">
                    <div>
                      <span className="text-stone-300 font-medium">{v.name}</span>
                      <span className="text-stone-600 text-xs ml-2">{v.length}" × {v.ring_gauge}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-stone-600">{v.quantity} in stock</span>
                      <span className="font-bold text-amber-400">${v.price.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reviews tab */}
      {tab === 'reviews' && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setReviewModal(true)} className="btn-primary w-full">
            Write a Review
          </button>
          {reviews.length === 0 ? (
            <p className="text-stone-500 text-center py-10">No reviews yet. Be the first!</p>
          ) : reviews.map(r => <ReviewCard key={r.id} review={r} />)}
        </div>
      )}

      {/* Humidor Modal */}
      {humidorModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70" onClick={() => setHumidorModal(false)}>
          <div className="bg-stone-900 border border-stone-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-bold text-stone-100">Add to Collection</h2>
            <div>
              <label className="block text-xs text-stone-400 mb-1.5">Size</label>
              <select className="input" value={humidorForm.vitola_id} onChange={e => setHumidorForm(f => ({ ...f, vitola_id: e.target.value }))}>
                {vitolas.map(v => <option key={v.id} value={v.id}>{v.name} ({v.length}" × {v.ring_gauge})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Status</label>
                <select className="input" value={humidorForm.status} onChange={e => setHumidorForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="humidor">In Humidor</option>
                  <option value="smoked">Already Smoked</option>
                  <option value="wishlist">Wishlist</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Quantity</label>
                <input type="number" min="1" className="input" value={humidorForm.quantity} onChange={e => setHumidorForm(f => ({ ...f, quantity: +e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Price Paid</label>
                <input type="number" step="0.01" placeholder="0.00" className="input" value={humidorForm.purchase_price} onChange={e => setHumidorForm(f => ({ ...f, purchase_price: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Date Purchased</label>
                <input type="date" className="input" value={humidorForm.purchase_date} onChange={e => setHumidorForm(f => ({ ...f, purchase_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1.5">Notes</label>
              <textarea rows={2} className="input resize-none" placeholder="Tasting notes, occasion, where you got it..." value={humidorForm.notes} onChange={e => setHumidorForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setHumidorModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={addToHumidor} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Adding...' : 'Add to Collection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review / Logbook Modal */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 overflow-y-auto" onClick={() => setReviewModal(false)}>
          <div className="bg-stone-900 border border-stone-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto p-5 my-auto" onClick={e => e.stopPropagation()}>
            <ReviewLogbookForm
              cigar={cigar}
              vitolas={vitolas}
              stores={stores}
              onSubmit={submitReview}
              onClose={() => setReviewModal(false)}
              saving={saving}
            />
          </div>
        </div>
      )}
    </div>
  );
}
