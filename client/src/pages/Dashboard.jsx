import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, Star, Heart, Clock, Flame, Plus, Trash2, Edit2, Bell, Store, CheckCircle, User, ListChecks, ChevronDown, ChevronUp, BookOpen, ArrowRight, Timer, Square, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ReviewCard from '../components/ReviewCard';
import { useSmokeTimer } from '../hooks/useSmokeTimer';

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'humidor', label: '📦 Humidor' },
  { key: 'smoked', label: '💨 Smoked' },
  { key: 'wishlist', label: '❤️ Wishlist' },
];

const PRIORITY_CONFIG = {
  high:   { color: 'text-red-400',    bg: 'bg-red-900/30 border-red-800/40',    dot: 'bg-red-400',    label: 'High' },
  medium: { color: 'text-amber-400',  bg: 'bg-amber-900/30 border-amber-800/40', dot: 'bg-amber-400', label: 'Medium' },
  low:    { color: 'text-stone-400',  bg: 'bg-stone-800 border-stone-700',       dot: 'bg-stone-500', label: 'Low' },
};

const FLAVOR_COLORS = {
  cedar: 'bg-amber-900/30 text-amber-400', leather: 'bg-yellow-900/30 text-yellow-500',
  earth: 'bg-stone-700/40 text-stone-300', coffee: 'bg-yellow-950/60 text-yellow-600',
  chocolate: 'bg-amber-950/50 text-amber-600', espresso: 'bg-stone-800 text-stone-300',
  pepper: 'bg-red-900/30 text-red-400', cream: 'bg-stone-600/30 text-stone-300',
  default: 'bg-stone-800 text-stone-400',
};

