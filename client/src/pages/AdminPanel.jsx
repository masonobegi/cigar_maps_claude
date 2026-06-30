import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, X, Users, Store, Star, Package, Flame, AlertCircle, Eye, ChevronDown, ChevronUp, Shield } from 'lucide-react';
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
