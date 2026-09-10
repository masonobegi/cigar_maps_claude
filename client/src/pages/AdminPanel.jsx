import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, X, Users, Store, Star, Package, Flame, AlertCircle, Eye, EyeOff, ChevronDown, ChevronUp, Shield, Plus, Edit2, Trash2, Search, Check, MapPin, Flag, ExternalLink, BadgeCheck, Link2Off, RefreshCw, Globe, DoorClosed, RotateCcw, Phone } from 'lucide-react';
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

const TYPE_LABEL = { cigar_lounge: 'Lounge', cigar_shop: 'Cigar shop', tobacco_shop: 'Tobacco shop', smoke_shop: 'Smoke shop' };

function domainOf(v) {
  return (v || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].split('@').pop().split('.').slice(-2).join('.');
}

function ClaimsQueue({ onAction }) {
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [notes, setNotes] = useState({});

  useEffect(() => { setLoading(true); api.adminGetClaims(filter).then(setRows).finally(() => setLoading(false)); }, [filter]);

  async function act(id, fn, msg) {
    setBusy(id);
    try { await fn(); setRows(r => r.filter(x => x.id !== id)); onAction(msg); }
    catch (e) { onAction(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {['pending', 'approved', 'rejected'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`text-sm px-4 py-1.5 rounded-full capitalize transition-all ${filter === s ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}>{s}</button>
        ))}
      </div>
      {loading ? <div className="card h-24 skeleton" /> : rows.length === 0 ? (
        <p className="text-stone-500 text-sm text-center py-10">No {filter} claims.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(c => {
            const emailMatch = c.store_website && domainOf(c.contact_email) === domainOf(c.store_website);
            return (
              <div key={c.id} className="card p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <p className="font-semibold text-stone-200 flex items-center gap-2">
                      {c.store_name}
                      <a href={`/stores/${c.store_id}`} target="_blank" rel="noreferrer" className="text-stone-500 hover:text-amber-400"><ExternalLink className="w-3.5 h-3.5" /></a>
                    </p>
                    <p className="text-xs text-stone-500">{[c.store_address, c.city, c.state].filter(Boolean).join(', ')}</p>
                    <p className="text-xs text-stone-500">Listing: {c.store_phone || 'no phone'} · {c.store_website || 'no website'}</p>
                  </div>
                  <div className="flex-1 min-w-[220px] text-xs">
                    <p className="text-stone-300 font-medium">{c.user_name} <span className="text-stone-500">({c.user_email})</span></p>
                    <p className="text-stone-400 mt-0.5">
                      Contact: {c.contact_email}
                      {emailMatch && <span className="ml-1.5 text-emerald-400">matches website domain</span>}
                      {c.contact_phone && ` · ${c.contact_phone}`}
                    </p>
                    {c.message && <p className="text-stone-400 mt-1 italic">"{c.message}"</p>}
                    <p className="text-stone-600 mt-1">{c.method} · {new Date(c.created_at).toLocaleString()}{c.admin_notes ? ` · ${c.admin_notes}` : ''}</p>
                  </div>
                </div>
                {c.status === 'pending' && (
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <input value={notes[c.id] || ''} onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))} placeholder="Note (optional)" className="input py-1.5 text-xs flex-1 min-w-[160px]" />
                    <button disabled={busy === c.id} onClick={() => act(c.id, () => api.adminApproveClaim(c.id, notes[c.id]), 'Claim approved. Store is now owner-managed and verified.')}
                      className="text-xs px-3 py-1.5 rounded-lg border border-emerald-700 text-emerald-400 hover:bg-emerald-900/20 disabled:opacity-50 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button disabled={busy === c.id} onClick={() => act(c.id, () => api.adminRejectClaim(c.id, notes[c.id]), 'Claim rejected.')}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-800 text-red-400 hover:bg-red-900/20 disabled:opacity-50 flex items-center gap-1">
                      <X className="w-3.5 h-3.5" /> Reject
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

function ListingsQueue({ onAction }) {
  const [visible, setVisible] = useState('0');
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const p = { visible, limit: 200 };
    if (q) p.q = q;
    if (state) p.state = state;
    if (visible === '0') p.min_conf = '0.25';
    api.adminGetListings(p).then(setRows).finally(() => setLoading(false));
  }
  useEffect(load, [visible, state]);

  async function setListing(id, patch, msg) {
    await api.adminSetListing(id, patch);
    setRows(r => r.map(x => x.id === id ? { ...x, ...patch } : x));
    onAction(msg);
  }

  return (
    <div>
      <p className="text-xs text-stone-500 mb-3">
        Listings are imported from OpenStreetMap and scored by how likely they are a real cigar shop. Anything under 0.5 is hidden from the public map.
        Borderline ones (0.25 to 0.5) show here so you can unhide the good ones.
      </p>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {[['0', 'Hidden (review)'], ['1', 'Public']].map(([v, l]) => (
          <button key={v} onClick={() => setVisible(v)}
            className={`text-sm px-4 py-1.5 rounded-full transition-all ${visible === v ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}>{l}</button>
        ))}
        <input value={state} onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))} placeholder="State" className="input py-1.5 text-xs w-20" />
        <form onSubmit={e => { e.preventDefault(); load(); }} className="flex gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or city" className="input py-1.5 text-xs w-48" />
          <button type="submit" className="btn-secondary text-xs px-3 py-1.5"><Search className="w-3.5 h-3.5" /></button>
        </form>
      </div>
      {loading ? <div className="card h-24 skeleton" /> : rows.length === 0 ? (
        <p className="text-stone-500 text-sm text-center py-10">Nothing here.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(s => (
            <div key={s.id} className="card p-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <p className="font-medium text-stone-200 text-sm flex items-center gap-2">
                  {s.name}
                  <a href={`/stores/${s.id}`} target="_blank" rel="noreferrer" className="text-stone-500 hover:text-amber-400"><ExternalLink className="w-3.5 h-3.5" /></a>
                  {s.open_reports > 0 && <span className="text-[10px] bg-red-900/40 text-red-400 px-1.5 py-0.5 rounded-full">{s.open_reports} report{s.open_reports > 1 ? 's' : ''}</span>}
                </p>
                <p className="text-xs text-stone-500">{[s.address, s.city, s.state].filter(Boolean).join(', ') || `${s.lat?.toFixed(3)}, ${s.lng?.toFixed(3)}`}{s.website ? ` · ${s.website}` : ''}{s.phone ? ` · ${s.phone}` : ''}</p>
                <p className="text-[11px] text-stone-600">confidence {Number(s.confidence).toFixed(2)} · {s.views} views · osm {s.source_id}</p>
              </div>
              <select value={s.store_type || 'cigar_shop'} onChange={e => setListing(s.id, { store_type: e.target.value }, 'Type updated')} className="input py-1 text-xs w-36">
                {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button onClick={() => setListing(s.id, { visible: s.visible ? 0 : 1 }, s.visible ? 'Listing hidden' : 'Listing is now public')}
                className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1 ${s.visible ? 'border-stone-700 text-stone-400 hover:border-red-700 hover:text-red-400' : 'border-emerald-700 text-emerald-400 hover:bg-emerald-900/20'}`}>
                {s.visible ? <><EyeOff className="w-3.5 h-3.5" /> Hide</> : <><Eye className="w-3.5 h-3.5" /> Show</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const REASON_LABEL = { closed: 'Permanently closed', not_cigar_shop: 'Not a cigar shop', wrong_location: 'Wrong location', wrong_info: 'Wrong info', duplicate: 'Duplicate', other: 'Other' };

function ReportsQueue({ onAction }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.adminGetReports('open').then(setRows).finally(() => setLoading(false)); }, []);

  async function resolve(r, hide) {
    await api.adminUpdateReport(r.id, { status: 'resolved', hide_store: hide });
    setRows(x => x.filter(y => y.id !== r.id));
    onAction(hide ? 'Listing hidden and report resolved.' : 'Report resolved.');
  }

  return loading ? <div className="card h-24 skeleton" /> : rows.length === 0 ? (
    <p className="text-stone-500 text-sm text-center py-10">No open reports.</p>
  ) : (
    <div className="flex flex-col gap-2">
      {rows.map(r => (
        <div key={r.id} className="card p-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <p className="font-medium text-stone-200 text-sm flex items-center gap-2">
              {r.store_name}
              <a href={`/stores/${r.store_id}`} target="_blank" rel="noreferrer" className="text-stone-500 hover:text-amber-400"><ExternalLink className="w-3.5 h-3.5" /></a>
              {r.claimed ? <span className="text-[10px] text-amber-400">claimed</span> : null}
            </p>
            <p className="text-xs text-stone-400"><span className="text-red-400">{REASON_LABEL[r.reason] || r.reason}</span>{r.details ? ` · ${r.details}` : ''}</p>
            <p className="text-[11px] text-stone-600">{r.reporter_email || 'anonymous'} · {new Date(r.created_at).toLocaleString()} · {r.city}, {r.state}</p>
          </div>
          {!r.claimed && (
            <button onClick={() => resolve(r, true)} className="text-xs px-3 py-1.5 rounded-lg border border-red-800 text-red-400 hover:bg-red-900/20 flex items-center gap-1">
              <EyeOff className="w-3.5 h-3.5" /> Hide listing
            </button>
          )}
          <button onClick={() => resolve(r, false)} className="text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-400 hover:text-stone-200 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> Resolve
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Catalog queue: product titles our menu reader pulled off shop websites but
 * could not match to a cigar. Linking one teaches the matcher — the next scan
 * treats that exact title as an alias for the cigar chosen here.
 */
function CatalogQueue({ onAction }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [openRow, setOpenRow] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  function load() {
    setLoading(true);
    api.adminGetCatalogPending({ status: 'pending', limit: 100 })
      .then(d => setRows(d.items || []))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.searchCigars({ q: query, limit: 8 }).then(d => setResults(d.cigars || [])).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function link(row, cigar) {
    setBusy(row.id);
    try {
      await api.adminResolveCatalogPending(row.id, { cigar_id: cigar.id });
      setRows(r => r.filter(x => x.id !== row.id));
      setOpenRow(null); setQuery(''); setResults([]);
      onAction(`Linked to ${cigar.brand} ${cigar.name}.`);
    } catch (e) { onAction(e.message); } finally { setBusy(null); }
  }

  async function dismiss(row) {
    setBusy(row.id);
    try {
      await api.adminResolveCatalogPending(row.id, { dismiss: true });
      setRows(r => r.filter(x => x.id !== row.id));
      onAction('Dismissed.');
    } catch (e) { onAction(e.message); } finally { setBusy(null); }
  }

  async function scan() {
    setScanning(true);
    try {
      await api.adminRunMenuScan({ limit: 40 });
      onAction('Menu scan started — check back in a few minutes.');
    } catch (e) { onAction(e.message); } finally { setScanning(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-stone-500">
          Unmatched product titles read from shop websites, most-seen first.
        </p>
        <button onClick={scan} disabled={scanning}
          className="text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-300 hover:text-amber-400 flex items-center gap-1.5 disabled:opacity-50">
          <Search className="w-3.5 h-3.5" /> {scanning ? 'Starting...' : 'Scan 40 stale stores'}
        </button>
      </div>

      {loading ? <div className="card h-24 skeleton" /> : rows.length === 0 ? (
        <p className="text-stone-500 text-sm text-center py-10">Nothing waiting in the catalog queue.</p>
      ) : rows.map(r => (
        <div key={r.id} className="card p-3 flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <p className="font-medium text-stone-200 text-sm">{r.raw_name}</p>
              <p className="text-[11px] text-stone-600">
                seen {r.seen_count}x
                {r.price ? ` · $${Number(r.price).toFixed(2)}` : ''}
                {r.store_name ? ` · ${r.store_name}` : ''}
                {r.suggested_brand ? ` · suggested: ${r.suggested_brand} ${r.suggested_name}` : ''}
              </p>
            </div>
            <button onClick={() => { setOpenRow(openRow === r.id ? null : r.id); setQuery(''); setResults([]); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-300 hover:text-amber-400 flex items-center gap-1">
              <Search className="w-3.5 h-3.5" /> {openRow === r.id ? 'Close' : 'Link cigar'}
            </button>
            <button onClick={() => dismiss(r)} disabled={busy === r.id}
              className="text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-400 hover:text-stone-200 flex items-center gap-1 disabled:opacity-50">
              <X className="w-3.5 h-3.5" /> Dismiss
            </button>
          </div>

          {openRow === r.id && (
            <div className="pt-2 border-t border-stone-800 flex flex-col gap-2">
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search the catalog by brand or line..." className="input py-1.5 text-sm" />
              {results.map(c => (
                <button key={c.id} onClick={() => link(r, c)} disabled={busy === r.id}
                  className="text-left text-sm px-3 py-2 rounded-lg border border-stone-800 hover:border-amber-700 text-stone-300 disabled:opacity-50">
                  <span className="text-amber-500 text-xs font-semibold uppercase tracking-wide">{c.brand}</span> {c.name}
                </button>
              ))}
              {query.trim() && results.length === 0 && (
                <p className="text-xs text-stone-600">No catalog match. Add the cigar under the Cigars tab first.</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Links queue: listings whose website column no longer works. The public
 * profile refuses to render these as links, so this is where staff see what the
 * checker found and either re-run it or wipe a domain that is never coming back.
 */
const LINK_STATUS_LABEL = {
  dns_fail:  'Domain does not resolve',
  timeout:   'No answer (timed out)',
  refused:   'Connection refused',
  not_found: 'Not found (404)',
  error:     'Server error',
  parked:    'Parked / placeholder page',
  removed:   'Cleared by staff',
  ok:        'Working',
};

// The checker only ever writes the statuses above; 'removed' is what the clear
// endpoint stamps on a listing whose website someone already threw away. Those
// need no further decision, so they stay out of the badge and the default view
// and get their own chip.
const BROKEN_STATUSES = ['dns_fail', 'timeout', 'refused', 'not_found', 'error', 'parked'];
const CLEARED_STATUS = 'removed';

// GET /admin/dead-links answers { items, counts, total_bad, unchecked }, where
// counts is keyed by website_status and spans the whole table, not just this page.
const deadLinkCounts = (d) => (d?.counts && typeof d.counts === 'object' ? d.counts : null);

const brokenTotal = (counts) => BROKEN_STATUSES.reduce((n, k) => n + (Number(counts?.[k]) || 0), 0);

// api.js is owned elsewhere and has no helper for the clear endpoint, so post it
// exactly the way request() in that file does.
async function adminPost(path, body) {
  const token = localStorage.getItem('cigarbuddy_token');
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function LinksQueue({ onAction, onCounts }) {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');   // '' = every broken status
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [checking, setChecking] = useState(false);
  const [unchecked, setUnchecked] = useState(null);

  function load() {
    setLoading(true);
    const p = { limit: 200 };
    if (status) p.status = status;
    if (q.trim()) p.q = q.trim();
    api.adminGetDeadLinks(p)
      .then(d => {
        const c = deadLinkCounts(d) || {};
        setRows(d?.items || []);
        setCounts(c);
        setUnchecked(Number(d?.unchecked) || 0);
        onCounts?.(c);
      })
      .catch(e => { setRows([]); onAction(e.message); })
      .finally(() => setLoading(false));
  }
  useEffect(load, [status]);

  async function clearWebsite(row) {
    setBusy(row.id);
    try {
      await adminPost(`/admin/dead-links/${row.id}/clear`);
      setRows(r => r.filter(x => x.id !== row.id));
      setCounts(c => {
        const k = row.website_status || 'unknown';
        const next = {
          ...c,
          [k]: Math.max(0, (Number(c[k]) || 0) - 1),
          [CLEARED_STATUS]: (Number(c[CLEARED_STATUS]) || 0) + 1,
        };
        onCounts?.(next);
        return next;
      });
      onAction(`Website removed from ${row.name}.`);
    } catch (e) { onAction(e.message); } finally { setBusy(null); }
  }

  async function runCheck() {
    setChecking(true);
    try {
      await api.adminRunLinkCheck({ limit: 300 });
      onAction('Link check started on 300 listings — reload this tab in a few minutes.');
    } catch (e) { onAction(e.message); } finally { setChecking(false); }
  }

  // The endpoint may or may not honour ?q, so narrow locally as well. The
  // unfiltered call also returns listings staff already cleared — keep those out
  // of the working list unless their own chip is selected.
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter(r => status ? true : r.website_status !== CLEARED_STATUS)
    .filter(r => !needle || [r.name, r.city, r.state, r.website].some(v => String(v || '').toLowerCase().includes(needle)));

  const present = BROKEN_STATUSES.filter(s => (Number(counts[s]) || 0) > 0);
  const total = brokenTotal(counts);
  const clearedCount = Number(counts[CLEARED_STATUS]) || 0;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <p className="text-xs text-stone-500 max-w-xl">
          Website addresses imported from Overture and OpenStreetMap that we could not reach. Store profiles show these
          as plain text instead of a link, so a visitor never clicks into a dead domain. Clearing one drops the address
          from the listing for good.
        </p>
        <div className="flex flex-col items-end gap-1">
          <button onClick={runCheck} disabled={checking}
            className="text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-300 hover:text-amber-400 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> {checking ? 'Starting...' : 'Check 300 listings'}
          </button>
          {unchecked > 0 && <span className="text-[11px] text-stone-600">{unchecked.toLocaleString()} never checked</span>}
        </div>
      </div>

      {/* Counts by status — each one doubles as the filter */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <button onClick={() => setStatus('')}
          className={`text-xs px-3 py-1.5 rounded-full transition-all ${status === '' ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}>
          All broken <span className="opacity-70">({total})</span>
        </button>
        {present.map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`text-xs px-3 py-1.5 rounded-full transition-all ${status === s ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}>
            {LINK_STATUS_LABEL[s] || s} <span className="opacity-70">({counts[s]})</span>
          </button>
        ))}
        {clearedCount > 0 && (
          <button onClick={() => setStatus(CLEARED_STATUS)}
            className={`text-xs px-3 py-1.5 rounded-full transition-all ${status === CLEARED_STATUS ? 'bg-stone-600 text-white' : 'bg-stone-900 text-stone-500 hover:bg-stone-800'}`}>
            {LINK_STATUS_LABEL[CLEARED_STATUS]} <span className="opacity-70">({clearedCount})</span>
          </button>
        )}
        <form onSubmit={e => { e.preventDefault(); load(); }} className="flex gap-2 ml-auto">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, city, domain" className="input py-1.5 text-xs w-52" />
          <button type="submit" className="btn-secondary text-xs px-3 py-1.5"><Search className="w-3.5 h-3.5" /></button>
        </form>
      </div>

      {loading ? <div className="card h-24 skeleton" /> : shown.length === 0 ? (
        <p className="text-stone-500 text-sm text-center py-10">
          {needle ? `Nothing matches "${q}".` : 'No broken links here. Run a check to look at more listings.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map(r => (
            <div key={r.id} className="card p-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[240px]">
                <p className="font-medium text-stone-200 text-sm flex items-center gap-2">
                  {r.name}
                  <a href={`/stores/${r.id}`} target="_blank" rel="noreferrer" className="text-stone-500 hover:text-amber-400" title="Open the listing">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  {r.claimed ? <span className="text-[10px] text-amber-400">claimed</span> : null}
                </p>
                <p className="text-xs text-stone-500 flex items-center gap-1.5 flex-wrap">
                  <span>{[r.city, r.state].filter(Boolean).join(', ') || 'location unknown'}</span>
                  <span className="text-stone-700">·</span>
                  <span className="text-stone-400 flex items-center gap-1">
                    <Globe className="w-3 h-3" />{r.website || <span className="text-stone-600 italic">no website on the listing</span>}
                  </span>
                </p>
                <p className="text-[11px] text-stone-600">
                  <span className="text-red-400">{LINK_STATUS_LABEL[r.website_status] || r.website_status || 'unchecked'}</span>
                  {r.website_checked_at ? ` · checked ${new Date(r.website_checked_at).toLocaleString()}` : ' · never checked'}
                  {r.website_final_url ? ` · landed on ${r.website_final_url}` : ''}
                </p>
              </div>
              {r.website && (
                <button onClick={() => clearWebsite(r)} disabled={busy === r.id}
                  className="text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-400 hover:border-red-800 hover:text-red-400 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                  title="Remove this website from the listing">
                  <Link2Off className="w-3.5 h-3.5" /> Clear this website
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Closed queue: listings we believe have shut for good.
 *
 * Three separate signals land a shop here and none of them is trusted on its
 * own — the source directory's operating_status, the closure sweep, and
 * visitors reporting it. Two different people reporting a shop closed hides an
 * unclaimed listing immediately; a claimed one never moves without a person.
 * "Confirm closed" settles it; "Still open" puts the shop back on the map.
 */

// GET /admin/closures answers either a bare array or { items, counts, unreviewed }.
const closureItems = (d) => (Array.isArray(d) ? d : (d?.items || []));

// Only a number the server actually sent. Counting the rows of a one-row probe
// would give the tab badge a badly wrong number.
function closureUnreviewedFromServer(d) {
  const n = d?.unreviewed ?? d?.total_unreviewed ?? d?.counts?.unreviewed;
  return Number.isFinite(Number(n)) ? Number(n) : null;
}

const closureReviewed = (r) => !!r.reviewed || Number(r.staff_edited) === 1;

function closureReason(r) {
  return r.closed_reason || r.storefront_reason || r.reason
    || (r.operating_status === 'permanently_closed' ? 'Source data reports it permanently closed' : 'Flagged closed');
}

function closureWhen(r) {
  const raw = r.closed_at || r.flagged_at || r.closure_checked_at || r.storefront_checked_at || null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ClosuresQueue({ onAction, onCount }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);     // whole-queue tallies, when the endpoint sends them
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');   // '' = every reason
  const [busy, setBusy] = useState(null);

  function load() {
    setLoading(true); setError('');
    api.adminGetClosures({ limit: 200 })
      .then(d => {
        const items = closureItems(d);
        const waiting = closureUnreviewedFromServer(d) ?? items.filter(r => !closureReviewed(r)).length;
        setRows(items);
        setMeta({
          total: Number(d?.counts?.total ?? d?.total) || null,
          unreviewed: waiting,
          still_visible: Number(d?.still_visible) || 0,
        });
        onCount?.(waiting);
      })
      .catch(e => {
        setRows([]);
        // An endpoint that is not mounted falls through to the SPA and answers
        // HTML, which surfaces as a JSON parse error. Say what actually happened.
        setError(/JSON|Unexpected token/i.test(e.message || '')
          ? 'GET /admin/closures did not answer with data. The closure queue endpoint may not be deployed yet.'
          : (e.message || 'Could not load the closure queue.'));
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function act(row, fn, msg) {
    setBusy(row.id);
    try {
      await fn();
      setRows(rows.filter(x => x.id !== row.id));
      // The tally spans the whole queue, which can be far longer than this
      // page, so count this decision down rather than recounting the page.
      const decided = !closureReviewed(row) && !row.claimed;
      const next = meta && {
        ...meta,
        total: meta.total ? Math.max(0, meta.total - 1) : meta.total,
        unreviewed: meta.unreviewed === null ? null : Math.max(0, meta.unreviewed - (decided ? 1 : 0)),
        still_visible: Math.max(0, meta.still_visible - (Number(row.visible) === 1 ? 1 : 0)),
      };
      setMeta(next);
      if (next && next.unreviewed !== null) onCount?.(next.unreviewed);
      onAction(msg);
    } catch (e) { onAction(e.message); } finally { setBusy(null); }
  }

  // Counts by reason, tallied from what is on screen so the chips can never
  // disagree with the rows underneath them.
  const byReason = {};
  for (const r of rows) { const k = closureReason(r); byReason[k] = (byReason[k] || 0) + 1; }
  const reasons = Object.entries(byReason).sort((a, b) => b[1] - a[1]);
  const shown = reason ? rows.filter(r => closureReason(r) === reason) : rows;

  return (
    <div>
      <p className="text-xs text-stone-500 max-w-2xl mb-2">
        Shops the directory, the closure sweep, or visitors say have shut down. Source data lags reality by months, so
        nothing here is certain — check the phone number and the website before you settle one.
        <strong className="text-stone-400"> Confirm closed</strong> keeps it off the map for good;
        <strong className="text-stone-400"> Still open</strong> puts it back and stops anything re-flagging it.
      </p>
      {meta && (meta.total || meta.unreviewed !== null) && (
        <p className="text-xs text-stone-600 mb-4">
          {meta.total ? `${rows.length.toLocaleString()} of ${meta.total.toLocaleString()} flagged listings` : `${rows.length.toLocaleString()} flagged listings`}
          {meta.unreviewed !== null && ` · ${meta.unreviewed.toLocaleString()} still waiting on a decision`}
          {meta.still_visible > 0 && ` · ${meta.still_visible.toLocaleString()} still on the public map`}
        </p>
      )}

      {/* Counts by reason — each one doubles as the filter */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <button onClick={() => setReason('')}
          className={`text-xs px-3 py-1.5 rounded-full transition-all ${reason === '' ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}>
          All <span className="opacity-70">({rows.length})</span>
        </button>
        {reasons.map(([k, n]) => (
          <button key={k} onClick={() => setReason(k)} title={k}
            className={`text-xs px-3 py-1.5 rounded-full transition-all max-w-[280px] truncate ${reason === k ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}>
            {k} <span className="opacity-70">({n})</span>
          </button>
        ))}
        <button onClick={load} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-300 hover:text-amber-400 flex items-center gap-1.5 disabled:opacity-50 ml-auto">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Reload
        </button>
      </div>

      {error && (
        <div className="card p-4 mb-4 border-red-900/40 bg-red-900/10">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loading ? <div className="card h-24 skeleton" /> : shown.length === 0 ? (
        <p className="text-stone-500 text-sm text-center py-10">
          {error ? 'Nothing to show.' : reason ? `Nothing left under "${reason}".` : 'No listings are flagged as closed.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map(r => {
            const when = closureWhen(r);
            const reports = Number(r.closed_reports ?? r.report_count ?? 0);
            return (
              <div key={r.id} className="card p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[240px]">
                  <p className="font-medium text-stone-200 text-sm flex items-center gap-2 flex-wrap">
                    {r.name}
                    <a href={`/stores/${r.id}`} target="_blank" rel="noreferrer" className="text-stone-500 hover:text-amber-400" title="Open the listing">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    {r.claimed ? <span className="text-[10px] text-amber-400">claimed — owner managed</span> : null}
                    {Number(r.visible) === 1 && <span className="text-[10px] text-emerald-500">still on the map</span>}
                    {reports > 0 && <span className="text-[10px] bg-red-900/40 text-red-400 px-1.5 py-0.5 rounded-full">{reports} report{reports > 1 ? 's' : ''}</span>}
                    {closureReviewed(r) && <span className="text-[10px] text-stone-500">reviewed</span>}
                  </p>
                  <p className="text-xs text-stone-500">{[r.city, r.state].filter(Boolean).join(', ') || 'location unknown'}</p>
                  <p className="text-xs text-stone-500 flex items-center gap-3 flex-wrap mt-0.5">
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{r.phone || <span className="text-stone-600 italic">no phone</span>}</span>
                    <span className="flex items-center gap-1">
                      <Globe className="w-3 h-3" />{r.website || <span className="text-stone-600 italic">no website</span>}
                      {r.website && r.website_status && r.website_status !== 'ok' && (
                        <span className="text-stone-600">({LINK_STATUS_LABEL[r.website_status] || r.website_status})</span>
                      )}
                    </span>
                  </p>
                  <p className="text-[11px] text-stone-600">
                    <span className="text-red-400">{closureReason(r)}</span>
                    {when ? ` · flagged ${when.toLocaleString()}` : ''}
                  </p>
                </div>
                <button onClick={() => act(r, () => api.adminConfirmClosure(r.id), `${r.name} confirmed closed and kept off the map.`)}
                  disabled={busy === r.id}
                  className="text-xs px-3 py-1.5 rounded-lg border border-red-800 text-red-400 hover:bg-red-900/20 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap">
                  <DoorClosed className="w-3.5 h-3.5" /> Confirm closed
                </button>
                <button onClick={() => act(r, () => api.adminReopenStore(r.id), `${r.name} is back on the map.`)}
                  disabled={busy === r.id}
                  className="text-xs px-3 py-1.5 rounded-lg border border-emerald-700 text-emerald-400 hover:bg-emerald-900/20 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap">
                  <RotateCcw className="w-3.5 h-3.5" /> Still open
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('claims');
  const [stats, setStats] = useState(null);
  const [stores, setStores] = useState([]);
  const [users, setUsers] = useState([]);
  const [toast, setToast] = useState('');
  const [linkCounts, setLinkCounts] = useState(null);
  const [closureCount, setClosureCount] = useState(null);
  useEffect(() => {
    if (!authLoading && (!user || !['admin','staff'].includes(user.account_type))) {
      navigate('/');
    }
  }, [user, authLoading]);

  useEffect(() => {
    if (!user || !['admin','staff'].includes(user.account_type)) return;
    api.adminGetStats().then(setStats);
    // Just the tallies for the tab badge — ask for one row, and only trust a
    // counts block the endpoint actually returned.
    api.adminGetDeadLinks({ limit: 1 }).then(d => setLinkCounts(deadLinkCounts(d))).catch(() => {});
    // Same idea for the Closed badge, but only a tally the endpoint itself
    // reported — one row of items says nothing about how many are waiting.
    api.adminGetClosures({ limit: 1 })
      .then(d => { const n = closureUnreviewedFromServer(d); if (n !== null) setClosureCount(n); })
      .catch(() => {});
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
    { key: 'claims', label: 'Claims', badge: stats?.stats.pending_claims },
    { key: 'verifications', label: 'Verifications', badge: stats?.stats.pending_verifications },
    { key: 'listings', label: 'Listings' },
    { key: 'reports', label: 'Reports', badge: stats?.stats.open_reports },
    { key: 'links', label: 'Links', badge: brokenTotal(linkCounts) },
    { key: 'closed', label: 'Closed', badge: closureCount },
    { key: 'catalog', label: 'Catalog queue' },
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
          <StatCard label="Listings on map" value={stats.stats.total_listings ?? 0} icon={MapPin} color="text-amber-400" />
          <StatCard label="Unclaimed" value={stats.stats.unclaimed_listings ?? 0} icon={Store} color="text-stone-400" />
          <StatCard label="Pending claims" value={stats.stats.pending_claims ?? 0} icon={BadgeCheck} color={stats.stats.pending_claims > 0 ? 'text-orange-400' : 'text-stone-500'} />
          <StatCard label="Open reports" value={stats.stats.open_reports ?? 0} icon={Flag} color={stats.stats.open_reports > 0 ? 'text-red-400' : 'text-stone-500'} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-stone-800 mb-6 gap-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${tab === t.key ? 'text-amber-400 border-b-2 border-amber-400' : 'text-stone-500 hover:text-stone-300'}`}>
            {t.label}
            {t.badge > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'claims' && <ClaimsQueue onAction={showToast} />}
      {tab === 'listings' && <ListingsQueue onAction={showToast} />}
      {tab === 'reports' && <ReportsQueue onAction={showToast} />}
      {tab === 'links' && <LinksQueue onAction={showToast} onCounts={setLinkCounts} />}
      {tab === 'closed' && <ClosuresQueue onAction={showToast} onCount={setClosureCount} />}
      {tab === 'catalog' && <CatalogQueue onAction={showToast} />}
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