function LogbookEntry({ review, expanded, onToggle }) {
  const safeJson = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
  const firstNotes = safeJson(review.first_third_notes);
  const secondNotes = safeJson(review.second_third_notes);
  const finalNotes = safeJson(review.final_third_notes);
  const flavors = safeJson(review.flavor_notes);

  const scoreColor = review.rating >= 95 ? 'text-emerald-400' : review.rating >= 90 ? 'text-amber-400' : review.rating >= 85 ? 'text-orange-400' : 'text-stone-400';

  return (
    <div className="card overflow-hidden">
      {/* Header — always visible */}
      <button type="button" onClick={onToggle} className="w-full p-4 flex items-start gap-3 text-left hover:bg-stone-800/30 transition-colors">
        <div className="flex-1 min-w-0">
          <Link to={`/cigars/${review.cigar_id}`} className="block" onClick={e => e.stopPropagation()}>
            <p className="text-xs text-amber-500/80 font-medium uppercase tracking-wider">{review.brand}</p>
            <p className="font-semibold text-stone-200 hover:text-amber-300 transition-colors">{review.cigar_name}</p>
          </Link>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 mt-1">
            {review.vitola_name && <span>{review.vitola_name}</span>}
            {review.logged_date && <span>{review.logged_date}</span>}
            {review.smoke_time && <span>⏱ {review.smoke_time}min</span>}
            {review.pairing && <span>🥃 {review.pairing}</span>}
            {review.would_buy_again && (
              <span className={review.would_buy_again === 'yes' ? 'text-emerald-400' : review.would_buy_again === 'no' ? 'text-red-400' : 'text-stone-400'}>
                {review.would_buy_again === 'yes' ? '✓ Would buy again' : review.would_buy_again === 'no' ? '✗ Would not buy' : '～ Maybe buy'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-center">
            <div className={`text-2xl font-bold ${scoreColor}`}>{review.rating}</div>
            <div className="text-[9px] text-stone-600 uppercase">score</div>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-stone-500" /> : <ChevronDown className="w-4 h-4 text-stone-500" />}
        </div>
      </button>

      {/* Expanded logbook detail */}
      {expanded && (
        <div className="border-t border-stone-800 p-4 flex flex-col gap-4">
          {/* Construction */}
          {(review.draw_rating || review.burn_rating || review.appearance_rating || review.ash_color) && (
            <div>
              <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Construction</p>
              <div className="flex flex-wrap gap-4">
                {[['Draw', review.draw_rating], ['Burn', review.burn_rating], ['Appearance', review.appearance_rating]].map(([label, val]) => val ? (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="text-xs text-stone-500">{label}</span>
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map(i => <div key={i} className={`w-2.5 h-2.5 rounded-full ${i <= val ? 'bg-amber-500' : 'bg-stone-700'}`} />)}
                    </div>
                  </div>
                ) : null)}
                {review.ash_color && <span className="text-xs text-stone-400">Ash: <span className="text-stone-300 capitalize">{review.ash_color}</span></span>}
              </div>
            </div>
          )}

          {/* Smoke journey */}
          {(firstNotes.length > 0 || review.first_third_text || secondNotes.length > 0 || finalNotes.length > 0) && (
            <div>
              <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Smoke Journey</p>
              <div className="flex flex-col gap-2">
                {[
                  { label: '🟢 First Third', notes: firstNotes, text: review.first_third_text },
                  { label: '🟡 Second Third', notes: secondNotes, text: review.second_third_text },
                  { label: '🔴 Final Third', notes: finalNotes, text: review.final_third_text },
                ].filter(s => s.notes.length > 0 || s.text).map(({ label, notes, text }) => (
                  <div key={label} className="bg-stone-800/40 rounded-xl p-3">
                    <p className="text-xs font-semibold text-stone-400 mb-1.5">{label}</p>
                    {notes.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {notes.map(n => <span key={n} className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${FLAVOR_COLORS[n] || FLAVOR_COLORS.default}`}>{n}</span>)}
                      </div>
                    )}
                    {text && <p className="text-xs text-stone-400 italic">{text}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overall */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400">
            {flavors.length > 0 && (
              <div className="w-full">
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Overall Flavor Notes</p>
                <div className="flex flex-wrap gap-1">
                  {flavors.map(n => <span key={n} className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${FLAVOR_COLORS[n] || FLAVOR_COLORS.default}`}>{n}</span>)}
                </div>
              </div>
            )}
            {review.finish_length && <span>Finish: <span className="text-stone-300 capitalize">{review.finish_length}</span></span>}
            {review.strength_start && review.strength_end && (
              <span>Strength: <span className="text-stone-300 capitalize">{review.strength_start}</span> → <span className="text-stone-300 capitalize">{review.strength_end}</span></span>
            )}
            {review.retrohale_notes && <span className="w-full">Retrohale: <span className="text-stone-300">{review.retrohale_notes}</span></span>}
          </div>

          {review.review_text && (
            <div>
              <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Notes</p>
              <p className="text-sm text-stone-300 leading-relaxed italic">"{review.review_text}"</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SmokeListTab({ smokeList, setSmokeList, smokeFilter, setSmokeFilter, onMarkSmoked, onDelete, onUpdatePriority }) {
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ priority: 'medium', notes: '', recommended_by: '' });
  const [selectedCigar, setSelectedCigar] = useState(null);

  async function searchCigars(q) {
    if (q.length < 2) { setAddResults([]); return; }
    const { cigars } = await api.searchCigars({ q, limit: 6 });
    setAddResults(cigars);
  }

  async function addToList() {
    if (!selectedCigar) return;
    try {
      const res = await api.addToSmokeList({ cigar_id: selectedCigar.id, ...addForm });
      const newItem = { id: res.id, cigar_id: selectedCigar.id, brand: selectedCigar.brand, cigar_name: selectedCigar.name, status: 'pending', priority: addForm.priority, notes: addForm.notes, recommended_by: addForm.recommended_by, avg_rating: Math.round(selectedCigar.avg_rating || 0), store_count: 0, min_price: 0 };
      setSmokeList(sl => [newItem, ...sl]);
      setAdding(false);
      setSelectedCigar(null);
      setAddSearch('');
      setAddResults([]);
      setAddForm({ priority: 'medium', notes: '', recommended_by: '' });
    } catch (e) { alert(e.message); }
  }

  const filtered = smokeList.filter(i => smokeFilter === 'all' || i.status === smokeFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {[['pending', '📋 To Try'], ['smoked', '✓ Tried'], ['all', 'All']].map(([key, label]) => (
            <button key={key} onClick={() => setSmokeFilter(key)}
              className={`text-sm px-3 py-1.5 rounded-full transition-all ${smokeFilter === key ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setAdding(!adding)} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add Cigar
        </button>
      </div>

      {adding && (
        <div className="card p-4 mb-4 flex flex-col gap-3">
          <h3 className="font-semibold text-stone-100 text-sm">Add to Smoke List</h3>
          <div className="relative">
            <input
              className="input text-sm"
              placeholder="Search cigar by name or brand..."
              value={addSearch}
              onChange={e => { setAddSearch(e.target.value); searchCigars(e.target.value); if (!e.target.value) setSelectedCigar(null); }}
            />
            {addResults.length > 0 && !selectedCigar && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-stone-900 border border-stone-700 rounded-xl overflow-hidden z-10 shadow-xl">
                {addResults.map(c => (
                  <button key={c.id} onClick={() => { setSelectedCigar(c); setAddSearch(`${c.brand} ${c.name}`); setAddResults([]); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-stone-800 border-b border-stone-800/50 last:border-0">
                    <p className="text-sm font-medium text-stone-200">{c.brand} {c.name}</p>
                    <p className="text-xs text-stone-500 capitalize">{c.strength} · {c.country}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedCigar && (
            <>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Priority</label>
                <div className="flex gap-2">
                  {['high', 'medium', 'low'].map(p => (
                    <button key={p} onClick={() => setAddForm(f => ({ ...f, priority: p }))}
                      className={`flex-1 py-1.5 rounded-lg border text-xs capitalize font-medium transition-all ${addForm.priority === p ? 'bg-amber-600 border-amber-500 text-white' : 'border-stone-700 text-stone-500'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Why do you want to try it?</label>
                <input className="input text-sm" placeholder="Heard great things, recommended by..." value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Recommended by</label>
                <input className="input text-sm" placeholder="A friend, Cigar Aficionado, etc." value={addForm.recommended_by} onChange={e => setAddForm(f => ({ ...f, recommended_by: e.target.value }))} />
              </div>
            </>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setAdding(false); setSelectedCigar(null); setAddSearch(''); }} className="btn-secondary flex-1 text-sm">Cancel</button>
            <button onClick={addToList} disabled={!selectedCigar} className="btn-primary flex-1 text-sm disabled:opacity-50">Add to List</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <ListChecks className="w-10 h-10 text-stone-700 mx-auto mb-3" />
          <p className="text-stone-400 font-medium">
            {smokeFilter === 'all' ? 'Your smoke list is empty' : smokeFilter === 'smoked' ? 'No smoked cigars yet' : 'Nothing queued to try'}
          </p>
          <p className="text-stone-600 text-sm mt-1">Discover cigars and add them to your queue.</p>
          <Link to="/search" className="btn-primary mt-4 inline-flex items-center gap-2">
            Browse Cigars <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(item => {
            const pc = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
            return (
              <div key={item.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-full min-h-8 rounded-full ${pc.dot} flex-shrink-0 mt-1`} />
                  <div className="flex-1 min-w-0">
                    <Link to={`/cigars/${item.cigar_id}`} className="block">
                      <p className="text-xs text-amber-500/80 font-medium uppercase tracking-wider">{item.brand}</p>
                      <p className="font-semibold text-stone-200 hover:text-amber-300 transition-colors">{item.cigar_name}</p>
                    </Link>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500 mt-1">
                      <span className={`${pc.color} font-medium capitalize`}>{pc.label} priority</span>
                      {item.avg_rating > 0 && <span>⭐ {item.avg_rating} avg</span>}
                      {item.store_count > 0 && <span>🏪 {item.store_count} stores</span>}
                      {item.min_price > 0 && <span>from ${item.min_price.toFixed(2)}</span>}
                    </div>
                    {item.recommended_by && <p className="text-xs text-stone-500 mt-1">Recommended by: {item.recommended_by}</p>}
                    {item.notes && <p className="text-xs text-stone-500 mt-0.5 italic">"{item.notes}"</p>}
                    {item.status === 'smoked' && item.smoked_on && (
                      <p className="text-xs text-emerald-500 mt-1">✓ Smoked on {item.smoked_on}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    {['high', 'medium', 'low'].map(p => (
                      <button key={p} onClick={() => onUpdatePriority(item.id, p)}
                        className={`w-5 h-5 rounded-full border transition-all ${item.priority === p ? PRIORITY_CONFIG[p].dot + ' border-transparent' : 'bg-stone-800 border-stone-700'}`}
                        title={`Set ${p} priority`}
                      />
                    ))}
                  </div>
                </div>
                {item.status === 'pending' && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-stone-800">
                    <Link to={`/cigars/${item.cigar_id}`} className="btn-secondary text-xs flex-1 text-center">View Cigar</Link>
                    <button onClick={() => onMarkSmoked(item.id)} className="btn-primary text-xs flex-1">✓ Mark as Smoked</button>
                    <button onClick={() => onDelete(item.id)} className="p-2 hover:bg-red-900/30 rounded-lg text-stone-600 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const timer = useSmokeTimer();
  const [tab, setTab] = useState('collection');
  const [statusFilter, setStatusFilter] = useState('humidor');
  const [humidor, setHumidor] = useState([]);
  const [stats, setStats] = useState({});
  const [reviews, setReviews] = useState([]);
  const [followedStores, setFollowedStores] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [feed, setFeed] = useState({ reviews: [], deals: [] });
  const [smokeList, setSmokeList] = useState([]);
  const [smokeFilter, setSmokeFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState(null);
  const [editProfile, setEditProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: user?.name || '', bio: '', location_city: '', location_state: '' });
  const [saving, setSaving] = useState(false);
  const [expandedReview, setExpandedReview] = useState(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [h, r, stores, notifs, f, sl] = await Promise.all([
        api.getHumidor({ status: statusFilter }),
        api.getMyReviews(),
        api.getFollowedStores(),
        api.getNotifications(),
        api.getFeed(),
        api.getSmokeList(),
      ]);
      setHumidor(h.items);
      setStats(h.stats);
      setReviews(r);
      setFollowedStores(stores);
      setNotifications(notifs);
      setFeed(f);
      setSmokeList(sl);
    } finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); }, [statusFilter]);

  async function deleteItem(id) {
    if (!confirm('Remove from collection?')) return;
    try {
      await api.deleteHumidorItem(id);
      setHumidor(h => h.filter(i => i.id !== id));
      toast('Removed from collection', 'info');
    } catch { toast('Could not remove item', 'error'); }
  }

  async function saveEdit() {
    setSaving(true);
    try {
      await api.updateHumidorItem(editItem.id, editItem);
      setHumidor(h => h.map(i => i.id === editItem.id ? { ...i, ...editItem } : i));
      setEditItem(null);
      toast('Collection updated');
    } catch { toast('Could not save changes', 'error'); }
    finally { setSaving(false); }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      await api.updateProfile(profileForm);
      setEditProfile(false);
      toast('Profile saved');
    } catch { toast('Could not save profile', 'error'); }
    finally { setSaving(false); }
  }

  async function markAllRead() {
    await api.markAllNotificationsRead();
    setNotifications(ns => ns.map(n => ({ ...n, is_read: 1 })));
  }

  async function markRead(id) {
    await api.markNotificationRead(id);
    setNotifications(ns => ns.map(n => n.id === id ? { ...n, is_read: 1 } : n));
  }

  async function unfollowStore(storeId) {
    await api.followStore(storeId);
    setFollowedStores(s => s.filter(x => x.id !== storeId));
  }

  async function updateFollowPrefs(storeId, prefs) {
    await api.updateFollowPrefs(storeId, prefs);
    setFollowedStores(s => s.map(x => x.id === storeId ? { ...x, ...prefs } : x));
  }

  const unreadNotifs = notifications.filter(n => !n.is_read).length;

  const pendingSmoke = smokeList.filter(s => s.status === 'pending').length;

  const TABS = [
    { key: 'collection', label: 'My Humidor' },
    { key: 'smokelist', label: 'Smoke List', badge: pendingSmoke },
    { key: 'journal', label: `Journal (${reviews.length})` },
    { key: 'following', label: `Following (${followedStores.length})` },
    { key: 'notifications', label: 'Notifications', badge: unreadNotifs },
    { key: 'feed', label: 'Community' },
    { key: 'profile', label: 'Profile' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-5">
        <h1 className="font-serif text-2xl font-bold text-stone-100">Hey, {user?.name?.split(' ')[0]} 👋</h1>
        <p className="text-stone-500 text-sm mt-0.5">Your cigar world, all in one place</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {[
          { label: 'Humidor', value: stats.humidor || 0, icon: Package, color: 'text-amber-400' },
          { label: 'Smoked', value: stats.smoked || 0, icon: Flame, color: 'text-orange-400' },
          { label: 'Wishlist', value: stats.wishlist || 0, icon: Heart, color: 'text-pink-400' },
          { label: 'Reviews', value: reviews.length, icon: Star, color: 'text-yellow-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-3 text-center">
            <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
            <div className="text-lg font-bold text-stone-100">{value}</div>
            <div className="text-[10px] text-stone-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Tabs — scrollable with right-fade indicator */}
      <div className="relative mb-5">
        <div className="tab-bar border-b border-stone-800">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`tab-btn gap-1.5 ${tab === t.key ? 'tab-btn-active' : 'tab-btn-inactive'}`}>
              {t.label}
              {t.badge > 0 && (
                <span className="min-w-[18px] h-[18px] bg-amber-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center px-1">
                  {t.badge > 9 ? '9+' : t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* Fade hint that more tabs exist */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-stone-950 to-transparent" />
      </div>

      {/* Collection */}
      {tab === 'collection' && (
        <>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {STATUS_TABS.map(s => (
              <button key={s.key} onClick={() => setStatusFilter(s.key)}
                className={`text-sm px-4 py-1.5 rounded-full whitespace-nowrap transition-all ${statusFilter === s.key ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Active smoke timer banner */}
          {timer.running && (
            <div className="bg-amber-900/30 border border-amber-700/40 rounded-xl p-3 mb-3 flex items-center gap-3">
              <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-amber-400 font-semibold">Smoke session in progress</p>
                <p className="text-xs text-stone-400 truncate">{timer.label}</p>
              </div>
              <span className="font-mono text-xl font-bold text-amber-400 flex-shrink-0">{timer.formattedTime}</span>
              <button onClick={() => timer.stop()} className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0">Stop</button>
            </div>
          )}

          {stats.total_value > 0 && (
            <div className="bg-amber-900/20 border border-amber-800/30 rounded-xl p-3 mb-4 text-sm flex items-center gap-2">
              <span className="text-stone-400">Estimated humidor value:</span>
              <span className="text-amber-400 font-bold">${stats.total_value.toFixed(2)}</span>
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-stone-600">{humidor.length} item{humidor.length !== 1 ? 's' : ''}</p>
            <Link to="/search" className="text-xs text-amber-500 hover:text-amber-400 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add cigars
            </Link>
          </div>

          {loading ? (
            <div className="flex flex-col gap-3">{[1,2,3].map(i => <div key={i} className="card h-20 animate-pulse bg-stone-800" />)}</div>
          ) : humidor.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-10 h-10 text-stone-700 mx-auto mb-3" />
              <p className="text-stone-400 font-medium">Your collection is empty</p>
              <Link to="/search" className="btn-primary mt-4 inline-flex">Browse Cigars</Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {humidor.map(item => (
                <div key={item.id} className="card p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <Link to={`/cigars/${item.cigar_id}`} className="block">
                        <p className="text-xs text-amber-500/80 font-medium uppercase tracking-wider">{item.brand}</p>
                        <h3 className="font-semibold text-stone-200 hover:text-amber-300 transition-colors leading-tight">
                          {item.cigar_name}{item.vitola_name ? ` — ${item.vitola_name}` : ''}
                        </h3>
                      </Link>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500 mt-1.5">
                        <span>Qty: <span className="text-stone-300 font-medium">{item.quantity}</span></span>
                        {item.purchase_price && <span>Paid: <span className="text-amber-400 font-medium">${item.purchase_price.toFixed(2)}</span></span>}
                        {item.purchase_date && <span>{item.purchase_date}</span>}
                        {item.aging_goal_date && <span className="flex items-center gap-0.5 text-amber-600"><Clock className="w-3 h-3" />Age until {item.aging_goal_date}</span>}
                      </div>
                      {item.notes && <p className="text-xs text-stone-500 mt-1.5 italic line-clamp-1">"{item.notes}"</p>}
                      <div className="mt-2">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          item.status === 'humidor' ? 'bg-amber-900/30 text-amber-400' :
                          item.status === 'smoked' ? 'bg-stone-700 text-stone-400' : 'bg-pink-900/30 text-pink-400'}`}>
                          {item.status === 'humidor' ? '📦 Humidor' : item.status === 'smoked' ? '💨 Smoked' : '❤️ Wishlist'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {item.status === 'humidor' && (
                        <button
                          onClick={() => timer.running && timer.label === item.cigar_name ? timer.stop() : timer.start(item.cigar_name)}
                          className={`p-1.5 rounded-lg transition-colors ${timer.running && timer.label === item.cigar_name ? 'text-amber-400 bg-amber-900/30' : 'text-stone-600 hover:text-amber-400 hover:bg-stone-800'}`}
                          title={timer.running && timer.label === item.cigar_name ? 'Stop timer' : 'Start smoke timer'}
                        >
                          {timer.running && timer.label === item.cigar_name ? <Square className="w-4 h-4" /> : <Timer className="w-4 h-4" />}
                        </button>
                      )}
                      <button onClick={() => setEditItem({ ...item })} className="p-1.5 hover:bg-stone-800 rounded-lg text-stone-600 hover:text-stone-300 transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteItem(item.id)} className="p-1.5 hover:bg-red-900/30 rounded-lg text-stone-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Smoke List */}
      {tab === 'smokelist' && (
        <SmokeListTab
          smokeList={smokeList}
          setSmokeList={setSmokeList}
          smokeFilter={smokeFilter}
          setSmokeFilter={setSmokeFilter}
          onMarkSmoked={async (id) => {
            await api.markSmokeListSmoked(id);
            setSmokeList(sl => sl.map(i => i.id === id ? { ...i, status: 'smoked', smoked_on: new Date().toISOString().slice(0, 10) } : i));
          }}
          onDelete={async (id) => {
            await api.deleteSmokeListItem(id);
            setSmokeList(sl => sl.filter(i => i.id !== id));
          }}
          onUpdatePriority={async (id, priority) => {
            await api.updateSmokeListItem(id, { priority });
            setSmokeList(sl => sl.map(i => i.id === id ? { ...i, priority } : i));
          }}
        />
      )}

      {/* Journal / logbook reviews */}
      {tab === 'journal' && (
        <div className="flex flex-col gap-4">
          {reviews.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-10 h-10 text-stone-700 mx-auto mb-3" />
              <p className="text-stone-400 font-medium">Your journal is empty</p>
              <p className="text-stone-600 text-sm mt-1">Log your next smoke from any cigar page.</p>
              <Link to="/search" className="btn-primary mt-4 inline-flex items-center gap-2">
                Browse Cigars <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : reviews.map(r => (
            <LogbookEntry
              key={r.id}
              review={r}
              expanded={expandedReview === r.id}
              onToggle={() => setExpandedReview(expandedReview === r.id ? null : r.id)}
            />
          ))}
        </div>
      )}

      {/* Following */}
      {tab === 'following' && (
        <div className="flex flex-col gap-4">
          {followedStores.length === 0 ? (
            <div className="text-center py-12">
              <Store className="w-10 h-10 text-stone-700 mx-auto mb-3" />
              <p className="text-stone-400">Not following any stores yet.</p>
              <Link to="/stores" className="btn-primary mt-4 inline-flex">Browse Stores</Link>
            </div>
          ) : followedStores.map(store => (
            <div key={store.id} className="card p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 bg-amber-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Store className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={`/stores/${store.id}`} className="font-semibold text-stone-200 hover:text-amber-300 transition-colors">{store.name}</Link>
                    {store.verified === 1 && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                    {store.unread_notifications > 0 && (
                      <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {store.unread_notifications} new
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">{store.city}, {store.state} · {store.inventory_count} SKUs</p>
                </div>
                <button onClick={() => unfollowStore(store.id)} className="text-xs text-stone-500 hover:text-red-400 transition-colors flex-shrink-0">Unfollow</button>
              </div>

              {/* Notification prefs */}
              <div className="bg-stone-800/50 rounded-xl p-3">
                <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-2">Notify me about:</p>
                <div className="flex flex-wrap gap-3">
                  {[
                    { key: 'notify_broadcasts', label: 'Announcements' },
                    { key: 'notify_deals', label: 'Deals' },
                    { key: 'notify_new_arrivals', label: 'New Arrivals' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!store[key]}
                        onChange={e => updateFollowPrefs(store.id, { notify_broadcasts: store.notify_broadcasts, notify_deals: store.notify_deals, notify_new_arrivals: store.notify_new_arrivals, [key]: e.target.checked ? 1 : 0 })}
                        className="accent-amber-500"
                      />
                      <span className="text-xs text-stone-400">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notifications */}
      {tab === 'notifications' && (
        <div>
          {unreadNotifs > 0 && (
            <button onClick={markAllRead} className="btn-secondary text-sm mb-4 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Mark all as read ({unreadNotifs})
            </button>
          )}
          {notifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="w-10 h-10 text-stone-700 mx-auto mb-3" />
              <p className="text-stone-400">No notifications. Follow stores to get updates.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {notifications.map(n => (
                <div key={n.id} className={`card p-4 ${!n.is_read ? 'border-amber-900/50 bg-amber-950/10' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-semibold text-amber-500/80">{n.store_name}</p>
                        <span className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full ${
                          n.type === 'deal' ? 'bg-emerald-900/40 text-emerald-400' :
                          n.type === 'new_arrival' ? 'bg-blue-900/40 text-blue-400' :
                          n.type === 'event' ? 'bg-purple-900/40 text-purple-400' :
                          'bg-amber-900/40 text-amber-400'
                        }`}>{n.type.replace('_', ' ')}</span>
                        {!n.is_read && <span className="w-2 h-2 bg-amber-400 rounded-full" />}
                      </div>
                      <p className={`text-sm font-semibold mt-1 ${!n.is_read ? 'text-stone-100' : 'text-stone-300'}`}>{n.title}</p>
                      <p className="text-xs text-stone-400 mt-1 leading-relaxed">{n.message}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] text-stone-600">{timeAgo(n.created_at)}</span>
                        <Link to={`/stores/${n.store_id}`} className="text-[10px] text-amber-600 hover:text-amber-400">View store →</Link>
                        {!n.is_read && (
                          <button onClick={() => markRead(n.id)} className="text-[10px] text-stone-600 hover:text-stone-400 ml-auto">Mark read</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Community Feed */}
      {tab === 'feed' && (
        <div className="flex flex-col gap-4">
          {feed.deals.length > 0 && (
            <div className="mb-2">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Current Deals</h3>
              <div className="flex flex-col gap-2">
                {feed.deals.map(d => (
                  <Link key={d.id} to={`/stores/${d.store_id}`} className="card p-3 hover:border-stone-600 transition-colors">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-stone-200">{d.title}</p>
                        <p className="text-xs text-stone-500">{d.store_name}</p>
                      </div>
                      {d.discount_percent && <span className="bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">-{d.discount_percent}%</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Recent Reviews</h3>
          {feed.reviews.map(r => <ReviewCard key={r.id} review={r} showCigar />)}
        </div>
      )}

      {/* Profile */}
      {tab === 'profile' && (
        <div className="max-w-md">
          <div className="card p-5 flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-amber-900/30 rounded-2xl flex items-center justify-center">
                <User className="w-7 h-7 text-amber-500" />
              </div>
              <div>
                <p className="font-semibold text-stone-100">{user?.name}</p>
                <p className="text-xs text-stone-500">{user?.email}</p>
              </div>
            </div>

            {!editProfile ? (
              <button onClick={() => { setProfileForm({ name: user?.name || '', bio: user?.bio || '', location_city: user?.location_city || '', location_state: user?.location_state || '' }); setEditProfile(true); }} className="btn-secondary text-sm">
                Edit Profile
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-stone-400 mb-1.5">Name</label>
                  <input className="input" value={profileForm.name} onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-stone-400 mb-1.5">Bio</label>
                  <textarea rows={2} className="input resize-none" placeholder="Tell people about your cigar preferences..." value={profileForm.bio} onChange={e => setProfileForm(f => ({ ...f, bio: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-stone-400 mb-1.5">City</label>
                    <input className="input" placeholder="New Orleans" value={profileForm.location_city} onChange={e => setProfileForm(f => ({ ...f, location_city: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1.5">State</label>
                    <input className="input uppercase" maxLength={2} placeholder="LA" value={profileForm.location_state} onChange={e => setProfileForm(f => ({ ...f, location_state: e.target.value.toUpperCase() }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditProfile(false)} className="btn-secondary flex-1">Cancel</button>
                  <button onClick={saveProfile} disabled={saving} className="btn-primary flex-1">Save</button>
                </div>
              </div>
            )}
          </div>

          <div className="card p-5 mt-4">
            <h3 className="text-sm font-semibold text-stone-300 mb-3">Your Stats</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><div className="text-xl font-bold text-amber-400">{stats.humidor || 0}</div><div className="text-xs text-stone-500">In Humidor</div></div>
              <div><div className="text-xl font-bold text-orange-400">{stats.smoked || 0}</div><div className="text-xs text-stone-500">Smoked</div></div>
              <div><div className="text-xl font-bold text-yellow-400">{reviews.length}</div><div className="text-xs text-stone-500">Reviews</div></div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Humidor Item Modal */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70" onClick={() => setEditItem(null)}>
          <div className="bg-stone-900 border border-stone-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-bold text-stone-100">Edit Collection Item</h2>
            <p className="text-stone-400 text-sm -mt-2">{editItem.brand} {editItem.cigar_name}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Status</label>
                <select className="input" value={editItem.status} onChange={e => setEditItem(i => ({ ...i, status: e.target.value }))}>
                  <option value="humidor">In Humidor</option>
                  <option value="smoked">Smoked</option>
                  <option value="wishlist">Wishlist</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Quantity</label>
                <input type="number" min="1" className="input" value={editItem.quantity} onChange={e => setEditItem(i => ({ ...i, quantity: +e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1.5">Aging Goal Date</label>
              <input type="date" className="input" value={editItem.aging_goal_date || ''} onChange={e => setEditItem(i => ({ ...i, aging_goal_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1.5">Notes</label>
              <textarea rows={2} className="input resize-none" value={editItem.notes || ''} onChange={e => setEditItem(i => ({ ...i, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditItem(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="btn-primary flex-1">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
