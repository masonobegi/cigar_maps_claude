import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, X, Users, Store, Star, Package, Flame, AlertCircle, Eye, ChevronDown, ChevronUp, Shield, Plus, Edit2, Trash2, Search, Check } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

function StatCard({ label, value, icon: Icon, color = 'text-amber-400' }) {
  return (
    <div className="card p-4">
      <Icon className={`w-5 h-5 ${color} mb-2`} />
      <div className="text-2xl font-bold text-stone-100">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-xs text-stone-500 mt-0.5">{label}</div>
    </div>
  );
}

function VerificationQueue({ onAction }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [filter, setFilter] = useState('pending');
  const [processing, setProcessing] = useState(null);

  useEffect(() => {
    api.adminGetVerifications(filter).then(setRequests).finally(() => setLoading(false));
  }, [filter]);

  async function approve(id) {
    setProcessing(id);
    try {
      await api.adminApproveVerification(id, approveNote);
      setRequests(r => r.map(x => x.id === id ? { ...x, status: 'approved' } : x));
      onAction('Verification approved — store is now verified!');
    } finally { setProcessing(null); setApproveNote(''); setExpanded(null); }
  }

  async function reject(id) {
    setProcessing(id);
    try {
      await api.adminRejectVerification(id, rejectNote || 'Verification not approved. Please ensure all information is accurate and resubmit.');
      setRequests(r => r.map(x => x.id === id ? { ...x, status: 'rejected' } : x));
      onAction('Request rejected.');
    } finally { setProcessing(null); setRejectNote(''); setExpanded(null); }
  }

  const STATUS_BADGE = {
    pending: 'bg-amber-900/40 text-amber-400 border-amber-800/40',
    approved: 'bg-emerald-900/40 text-emerald-400 border-emerald-800/40',
    rejected: 'bg-red-900/40 text-red-400 border-red-800/40',
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {['pending', 'approved', 'rejected'].map(s => (
          <button key={s} onClick={() => { setFilter(s); setLoading(true); api.adminGetVerifications(s).then(setRequests).finally(() => setLoading(false)); }}
            className={`text-sm px-4 py-1.5 rounded-full capitalize transition-all ${filter === s ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">{[1,2,3].map(i => <div key={i} className="card h-24 animate-pulse bg-stone-800" />)}</div>
      ) : requests.length === 0 ? (
        <div className="card p-8 text-center text-stone-500">No {filter} requests.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {requests.map(req => (
            <div key={req.id} className="card overflow-hidden">
              <button type="button" onClick={() => setExpanded(expanded === req.id ? null : req.id)}
                className="w-full p-4 flex items-start gap-3 text-left hover:bg-stone-800/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-stone-100">{req.business_name}</p>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_BADGE[req.status] || ''}`}>{req.status}</span>
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">{req.store_name} · {req.city}, {req.state}</p>
                  <p className="text-xs text-stone-600 mt-0.5">{req.owner_email} · Submitted {new Date(req.submitted_at).toLocaleDateString()}</p>
                </div>
                {expanded === req.id ? <ChevronUp className="w-4 h-4 text-stone-500 flex-shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-stone-500 flex-shrink-0 mt-1" />}
              </button>

              {expanded === req.id && (
                <div className="border-t border-stone-800 p-4 flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Legal Name', req.business_name],
                      ['Store Name', req.store_name],
                      ['Owner', req.owner_name],
                      ['Email', req.owner_email],
                      ['EIN / Tax ID', req.business_ein],
                      ['Business Phone', req.business_phone],
                      ['License Number', req.license_number],
                      ['Website', req.business_website],
                    ].map(([label, value]) => value ? (
                      <div key={label}>
                        <p className="text-xs text-stone-500">{label}</p>
                        <p className="text-stone-300 font-medium truncate">{value}</p>
                      </div>
                    ) : null)}
                  </div>

                  {req.business_address && (
                    <div>
                      <p className="text-xs text-stone-500 mb-0.5">Address</p>
                      <p className="text-sm text-stone-300">{req.business_address}</p>
                    </div>
                  )}

                  {req.notes && (
                    <div>
                      <p className="text-xs text-stone-500 mb-0.5">Applicant Notes</p>
                      <p className="text-sm text-stone-300 italic">"{req.notes}"</p>
                    </div>
                  )}

                  {req.admin_notes && (
                    <div className={`rounded-lg p-3 ${req.status === 'approved' ? 'bg-emerald-900/20 border border-emerald-800/30' : 'bg-red-900/20 border border-red-800/30'}`}>
                      <p className="text-xs text-stone-500 mb-0.5">Admin Notes</p>
                      <p className="text-sm">{req.admin_notes}</p>
                    </div>
                  )}

                  {req.status === 'pending' && (
                    <div className="flex flex-col gap-3 pt-2 border-t border-stone-800">
                      <div>
                        <label className="block text-xs text-stone-400 mb-1.5">Note to store (optional)</label>
                        <input className="input text-sm" placeholder="Add a note visible to the store owner..." value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => reject(req.id)}
                          disabled={processing === req.id}
                          className="flex-1 py-2.5 rounded-xl border border-red-800/60 bg-red-900/20 text-red-400 hover:bg-red-900/40 text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <X className="w-4 h-4" /> Reject
                        </button>
                        <button
                          onClick={() => approve(req.id)}
                          disabled={processing === req.id}
                          className="flex-1 py-2.5 rounded-xl border border-emerald-700/60 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <CheckCircle className="w-4 h-4" /> Approve & Verify
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STRENGTHS = ['mild', 'mild-medium', 'medium', 'medium-full', 'full'];
const EMPTY_CIGAR = { brand: '', name: '', country: '', wrapper: '', binder: '', filler: '', strength: 'medium', flavor_notes: '', description: '', year_introduced: '' };

function CigarManager({ toast }) {
  const [cigars, setCigars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editCigar, setEditCigar] = useState(null);
  const [vitolas, setVitolas] = useState([]);
  const [newVitola, setNewVitola] = useState({ name: '', length: '', ring_gauge: '', msrp: '' });
  const [editVitola, setEditVitola] = useState(null);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.adminGetCigars().then(setCigars).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function parseFn(raw) {
    if (!raw) return '';
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.join(', ') : raw; } catch { return raw; }
  }

  async function openEdit(cigar) {
    setEditVitola(null);
    setNewVitola({ name: '', length: '', ring_gauge: '', msrp: '' });
    setEditCigar({ ...cigar, flavor_notes: parseFn(cigar.flavor_notes) });
    if (cigar.id) {
      api.adminGetCigarVitolas(cigar.id).then(setVitolas);
    } else {
      setVitolas([]);
    }
  }

  async function saveCigar() {
    setSaving(true);
    try {
      const payload = {
        ...editCigar,
        flavor_notes: editCigar.flavor_notes ? editCigar.flavor_notes.split(',').map(s => s.trim()).filter(Boolean) : [],
        year_introduced: editCigar.year_introduced ? +editCigar.year_introduced : null,
      };
      if (editCigar.id) {
        await api.adminUpdateCigar(editCigar.id, payload);
        toast('Cigar updated — all inventory and review refs preserved.');
      } else {
        await api.adminCreateCigar(payload);
        toast('Cigar added to catalog.');
      }
      setEditCigar(null);
      load();
    } catch (e) {
      toast(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteCigar(id) {
    try {
      await api.adminDeleteCigar(id);
      toast('Cigar deleted.');
      load();
    } catch (e) {
      toast(e.message || 'Delete failed');
    }
  }

  async function addVitola() {
    if (!newVitola.name || !editCigar?.id) return;
    await api.adminAddVitola(editCigar.id, newVitola);
    setNewVitola({ name: '', length: '', ring_gauge: '', msrp: '' });
    api.adminGetCigarVitolas(editCigar.id).then(setVitolas);
    toast('Vitola added.');
  }

  async function saveVitola(v) {
    await api.adminUpdateVitola(v.id, { name: v.name, length: v.length, ring_gauge: v.ring_gauge, msrp: v.msrp });
    setEditVitola(null);
    api.adminGetCigarVitolas(editCigar.id).then(setVitolas);
    toast('Vitola updated in place.');
  }

  async function deleteVitola(v) {
    if (v.inventory_count > 0) { toast(`Can't delete — ${v.inventory_count} inventory items use this vitola.`); return; }
    if (!confirm('Delete this vitola?')) return;
    await api.adminDeleteVitola(v.id);
    api.adminGetCigarVitolas(editCigar.id).then(setVitolas);
    toast('Vitola deleted.');
  }

  const filtered = cigars.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.brand.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="card p-4 mb-5 bg-amber-900/10 border-amber-900/30">
        <p className="text-sm font-semibold text-amber-400 mb-1">Safe live migration</p>
        <p className="text-xs text-stone-400">
          Editing a cigar updates it <strong className="text-stone-300">in place</strong> — the cigar ID never changes, so all store inventory,
          reviews, humidor entries, and follows automatically reflect the new brand/name. Safe to run on live data at any time.
          Cigars with active references cannot be deleted — only edited.
        </p>
      </div>

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search brand or name…" className="input pl-9 py-2" />
        </div>
        <button onClick={() => openEdit({ ...EMPTY_CIGAR })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
          <Plus className="w-4 h-4" /> Add Cigar
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">{[1,2,3,4].map(i => <div key={i} className="card h-14 animate-pulse bg-stone-800" />)}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map(c => {
            const hasRefs = c.inventory_count > 0 || c.review_count > 0 || c.follow_count > 0;
            return (
              <div key={c.id} className="card px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600/70 truncate">{c.brand}</p>
                  <p className="text-sm font-semibold text-stone-200 truncate">{c.name}</p>
                  <div className="flex gap-3 mt-0.5 flex-wrap">
                    {c.inventory_count > 0 && <span className="text-[10px] text-stone-500">{c.inventory_count} inventory</span>}
                    {c.review_count > 0 && <span className="text-[10px] text-stone-500">{c.review_count} reviews</span>}
                    {c.vitola_count > 0 && <span className="text-[10px] text-stone-500">{c.vitola_count} vitolas</span>}
                    {!hasRefs && <span className="text-[10px] text-stone-600">no refs — safe to delete</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {hasRefs && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-900/30 text-emerald-500 border border-emerald-800/30">live</span>
                  )}
                  <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-stone-700 rounded-lg text-stone-500 hover:text-stone-200 transition-colors" title="Edit">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  {!hasRefs && (
                    <button onClick={() => { if (confirm(`Delete "${c.brand} ${c.name}"?`)) deleteCigar(c.id); }}
                      className="p-1.5 hover:bg-red-900/30 rounded-lg text-stone-600 hover:text-red-400 transition-colors" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && !loading && (
            <div className="card p-8 text-center text-stone-500">No cigars match "{search}"</div>
          )}
        </div>
      )}

      {/* Edit / Add modal */}
      {editCigar && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setEditCigar(null)}>
          <div className="bg-stone-900 border border-stone-700 rounded-2xl w-full max-w-2xl p-6 flex flex-col gap-5 my-8" onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg font-bold text-stone-100">
                {editCigar.id ? 'Edit Cigar' : 'Add New Cigar'}
              </h2>
              <button onClick={() => setEditCigar(null)} className="p-1.5 hover:bg-stone-800 rounded-lg text-stone-500">
                <X className="w-4 h-4" />
              </button>
            </div>

            {editCigar.id && (editCigar.inventory_count > 0 || editCigar.review_count > 0) && (
              <div className="bg-emerald-900/20 border border-emerald-800/30 rounded-xl p-3 text-xs text-emerald-400">
                <strong>{editCigar.inventory_count}</strong> inventory · <strong>{editCigar.review_count}</strong> reviews attached.
                Saving updates the name/details in place — all references stay intact.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs text-stone-400 mb-1.5">Brand *</label>
                <input className="input" value={editCigar.brand || ''} onChange={e => setEditCigar(c => ({ ...c, brand: e.target.value }))} placeholder="e.g. Padron" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs text-stone-400 mb-1.5">Line / Name *</label>
                <input className="input" value={editCigar.name || ''} onChange={e => setEditCigar(c => ({ ...c, name: e.target.value }))} placeholder="e.g. 1964 Anniversary Serie" />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Country</label>
                <input className="input" value={editCigar.country || ''} onChange={e => setEditCigar(c => ({ ...c, country: e.target.value }))} placeholder="Nicaragua" />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Strength</label>
                <select className="input" value={editCigar.strength || 'medium'} onChange={e => setEditCigar(c => ({ ...c, strength: e.target.value }))}>
                  {STRENGTHS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Wrapper</label>
                <input className="input" value={editCigar.wrapper || ''} onChange={e => setEditCigar(c => ({ ...c, wrapper: e.target.value }))} placeholder="Maduro" />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Binder</label>
                <input className="input" value={editCigar.binder || ''} onChange={e => setEditCigar(c => ({ ...c, binder: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Filler</label>
                <input className="input" value={editCigar.filler || ''} onChange={e => setEditCigar(c => ({ ...c, filler: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1.5">Year Introduced</label>
                <input type="number" className="input" value={editCigar.year_introduced || ''} onChange={e => setEditCigar(c => ({ ...c, year_introduced: e.target.value }))} placeholder="2004" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-stone-400 mb-1.5">Flavor Notes (comma-separated)</label>
                <input className="input" value={editCigar.flavor_notes || ''} onChange={e => setEditCigar(c => ({ ...c, flavor_notes: e.target.value }))} placeholder="cedar, leather, coffee, dark chocolate" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-stone-400 mb-1.5">Description</label>
                <textarea rows={2} className="input resize-none" value={editCigar.description || ''} onChange={e => setEditCigar(c => ({ ...c, description: e.target.value }))} />
              </div>
            </div>

            {/* Vitolas — only for existing cigars */}
            {editCigar.id && (
              <div className="border-t border-stone-800 pt-4">
                <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Vitolas / Sizes</p>
                <div className="flex flex-col gap-2 mb-3">
                  {vitolas.map(v => (
                    <div key={v.id} className="flex items-center gap-2 text-sm">
                      {editVitola?.id === v.id ? (
                        <>
                          <input className="input py-1.5 text-xs flex-1" value={editVitola.name} onChange={e => setEditVitola(x => ({ ...x, name: e.target.value }))} placeholder="Name" />
                          <input type="number" step="0.25" placeholder="Length" className="input py-1.5 text-xs w-20" value={editVitola.length || ''} onChange={e => setEditVitola(x => ({ ...x, length: e.target.value }))} />
                          <input type="number" placeholder="RG" className="input py-1.5 text-xs w-16" value={editVitola.ring_gauge || ''} onChange={e => setEditVitola(x => ({ ...x, ring_gauge: e.target.value }))} />
                          <input type="number" step="0.01" placeholder="MSRP" className="input py-1.5 text-xs w-20" value={editVitola.msrp || ''} onChange={e => setEditVitola(x => ({ ...x, msrp: e.target.value }))} />
                          <button onClick={() => saveVitola(editVitola)} className="btn-primary py-1 px-2 text-xs flex items-center gap-1"><Check className="w-3 h-3" /></button>
                          <button onClick={() => setEditVitola(null)} className="p-1 text-stone-500 hover:text-stone-200"><X className="w-3.5 h-3.5" /></button>
                        </>
                      ) : (
                        <>
                          <span className="text-stone-200 flex-1 text-sm">{v.name}</span>
                          {(v.length || v.ring_gauge) && <span className="text-stone-500 text-xs">{v.length ? `${v.length}"` : ''}×{v.ring_gauge || '?'}</span>}
                          {v.msrp && <span className="text-amber-500 text-xs">${v.msrp}</span>}
                          {v.inventory_count > 0 && <span className="text-[10px] text-emerald-500">{v.inventory_count} inv</span>}
                          <button onClick={() => setEditVitola({ ...v })} className="p-1 text-stone-600 hover:text-stone-200 transition-colors"><Edit2 className="w-3 h-3" /></button>
                          <button onClick={() => deleteVitola(v)} className={`p-1 transition-colors ${v.inventory_count > 0 ? 'text-stone-800 cursor-not-allowed' : 'text-stone-600 hover:text-red-400'}`}><Trash2 className="w-3 h-3" /></button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 border-t border-stone-800 pt-3">
                  <input placeholder="Vitola name (e.g. Toro)" className="input py-1.5 text-xs flex-1" value={newVitola.name} onChange={e => setNewVitola(v => ({ ...v, name: e.target.value }))} />
                  <input type="number" step="0.25" placeholder="Length" className="input py-1.5 text-xs w-20" value={newVitola.length} onChange={e => setNewVitola(v => ({ ...v, length: e.target.value }))} />
                  <input type="number" placeholder="RG" className="input py-1.5 text-xs w-16" value={newVitola.ring_gauge} onChange={e => setNewVitola(v => ({ ...v, ring_gauge: e.target.value }))} />
                  <input type="number" step="0.01" placeholder="MSRP" className="input py-1.5 text-xs w-20" value={newVitola.msrp} onChange={e => setNewVitola(v => ({ ...v, msrp: e.target.value }))} />
                  <button onClick={addVitola} disabled={!newVitola.name} className="btn-primary py-1 px-2 text-xs disabled:opacity-40 flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-stone-800">
              <button onClick={() => setEditCigar(null)} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={saveCigar}
                disabled={saving || !editCigar.brand || !editCigar.name}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {saving ? 'Saving…' : editCigar.id ? 'Update In Place' : 'Add to Catalog'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('verifications');
  const [stats, setStats] = useState(null);
  const [stores, setStores] = useState([]);
  const [users, setUsers] = useState([]);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!authLoading && (!user || !['admin','staff'].includes(user.account_type))) {
      navigate('/');
    }
  }, [user, authLoading]);

  useEffect(() => {
    if (!user || !['admin','staff'].includes(user.account_type)) return;
    api.adminGetStats().then(setStats);
  }, [user]);

  useEffect(() => {
    if (tab === 'stores') api.adminGetStores().then(setStores);
    if (tab === 'users') api.adminGetUsers().then(setUsers);
  }, [tab]);

  if (authLoading || !user) return null;
  if (!['admin','staff'].includes(user.account_type)) return null;

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function toggleVerified(storeId, current) {
    await api.adminToggleVerified(storeId, !current);
    setStores(s => s.map(x => x.id === storeId ? { ...x, verified: current ? 0 : 1 } : x));
    showToast(current ? 'Verification removed.' : 'Store verified!');
  }

  const TABS = [
    { key: 'verifications', label: 'Verifications' },
    { key: 'stores', label: 'Stores' },
    { key: 'users', label: 'Users' },
    { key: 'cigars', label: 'Cigars' },
    { key: 'overview', label: 'Overview' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-stone-800 border border-stone-700 text-stone-100 text-sm px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" /> {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-amber-900/30 rounded-xl flex items-center justify-center">
          <Shield className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h1 className="font-serif text-2xl font-bold text-stone-100">Admin Panel</h1>
          <p className="text-stone-500 text-sm">CigarBuddy operations</p>
        </div>
      </div>

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Users" value={stats.stats.total_users} icon={Users} color="text-blue-400" />
          <StatCard label="Stores" value={stats.stats.total_stores} icon={Store} color="text-amber-400" />
          <StatCard label="Verified" value={stats.stats.verified_stores} icon={CheckCircle} color="text-emerald-400" />
          <StatCard label="Pending Verif." value={stats.stats.pending_verifications} icon={AlertCircle} color={stats.stats.pending_verifications > 0 ? 'text-orange-400' : 'text-stone-500'} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-stone-800 mb-6 gap-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${tab === t.key ? 'text-amber-400 border-b-2 border-amber-400' : 'text-stone-500 hover:text-stone-300'}`}>
            {t.label}
            {t.key === 'verifications' && stats?.stats.pending_verifications > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {stats.stats.pending_verifications}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'verifications' && <VerificationQueue onAction={showToast} />}

      {tab === 'stores' && (
        <div className="flex flex-col gap-3">
          {stores.map(s => (
            <div key={s.id} className="card p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-stone-200">{s.name}</p>
                  {s.verified === 1 && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                  {s.verification_status === 'pending' && <span className="text-[10px] bg-amber-900/40 text-amber-400 border border-amber-800/40 px-1.5 py-0.5 rounded-full">Verification Pending</span>}
                </div>
                <p className="text-xs text-stone-500">{s.city}, {s.state} · {s.owner_email}</p>
                <p className="text-xs text-stone-600 mt-0.5">{s.inventory_count} SKUs · {s.followers} followers</p>
              </div>
              <button
                onClick={() => toggleVerified(s.id, s.verified)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  s.verified ? 'border-emerald-700 text-emerald-400 hover:bg-red-900/20 hover:border-red-700 hover:text-red-400' : 'border-stone-700 text-stone-500 hover:border-emerald-700 hover:text-emerald-400'
                }`}
              >
                {s.verified ? 'Unverify' : 'Verify'}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div className="flex flex-col gap-2">
          {users.map(u => (
            <div key={u.id} className="card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-stone-200 text-sm">{u.name}</p>
                <p className="text-xs text-stone-500">{u.email}</p>
                {(u.location_city || u.location_state) && (
                  <p className="text-xs text-stone-600">{[u.location_city, u.location_state].filter(Boolean).join(', ')}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${
                  u.account_type === 'admin' ? 'bg-purple-900/40 text-purple-400' :
                  u.account_type === 'staff' ? 'bg-blue-900/40 text-blue-400' :
                  u.account_type === 'store' ? 'bg-amber-900/40 text-amber-400' : 'bg-stone-800 text-stone-400'
                }`}>{u.account_type}</span>
                <span className="text-[10px] text-stone-600">{new Date(u.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'cigars' && <CigarManager toast={showToast} />}

      {tab === 'overview' && stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Total Users', value: stats.stats.total_users, icon: Users, color: 'text-blue-400' },
            { label: 'Total Stores', value: stats.stats.total_stores, icon: Store, color: 'text-amber-400' },
            { label: 'Verified Stores', value: stats.stats.verified_stores, icon: CheckCircle, color: 'text-emerald-400' },
            { label: 'Total Reviews', value: stats.stats.total_reviews, icon: Star, color: 'text-yellow-400' },
            { label: 'Cigars in DB', value: stats.stats.total_cigars, icon: Flame, color: 'text-orange-400' },
            { label: 'Inventory SKUs', value: stats.stats.total_inventory, icon: Package, color: 'text-stone-400' },
            { label: 'Smoke Lists (active)', value: stats.stats.smoke_list_pending, icon: Eye, color: 'text-blue-400' },
            { label: 'Store Follows', value: stats.stats.total_follows, icon: Users, color: 'text-pink-400' },
            { label: 'Broadcasts Sent', value: stats.stats.total_broadcasts, icon: Flame, color: 'text-purple-400' },
          ].map(s => <StatCard key={s.label} {...s} />)}
        </div>
      )}
    </div>
  );
}
