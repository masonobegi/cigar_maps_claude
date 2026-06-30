import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Store, MapPin, Phone, Globe, Clock, Package, Heart, CheckCircle, Tag, Star, Users, Bell, BellOff, Package2, Navigation, X, Search } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import BackButton from '../components/BackButton';

const DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NAVY  = '#E8DDD0';
const LABEL = '#B0A090';
const MUTED = '#9E8E7E';
const AMBER = '#D4882A';
const BORDER= '#3D3020';
const BG_ALT= '#2A2018';

function StarRating({ value, onChange, size = 'md' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button" onClick={() => onChange && onChange(n)} className="transition-transform hover:scale-110">
          <Star className={`${sz} ${n <= value ? 'fill-amber-500' : ''}`}
            style={{ color: n <= value ? '#D4882A' : '#3A4858' }} />
        </button>
      ))}
    </div>
  );
}

export default function StoreProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followPrefs, setFollowPrefs] = useState({ notify_broadcasts: 1, notify_deals: 1, notify_new_arrivals: 1 });
  const [tab, setTab] = useState('inventory');
  const [search, setSearch] = useState('');
  const [ratingForm, setRatingForm] = useState({ rating: 0, comment: '' });
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

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
    if (!user) return navigate('/login');
    setFollowLoading(true);
    try {
      const res = await api.followStore(id);
      setFollowing(res.following);
      toast(res.following ? `Following ${data?.store?.name}` : 'Unfollowed');
    } finally { setFollowLoading(false); }
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


  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div className="h-8 skeleton rounded w-64" />
      <div className="h-32 skeleton rounded" />
    </div>
  );

  if (!data) return <div className="text-center py-20" style={{ color: MUTED }}>Store not found</div>;

  const { store, inventory_count, deals, stats, recent_ratings, new_arrivals } = data;
  const hours = typeof store.hours === 'object' ? store.hours : {};

  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = dayNames[now.getDay()];
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
    { key: 'new',       label: `New Arrivals (${new_arrivals.length})` },
    { key: 'deals',     label: `Deals (${deals.length})` },
    { key: 'about',     label: 'About' },
  ];

  const mapsUrl = store.address
    ? `https://maps.google.com/?q=${encodeURIComponent([store.address, store.city, store.state].filter(Boolean).join(', '))}`
    : `https://maps.google.com/?q=${encodeURIComponent([store.name, store.city, store.state].filter(Boolean).join(', '))}`;

  const openStyle   = { backgroundColor: '#0B3320', color: '#4ADE80' };
  const closedStyle = { backgroundColor: '#2D1010', color: '#F87171' };

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6">
      <BackButton label="Stores" to="/stores" />

      {/* Store header card */}
      <div className="card mb-4 overflow-hidden">
        <div className="flex items-start gap-4 p-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#2D2010' }}>
            <Store className="w-7 h-7" style={{ color: AMBER }} />
          </div>
          <div className="flex-1 min-w-0">
            {/* Name + badges */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="font-serif text-xl font-bold" style={{ color: NAVY }}>{store.name}</h1>
              {store.verified === 1 && <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#4ADE80' }} />}
              {isOpen !== null && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                  style={isOpen ? openStyle : closedStyle}>
                  ● {isOpen ? 'Open Now' : 'Closed'}
                </span>
              )}
            </div>

            {/* Address / phone / website */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2" style={{ color: MUTED }}>
              {(store.address || store.city) && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {[store.address, store.city, store.state].filter(Boolean).join(', ')}
                </span>
              )}
              {store.phone && (
                <a href={`tel:${store.phone}`} className="flex items-center gap-1 transition-colors"
                  style={{ color: MUTED }}
                  onMouseEnter={e => e.currentTarget.style.color = AMBER}
                  onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                  <Phone className="w-3.5 h-3.5" />{store.phone}
                </a>
              )}
              {store.website && (
                <a href={`https://${store.website}`} target="_blank" rel="noopener"
                  className="flex items-center gap-1 transition-colors"
                  style={{ color: MUTED }}
                  onMouseEnter={e => e.currentTarget.style.color = AMBER}
                  onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                  <Globe className="w-3.5 h-3.5" />{store.website}
                </a>
              )}
            </div>

            {/* Tags */}
            {store.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {store.tags.map(t => (
                  <span key={t} className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                    style={{ backgroundColor: '#F0EDE8', color: LABEL, border: `1px solid ${BORDER}` }}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="flex flex-wrap gap-4 text-xs" style={{ color: MUTED }}>
              <span className="flex items-center gap-1"><Package className="w-3 h-3" />{inventory_count} SKUs</span>
              <span className="flex items-center gap-1"><Users className="w-3 h-3" />{stats.followers} followers</span>
              {stats.avg_rating > 0 && (
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3" style={{ color: '#D97706' }} />
                  <span style={{ color: LABEL, fontWeight: 500 }}>{stats.avg_rating}</span>
                  <span>({stats.rating_count} ratings)</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Follow / Request buttons */}
        {user && user.account_type === 'user' && (
          <div className="px-5 pb-4 pt-3 flex flex-wrap items-center gap-3"
            style={{ borderTop: `1px solid ${BORDER}` }}>
            <button onClick={handleFollow} disabled={followLoading}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-60 ${following ? '' : 'btn-primary'}`}
              style={following ? { backgroundColor: '#2D1E06', color: AMBER, border: `1px solid #4D3010` } : {}}>
              {followLoading
                ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Heart className={`w-4 h-4 ${following ? 'fill-current' : ''}`} />}
              {following ? 'Following' : 'Follow'}
            </button>

            {following && (
              <button onClick={() => setShowPrefs(!showPrefs)}
                className="flex items-center gap-1.5 text-xs ml-auto transition-colors"
                style={{ color: MUTED }}
                onMouseEnter={e => e.currentTarget.style.color = NAVY}
                onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                <Bell className="w-3.5 h-3.5" /> Alerts
              </button>
            )}
          </div>
        )}

        {/* Notification prefs */}
        {following && showPrefs && (
          <div className="mx-5 mb-4 rounded-xl p-3" style={{ backgroundColor: BG_ALT, border: `1px solid ${BORDER}` }}>
            <p className="text-xs mb-2" style={{ color: MUTED }}>Notify me when this store posts:</p>
            <div className="flex flex-wrap gap-4">
              {[
                { key: 'notify_broadcasts', label: 'Announcements' },
                { key: 'notify_deals',      label: 'Deals' },
                { key: 'notify_new_arrivals', label: 'New Arrivals' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!followPrefs[key]} onChange={e => updatePrefs(key, e.target.checked)} className="accent-amber-600" />
                  <span className="text-sm font-medium" style={{ color: LABEL }}>{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Quick contact bar */}
        <div className="flex" style={{ borderTop: `1px solid ${BORDER}` }}>
          {store.phone && (
            <a href={`tel:${store.phone}`}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors"
              style={{ color: MUTED }}
              onMouseEnter={e => { e.currentTarget.style.color = AMBER; e.currentTarget.style.backgroundColor = BG_ALT; }}
              onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = ''; }}>
              <Phone className="w-5 h-5" />
              <span className="text-xs font-medium">Call</span>
            </a>
          )}
          <a href={mapsUrl} target="_blank" rel="noopener"
            className="flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors"
            style={{ color: MUTED, borderLeft: `1px solid ${BORDER}` }}
            onMouseEnter={e => { e.currentTarget.style.color = AMBER; e.currentTarget.style.backgroundColor = BG_ALT; }}
            onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = ''; }}>
            <Navigation className="w-5 h-5" />
            <span className="text-xs font-medium">Directions</span>
          </a>
          {store.website && (
            <a href={`https://${store.website}`} target="_blank" rel="noopener"
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors"
              style={{ color: MUTED, borderLeft: `1px solid ${BORDER}` }}
              onMouseEnter={e => { e.currentTarget.style.color = AMBER; e.currentTarget.style.backgroundColor = BG_ALT; }}
              onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = ''; }}>
              <Globe className="w-5 h-5" />
              <span className="text-xs font-medium">Website</span>
            </a>
          )}
          <button onClick={() => { if (!user) navigate('/login'); else setRequestModal(true); }}
            className="flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors"
            style={{ color: MUTED, borderLeft: `1px solid ${BORDER}` }}
            onMouseEnter={e => { e.currentTarget.style.color = AMBER; e.currentTarget.style.backgroundColor = BG_ALT; }}
            onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = ''; }}>
            <Package className="w-5 h-5" />
            <span className="text-xs font-medium">Request</span>
          </button>
        </div>
      </div>

      {/* Today's hours */}
      {todayHours && (
        <div className="rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2 text-sm"
          style={isOpen
            ? { backgroundColor: '#0A2C1A', border: '1px solid #0D5F35' }
            : { backgroundColor: BG_ALT, border: `1px solid ${BORDER}` }}>
          <Clock className="w-4 h-4" style={{ color: isOpen ? '#4ADE80' : MUTED }} />
          <span style={{ color: LABEL }}>
            Today: <span className="font-semibold">{todayHours}</span>
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex mb-5 overflow-x-auto" style={{ borderBottom: `1px solid ${BORDER}` }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors"
            style={tab === t.key
              ? { color: AMBER, borderBottom: `2px solid ${AMBER}` }
              : { color: MUTED }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Inventory ── */}
      {tab === 'inventory' && (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search this store's inventory..." className="input mb-4" />
          {Object.values(byCigar).length === 0 ? (
            <p className="text-center py-10" style={{ color: MUTED }}>No inventory found.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {Object.values(byCigar).map(item => (
                <Link key={item.cigar_id} to={`/cigars/${item.cigar_id}`}
                  className="card p-4 transition-colors group"
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#3A4F68'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
                  <div className="mb-3">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      {item.is_featured === 1 && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
                          style={{ backgroundColor: '#2D1E06', color: '#D4882A', border: '1px solid #4D3010' }}>
                          Featured
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: AMBER }}>{item.brand}</p>
                    <h3 className="font-semibold" style={{ color: NAVY }}>{item.cigar_name}</h3>
                    <p className="text-xs mt-0.5 capitalize" style={{ color: MUTED }}>{item.strength} · {item.country}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {item.vitolas.map(v => (
                      <div key={v.vitola_id} className="rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5"
                        style={{ backgroundColor: BG_ALT, border: `1px solid ${BORDER}` }}>
                        {v.is_new_arrival === 1 && (
                          <span className="text-xs font-bold uppercase" style={{ color: '#60A5FA' }}>NEW</span>
                        )}
                        <span className="font-medium" style={{ color: LABEL }}>{v.name}</span>
                        <span className="font-bold" style={{ color: AMBER }}>${v.price.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── New Arrivals ── */}
      {tab === 'new' && (
        <div className="flex flex-col gap-3">
          {new_arrivals.length === 0 ? (
            <p className="text-center py-10" style={{ color: MUTED }}>No new arrivals right now.</p>
          ) : new_arrivals.map(item => (
            <Link key={item.id} to={`/cigars/${item.cigar_id}`}
              className="card p-4 transition-colors group"
              onMouseEnter={e => e.currentTarget.style.borderColor = '#3A4F68'}
              onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#0D1F3A' }}>
                  <Package2 className="w-4 h-4" style={{ color: '#60A5FA' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: AMBER }}>{item.brand}</p>
                  <p className="font-semibold text-sm" style={{ color: NAVY }}>{item.cigar_name} — {item.vitola_name}</p>
                </div>
                <p className="font-bold flex-shrink-0" style={{ color: AMBER }}>${item.price.toFixed(2)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ── Deals ── */}
      {tab === 'deals' && (
        <div className="flex flex-col gap-4">
          {deals.length === 0 ? (
            <p className="text-center py-10" style={{ color: MUTED }}>No active deals right now.</p>
          ) : deals.map(d => (
            <div key={d.id} className="card p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-semibold" style={{ color: NAVY }}>{d.title}</h3>
                {d.discount_percent && (
                  <span className="text-white text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: AMBER }}>
                    -{d.discount_percent}%
                  </span>
                )}
              </div>
              {d.description && <p className="text-sm mb-2" style={{ color: LABEL }}>{d.description}</p>}
              {d.expires_at && <p className="text-xs" style={{ color: MUTED }}>Expires {new Date(d.expires_at).toLocaleDateString()}</p>}
            </div>
          ))}
        </div>
      )}

      {/* ── About ── */}
      {tab === 'about' && (
        <div className="flex flex-col gap-5">
          {store.description && (
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: MUTED }}>About</p>
              <p className="leading-relaxed" style={{ color: LABEL }}>{store.description}</p>
            </div>
          )}

          {Object.keys(hours).length > 0 && (
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: MUTED }}>Hours</p>
              <div className="flex flex-col gap-1.5">
                {DAYS.map(day => {
                  const h = hours[day];
                  const isToday = day === today;
                  return (
                    <div key={day} className="flex justify-between text-sm py-1"
                      style={{ color: isToday ? AMBER : LABEL, fontWeight: isToday ? 600 : 400 }}>
                      <span>{isToday ? `${day} (today)` : day}</span>
                      <span style={h === 'Closed' ? { color: '#F87171' } : {}}>{h || '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card p-5">
            <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: MUTED }}>Customer Ratings</p>
            {stats.rating_count > 0 && (
              <div className="flex items-center gap-4 mb-4 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div className="text-center">
                  <div className="text-3xl font-bold mb-1" style={{ color: AMBER }}>{stats.avg_rating}</div>
                  <StarRating value={Math.round(stats.avg_rating)} size="sm" />
                  <p className="text-xs mt-1" style={{ color: MUTED }}>{stats.rating_count} ratings</p>
                </div>
              </div>
            )}
            {recent_ratings.map(r => (
              <div key={r.id} className="py-3 last:border-0" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold" style={{ color: NAVY }}>{r.user_name}</p>
                  <StarRating value={r.rating} size="sm" />
                </div>
                {r.comment && <p className="text-sm" style={{ color: LABEL }}>{r.comment}</p>}
              </div>
            ))}

            {user && user.account_type === 'user' && !ratingSubmitted && (
              <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
                <p className="text-sm font-semibold mb-2" style={{ color: NAVY }}>Rate this store</p>
                <StarRating value={ratingForm.rating} onChange={r => setRatingForm(f => ({ ...f, rating: r }))} />
                <textarea rows={2} className="input resize-none mt-2 text-sm"
                  placeholder="Leave a comment (optional)..."
                  value={ratingForm.comment}
                  onChange={e => setRatingForm(f => ({ ...f, comment: e.target.value }))} />
                <button onClick={submitRating} disabled={!ratingForm.rating} className="btn-primary text-sm mt-2 disabled:opacity-50">
                  Submit Rating
                </button>
              </div>
            )}
            {ratingSubmitted && (
              <p className="text-xs mt-2" style={{ color: '#4ADE80' }}>Thanks for your rating!</p>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
