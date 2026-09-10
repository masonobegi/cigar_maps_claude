import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, Store, MapPin } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const NAVY = '#E8DDD0';
const LABEL = '#B0A090';
const MUTED = '#9E8E7E';
const AMBER = '#D4882A';
const BORDER = '#453C2E';

export default function Pricing() {
  const { user, store } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPlans().then(r => setPlans(r.plans || [])).finally(() => setLoading(false));
  }, []);

  async function choose(planId) {
    setError('');
    if (planId === 'free') return;
    if (!store) return;
    setBusy(planId);
    try {
      const { url } = await api.startCheckout(store.id, planId);
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const current = store?.plan || 'free';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="text-center mb-10">
        <h1 className="font-serif text-3xl font-bold mb-2" style={{ color: NAVY }}>Get found first</h1>
        <p className="text-sm max-w-xl mx-auto" style={{ color: MUTED }}>
          Every cigar shop in the country is already on CigarBuddy, free. Paid plans decide who comes up first
          when someone nearby is looking for a cigar tonight.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map(i => <div key={i} className="card h-80 skeleton" />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3 items-start">
          {plans.map(plan => {
            const isCurrent = current === plan.id;
            const highlight = plan.id === 'featured';
            return (
              <div key={plan.id} className="card p-6 flex flex-col h-full"
                style={highlight ? { borderColor: AMBER } : {}}>
                {highlight && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider mb-2 self-start px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#2D1E06', color: AMBER }}>Most shops pick this</span>
                )}
                <h2 className="font-serif text-xl font-bold mb-1" style={{ color: NAVY }}>{plan.name}</h2>
                <p className="text-xs mb-4" style={{ color: MUTED }}>{plan.tagline}</p>
                <div className="mb-5">
                  <span className="font-serif text-3xl font-bold" style={{ color: NAVY }}>
                    {plan.price === 0 ? 'Free' : `$${plan.price}`}
                  </span>
                  {plan.price > 0 && <span className="text-sm ml-1" style={{ color: MUTED }}>/ month</span>}
                </div>

                <ul className="flex flex-col gap-2 mb-6 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm" style={{ color: LABEL }}>
                      <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: highlight ? AMBER : '#4ADE80' }} />
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <span className="text-sm text-center py-2.5 rounded-xl" style={{ backgroundColor: '#2E2820', color: LABEL }}>
                    Your current plan
                  </span>
                ) : plan.id === 'free' ? (
                  <span className="text-sm text-center py-2.5" style={{ color: MUTED }}>Included with every listing</span>
                ) : !user ? (
                  <Link to="/register?type=store" className={highlight ? 'btn-primary text-center' : 'btn-secondary text-center'}>
                    Create a retailer account
                  </Link>
                ) : !store ? (
                  <Link to="/stores" className={highlight ? 'btn-primary text-center' : 'btn-secondary text-center'}>
                    Claim your shop first
                  </Link>
                ) : !plan.available ? (
                  <span className="text-xs text-center py-2.5" style={{ color: MUTED }}>Not open yet. We will email you.</span>
                ) : (
                  <button onClick={() => choose(plan.id)} disabled={busy === plan.id}
                    className={highlight ? 'btn-primary' : 'btn-secondary'}>
                    {busy === plan.id ? 'Opening checkout...' : `Choose ${plan.name}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-center mt-4" style={{ color: '#F87171' }}>{error}</p>}

      <div className="mt-10 rounded-xl p-5" style={{ backgroundColor: '#1A1410', border: `1px solid ${BORDER}` }}>
        <h3 className="font-semibold mb-2 flex items-center gap-2" style={{ color: NAVY }}>
          <MapPin className="w-4 h-4" style={{ color: AMBER }} /> Listings stay free, always
        </h3>
        <p className="text-sm" style={{ color: MUTED }}>
          We list every cigar shop we can find whether or not they pay us, because a directory that hides shops is
          a worse directory. Paying changes where you sit in the results, not whether a customer can find you.
        </p>
        <p className="text-sm mt-3" style={{ color: MUTED }}>
          Not listed yet, or your details are wrong?{' '}
          <Link to="/stores" style={{ color: AMBER }}>Find your shop and claim it</Link>. It takes about two minutes.
        </p>
      </div>

      <div className="mt-6 text-center">
        <Link to="/store-dashboard" className="text-sm" style={{ color: MUTED }}>
          <Store className="w-3.5 h-3.5 inline mr-1" /> Back to your store dashboard
        </Link>
      </div>
    </div>
  );
}
