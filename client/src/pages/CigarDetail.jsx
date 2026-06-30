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

const NAVY  = '#DCE5F0';
const MUTED = '#7B8C9C';
const LABEL = '#96A8B8';
const AMBER = '#D4882A';

const STRENGTH_LABEL = { mild: 'Mild', 'mild-medium': 'Mild-Medium', medium: 'Medium', 'medium-full': 'Medium-Full', full: 'Full' };

const STRENGTH_BADGE = {
  mild:          { bg: '#0B3320', color: '#4ADE80', border: '#155E36' },
  'mild-medium': { bg: '#1A3A10', color: '#A3E635', border: '#2D6E1E' },
  medium:        { bg: '#3A2008', color: '#FCD34D', border: '#6B3D14' },
  'medium-full': { bg: '#3A1508', color: '#FB923C', border: '#6B2A14' },
  full:          { bg: '#3A0E0E', color: '#F87171', border: '#6B1A1A' },
};

const FLAVOR_COLORS = {
  cedar:           { bg: '#2E1E08', color: '#FCD34D' },
  leather:         { bg: '#2E2008', color: '#E8C96B' },
  earth:           { bg: '#1E2020', color: '#A8A29E' },
  coffee:          { bg: '#2E1E08', color: '#FCD34D' },
  chocolate:       { bg: '#2E1A08', color: '#FBB96B' },
  'dark chocolate':{ bg: '#2E1010', color: '#F87171' },
  espresso:        { bg: '#1E1A16', color: '#A8917A' },
  pepper:          { bg: '#2E1010', color: '#F87171' },
  cream:           { bg: '#1E2020', color: '#BEB8B0' },
  nuts:            { bg: '#2E2008', color: '#E8C96B' },
  spice:           { bg: '#2E1808', color: '#FB923C' },
  floral:          { bg: '#1E0E2E', color: '#D8B4FE' },
  honey:           { bg: '#2E1E08', color: '#FCD34D' },
  'dark fruit':    { bg: '#1E0E28', color: '#D8B4FE' },
  cocoa:           { bg: '#2E1010', color: '#F87171' },
  default:         { bg: '#1E2020', color: '#A8A29E' },
};

