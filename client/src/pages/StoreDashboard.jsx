import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Store, Package, Plus, Edit2, Trash2, Tag, CheckCircle, AlertCircle,
  Search, Megaphone, BarChart2, Eye, Users, TrendingUp, RefreshCw,
  AlertTriangle, ChevronDown, ChevronUp, Bell, Star, X, Check,
  ToggleLeft, ToggleRight, ArrowRight, Clock, Upload, FileSpreadsheet, AlertOctagon
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const HOURS_TEMPLATE = { Mon: '10am-8pm', Tue: '10am-8pm', Wed: '10am-8pm', Thu: '10am-8pm', Fri: '10am-9pm', Sat: '10am-9pm', Sun: '11am-6pm' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NOTIF_TYPES = [
  { value: 'announcement', label: 'Announcement', icon: Megaphone, desc: 'General updates and news' },
  { value: 'deal', label: 'Deal', icon: Tag, desc: 'Sales and promotions' },
  { value: 'new_arrival', label: 'New Arrival', icon: Package, desc: 'New products in stock' },
  { value: 'event', label: 'Event', icon: Star, desc: 'In-store events' },
];


// Setup Wizard Component
function SetupWizard({ onComplete }) {
  const { refreshStore } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '', description: '', address: '', city: '', state: '', zip: '', phone: '', website: '',
    has_lounge: false, has_walk_in_humidor: false,
    tags: [],
    hours: { ...HOURS_TEMPLATE }
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const TAG_OPTIONS = ['Walk-in Humidor', 'Lounge', 'Bar', 'Accessories', 'Events', 'Rare Finds', 'Members Club', 'Custom Humidors', 'Whiskey Bar'];

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }
  function toggleTag(t) { setForm(f => ({ ...f, tags: f.tags.includes(t) ? f.tags.filter(x => x !== t) : [...f.tags, t] })); }
  function setHour(day, val) { setForm(f => ({ ...f, hours: { ...f.hours, [day]: val } })); }

  async function handleFinish() {
    if (!form.name || !form.city || !form.state) { setError('Store name, city, and state are required.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.createStore(form);
      const { store } = await api.me();
      refreshStore(store);
      onComplete(store);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  const steps = ['Basic Info', 'Details & Hours', 'Review'];

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="flex items-center gap-0 mb-8">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${i + 1 <= step ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-500'}`}>
              {i + 1 < step ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            <div className="flex-1 mx-2">
              <div className={`h-0.5 ${i + 1 < step ? 'bg-amber-600' : 'bg-stone-800'}`} />
            </div>
            <span className={`text-xs hidden sm:block ${i + 1 === step ? 'text-amber-400 font-medium' : 'text-stone-600'}`}>{s}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800/50 text-red-400 text-sm rounded-lg p-3 mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {step === 1 && (
        <div className="card p-6 flex flex-col gap-4">
          <h2 className="font-serif text-xl font-bold text-stone-100 mb-1">Tell us about your store</h2>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Store Name *</label>
            <input className="input" placeholder="The Cigar Vault" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Description</label>
            <textarea rows={3} className="input resize-none" placeholder="Tell customers what makes your shop special — your walk-in humidor, lounge, rare finds, events..." value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Street Address</label>
            <input className="input" placeholder="123 Main Street" value={form.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-stone-400 mb-1.5">City *</label>
              <input className="input" placeholder="New Orleans" value={form.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">State *</label>
              <input className="input uppercase" placeholder="LA" maxLength={2} value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Phone</label>
              <input className="input" placeholder="(504) 555-0100" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Website</label>
              <input className="input" placeholder="yourshop.com" value={form.website} onChange={e => set('website', e.target.value)} />
            </div>
          </div>
          <button onClick={() => { if (!form.name || !form.city || !form.state) { setError('Name, city and state required'); return; } setError(''); setStep(2); }} className="btn-primary mt-2">
            Continue <ArrowRight className="w-4 h-4 inline ml-1" />
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="card p-6 flex flex-col gap-5">
          <h2 className="font-serif text-xl font-bold text-stone-100 mb-1">Store details & hours</h2>

          {/* Amenities */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-2">Amenities</label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-stone-800 hover:border-stone-600 transition-colors">
                <input type="checkbox" checked={form.has_lounge} onChange={e => set('has_lounge', e.target.checked)} className="accent-amber-500" />
                <div>
                  <p className="text-sm font-medium text-stone-200">Cigar Lounge</p>
                  <p className="text-xs text-stone-500">On-site smoking lounge for customers</p>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-stone-800 hover:border-stone-600 transition-colors">
                <input type="checkbox" checked={form.has_walk_in_humidor} onChange={e => set('has_walk_in_humidor', e.target.checked)} className="accent-amber-500" />
                <div>
                  <p className="text-sm font-medium text-stone-200">Walk-in Humidor</p>
                  <p className="text-xs text-stone-500">Full walk-in humidity-controlled room</p>
                </div>
              </label>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-2">Store Tags</label>
            <div className="flex flex-wrap gap-2">
              {TAG_OPTIONS.map(t => (
                <button key={t} type="button" onClick={() => toggleTag(t)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${form.tags.includes(t) ? 'bg-amber-600 border-amber-500 text-white' : 'border-stone-700 text-stone-400 hover:border-stone-500'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Hours */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-2">Hours</label>
            <div className="flex flex-col gap-2">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-3">
                  <span className="text-xs text-stone-400 w-8">{day}</span>
                  <select value={form.hours[day] === 'Closed' ? 'Closed' : 'open'} onChange={e => e.target.value === 'Closed' && setHour(day, 'Closed')}
                    className="bg-stone-800 border border-stone-700 text-stone-300 text-xs rounded-lg px-2 py-1.5 w-20">
                    <option value="open">Open</option>
                    <option value="Closed">Closed</option>
                  </select>
                  {form.hours[day] !== 'Closed' && (
                    <input type="text" value={form.hours[day]} onChange={e => setHour(day, e.target.value)}
                      placeholder="10am-8pm" className="input py-1.5 text-xs flex-1" />
                  )}
                  {form.hours[day] === 'Closed' && (
                    <button onClick={() => setHour(day, '10am-8pm')} className="text-xs text-stone-600 hover:text-amber-400">Set hours</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 mt-2">
            <button onClick={() => setStep(1)} className="btn-secondary flex-1">Back</button>
            <button onClick={() => setStep(3)} className="btn-primary flex-1">Review <ArrowRight className="w-4 h-4 inline ml-1" /></button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card p-6 flex flex-col gap-4">
          <h2 className="font-serif text-xl font-bold text-stone-100 mb-1">Review & Launch</h2>
          <div className="bg-stone-800/50 rounded-xl p-4 flex flex-col gap-3 text-sm">
            <div className="flex justify-between"><span className="text-stone-500">Store Name</span><span className="text-stone-200 font-medium">{form.name}</span></div>
            <div className="flex justify-between"><span className="text-stone-500">Location</span><span className="text-stone-200">{form.city}, {form.state}</span></div>
            {form.phone && <div className="flex justify-between"><span className="text-stone-500">Phone</span><span className="text-stone-200">{form.phone}</span></div>}
            {form.has_lounge && <div className="flex justify-between"><span className="text-stone-500">Lounge</span><span className="text-emerald-400">✓ Yes</span></div>}
            {form.has_walk_in_humidor && <div className="flex justify-between"><span className="text-stone-500">Walk-in Humidor</span><span className="text-emerald-400">✓ Yes</span></div>}
            {form.tags.length > 0 && <div className="flex justify-between items-start gap-4"><span className="text-stone-500 flex-shrink-0">Tags</span><span className="text-stone-300 text-right">{form.tags.join(', ')}</span></div>}
          </div>
          <div className="bg-amber-900/20 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-400">
            After creating your store, you'll be able to add inventory, post deals, and broadcast notifications to followers.
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="btn-secondary flex-1">Back</button>
            <button onClick={handleFinish} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Creating...' : '🚀 Launch Store'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Inventory Manager
function InventoryManager({ storeId, toast, externalOpen, onExternalOpen }) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ low_stock: 0, out_of_stock: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddLocal, setShowAddLocal] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const showAdd = showAddLocal || !!externalOpen;
  function setShowAdd(val) {
    setShowAddLocal(val);
    if (!val && onExternalOpen) onExternalOpen(false);
  }
  const [filterStatus, setFilterStatus] = useState('all');

  // Add form
  const [cigarQ, setCigarQ] = useState('');
  const [cigarResults, setCigarResults] = useState([]);
  const [selectedCigar, setSelectedCigar] = useState(null);
  const [vitolas, setVitolas] = useState([]);
  const [addRows, setAddRows] = useState([{ vitola_id: '', price: '', quantity: '', is_featured: false, is_new_arrival: false }]);

  async function load() {
    setLoading(true);
    const data = await api.getManageInventory(storeId, search ? { q: search } : {});
    setItems(data.items);
    setStats({ low_stock: data.low_stock, out_of_stock: data.out_of_stock });
    setLoading(false);
  }

  useEffect(() => { load(); }, [storeId, search]);

  async function searchCigars(q) {
    if (q.length < 2) { setCigarResults([]); return; }
    const { cigars } = await api.searchCigars({ q, limit: 8 });
    setCigarResults(cigars);
  }

  async function selectCigar(c) {
    setSelectedCigar(c);
    setCigarQ(`${c.brand} ${c.name}`);
    setCigarResults([]);
    const d = await api.getCigar(c.id);
    setVitolas(d.vitolas);
    setAddRows([{ vitola_id: '', price: '', quantity: '', is_featured: false, is_new_arrival: false }]);
  }

  function updateRow(i, key, val) {
    setAddRows(rows => rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }

  async function handleBulkAdd() {
    if (!selectedCigar) return;
    const items = addRows
      .filter(r => r.vitola_id && r.price)
      .map(r => ({ cigar_id: selectedCigar.id, vitola_id: +r.vitola_id, price: +r.price, quantity: +r.quantity || 0, is_featured: r.is_featured ? 1 : 0, is_new_arrival: r.is_new_arrival ? 1 : 0 }));
    if (!items.length) return;
    const { added, updated } = await api.bulkAddInventory(storeId, items);
    toast(`Added ${added} new, updated ${updated} existing`);
    setShowAdd(false);
    setSelectedCigar(null);
    setCigarQ('');
    setAddRows([{ vitola_id: '', price: '', quantity: '', is_featured: false, is_new_arrival: false }]);
    load();
  }

  async function handleUpdate() {
    if (!editItem) return;
    await api.updateInventory(storeId, editItem.id, { price: +editItem.price, quantity: +editItem.quantity, in_stock: editItem.in_stock ? 1 : 0, is_featured: editItem.is_featured ? 1 : 0, is_new_arrival: editItem.is_new_arrival ? 1 : 0 });
    toast('Updated!');
    setEditItem(null);
    load();
  }

  async function handleDelete(id) {
    if (!confirm('Remove from inventory?')) return;
    await api.deleteInventory(storeId, id);
    load();
  }

  const filtered = items.filter(i => {
    if (filterStatus === 'low') return i.in_stock && i.quantity > 0 && i.quantity < 5;
    if (filterStatus === 'out') return !i.in_stock || i.quantity === 0;
    if (filterStatus === 'featured') return i.is_featured;
    if (filterStatus === 'new') return i.is_new_arrival;
    return true;
  });

  return (
    <div>
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Cigars', value: new Set(items.map(i => i.cigar_id)).size, active: filterStatus === 'all', onClick: () => setFilterStatus('all'), color: 'text-stone-100' },
          { label: 'Low Stock', value: stats.low_stock, active: filterStatus === 'low', onClick: () => setFilterStatus('low'), color: stats.low_stock > 0 ? 'text-orange-400' : 'text-stone-400', alert: stats.low_stock > 0 },
          { label: 'Out of Stock', value: stats.out_of_stock, active: filterStatus === 'out', onClick: () => setFilterStatus('out'), color: stats.out_of_stock > 0 ? 'text-red-400' : 'text-stone-400', alert: stats.out_of_stock > 0 },
          { label: 'Featured', value: items.filter(i => i.is_featured).length, active: filterStatus === 'featured', onClick: () => setFilterStatus('featured'), color: 'text-amber-400' },
        ].map(s => (
          <button key={s.label} onClick={s.onClick} className={`card p-3 text-left transition-colors ${s.active ? 'border-amber-600' : 'hover:border-stone-600'}`}>
            <div className={`text-xl font-bold ${s.color} flex items-center gap-1.5`}>
              {s.value}
              {s.alert && s.value > 0 && <AlertTriangle className="w-4 h-4" />}
            </div>
            <div className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your inventory..." className="input pl-10 py-2" />
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 whitespace-nowrap">
          <Plus className="w-4 h-4" /> Add Cigar
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex flex-col gap-2">{[1,2,3,4].map(i => <div key={i} className="card h-14 animate-pulse bg-stone-800" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14">
          <Package className="w-10 h-10 text-stone-700 mx-auto mb-3" />
          <p className="text-stone-400 font-medium">
            {filterStatus !== 'all' ? 'No items match this filter' : 'No inventory yet'}
          </p>
          {filterStatus === 'all' && <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">Add Your First Cigar</button>}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map(item => (
            <div key={item.id} className={`card px-4 py-3 flex items-center gap-3 ${!item.in_stock || item.quantity === 0 ? 'opacity-60' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {item.is_featured === 1 && <span className="text-[9px] bg-amber-900/50 text-amber-400 border border-amber-800/40 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Featured</span>}
                  {item.is_new_arrival === 1 && <span className="text-[9px] bg-blue-900/40 text-blue-400 border border-blue-800/40 px-1.5 py-0.5 rounded-full uppercase tracking-wider">New</span>}
                </div>
                <p className="text-xs text-amber-500/70 font-medium uppercase tracking-wider truncate">{item.brand}</p>
                <p className="text-sm font-semibold text-stone-200 leading-tight truncate">{item.cigar_name}</p>
                <p className="text-xs text-stone-500">{item.vitola_name} · {item.length}" × {item.ring_gauge}</p>
              </div>
              <div className="text-center flex-shrink-0 w-20">
                <p className="text-xs text-stone-600 mb-0.5">Stock</p>
                <p className={`font-bold text-sm ${item.quantity === 0 || !item.in_stock ? 'text-red-400' : item.quantity !== null && item.quantity < 5 ? 'text-orange-400' : 'text-stone-200'}`}>
                  {!item.in_stock ? 'Out' : item.quantity !== null ? item.quantity : '?'}
                </p>
              </div>
              <div className="text-right flex-shrink-0 w-20">
                <p className="text-xs text-stone-600 mb-0.5">Price</p>
                <p className="font-bold text-amber-400">${(+item.price).toFixed(2)}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditItem({ ...item })} className="p-1.5 hover:bg-stone-700 rounded-lg text-stone-600 hover:text-stone-300 transition-colors">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-900/30 rounded-lg text-stone-600 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Inventory Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 overflow-y-auto" onClick={() => setShowAdd(false)}>
          <div className="bg-stone-900 border border-stone-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xl p-6 flex flex-col gap-4 my-auto max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg font-bold text-stone-100">Add Cigar to Inventory</h2>
              <button onClick={() => setShowAdd(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>

            {/* Step 1: Search cigar */}
            <div>
              <label className="block text-xs text-stone-400 mb-1.5">Search the Cigar Catalog</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
                <input className="input pl-10" placeholder="Type brand or name..." value={cigarQ} onChange={e => { setCigarQ(e.target.value); searchCigars(e.target.value); if (!e.target.value) setSelectedCigar(null); }} />
              </div>
              {cigarResults.length > 0 && !selectedCigar && (
                <div className="mt-1 border border-stone-700 rounded-xl overflow-hidden shadow-xl">
                  {cigarResults.map(c => (
                    <button key={c.id} onClick={() => selectCigar(c)} className="w-full text-left px-4 py-3 hover:bg-stone-800 border-b border-stone-800/60 last:border-0 transition-colors">
                      <p className="text-sm font-semibold text-stone-200">{c.brand} {c.name}</p>
                      <p className="text-xs text-stone-500 capitalize mt-0.5">{c.strength} · {c.country} · {c.wrapper} wrapper</p>
                    </button>
                  ))}
                </div>
              )}
              {selectedCigar && (
                <div className="mt-1 flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle className="w-4 h-4" />
                  <span className="font-medium">{selectedCigar.brand} {selectedCigar.name}</span>
                  <button onClick={() => { setSelectedCigar(null); setCigarQ(''); setVitolas([]); }} className="ml-auto text-stone-500 hover:text-red-400">Change</button>
                </div>
              )}
            </div>

            {/* Step 2: Select sizes and prices */}
            {selectedCigar && vitolas.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-stone-400">Select Sizes & Set Prices</label>
                  <button onClick={() => setAddRows(r => [...r, { vitola_id: '', price: '', quantity: '', is_featured: false, is_new_arrival: false }])} className="text-xs text-amber-500 hover:text-amber-400 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add size
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {addRows.map((row, i) => (
                    <div key={i} className="bg-stone-800/50 rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex gap-2">
                        <select value={row.vitola_id} onChange={e => updateRow(i, 'vitola_id', e.target.value)} className="input py-2 text-sm flex-1">
                          <option value="">Select size...</option>
                          {vitolas.map(v => <option key={v.id} value={v.id}>{v.name} ({v.length}" × {v.ring_gauge}) — MSRP ${v.msrp}</option>)}
                        </select>
                        {addRows.length > 1 && (
                          <button onClick={() => setAddRows(r => r.filter((_, idx) => idx !== i))} className="btn-ghost p-2 text-stone-500 hover:text-red-400">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-stone-500 mb-1 block">Your Price *</label>
                          <input type="number" step="0.01" placeholder="0.00" className="input py-2 text-sm" value={row.price} onChange={e => updateRow(i, 'price', e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[10px] text-stone-500 mb-1 block">Qty in Stock</label>
                          <input type="number" placeholder="0" className="input py-2 text-sm" value={row.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} />
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={row.is_featured} onChange={e => updateRow(i, 'is_featured', e.target.checked)} className="accent-amber-500" />
                          <span className="text-xs text-stone-400">Featured</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={row.is_new_arrival} onChange={e => updateRow(i, 'is_new_arrival', e.target.checked)} className="accent-amber-500" />
                          <span className="text-xs text-stone-400">New Arrival</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleBulkAdd} disabled={!selectedCigar || !addRows.some(r => r.vitola_id && r.price)} className="btn-primary flex-1 disabled:opacity-50">
                Add to Inventory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70" onClick={() => setEditItem(null)}>
          <div className="bg-stone-900 border border-stone-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-bold text-stone-100">Edit Item</h2>
            <p className="text-stone-400 text-sm -mt-2">{editItem.brand} {editItem.cigar_name} — {editItem.vitola_name}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Price</label>
                <input type="number" step="0.01" className="input" value={editItem.price} onChange={e => setEditItem(i => ({ ...i, price: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Quantity</label>
                <input type="number" className="input" value={editItem.quantity} onChange={e => setEditItem(i => ({ ...i, quantity: +e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              {[['in_stock', 'In Stock'], ['is_featured', 'Featured'], ['is_new_arrival', 'New Arrival']].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!editItem[key]} onChange={e => setEditItem(i => ({ ...i, [key]: e.target.checked }))} className="accent-amber-500" />
                  <span className="text-sm text-stone-300">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditItem(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleUpdate} className="btn-primary flex-1">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Broadcast Center
function BroadcastCenter({ storeId, followerCount, toast }) {
  const [form, setForm] = useState({ title: '', message: '', type: 'announcement', cigar_id: '' });
  const [broadcasts, setBroadcasts] = useState([]);
  const [sending, setSending] = useState(false);
  const charLimit = 280;

  useEffect(() => {
    api.getBroadcasts(storeId).then(setBroadcasts).catch(() => {});
  }, [storeId]);

  async function send() {
    if (!form.title || !form.message) return;
    setSending(true);
    try {
      const { sent_to } = await api.broadcastNotification(storeId, form);
      toast(`Sent to ${sent_to} follower${sent_to !== 1 ? 's' : ''}!`);
      setForm({ title: '', message: '', type: 'announcement', cigar_id: '' });
      const updated = await api.getBroadcasts(storeId);
      setBroadcasts(updated);
    } catch (e) { toast(e.message, 'error'); } finally { setSending(false); }
  }

  const TYPE = NOTIF_TYPES.find(t => t.value === form.type) || NOTIF_TYPES[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Compose */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 mb-1">
          <Megaphone className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-stone-100">Compose Notification</h3>
        </div>
        <div className="bg-amber-900/20 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-400">
          This will be sent to all <span className="font-bold">{followerCount}</span> follower{followerCount !== 1 ? 's' : ''} who have notifications enabled.
        </div>

        {/* Type selector */}
        <div>
          <label className="block text-xs text-stone-400 mb-2">Notification Type</label>
          <div className="grid grid-cols-2 gap-2">
            {NOTIF_TYPES.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.value} onClick={() => setForm(f => ({ ...f, type: t.value }))}
                  className={`p-3 rounded-xl border text-left transition-all ${form.type === t.value ? 'border-amber-600 bg-amber-900/20' : 'border-stone-700 hover:border-stone-600'}`}>
                  <Icon className={`w-4 h-4 mb-1.5 ${form.type === t.value ? 'text-amber-400' : 'text-stone-500'}`} />
                  <p className={`text-xs font-semibold ${form.type === t.value ? 'text-amber-300' : 'text-stone-300'}`}>{t.label}</p>
                  <p className="text-[10px] text-stone-600 mt-0.5">{t.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Title *</label>
          <input className="input" placeholder="e.g., Liga Privada T52 Back in Stock!" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} maxLength={80} />
        </div>
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="text-xs text-stone-400">Message *</label>
            <span className={`text-xs ${form.message.length > charLimit * 0.9 ? 'text-orange-400' : 'text-stone-600'}`}>{form.message.length}/{charLimit}</span>
          </div>
          <textarea rows={4} className="input resize-none" placeholder="Tell your followers what's happening..." value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value.slice(0, charLimit) }))} />
        </div>

        <button onClick={send} disabled={sending || !form.title || !form.message || followerCount === 0} className="btn-primary disabled:opacity-50 flex items-center justify-center gap-2">
          <Bell className="w-4 h-4" />
          {sending ? 'Sending...' : followerCount === 0 ? 'No followers yet' : `Send to ${followerCount} follower${followerCount !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* History */}
      <div>
        <h3 className="font-semibold text-stone-300 text-sm mb-3">Recent Broadcasts</h3>
        {broadcasts.length === 0 ? (
          <div className="card p-6 text-center text-stone-500 text-sm">No broadcasts sent yet.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {broadcasts.slice(0, 8).map(b => {
              const cfg = TYPE_CONFIG_MAP[b.type] || { color: 'text-amber-400', bg: 'bg-amber-900/30' };
              const readPct = b.total_followers > 0 ? Math.round((b.read_count / b.total_followers) * 100) : 0;
              return (
                <div key={b.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${cfg.color}`}>{b.type}</span>
                      <p className="text-sm font-semibold text-stone-200 mt-0.5 truncate">{b.title}</p>
                      <p className="text-xs text-stone-500 line-clamp-1 mt-0.5">{b.message}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-xs text-stone-600">
                    <span>{new Date(b.created_at).toLocaleDateString()}</span>
                    <span>·</span>
                    <span>{b.read_count}/{b.total_followers} read ({readPct}%)</span>
                    <div className="flex-1 h-1 bg-stone-800 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-600 rounded-full" style={{ width: `${readPct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const TYPE_CONFIG_MAP = {
  announcement: { color: 'text-amber-400', bg: 'bg-amber-900/30' },
  deal: { color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
  new_arrival: { color: 'text-blue-400', bg: 'bg-blue-900/30' },
  event: { color: 'text-purple-400', bg: 'bg-purple-900/30' },
};

// Analytics
function Analytics({ storeId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAnalytics(storeId).then(setData).finally(() => setLoading(false));
  }, [storeId]);

  if (loading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[1,2,3,4].map(i => <div key={i} className="card h-24 animate-pulse bg-stone-800" />)}</div>;
  if (!data) return null;

  const { overview, daily_views, top_items } = data;
  const maxViews = Math.max(...daily_views.map(d => d.views), 1);

  return (
    <div className="flex flex-col gap-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Followers', value: overview.followers, icon: Users, color: 'text-amber-400' },
          { label: 'Views (30d)', value: overview.views_30d, icon: Eye, color: 'text-blue-400' },
          { label: 'Views (7d)', value: overview.views_7d, icon: TrendingUp, color: 'text-emerald-400' },
          { label: 'Active Deals', value: overview.active_deals, icon: Tag, color: 'text-purple-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-4">
            <Icon className={`w-5 h-5 ${color} mb-2`} />
            <div className="text-2xl font-bold text-stone-100">{value.toLocaleString()}</div>
            <div className="text-xs text-stone-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Views chart */}
        {daily_views.length > 0 && (
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-stone-300 mb-4">Page Views (Last 14 Days)</h3>
            <div className="flex items-end gap-1.5 h-28">
              {daily_views.map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div className="w-full bg-amber-600/80 rounded-t" style={{ height: `${(d.views / maxViews) * 100}%`, minHeight: '2px' }} title={`${d.date}: ${d.views} views`} />
                  <span className="text-[8px] text-stone-600 rotate-90 sm:rotate-0 truncate">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inventory health */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-stone-300 mb-4">Inventory Health</h3>
          <div className="flex flex-col gap-3">
            {[
              { label: 'In Stock', value: overview.items_in_stock, color: 'bg-emerald-600' },
              { label: 'Low Stock (<5)', value: overview.low_stock, color: 'bg-orange-500' },
              { label: 'Out of Stock', value: overview.out_of_stock, color: 'bg-red-600' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-500">{label}</span>
                  <span className="text-stone-300 font-medium">{value}</span>
                </div>
                <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.max((value / Math.max(overview.items_in_stock + overview.out_of_stock, 1)) * 100, value > 0 ? 4 : 0)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-stone-800">
            <p className="text-xs text-stone-600">Total broadcasts sent: <span className="text-stone-400">{overview.total_broadcasts}</span></p>
          </div>
        </div>
      </div>

      {top_items.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-stone-300 mb-4">Featured & Top Items</h3>
          <div className="flex flex-col gap-2">
            {top_items.map((item, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-stone-800/50 last:border-0">
                <span className="text-lg text-stone-700 font-mono w-5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-amber-500/70">{item.brand}</p>
                  <p className="text-sm font-medium text-stone-200 truncate">{item.cigar_name} — {item.vitola_name}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-amber-400 font-bold text-sm">${(+item.price).toFixed(2)}</p>
                  <p className="text-xs text-stone-600">{item.quantity} left</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Deals Manager
function DealsManager({ storeId, toast }) {
  const [deals, setDeals] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', discount_percent: '', expires_at: '' });

  useEffect(() => {
    api.getStore(storeId).then(d => setDeals(d.deals));
  }, [storeId]);

  async function addDeal() {
    if (!form.title) return;
    await api.addDeal(storeId, { ...form, discount_percent: form.discount_percent ? +form.discount_percent : null });
    toast('Deal posted!');
    const d = await api.getStore(storeId);
    setDeals(d.deals);
    setForm({ title: '', description: '', discount_percent: '', expires_at: '' });
    setShowForm(false);
  }

  async function deleteDeal(id) {
    if (!confirm('Delete this deal?')) return;
    await api.deleteDeal(storeId, id);
    setDeals(d => d.filter(x => x.id !== id));
  }

  return (
    <div>
      <button onClick={() => setShowForm(!showForm)} className="btn-primary mb-5 flex items-center gap-2">
        <Plus className="w-4 h-4" /> Post New Deal or Event
      </button>

      {showForm && (
        <div className="card p-5 mb-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">Title *</label>
            <input className="input" placeholder="20% Off Robusto Boxes This Weekend" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">Description</label>
            <textarea rows={2} className="input resize-none" placeholder="More details about the deal..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1.5">Discount % (optional)</label>
              <input type="number" className="input" placeholder="20" value={form.discount_percent} onChange={e => setForm(f => ({ ...f, discount_percent: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1.5">Expires</label>
              <input type="date" className="input" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancel</button>
            <button onClick={addDeal} disabled={!form.title} className="btn-primary flex-1 disabled:opacity-50">Post Deal</button>
          </div>
        </div>
      )}

      {deals.length === 0 ? (
        <div className="card p-6 text-center text-stone-500 text-sm">No active deals. Post one above!</div>
      ) : (
        <div className="flex flex-col gap-3">
          {deals.map(d => (
            <div key={d.id} className="card p-4 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-stone-200 text-sm">{d.title}</p>
                  {d.discount_percent && <span className="bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">-{d.discount_percent}%</span>}
                </div>
                {d.description && <p className="text-xs text-stone-500 mt-1 line-clamp-2">{d.description}</p>}
                {d.expires_at && <p className="text-[10px] text-stone-600 mt-1.5">Expires {new Date(d.expires_at).toLocaleDateString()}</p>}
              </div>
              <button onClick={() => deleteDeal(d.id)} className="p-1.5 hover:bg-red-900/30 rounded-lg text-stone-600 hover:text-red-400 transition-colors flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VerificationSection({ store, toast, onVerified }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    business_name: store.name || '',
    business_ein: '',
    business_phone: store.phone || '',
    business_address: store.address || '',
    business_website: store.website || '',
    license_number: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getVerificationStatus(store.id).then(d => {
      setStatus(d);
    }).finally(() => setLoading(false));
  }, [store.id]);

  async function submit() {
    if (!form.business_name) return;
    setSubmitting(true);
    try {
      await api.submitVerificationRequest(store.id, form);
      const d = await api.getVerificationStatus(store.id);
      setStatus(d);
      toast('Verification request submitted!');
    } catch (e) { toast(e.message, 'error'); } finally { setSubmitting(false); }
  }

  if (loading) return <div className="animate-pulse h-48 bg-stone-800 rounded-xl" />;

  if (store.verified) {
    return (
      <div className="card p-6 text-center">
        <div className="w-14 h-14 bg-emerald-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-7 h-7 text-emerald-500" />
        </div>
        <h2 className="font-serif text-xl font-bold text-stone-100 mb-1">Your store is verified</h2>
        <p className="text-stone-400 text-sm">
          The ✓ Verified badge on your store page tells customers your business has been reviewed and approved by the CigarBuddy team.
        </p>
      </div>
    );
  }

  if (status?.request?.status === 'pending') {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-900/30 rounded-xl flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h2 className="font-semibold text-stone-100">Verification Pending</h2>
            <p className="text-xs text-stone-500">Submitted {new Date(status.request.submitted_at).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="bg-amber-900/20 border border-amber-800/30 rounded-xl p-4 text-sm text-amber-400">
          Your verification request is under review by the CigarBuddy team. We'll update your store status within 1-3 business days. No action needed from you at this time.
        </div>
      </div>
    );
  }

  if (status?.request?.status === 'rejected') {
    return (
      <div className="card p-6 flex flex-col gap-4">
        <div className="bg-red-900/20 border border-red-800/30 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-400 mb-1">Verification Not Approved</p>
          <p className="text-xs text-stone-400">{status.request.admin_notes || 'Your previous request was not approved. Please review your information and resubmit.'}</p>
        </div>
        <p className="text-sm text-stone-400">Please correct any issues and submit a new request below.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl flex flex-col gap-5">
      {/* What verification means */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-3">
          <CheckCircle className="w-5 h-5 text-emerald-500" />
          <h2 className="font-semibold text-stone-100">Get Your Store Verified</h2>
        </div>
        <p className="text-sm text-stone-400 mb-4">
          Verified stores get a <span className="text-emerald-400 font-medium">✓ Verified</span> badge visible to all users. It signals that your business has been reviewed by the CigarBuddy team — boosting trust and discoverability.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: '🔍', label: 'More visible', desc: 'Verified stores appear higher in search' },
            { icon: '🛡️', label: 'Builds trust', desc: 'Customers know you\'re a real business' },
            { icon: '📢', label: 'Broadcasts', desc: 'Verified badge on all your notifications' },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="bg-stone-800/50 rounded-xl p-3 text-center">
              <div className="text-xl mb-1">{icon}</div>
              <p className="text-xs font-semibold text-stone-200">{label}</p>
              <p className="text-[10px] text-stone-500 mt-0.5">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-stone-300 mb-3">How It Works</h3>
        <ol className="flex flex-col gap-3">
          {[
            'Fill out the form below with your business details and license information',
            'The CigarBuddy team reviews your submission within 1-3 business days',
            'Once approved, your store gets the ✓ Verified badge immediately',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-6 h-6 bg-amber-900/40 text-amber-400 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
              <span className="text-sm text-stone-400">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Submission form */}
      <div className="card p-5 flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-stone-300">Verification Request</h3>

        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Legal Business Name *</label>
          <input className="input" placeholder="e.g. The Cigar Vault LLC" value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">EIN / Tax ID</label>
            <input className="input" placeholder="XX-XXXXXXX" value={form.business_ein} onChange={e => setForm(f => ({ ...f, business_ein: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">Business Phone</label>
            <input className="input" value={form.business_phone} onChange={e => setForm(f => ({ ...f, business_phone: e.target.value }))} />
          </div>
        </div>

        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Full Business Address</label>
          <input className="input" placeholder="123 Main St, New Orleans, LA 70130" value={form.business_address} onChange={e => setForm(f => ({ ...f, business_address: e.target.value }))} />
        </div>

        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Business Website</label>
          <input className="input" placeholder="yourshop.com" value={form.business_website} onChange={e => setForm(f => ({ ...f, business_website: e.target.value }))} />
        </div>

        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Tobacco Retail License Number</label>
          <input className="input" placeholder="State tobacco retail license or permit number" value={form.license_number} onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))} />
          <p className="text-[10px] text-stone-600 mt-1">Required by most states to sell tobacco products. This helps us verify you're a legitimate retailer.</p>
        </div>

        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Additional Notes (optional)</label>
          <textarea rows={2} className="input resize-none text-sm" placeholder="Years in business, social media links, any other info that helps us verify your shop..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        <div className="bg-stone-800/50 rounded-lg p-3 text-xs text-stone-500">
          By submitting, you confirm that the information provided is accurate and that your business holds a valid tobacco retail license in your state.
        </div>

        <button onClick={submit} disabled={submitting || !form.business_name} className="btn-primary disabled:opacity-50">
          {submitting ? 'Submitting...' : 'Submit Verification Request'}
        </button>
      </div>
    </div>
  );
}

function RequestsTab({ storeId, toast }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getInventoryRequests(storeId).then(setRequests).finally(() => setLoading(false));
  }, [storeId]);

  async function acknowledge(id) {
    await api.acknowledgeRequest(storeId, id);
    setRequests(r => r.map(x => x.id === id ? { ...x, status: 'acknowledged' } : x));
    toast('Marked as acknowledged');
  }

  // Group by cigar to show demand
  const byCigar = {};
  for (const req of requests) {
    const key = req.cigar_id || req.cigar_name_free || 'unknown';
    if (!byCigar[key]) byCigar[key] = { cigar_id: req.cigar_id, cigar_brand: req.cigar_brand, cigar_name: req.cigar_name || req.cigar_name_free, requests: [] };
    byCigar[key].requests.push(req);
  }

  const grouped = Object.values(byCigar).sort((a, b) => b.requests.length - a.requests.length);

  if (loading) return <div className="animate-pulse space-y-3">{[1,2,3].map(i => <div key={i} className="card h-16 bg-stone-800" />)}</div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <div className="bg-amber-900/20 border border-amber-800/30 rounded-xl p-3 flex-1">
          <p className="text-sm text-stone-300">
            <span className="text-amber-400 font-bold">{requests.length}</span> inventory request{requests.length !== 1 ? 's' : ''} from customers.
            Use this to see what cigars your shoppers want most.
          </p>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="card p-8 text-center">
          <Package className="w-10 h-10 text-stone-700 mx-auto mb-3" />
          <p className="text-stone-400 font-medium">No requests yet</p>
          <p className="text-stone-600 text-sm mt-1">Customers can request cigars from your store page.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(group => (
            <div key={group.cigar_id || group.cigar_name} className="card overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-stone-800/40">
                <div className="flex-1 min-w-0">
                  {group.cigar_brand && <p className="text-xs text-amber-500/70 uppercase tracking-wider">{group.cigar_brand}</p>}
                  <p className="font-semibold text-stone-200">{group.cigar_name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {group.requests.length} request{group.requests.length !== 1 ? 's' : ''}
                  </span>
                  {group.cigar_id && (
                    <Link to={`/cigars/${group.cigar_id}`} className="text-xs text-amber-500 hover:text-amber-400">View →</Link>
                  )}
                </div>
              </div>
              <div className="divide-y divide-stone-800/50">
                {group.requests.map(req => (
                  <div key={req.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-stone-400">{req.user_name}</p>
                      {req.message && <p className="text-xs text-stone-500 italic mt-0.5">"{req.message}"</p>}
                      <p className="text-[10px] text-stone-700 mt-0.5">{new Date(req.created_at).toLocaleDateString()}</p>
                    </div>
                    {req.status === 'pending' ? (
                      <button onClick={() => acknowledge(req.id)} className="text-xs text-stone-600 hover:text-emerald-400 border border-stone-700 hover:border-emerald-700 px-2 py-1 rounded-lg transition-colors flex-shrink-0">
                        Acknowledge
                      </button>
                    ) : (
                      <span className="text-[10px] text-emerald-500 flex-shrink-0">✓ Done</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportManager({ storeId, toast }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editedRows, setEditedRows] = useState([]);

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const data = await api.importPreview(storeId, fd);
      setPreview(data);
      setEditedRows(data.preview.map(r => ({
        ...r,
        cigar_id: r.match?.cigar_id || null,
        vitola_id: r.match?.vitola_id || null,
        price: r.price || '',
        quantity: r.quantity || 0,
        include: r.match && r.match.confidence >= 70,
      })));
    } catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  }

  async function confirmImport() {
    const rows = editedRows.filter(r => r.include && r.cigar_id && r.price);
    if (!rows.length) { toast('No valid rows to import', 'error'); return; }
    setConfirming(true);
    try {
      const result = await api.importConfirm(storeId, rows.map(r => ({ cigar_id: r.cigar_id, vitola_id: r.vitola_id || null, price: +r.price, quantity: +r.quantity })));
      toast(`Import complete: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`);
      setPreview(null);
      setFile(null);
    } catch (err) { toast(err.message, 'error'); }
    finally { setConfirming(false); }
  }

  function toggleRow(i) {
    setEditedRows(rows => rows.map((r, idx) => idx === i ? { ...r, include: !r.include } : r));
  }

  function updateRow(i, key, val) {
    setEditedRows(rows => rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }

  const includedCount = editedRows.filter(r => r.include).length;

  return (
    <div className="max-w-3xl">
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-3 mb-3">
          <FileSpreadsheet className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-stone-100">Import Inventory from CSV / XLSX</h3>
        </div>
        <p className="text-sm text-stone-400 mb-4">
          Upload a spreadsheet with your inventory. We'll match each row against our cigar catalog and let you review before importing.
          Columns detected automatically: <span className="text-amber-400">brand, name/cigar, vitola/size, price, qty/quantity</span>.
        </p>
        <label className="btn-primary flex items-center justify-center gap-2 cursor-pointer w-fit">
          <Upload className="w-4 h-4" />
          {file ? `Change File (${file.name})` : 'Choose CSV or XLSX'}
          <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFile} />
        </label>
        {loading && <p className="text-sm text-stone-400 mt-3">Analyzing file and matching cigars…</p>}
      </div>

      {preview && editedRows.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="card p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-stone-100">{editedRows.length} rows found · {includedCount} selected to import</p>
              <p className="text-xs text-stone-500 mt-0.5">Uncheck rows you don't want, or correct mismatches below</p>
            </div>
            <button onClick={confirmImport} disabled={confirming || includedCount === 0}
              className="btn-primary disabled:opacity-50 flex items-center gap-2">
              <Check className="w-4 h-4" />
              {confirming ? 'Importing…' : `Import ${includedCount} Row${includedCount !== 1 ? 's' : ''}`}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {editedRows.map((row, i) => {
              const confidence = row.match?.confidence ?? 0;
              const confColor = confidence >= 90 ? 'text-emerald-400' : confidence >= 70 ? 'text-amber-400' : 'text-red-400';
              return (
                <div key={i} className={`card p-3 flex flex-col gap-2 transition-opacity ${!row.include ? 'opacity-40' : ''}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={row.include} onChange={() => toggleRow(i)} className="mt-1 accent-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-stone-500">From file: <span className="text-stone-300">{[row.raw.brand, row.raw.name, row.raw.vitola].filter(Boolean).join(' · ')}</span></p>
                      {row.match ? (
                        <p className="text-sm font-medium text-stone-200 mt-0.5">
                          → {row.match.brand} {row.match.name}
                          {row.match.vitola_name && <span className="text-stone-400"> · {row.match.vitola_name}</span>}
                          <span className={`ml-2 text-xs font-bold ${confColor}`}>{confidence}%</span>
                        </p>
                      ) : (
                        <p className="text-sm text-red-400 mt-0.5 flex items-center gap-1"><AlertOctagon className="w-3.5 h-3.5" /> No match found</p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <div>
                        <p className="text-[10px] text-stone-600 mb-0.5">Price</p>
                        <input type="number" step="0.01" value={row.price} onChange={e => updateRow(i, 'price', e.target.value)}
                          className="input py-1 text-xs w-20 text-center" />
                      </div>
                      <div>
                        <p className="text-[10px] text-stone-600 mb-0.5">Qty</p>
                        <input type="number" value={row.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)}
                          className="input py-1 text-xs w-16 text-center" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SetupChecklist({ store, onTabChange }) {
  const [inventoryCount, setInventoryCount] = useState(null);

  useEffect(() => {
    if (store) {
      api.getManageInventory(store.id).then(d => setInventoryCount(d.items.length)).catch(() => setInventoryCount(0));
    }
  }, [store?.id]);

  const steps = [
    { done: !!(store.address && store.city && store.phone), label: 'Complete your store profile', tab: 'settings', hint: 'Add address, phone, and hours' },
    { done: inventoryCount > 0, label: 'Add your first cigars', tab: 'inventory', hint: 'Upload your live inventory' },
    { done: store.verified === 1, label: 'Get verified', tab: 'verification', hint: 'Submit for the ✓ badge' },
    { done: !!(store.description && store.description.length > 40), label: 'Write a store description', tab: 'settings', hint: 'Tell customers what makes you special' },
  ];

  const completed = steps.filter(s => s.done).length;
  if (completed === steps.length) return null; // all done, hide it

  const pct = Math.round((completed / steps.length) * 100);

  return (
    <div className="card p-4 mb-5 border-amber-900/30">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-stone-200">Getting started</p>
        <span className="text-xs text-stone-500">{completed}/{steps.length} complete</span>
      </div>
      <div className="h-1.5 bg-stone-800 rounded-full mb-3 overflow-hidden">
        <div className="h-full bg-amber-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-col gap-2">
        {steps.filter(s => !s.done).slice(0, 2).map(step => (
          <button key={step.tab} onClick={() => onTabChange(step.tab)}
            className="flex items-center gap-3 text-left p-2 rounded-lg hover:bg-stone-800/50 transition-colors">
            <div className="w-5 h-5 rounded-full border-2 border-stone-700 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-stone-300 font-medium">{step.label}</p>
              <p className="text-xs text-stone-600">{step.hint}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-stone-600 flex-shrink-0 ml-auto" />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function StoreDashboard() {
  const { user, store: storeCtx, refreshStore } = useAuth();
  const { toast: globalToast } = useToast();
  const [store, setStore] = useState(storeCtx);
  const [tab, setTab] = useState('inventory');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [showInventoryAdd, setShowInventoryAdd] = useState(false);

  const showToast = (message, type = 'success') => globalToast(message, type);

  useEffect(() => {
    if (storeCtx) setStore(storeCtx);
  }, [storeCtx]);

  if (!user || user.account_type !== 'store') {
    return <div className="max-w-xl mx-auto px-4 py-20 text-center text-stone-500">Store accounts only.</div>;
  }

  const TABS = [
    { key: 'inventory', label: 'Inventory', icon: Package },
    { key: 'import', label: 'Import', icon: Upload },
    { key: 'requests', label: 'Requests', icon: Bell },
    { key: 'broadcast', label: 'Broadcast', icon: Megaphone },
    { key: 'deals', label: 'Deals', icon: Tag },
    { key: 'analytics', label: 'Analytics', icon: BarChart2 },
    { key: 'verification', label: store?.verified ? '✓ Verified' : 'Get Verified', icon: CheckCircle },
    { key: 'settings', label: 'Settings', icon: Store },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">

      {!store ? (
        <div>
          <div className="mb-8 text-center">
            <div className="w-14 h-14 bg-amber-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Store className="w-7 h-7 text-amber-500" />
            </div>
            <h1 className="font-serif text-2xl font-bold text-stone-100 mb-1">Set Up Your Store</h1>
            <p className="text-stone-500 text-sm">Get your shop on CigarBuddy in 3 simple steps</p>
          </div>
          <SetupWizard onComplete={(s) => { setStore(s); refreshStore(s); }} />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h1 className="font-serif text-2xl font-bold text-stone-100">{store.name}</h1>
              <p className="text-stone-500 text-sm">{store.city}, {store.state}</p>
            </div>
            <Link to={`/stores/${store.id}`} className="btn-secondary text-sm flex items-center gap-2">
              <Eye className="w-4 h-4" /> View Public Page
            </Link>
          </div>

          <SetupChecklist store={store} onTabChange={(t) => { setTab(t); if (t === 'inventory') setShowInventoryAdd(true); }} />

          {/* Tabs */}
          <div className="flex border-b border-stone-800 mb-6 gap-0 overflow-x-auto">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${tab === key ? 'text-amber-400 border-b-2 border-amber-400' : 'text-stone-500 hover:text-stone-300'}`}>
                <Icon className="w-4 h-4" />{label}
              </button>
            ))}
          </div>

          {tab === 'inventory' && <InventoryManager storeId={store.id} toast={showToast} externalOpen={showInventoryAdd} onExternalOpen={setShowInventoryAdd} />}
          {tab === 'import' && <ImportManager storeId={store.id} toast={showToast} />}
          {tab === 'requests' && <RequestsTab storeId={store.id} toast={showToast} />}
          {tab === 'broadcast' && (
            <BroadcastCenter
              storeId={store.id}
              followerCount={analyticsData?.overview?.followers || 0}
              toast={showToast}
            />
          )}
          {tab === 'deals' && <DealsManager storeId={store.id} toast={showToast} />}
          {tab === 'analytics' && <Analytics storeId={store.id} />}
          {tab === 'verification' && (
            <VerificationSection store={store} toast={showToast} onVerified={(s) => { setStore(s); refreshStore(s); }} />
          )}
          {tab === 'settings' && (
            <StoreSettings store={store} onSave={(updated) => { setStore(updated); refreshStore(updated); showToast('Store updated!'); }} />
          )}
        </>
      )}
    </div>
  );
}

function StoreSettings({ store, onSave }) {
  const [form, setForm] = useState({
    name: store.name || '', description: store.description || '', address: store.address || '',
    city: store.city || '', state: store.state || '', zip: store.zip || '',
    phone: store.phone || '', website: store.website || '',
    has_lounge: !!store.has_lounge, has_walk_in_humidor: !!store.has_walk_in_humidor,
    tags: store.tags || [],
    hours: typeof store.hours === 'object' ? store.hours : (store.hours ? JSON.parse(store.hours) : { ...HOURS_TEMPLATE }),
    sheet_url: store.sheet_url || '',
  });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const TAG_OPTIONS = ['Walk-in Humidor', 'Lounge', 'Bar', 'Accessories', 'Events', 'Rare Finds', 'Members Club', 'Custom Humidors', 'Whiskey Bar'];
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function toggleTag(t) { setForm(f => ({ ...f, tags: f.tags.includes(t) ? f.tags.filter(x => x !== t) : [...f.tags, t] })); }
  function setHour(day, val) { setForm(f => ({ ...f, hours: { ...f.hours, [day]: val } })); }

  async function save() {
    setSaving(true);
    try {
      await api.updateStore(store.id, form);
      const { store: updated } = await api.me();
      onSave(updated);
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-2xl flex flex-col gap-5">
      <div className="card p-5 flex flex-col gap-4">
        <h3 className="font-semibold text-stone-100">Basic Information</h3>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Store Name</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Description</label>
          <textarea rows={3} className="input resize-none" value={form.description} onChange={e => set('description', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Address</label>
          <input className="input" value={form.address} onChange={e => set('address', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1.5">City</label><input className="input" value={form.city} onChange={e => set('city', e.target.value)} /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5">State</label><input className="input uppercase" maxLength={2} value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-stone-400 mb-1.5">Phone</label><input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5">Website</label><input className="input" value={form.website} onChange={e => set('website', e.target.value)} /></div>
        </div>
      </div>

      <div className="card p-5 flex flex-col gap-4">
        <h3 className="font-semibold text-stone-100">Amenities & Tags</h3>
        <div className="flex flex-col gap-2">
          {[['has_lounge', 'Cigar Lounge'], ['has_walk_in_humidor', 'Walk-in Humidor']].map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} className="accent-amber-500" />
              <span className="text-sm text-stone-300">{label}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {TAG_OPTIONS.map(t => (
            <button key={t} type="button" onClick={() => toggleTag(t)} className={`text-xs px-3 py-1.5 rounded-full border transition-all ${form.tags.includes(t) ? 'bg-amber-600 border-amber-500 text-white' : 'border-stone-700 text-stone-400 hover:border-stone-500'}`}>{t}</button>
          ))}
        </div>
      </div>

      <div className="card p-5 flex flex-col gap-3">
        <h3 className="font-semibold text-stone-100">Hours</h3>
        {DAYS.map(day => (
          <div key={day} className="flex items-center gap-3">
            <span className="text-xs text-stone-400 w-8">{day}</span>
            <select value={form.hours[day] === 'Closed' ? 'Closed' : 'open'} onChange={e => e.target.value === 'Closed' && setHour(day, 'Closed')} className="bg-stone-800 border border-stone-700 text-stone-300 text-xs rounded-lg px-2 py-1.5 w-20">
              <option value="open">Open</option><option value="Closed">Closed</option>
            </select>
            {form.hours[day] !== 'Closed' && <input type="text" value={form.hours[day] || ''} onChange={e => setHour(day, e.target.value)} placeholder="10am-8pm" className="input py-1.5 text-xs flex-1" />}
            {form.hours[day] === 'Closed' && <button onClick={() => setHour(day, '10am-8pm')} className="text-xs text-stone-600 hover:text-amber-400">Set hours</button>}
          </div>
        ))}
      </div>

      <div className="card p-5 flex flex-col gap-4">
        <div>
          <h3 className="font-semibold text-stone-100 mb-1">Inventory Sheet Sync</h3>
          <p className="text-xs text-stone-500">Auto-syncs every 15 min. Paste the Google Sheets URL you received from us.</p>
        </div>
        <div className="bg-amber-900/20 border border-amber-800/30 rounded-xl p-4 text-xs text-amber-300 space-y-1">
          <p className="font-semibold mb-2">Required sheet format (row 1 = header, ignored):</p>
          <p className="font-mono bg-stone-900/50 rounded p-2 text-[11px]">Brand | Cigar Name | Size | Price | Qty</p>
          <ul className="mt-2 space-y-1 text-stone-400 list-disc list-inside">
            <li>Brand and Cigar Name must match our catalog exactly (case + extra spaces are OK)</li>
            <li>Size must match a vitola name in the catalog</li>
            <li>Price is required — enter as a number (e.g. 12.50)</li>
            <li className="text-amber-300 font-medium">Leave Qty blank to mean "we carry it — quantity unknown"</li>
          </ul>
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Google Sheets URL</label>
          <input className="input" placeholder="https://docs.google.com/spreadsheets/d/..." value={form.sheet_url} onChange={e => set('sheet_url', e.target.value)} />
          <p className="text-[10px] text-stone-600 mt-1">Sheet must be set to "Anyone with the link can view"</p>
        </div>
        {store.sheet_last_synced && (
          <p className="text-xs text-stone-500">Last synced: {new Date(store.sheet_last_synced).toLocaleString()}</p>
        )}
        {syncResult && (
          <div className={`rounded-xl p-3 text-xs ${syncResult.error ? 'bg-red-900/20 border border-red-800/30 text-red-400' : 'bg-emerald-900/20 border border-emerald-800/30 text-emerald-400'}`}>
            {syncResult.error ? syncResult.error : (
              <>
                <p className="font-semibold mb-1">✓ Synced {syncResult.synced} items</p>
                {syncResult.unmatched?.length > 0 && (
                  <div>
                    <p className="text-stone-400 mb-1">{syncResult.unmatched.length} rows couldn't be matched:</p>
                    <ul className="space-y-0.5 text-stone-500">
                      {syncResult.unmatched.slice(0, 5).map((u, i) => (
                        <li key={i}>• {u.brand} {u.cigar} — {u.vitola}: <span className="text-red-400">{u.reason}</span></li>
                      ))}
                      {syncResult.unmatched.length > 5 && <li>…and {syncResult.unmatched.length - 5} more</li>}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <button onClick={async () => {
          setSyncing(true); setSyncResult(null);
          try { setSyncResult(await api.syncSheet(store.id)); }
          catch (e) { setSyncResult({ error: e.message }); }
          finally { setSyncing(false); }
        }} disabled={syncing || !store.sheet_url} className="btn-secondary flex items-center gap-2 self-start disabled:opacity-40">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Changes'}</button>
    </div>
  );
}
