import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Store, ArrowRight, MapPin, CheckCircle, ChevronRight } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import CigarCard from '../components/CigarCard';

const TEXT  = '#D4C5B0';
const BRASS = '#C9882A';
const MUTED = '#7A6858';
const DIM   = '#5A4A3A';

function OpenBadge({ isOpen }) {
  if (isOpen === null) return null;
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
      style={isOpen
        ? { backgroundColor: '#0B3320', color: '#4ADE80' }
        : { backgroundColor: '#2D1010', color: '#F87171' }}>
      {isOpen ? '● Open' : '● Closed'}
    </span>
  );
}

function StoreRow({ store }) {
  return (
    <Link to={`/stores/${store.id}`}
      className="flex items-center gap-4 py-3.5 group transition-colors rounded-md -mx-3 px-3"
      style={{ textDecoration: 'none' }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="font-medium text-sm" style={{ color: TEXT }}>{store.name}</span>
          {store.verified === 1 && <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
          <OpenBadge isOpen={store.is_open} />
        </div>
        <p className="text-xs" style={{ color: MUTED }}>
          {store.city}, {store.state}
          {store.inventory_count > 0 && ` · ${store.inventory_count} cigars`}
          {store.avg_rating > 0 && ` · ★ ${store.avg_rating.toFixed(1)}`}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 flex-shrink-0 transition-transform group-hover:translate-x-0.5"
        style={{ color: DIM }} />
    </Link>
  );
}

function SectionHeader({ eyebrow, title, action }) {
  return (
    <div className="flex items-end justify-between mb-8">
      <div>
        <p className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-2"
          style={{ color: BRASS }}>{eyebrow}</p>
        <h2 className="font-serif font-semibold leading-tight"
          style={{ fontSize: 'clamp(1.5rem, 3vw, 1.875rem)', color: TEXT }}>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function ViewAllLink({ to, label = 'View all' }) {
  return (
    <Link to={to}
      className="text-sm flex items-center gap-1.5 transition-colors"
      style={{ color: DIM, textDecoration: 'none' }}
      onMouseEnter={e => e.currentTarget.style.color = TEXT}
      onMouseLeave={e => e.currentTarget.style.color = DIM}>
      {label} <ArrowRight className="w-3.5 h-3.5" />
    </Link>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [topCigars, setTopCigars] = useState([]);
  const [cigarTotal, setCigarTotal] = useState(0);
  const [stores, setStores] = useState([]);
  const [deals, setDeals] = useState([]);
  const [cities, setCities] = useState([]);
  const [searchVal, setSearchVal] = useState('');
  const [cityInput, setCityInput] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.searchCigars({ limit: 8, sort: 'popular' }).then(d => { setTopCigars(d.cigars); setCigarTotal(d.total); });
    api.searchStores().then(setStores);
    api.getDeals().then(setDeals);
    api.getStoreCities().then(setCities);
  }, []);

  function handleSearch(e) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchVal.trim()) params.set('q', searchVal.trim());
    if (cityInput.trim()) params.set('city', cityInput.trim());
    navigate(`/search?${params}`);
  }

  return (
    <div>

      {/* ── Hero ── */}
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-12 sm:pt-20 sm:pb-16">
        {cities.length > 0 && (
          <div className="flex items-center gap-3 mb-7">
            <div className="h-px w-8 flex-shrink-0" style={{ backgroundColor: BRASS, opacity: 0.5 }} />
            <p className="text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: MUTED }}>
              {cities.slice(0, 4).map(c => c.city).join(' · ')}
            </p>
          </div>
        )}

        <div className="sm:flex sm:items-start sm:gap-14 lg:gap-20">
          <div className="flex-1 max-w-2xl">
            <h1 className="font-serif font-bold leading-[1.06] mb-5"
              style={{ fontSize: 'clamp(2.6rem, 5.5vw, 4.5rem)', color: TEXT, letterSpacing: '-0.01em' }}>
              Discover your<br />
              next{' '}
              <em style={{ fontStyle: 'italic', color: BRASS }}>perfect</em>
              {' '}smoke.
            </h1>
            <p className="text-base leading-relaxed mb-7 max-w-md" style={{ color: MUTED }}>
              Search premium cigars, find local retailers with live inventory, and keep track of your collection.
            </p>

            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 max-w-xl mb-5">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: DIM }} />
                <input value={searchVal} onChange={e => setSearchVal(e.target.value)}
                  placeholder="Cigar name, brand, wrapper..." className="input pl-10" />
              </div>
              <div className="relative sm:w-36">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: DIM }} />
                <input value={cityInput} onChange={e => setCityInput(e.target.value)}
                  placeholder="City" list="home-cities" className="input pl-10" />
                <datalist id="home-cities">
                  {cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}
                </datalist>
              </div>
              <button type="submit" className="btn-primary">Search</button>
            </form>

            <div className="flex gap-2 flex-wrap">
              {['mild', 'medium', 'full'].map(s => (
                <button key={s}
                  onClick={() => navigate(`/search?strength=${s}`)}
                  className="text-xs px-3.5 py-1.5 rounded-full border capitalize transition-colors"
                  style={{ borderColor: '#3D3428', color: MUTED }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = BRASS; e.currentTarget.style.color = BRASS; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#3D3428'; e.currentTarget.style.color = MUTED; }}>
                  {s}
                </button>
              ))}
              <button
                onClick={() => navigate('/search?in_stock_only=1')}
                className="text-xs px-3.5 py-1.5 rounded-full border transition-colors"
                style={{ borderColor: '#1E4A2E', color: '#4ADE80' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#4ADE80'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#1E4A2E'}>
                In Stock
              </button>
            </div>
          </div>

          {/* Stats column */}
          <div className="hidden lg:flex flex-col gap-7 pt-2 min-w-[120px]">
            {[
              { n: stores.length || '5', label: 'Retailers' },
              { n: cigarTotal || '—', label: 'Cigars' },
              { n: cities.length || '3', label: 'Cities' },
            ].map(({ n, label }) => (
              <div key={label} className="pl-5" style={{ borderLeft: '2px solid #5A4A3A' }}>
                <p className="font-serif font-bold leading-none" style={{ fontSize: '2.75rem', color: TEXT }}>{n}</p>
                <p className="text-[10px] mt-1.5 font-semibold tracking-widest uppercase" style={{ color: DIM }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Top Rated Cigars ── */}
      {topCigars.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-12" style={{ borderTop: '1px solid #3D3428' }}>
          <SectionHeader
            eyebrow="Collection"
            title="Top Rated"
            action={<ViewAllLink to="/search?sort=rating" />}
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
            {topCigars.map(c => <CigarCard key={c.id} cigar={c} />)}
          </div>
        </section>
      )}

      {/* ── Local Retailers ── */}
      {stores.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-12" style={{ borderTop: '1px solid #3D3428' }}>
          <SectionHeader
            eyebrow="Where to shop"
            title="Local Retailers"
            action={<ViewAllLink to="/stores" label="All stores" />}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10"
            style={{ borderTop: '1px solid #3D3428' }}>
            {stores.slice(0, 6).map((s, i) => (
              <div key={s.id}
                style={{
                  borderBottom: '1px solid #3D3428',
                  ...(i % 2 === 0 && i < stores.slice(0, 6).length - 1 ? { borderRight: 'none' } : {}),
                }}>
                <StoreRow store={s} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Deals ── */}
      {deals.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-12" style={{ borderTop: '1px solid #3D3428' }}>
          <SectionHeader
            eyebrow="Limited time"
            title="Current Deals"
            action={<ViewAllLink to="/deals" label="All deals" />}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {deals.slice(0, 3).map(d => (
              <Link key={d.id} to={`/stores/${d.store_id}`}
                className="card p-5 group"
                style={{ textDecoration: 'none', display: 'block' }}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-medium text-sm leading-snug" style={{ color: TEXT }}>{d.title}</p>
                  {d.discount_percent && (
                    <span className="flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(168,104,26,0.2)', color: '#D4A040' }}>
                      −{d.discount_percent}%
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed mb-3 line-clamp-2" style={{ color: MUTED }}>{d.description}</p>
                <p className="text-xs flex items-center gap-1.5" style={{ color: DIM }}>
                  <Store className="w-3 h-3" style={{ color: BRASS }} />{d.store_name}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Retailer CTA ── */}
      <section style={{ backgroundColor: '#120F0A', borderTop: '1px solid #3D3428' }}>
        <div className="max-w-6xl mx-auto px-6 py-14 sm:flex sm:items-center sm:justify-between gap-12">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-3"
              style={{ color: MUTED }}>For retailers</p>
            <h2 className="font-serif font-semibold mb-3"
              style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', color: TEXT }}>
              Own a cigar shop?
            </h2>
            <p className="max-w-md text-sm leading-relaxed" style={{ color: DIM }}>
              List your inventory, post deals, and let customers find you. Free to get started.
            </p>
          </div>
          <div className="mt-6 sm:mt-0 flex-shrink-0">
            <Link to="/register" className="btn-primary inline-flex items-center gap-2 whitespace-nowrap">
              Create store account <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