function ScoreGauge({ value }) {
  const color = value >= 95 ? '#4ADE80' : value >= 90 ? '#D4882A' : value >= 85 ? '#FB923C' : '#596B7A';
  return (
    <div className="relative w-20 h-20">
      <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#2B3D57" strokeWidth="3" />
        <circle cx="18" cy="18" r="15.9" fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={`${value} 100`}
          strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold" style={{color: NAVY}}>{value}</span>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{color: LABEL}}>{children}</p>
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
      if (d.vitolas.length > 0) setHumidorForm(f => ({ ...f, vitola_id: d.vitolas[0].id }));
    }).finally(() => setLoading(false));
  }, [id]);

  async function addToHumidor() {
    if (!user) return navigate('/login');
    setSaving(true);
    try {
      await api.addToHumidor({ cigar_id: id, ...humidorForm });
      setHumidorModal(false);
      toast('Added to your collection');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
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
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function addToSmokeList() {
    if (!user) return navigate('/login');
    try { await api.addToSmokeList({ cigar_id: id }); toast('Added to Smoke List'); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function toggleFollow() {
    if (!user) return navigate('/login');
    const { following: newVal } = await api.followCigar(id);
    setFollowing(newVal);
    setFollowerCount(c => newVal ? c + 1 : Math.max(0, c - 1));
    toast(newVal ? "Following — you'll be notified when stores stock this." : 'Unfollowed.');
  }

  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-4">
      <div className="h-8 skeleton rounded w-64" />
      <div className="h-4 skeleton rounded w-40" />
      <div className="h-48 skeleton rounded" />
    </div>
  );

  if (!data) return <div className="text-center py-20" style={{color: MUTED}}>Cigar not found</div>;

  const { cigar, vitolas, stats, top_flavors, similar = [] } = data;
  const sb = STRENGTH_BADGE[cigar.strength];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <BackButton />

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold uppercase tracking-wider mb-1" style={{color: AMBER}}>{cigar.brand}</p>
          <h1 className="font-serif text-2xl md:text-3xl font-bold leading-tight mb-2" style={{color: NAVY}}>{cigar.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" style={{color: MUTED}}>
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

      {/* Pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {cigar.strength && sb && (
          <span className="badge border text-xs font-semibold capitalize"
            style={{backgroundColor: sb.bg, color: sb.color, borderColor: sb.border}}>
            {STRENGTH_LABEL[cigar.strength]}
          </span>
        )}
        {cigar.wrapper && (
          <span className="badge border text-xs"
            style={{backgroundColor: '#1E2020', color: '#A8A29E', borderColor: '#2B3040'}}>
            {cigar.wrapper}
          </span>
        )}
        {availability.length > 0 && (
          <span className="badge border text-xs font-semibold"
            style={{backgroundColor: '#0B3320', color: '#4ADE80', borderColor: '#155E36'}}>
            <Store className="w-3 h-3 mr-1" />
            Available at {availability.length} store{availability.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Action buttons */}
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
        <button onClick={toggleFollow}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all"
          style={following
            ? { backgroundColor: '#FEF3C7', color: '#92400E', borderColor: '#FDE68A' }
            : { backgroundColor: '#1F2D42', color: NAVY, borderColor: '#2B3D57' }}>
          {following ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          {following ? 'Following' : 'Follow'}
          {followerCount > 0 && <span className="text-xs ml-1" style={{color: MUTED}}>({followerCount})</span>}
        </button>
      </div>

      {/* Tabs */}
      <div className="tab-bar mb-6">
        {['overview', 'vitolas', 'where to buy', 'reviews'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`tab-btn capitalize ${tab === t ? 'tab-btn-active' : 'tab-btn-inactive'}`}>
            {t === 'reviews' ? `Reviews (${stats.review_count})` : t}
            {t === 'where to buy' && availability.length > 0 && (
              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-bold"
                style={{backgroundColor: '#0B3320', color: '#4ADE80'}}>
                {availability.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          {cigar.description && (
            <div className="card p-5">
              <SectionLabel>About</SectionLabel>
              <p className="leading-relaxed" style={{color: '#BCC8D8'}}>{cigar.description}</p>
            </div>
          )}

          <div className="card p-5">
            <SectionLabel>Blend Details</SectionLabel>
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
                  <p className="text-xs uppercase tracking-wider mb-1" style={{color: LABEL}}>{label}</p>
                  <p className="text-sm font-semibold" style={{color: NAVY}}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {(cigar.flavor_notes.length > 0 || top_flavors.length > 0) && (
            <div className="card p-5">
              <SectionLabel>Flavor Profile</SectionLabel>
              <div className="flex flex-wrap gap-2 mb-3">
                {cigar.flavor_notes.map(n => {
                  const fc = FLAVOR_COLORS[n] || FLAVOR_COLORS.default;
                  return (
                    <span key={n} className="text-xs font-medium px-2.5 py-1 rounded-full border"
                      style={{backgroundColor: fc.bg, color: fc.color, borderColor: fc.bg}}>
                      {n}
                    </span>
                  );
                })}
              </div>
              {top_flavors.length > 0 && (
                <>
                  <p className="text-xs uppercase tracking-wider mb-2 mt-4" style={{color: LABEL}}>Reported by smokers</p>
                  <div className="flex flex-col gap-2">
                    {top_flavors.slice(0, 5).map(({ note, count }) => (
                      <div key={note} className="flex items-center gap-2">
                        <span className="text-sm w-28 capitalize" style={{color: NAVY}}>{note}</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{backgroundColor: '#2B3D57'}}>
                          <div className="h-full rounded-full bg-amber-600"
                            style={{ width: `${(count / top_flavors[0].count) * 100}%` }} />
                        </div>
                        <span className="text-xs w-5 text-right" style={{color: MUTED}}>{count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {stats.review_count > 0 && (
            <div className="card p-5">
              <SectionLabel>Score Breakdown</SectionLabel>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Overall', value: stats.avg_rating },
                  { label: 'Draw', value: stats.avg_draw * 20 },
                  { label: 'Burn', value: stats.avg_burn * 20 },
                  { label: 'Appearance', value: stats.avg_appearance * 20 },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span style={{color: MUTED}}>{label}</span>
                      <span className="font-semibold" style={{color: NAVY}}>{Math.round(value)}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{backgroundColor: '#2B3D57'}}>
                      <div className="h-full bg-amber-600 rounded-full" style={{ width: `${value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              {stats.avg_smoke_time > 0 && (
                <p className="text-xs mt-4 flex items-center gap-1" style={{color: MUTED}}>
                  <Clock className="w-3.5 h-3.5" /> Average smoke time: {stats.avg_smoke_time} minutes
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Vitolas */}
      {tab === 'vitolas' && (
        <div className="flex flex-col gap-3">
          {vitolas.length === 0 ? (
            <p className="text-center py-10" style={{color: MUTED}}>No sizes listed yet.</p>
          ) : vitolas.map(v => (
            <div key={v.id} className="card p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold" style={{color: NAVY}}>{v.name}</p>
                <p className="text-xs mt-0.5" style={{color: MUTED}}>{v.length}" × {v.ring_gauge} ring gauge</p>
              </div>
              {v.msrp && (
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wider mb-0.5" style={{color: LABEL}}>MSRP</p>
                  <p className="font-bold" style={{color: AMBER}}>${v.msrp.toFixed(2)}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Where to buy */}
      {tab === 'where to buy' && (
        <div className="flex flex-col gap-4">
          {availability.length === 0 ? (
            <div className="text-center py-12">
              <Store className="w-10 h-10 mx-auto mb-3" style={{color: '#3A4858'}} />
              <p className="font-medium" style={{color: NAVY}}>Not currently listed at any stores</p>
              <p className="text-sm mt-1" style={{color: MUTED}}>Check back later or search nearby shops</p>
            </div>
          ) : availability.map(store => (
            <div key={store.store_id} className="card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold" style={{color: NAVY}}>{store.name}</h3>
                    {store.verified && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold border"
                        style={{backgroundColor: '#0B3320', color: '#4ADE80', borderColor: '#155E36'}}>
                        Verified
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{color: MUTED}}>{store.city}, {store.state}</p>
                </div>
                {store.phone && (
                  <a href={`tel:${store.phone}`} className="text-xs font-medium hover:underline whitespace-nowrap"
                    style={{color: AMBER}}>
                    {store.phone}
                  </a>
                )}
              </div>
              <div className="flex flex-col gap-0">
                {store.vitolas.map(v => (
                  <div key={v.vitola_id} className="flex items-center justify-between py-2.5 border-t"
                    style={{borderColor: '#2B3D57'}}>
                    <div>
                      <span className="text-sm font-medium" style={{color: NAVY}}>{v.name}</span>
                      <span className="text-xs ml-2" style={{color: MUTED}}>{v.length}" × {v.ring_gauge}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-bold text-sm" style={{color: AMBER}}>${v.price.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reviews */}
      {tab === 'reviews' && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setReviewModal(true)} className="btn-primary w-full">Write a Review</button>
          {reviews.length === 0 ? (
            <p className="text-center py-10" style={{color: MUTED}}>No reviews yet. Be the first!</p>
          ) : reviews.map(r => <ReviewCard key={r.id} review={r} />)}
        </div>
      )}

      {/* Similar */}
      {similar.length > 0 && (
        <div className="mt-10 mb-2">
          <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{color: LABEL}}>You Might Also Like</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {similar.map(s => (
              <Link key={s.id} to={`/cigars/${s.id}`}
                className="card p-3.5 hover:shadow-md transition-shadow group">
                <p className="text-xs font-bold uppercase tracking-wider truncate mb-1" style={{color: AMBER}}>{s.brand}</p>
                <p className="text-sm font-semibold leading-tight line-clamp-2 group-hover:text-amber-700 transition-colors"
                  style={{color: NAVY}}>{s.name}</p>
                {s.avg_rating > 0 && (
                  <p className="text-xs mt-2 flex items-center gap-1" style={{color: MUTED}}>
                    <Star className="w-3 h-3 fill-amber-500 text-amber-500" />{Math.round(s.avg_rating)}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Humidor Modal */}
      {humidorModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
          onClick={() => setHumidorModal(false)}>
          <div className="card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-bold" style={{color: NAVY}}>Add to Collection</h2>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{color: MUTED}}>Size</label>
              <select className="input" value={humidorForm.vitola_id} onChange={e => setHumidorForm(f => ({ ...f, vitola_id: e.target.value }))}>
                {vitolas.map(v => <option key={v.id} value={v.id}>{v.name} ({v.length}" × {v.ring_gauge})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{color: MUTED}}>Status</label>
                <select className="input" value={humidorForm.status} onChange={e => setHumidorForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="humidor">In Humidor</option>
                  <option value="smoked">Already Smoked</option>
                  <option value="wishlist">Wishlist</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{color: MUTED}}>Quantity</label>
                <input type="number" min="1" className="input" value={humidorForm.quantity}
                  onChange={e => setHumidorForm(f => ({ ...f, quantity: +e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{color: MUTED}}>Price Paid</label>
                <input type="number" step="0.01" placeholder="0.00" className="input" value={humidorForm.purchase_price}
                  onChange={e => setHumidorForm(f => ({ ...f, purchase_price: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{color: MUTED}}>Date Purchased</label>
                <input type="date" className="input" value={humidorForm.purchase_date}
                  onChange={e => setHumidorForm(f => ({ ...f, purchase_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{color: MUTED}}>Notes</label>
              <textarea rows={2} className="input resize-none"
                placeholder="Tasting notes, occasion, where you got it..."
                value={humidorForm.notes}
                onChange={e => setHumidorForm(f => ({ ...f, notes: e.target.value }))} />
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

      {/* Review Modal */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 overflow-y-auto"
          onClick={() => setReviewModal(false)}>
          <div className="card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto p-5 my-auto"
            onClick={e => e.stopPropagation()}>
            <ReviewLogbookForm
              cigar={cigar} vitolas={vitolas} stores={stores}
              onSubmit={submitReview} onClose={() => setReviewModal(false)} saving={saving} />
          </div>
        </div>
      )}
    </div>
  );
}
