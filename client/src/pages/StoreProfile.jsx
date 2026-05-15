import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Store, MapPin, Phone, Globe, Clock, Package, Heart, CheckCircle, Tag, Star, Users, Bell, BellOff, Package2, Navigation, X, Search } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function StarRating({ value, onChange, size = 'md' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button" onClick={() => onChange && onChange(n)} className="transition-transform hover:scale-110">
          <Star className={`${sz} ${n <= value ? 'text-amber-400 fill-amber-400' : 'text-stone-700'}`} />
        </button>
      ))}
    </div>
  );
}

export default function StoreProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followPrefs, setFollowPrefs] = useState({ notify_broadcasts: 1, notify_deals: 1, notify_new_arrivals: 1 });
  const [tab, setTab] = useState('inventory');
  const [search, setSearch] = useState('');
  const [ratingForm, setRatingForm] = useState({ rating: 0, comment: '' });
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [requestModal, setRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState({ cigar_id: '', cigar_name_free: '', message: '' });
  const [reqCigarSearch, setReqCigarSearch] = useState('');
  const [reqCigarResults, setReqCigarResults] = useState([]);
  const [reqSelectedCigar, setReqSelectedCigar] = useState(null);
  const [reqSubmitted, setReqSubmitted] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    Promise.all([
      api.getStore(id),
      api.getStoreInventory(id, { limit: 200 }),
    ]).then(([d, inv]) => {
      setData(d);
      setInventory(inv.items);
      setFollowing(d.is_following);
      if (d.follow_prefs) setFollowPrefs(d.follow_prefs);
    }).finally(() => setLoading(false));
  }, [id]);

  async function handleFollow() {
    if (!user) return;
    const res = await api.followStore(id);
    setFollowing(res.following);
  }

  async function updatePrefs(key, val) {
    const next = { ...followPrefs, [key]: val ? 1 : 0 };
    setFollowPrefs(next);
    await api.updateFollowPrefs(id, next);
  }

  async function submitRating() {
    if (!ratingForm.rating) return;
    await api.rateStore(id, ratingForm);
    setRatingSubmitted(true);
    const updated = await api.getStore(id);
    setData(updated);
  }

  async function searchRequestCigars(q) {
    if (q.length < 2) { setReqCigarResults([]); return; }
    const { cigars } = await api.searchCigars({ q, limit: 6 });
    setReqCigarResults(cigars);
  }

  async function submitRequest() {
    if (!user) { navigate('/login'); return; }
    if (!reqSelectedCigar && !requestForm.cigar_name_free) return;
    await api.submitInventoryRequest(id, {
      cigar_id: reqSelectedCigar?.id || null,
      cigar_name_free: requestForm.cigar_name_free || null,
      message: requestForm.message || null,
    });
    setReqSubmitted(true);
    setToast('Request sent to the store!');
    setTimeout(() => setToast(''), 3000);
    setRequestModal(false);
    setReqSelectedCigar(null);
    setReqCigarSearch('');
    setRequestForm({ cigar_id: '', cigar_name_free: '', message: '' });
  }

  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-pulse space-y-4">
      <div className="h-8 bg-stone-800 rounded w-64" />
      <div className="h-32 bg-stone-800 rounded" />
    </div>
  );

  if (!data) return <div className="text-center py-20 text-stone-500">Store not found</div>;

  const { store, inventory_count, deals, stats, recent_ratings, new_arrivals } = data;
  const hours = typeof store.hours === 'object' ? store.hours : {};

  // Open now calculation
  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = dayNames[now.getDay()];
  const dayIdx = DAYS.indexOf(today);
  const todayHours = hours[today];
  let isOpen = null;
  if (todayHours && todayHours !== 'Closed') {
    const match = todayHours.match(/(\d+)(?::(\d+))?(am|pm)-(\d+)(?::(\d+))?(am|pm)/i);
    if (match) {
      let oh = parseInt(match[1]); const oap = match[3].toLowerCase();
      let ch = parseInt(match[4]); const cap = match[6].toLowerCase();
      if (oap === 'pm' && oh !== 12) oh += 12; if (oap === 'am' && oh === 12) oh = 0;
      if (cap === 'pm' && ch !== 12) ch += 12; if (cap === 'am' && ch === 12) ch = 0;
      isOpen = now.getHours() >= oh && now.getHours() < ch;
    }
  } else if (todayHours === 'Closed') isOpen = false;

  // Group inventory by cigar
  const filteredInv = inventory.filter(i =>
    !search || i.brand.toLowerCase().includes(search.toLowerCase()) ||
    i.cigar_name.toLowerCase().includes(search.toLowerCase())
  );
  const byCigar = {};
  for (const item of filteredInv) {
    if (!byCigar[item.cigar_id]) byCigar[item.cigar_id] = { ...item, vitolas: [] };
    byCigar[item.cigar_id].vitolas.push({ vitola_id: item.vitola_id, name: item.vitola_name, price: item.price, quantity: item.quantity, is_new_arrival: item.is_new_arrival });
  }

  const TABS = [
    { key: 'inventory', label: `Inventory (${inventory_count})` },
    { key: 'new', label: `New Arrivals (${new_arrivals.length})` },
    { key: 'deals', label: `Deals (${deals.length})` },
    { key: 'about', label: 'About' },
  ];

  const mapsUrl = store.address
    ? `https://maps.google.com/?q=${encodeURIComponent([store.address, store.city, store.state].filter(Boolean).join(', '))}`
    : `https://maps.google.com/?q=${encodeURIComponent([store.name, store.city, store.state].filter(Boolean).join(', '))}`;

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6">
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-stone-800 border border-stone-700 text-stone-100 text-sm px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />{toast}
        </div>
      )}

      {/* Store header card */}
      <div className="card mb-4 overflow-hidden">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-900/30 flex items-center justify-center flex-shrink-0">
            <Store className="w-7 h-7 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="font-serif text-xl font-bold text-stone-100">{store.name}</h1>
              {store.verified === 1 && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
              {isOpen !== null && (
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${isOpen ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/30 text-red-500'}`}>
                  {isOpen ? '● Open Now' : '● Closed'}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-500">
              {(store.address || store.city) && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />{[store.address, store.city, store.state].filter(Boolean).join(', ')}
                </span>
              )}
              {store.phone && <a href={`tel:${store.phone}`} className="flex items-center gap-1 hover:text-amber-400"><Phone className="w-3.5 h-3.5" />{store.phone}</a>}
              {store.website && <a href={`https://${store.website}`} target="_blank" rel="noopener" className="flex items-center gap-1 hover:text-amber-400"><Globe className="w-3.5 h-3.5" />{store.website}</a>}
            </div>

            {/* Tags */}
            {store.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {store.tags.map(t => <span key={t} className="text-xs bg-stone-800 text-stone-400 px-2.5 py-0.5 rounded-full">{t}</span>)}
              </div>
            )}

            {/* Stats row */}
            <div className="flex flex-wrap gap-4 mt-3 text-xs text-stone-500">
              <span className="flex items-center gap-1"><Package className="w-3 h-3" />{inventory_count} SKUs</span>
              <span className="flex items-center gap-1"><Users className="w-3 h-3" />{stats.followers} followers</span>
              {stats.avg_rating > 0 && (
                <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" />{stats.avg_rating} ({stats.rating_count} ratings)</span>
              )}
            </div>
          </div>
        </div>

        {/* Follow button area */}
        {user && user.account_type === 'user' && (
          <div className="mt-4 pt-4 border-t border-stone-800 flex flex-wrap items-center gap-3 px-5 pb-4">
            <button onClick={handleFollow} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${following ? 'bg-amber-900/30 border border-amber-700 text-amber-400' : 'btn-primary'}`}>
              <Heart className={`w-4 h-4 ${following ? 'fill-amber-400' : ''}`} />
              {following ? 'Following' : 'Follow'}
            </button>

            <button onClick={() => setRequestModal(true)} className="btn-secondary text-sm flex items-center gap-2">
              <Package className="w-4 h-4" /> Request a Cigar
            </button>

            {following && (
              <button onClick={() => setShowPrefs(!showPrefs)} className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors ml-auto">
                <Bell className="w-3.5 h-3.5" /> Alerts
              </button>
            )}
          </div>
        )}

        {following && showPrefs && (
          <div className="mx-5 mb-4 bg-stone-800/50 rounded-xl p-3">
            <p className="text-xs text-stone-500 mb-2">Notify me when this store posts:</p>
            <div className="flex flex-wrap gap-4">
              {[
                { key: 'notify_broadcasts', label: 'Announcements' },
                { key: 'notify_deals', label: 'Deals' },
                { key: 'notify_new_arrivals', label: 'New Arrivals' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!followPrefs[key]} onChange={e => updatePrefs(key, e.target.checked)} className="accent-amber-500" />
                  <span className="text-sm text-stone-300">{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Quick contact bar — always visible, mobile-optimized */}
        <div className="flex border-t border-stone-800">
          {store.phone && (
            <a href={`tel:${store.phone}`}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-stone-500 hover:text-amber-400 hover:bg-stone-800/40 transition-colors">
              <Phone className="w-5 h-5" />
              <span className="text-[10px] font-medium">Call</span>
            </a>
          )}
          <a href={mapsUrl} target="_blank" rel="noopener"
            className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-stone-500 hover:text-amber-400 hover:bg-stone-800/40 transition-colors border-l border-stone-800">
            <Navigation className="w-5 h-5" />
            <span className="text-[10px] font-medium">Directions</span>
          </a>
          {store.website && (
            <a href={`https://${store.website}`} target="_blank" rel="noopener"
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-stone-500 hover:text-amber-400 hover:bg-stone-800/40 transition-colors border-l border-stone-800">
              <Globe className="w-5 h-5" />
              <span className="text-[10px] font-medium">Website</span>
            </a>
          )}
          <button onClick={() => { if (!user) navigate('/login'); else setRequestModal(true); }}
            className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-stone-500 hover:text-amber-400 hover:bg-stone-800/40 transition-colors border-l border-stone-800">
            <Package className="w-5 h-5" />
            <span className="text-[10px] font-medium">Request</span>
          </button>
        </div>
      </div>

      {/* Today's hours highlight */}
      {todayHours && (
        <div className={`rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2 text-sm ${isOpen ? 'bg-emerald-900/20 border border-emerald-900/30' : 'bg-stone-800/50 border border-stone-800'}`}>
          <Clock className={`w-4 h-4 ${isOpen ? 'text-emerald-400' : 'text-stone-500'}`} />
          <span className="text-stone-300">Today: <span className="font-medium">{todayHours}</span></span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-stone-800 mb-5 gap-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${tab === t.key ? 'text-amber-400 border-b-2 border-amber-400' : 'text-stone-500 hover:text-stone-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Inventory */}
      {tab === 'inventory' && (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search this store's inventory..." className="input mb-4" />
          {Object.values(byCigar).length === 0 ? (
            <p className="text-stone-500 text-center py-10">No inventory found.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {Object.values(byCigar).map(item => (
                <Link key={item.cigar_id} to={`/cigars/${item.cigar_id}`} className="card p-4 hover:border-stone-600 transition-colors group">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        {item.is_featured === 1 && <span className="text-[9px] bg-amber-900/40 text-amber-400 border border-amber-800/40 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Featured</span>}
                      </div>
                      <p className="text-xs text-amber-500/80 font-medium uppercase tracking-wider">{item.brand}</p>
                      <h3 className="font-semibold text-stone-200 group-hover:text-amber-300 transition-colors mt-0.5">{item.cigar_name}</h3>
                      <p className="text-xs text-stone-600 mt-0.5 capitalize">{item.strength} · {item.country}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.vitolas.map(v => (
                      <div key={v.vitola_id} className="bg-stone-800 rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5">
                        {v.is_new_arrival === 1 && <span className="text-blue-400 text-[9px] font-bold uppercase">NEW</span>}
                        <span className="text-stone-300 font-medium">{v.name}</span>
                        <span className="text-amber-400 font-bold">${v.price.toFixed(2)}</span>
                        {v.quantity > 0 && v.quantity <= 3
                          ? <span className="text-red-400 text-[9px] font-bold">Only {v.quantity} left!</span>
                          : v.quantity > 0 && v.quantity <= 8
                          ? <span className="text-orange-400 text-[9px]">{v.quantity} left</span>
                          : <span className="text-stone-600 text-[9px]">{v.quantity} in stock</span>
                        }
                      </div>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* New Arrivals */}
      {tab === 'new' && (
        <div className="flex flex-col gap-3">
          {new_arrivals.length === 0 ? (
            <p className="text-stone-500 text-center py-10">No new arrivals right now.</p>
          ) : new_arrivals.map(item => (
            <Link key={item.id} to={`/cigars/${item.cigar_id}`} className="card p-4 hover:border-stone-600 transition-colors group">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Package2 className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-amber-500/70">{item.brand}</p>
                  <p className="font-semibold text-stone-200 group-hover:text-amber-300 transition-colors text-sm">{item.cigar_name} — {item.vitola_name}</p>
                </div>
                <p className="font-bold text-amber-400 flex-shrink-0">${item.price.toFixed(2)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Deals */}
      {tab === 'deals' && (
        <div className="flex flex-col gap-4">
          {deals.length === 0 ? (
            <p className="text-stone-500 text-center py-10">No active deals right now.</p>
          ) : deals.map(d => (
            <div key={d.id} className="card p-4 border-amber-900/20">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-semibold text-stone-100">{d.title}</h3>
                {d.discount_percent && <span className="bg-amber-600 text-white text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0">-{d.discount_percent}%</span>}
              </div>
              {d.description && <p className="text-sm text-stone-400 mb-2">{d.description}</p>}
              {d.expires_at && <p className="text-xs text-stone-600">Expires {new Date(d.expires_at).toLocaleDateString()}</p>}
            </div>
          ))}
        </div>
      )}

      {/* About */}
      {tab === 'about' && (
        <div className="flex flex-col gap-5">
          {store.description && (
            <div className="card p-5">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">About</h3>
              <p className="text-stone-300 leading-relaxed">{store.description}</p>
            </div>
          )}

          {/* Hours */}
          {Object.keys(hours).length > 0 && (
            <div className="card p-5">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Hours</h3>
              <div className="flex flex-col gap-1.5">
                {DAYS.map(day => {
                  const h = hours[day];
                  const isToday = day === today;
                  return (
                    <div key={day} className={`flex justify-between text-sm py-1 ${isToday ? 'text-amber-400 font-medium' : 'text-stone-500'}`}>
                      <span>{isToday ? `${day} (today)` : day}</span>
                      <span className={h === 'Closed' ? 'text-red-500' : ''}>{h || '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ratings */}
          <div className="card p-5">
            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-4">Customer Ratings</h3>
            {stats.rating_count > 0 && (
              <div className="flex items-center gap-4 mb-4 pb-4 border-b border-stone-800">
                <div className="text-center">
                  <div className="text-3xl font-bold text-amber-400">{stats.avg_rating}</div>
                  <StarRating value={Math.round(stats.avg_rating)} size="sm" />
                  <p className="text-xs text-stone-600 mt-1">{stats.rating_count} ratings</p>
                </div>
              </div>
            )}
            {recent_ratings.map(r => (
              <div key={r.id} className="py-3 border-b border-stone-800/50 last:border-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium text-stone-300">{r.user_name}</p>
                  <StarRating value={r.rating} size="sm" />
                </div>
                {r.comment && <p className="text-xs text-stone-500">{r.comment}</p>}
              </div>
            ))}

            {user && user.account_type === 'user' && !ratingSubmitted && (
              <div className="mt-4 pt-4 border-t border-stone-800">
                <p className="text-sm font-medium text-stone-300 mb-2">Rate this store</p>
                <StarRating value={ratingForm.rating} onChange={r => setRatingForm(f => ({ ...f, rating: r }))} />
                <textarea rows={2} className="input resize-none mt-2 text-sm" placeholder="Leave a comment (optional)..." value={ratingForm.comment} onChange={e => setRatingForm(f => ({ ...f, comment: e.target.value }))} />
                <button onClick={submitRating} disabled={!ratingForm.rating} className="btn-primary text-sm mt-2 disabled:opacity-50">Submit Rating</button>
              </div>
            )}
            {ratingSubmitted && <p className="text-xs text-emerald-400 mt-2">Thanks for your rating!</p>}
          </div>
        </div>
      )}

      {/* Request Inventory Modal */}
      {requestModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70" onClick={() => setRequestModal(false)}>
          <div className="bg-stone-900 border border-stone-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg font-bold text-stone-100">Request a Cigar</h2>
              <button onClick={() => setRequestModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-stone-400 -mt-2">
              Let <span className="text-stone-300 font-medium">{store.name}</span> know what you'd like them to stock.
            </p>

            <div>
              <label className="block text-xs text-stone-400 mb-1.5">Search the Catalog</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
                <input
                  className="input pl-10 text-sm"
                  placeholder="Type a brand or cigar name..."
                  value={reqCigarSearch}
                  onChange={e => { setReqCigarSearch(e.target.value); searchRequestCigars(e.target.value); if (!e.target.value) setReqSelectedCigar(null); }}
                />
              </div>
              {reqCigarResults.length > 0 && !reqSelectedCigar && (
                <div className="mt-1 border border-stone-700 rounded-xl overflow-hidden shadow-xl">
                  {reqCigarResults.map(c => (
                    <button key={c.id} onClick={() => { setReqSelectedCigar(c); setReqCigarSearch(`${c.brand} ${c.name}`); setReqCigarResults([]); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-stone-800 border-b border-stone-800/50 last:border-0">
                      <p className="text-sm font-medium text-stone-200">{c.brand} {c.name}</p>
                      <p className="text-xs text-stone-500 capitalize">{c.strength} · {c.country}</p>
                    </button>
                  ))}
                </div>
              )}
              {reqSelectedCigar && (
                <div className="mt-1 flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle className="w-4 h-4" />
                  <span>{reqSelectedCigar.brand} {reqSelectedCigar.name}</span>
                  <button onClick={() => { setReqSelectedCigar(null); setReqCigarSearch(''); }} className="ml-auto text-stone-500 hover:text-red-400">Change</button>
                </div>
              )}
            </div>

            {!reqSelectedCigar && (
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Or type a name (if not in catalog)</label>
                <input className="input text-sm" placeholder="e.g. Padron 1926 Imperial" value={requestForm.cigar_name_free} onChange={e => setRequestForm(f => ({ ...f, cigar_name_free: e.target.value }))} />
              </div>
            )}

            <div>
              <label className="block text-xs text-stone-400 mb-1.5">Message (optional)</label>
              <textarea rows={2} className="input resize-none text-sm" placeholder="Any specific size preference or note for the store..." value={requestForm.message} onChange={e => setRequestForm(f => ({ ...f, message: e.target.value }))} />
            </div>

            <div className="flex gap-2">
              <button onClick={() => setRequestModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={submitRequest} disabled={!reqSelectedCigar && !requestForm.cigar_name_free} className="btn-primary flex-1 disabled:opacity-50">
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
