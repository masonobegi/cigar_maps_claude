import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Store, ArrowRight, MapPin, Star, CheckCircle, Package, ChevronRight, Phone } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRecentlyViewed } from '../hooks/useRecentlyViewed';
import CigarCard from '../components/CigarCard';

const NAVY  = '#E8DDD0';
const AMBER = '#D4882A';
const MUTED = '#9E8E7E';

function OpenBadge({ isOpen }) {
  if (isOpen === null) return null;
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
      style={isOpen ? {backgroundColor: '#0B3320', color: '#4ADE80'} : {backgroundColor: '#2D1010', color: '#F87171'}}>
      {isOpen ? '● Open' : '● Closed'}
    </span>
  );
}

function StoreRow({ store }) {
  return (
    <Link to={`/stores/${store.id}`}
      className="flex items-center gap-4 py-4 group transition-colors -mx-2 px-2 rounded-xl"
      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#2E2820'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{backgroundColor: '#352A18', border: '1px solid #4D3010'}}>
        <Store className="w-4 h-4 text-amber-700" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm" style={{color: NAVY}}>{store.name}</span>
          {store.verified === 1 && <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
          <OpenBadge isOpen={store.is_open} />
        </div>
        <p className="text-xs mt-0.5" style={{color: MUTED}}>
          {store.city}, {store.state}
          {store.inventory_count > 0 && ` · ${store.inventory_count} cigars`}
          {store.avg_rating > 0 && ` · ★ ${store.avg_rating.toFixed(1)}`}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-25 group-hover:opacity-50 transition-opacity" style={{color: NAVY}} />
    </Link>
  );
}

function SectionLabel({ tag, title, action }) {
  return (
    <div className="flex items-end justify-between mb-7">
      <div>
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-1.5" style={{color: AMBER}}>{tag}</p>
        <h2 className="font-serif text-3xl font-bold" style={{color: NAVY}}>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { items: recentlyViewed } = useRecentlyViewed();
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
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-px w-10 flex-shrink-0 bg-amber-600" />
          <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{color: AMBER}}>
            {cities.length > 0
              ? cities.slice(0, 4).map(c => c.city).join(' · ')
              : 'Portland · Vancouver · Lake Oswego'}
          </p>
        </div>

        <div className="sm:flex sm:items-start sm:gap-16 lg:gap-24">
          <div className="flex-1 max-w-2xl">
            <h1 className="font-serif font-bold leading-[1.05] mb-5"
              style={{fontSize: 'clamp(2.8rem, 6vw, 4.75rem)', color: NAVY}}>
              Discover your<br />
              next{' '}
              <em style={{fontStyle: 'italic', color: '#92510A'}}>perfect</em>
              {' '}smoke.
            </h1>
            <p className="text-lg leading-relaxed mb-8 max-w-lg" style={{color: MUTED}}>
              Search premium cigars, find local retailers with live inventory, and keep track of your personal collection.
            </p>

            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 max-w-xl mb-5">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{color: '#4A5A6A'}} />
                <input value={searchVal} onChange={e => setSearchVal(e.target.value)}
                  placeholder="Cigar name, brand, wrapper..." className="input pl-11" />
              </div>
              <div className="relative sm:w-36">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{color: '#4A5A6A'}} />
                <input value={cityInput} onChange={e => setCityInput(e.target.value)}
                  placeholder="City" list="home-cities" className="input pl-10" />
                <datalist id="home-cities">{cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}</datalist>
              </div>
              <button type="submit" className="btn-primary">Search</button>
            </form>

            <div className="flex gap-2 flex-wrap">
              {['mild', 'medium', 'full'].map(s => (
                <button key={s} onClick={() => navigate(`/search?strength=${s}`)}
                  className="text-xs px-4 py-1.5 rounded-full border capitalize transition-colors"
                  style={{borderColor: '#453C2E', color: MUTED}}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = AMBER; e.currentTarget.style.color = AMBER; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#453C2E'; e.currentTarget.style.color = MUTED; }}>
                  {s}
                </button>
              ))}
              <button onClick={() => navigate('/search?in_stock_only=1')}
                className="text-xs px-4 py-1.5 rounded-full border transition-colors"
                style={{borderColor: '#1E4A2E', color: '#4ADE80'}}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#4ADE80'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#1E4A2E'}>
                In Stock
              </button>
            </div>
          </div>

          <div className="hidden lg:flex flex-col gap-8 pt-4 min-w-[140px]">
            {[
              { n: stores.length || '5', label: 'Local Retailers' },
              { n: cigarTotal || '—', label: 'Premium Cigars' },
              { n: cities.length || '3', label: 'Cities' },
            ].map(({ n, label }) => (
              <div key={label} className="border-l-2 pl-5" style={{borderColor: '#D4882A'}}>
                <p className="font-serif text-5xl font-bold leading-none" style={{color: NAVY}}>{n}</p>
                <p className="text-[11px] mt-1.5 font-semibold tracking-widest uppercase" style={{color: MUTED}}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Top Rated ── */}
      {topCigars.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-14">
          <SectionLabel
            tag="Collection"
            title="Top Rated"
            action={
              <Link to="/search?sort=rating" className="text-sm font-medium flex items-center gap-1 transition-colors"
                style={{color: MUTED}}
                onMouseEnter={e => e.currentTarget.style.color = NAVY}
                onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            }
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {topCigars.map(c => <CigarCard key={c.id} cigar={c} />)}
          </div>
        </section>
      )}

      {/* ── Local Retailers ── */}
      {stores.length > 0 && (
        <section style={{ borderTop: '1px solid #453C2E' }}>
          <div className="max-w-6xl mx-auto px-6 py-14">
            <SectionLabel
              tag="Where to shop"
              title="Local Retailers"
              action={
                <Link to="/stores" className="text-sm font-medium flex items-center gap-1 transition-colors"
                  style={{color: MUTED}}
                  onMouseEnter={e => e.currentTarget.style.color = NAVY}
                  onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                  All stores <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 divide-y divide-stone-200 sm:divide-y-0">
              {stores.slice(0, 6).map((s, i) => (
                <div key={s.id} className={i < stores.slice(0,6).length - 2 ? 'sm:border-b sm:border-stone-200' : ''}>
                  <StoreRow store={s} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Deals ── */}
      {deals.length > 0 && (
        <section style={{ borderTop: '1px solid #453C2E' }}>
          <div className="max-w-6xl mx-auto px-6 py-14">
            <SectionLabel
              tag="Limited time"
              title="Deals & Events"
              action={
                <Link to="/deals" className="text-sm font-medium flex items-center gap-1"
                  style={{color: MUTED}}
                  onMouseEnter={e => e.currentTarget.style.color = NAVY}
                  onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                  All deals <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {deals.slice(0, 3).map(d => (
                <Link key={d.id} to={`/stores/${d.store_id}`} className="card p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-semibold text-sm leading-tight" style={{color: NAVY}}>{d.title}</p>
                    {d.discount_percent && (
                      <span className="bg-amber-700 text-white text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                        -{d.discount_percent}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed mb-3 line-clamp-2" style={{color: MUTED}}>{d.description}</p>
                  <p className="text-xs flex items-center gap-1.5" style={{color: MUTED}}>
                    <Store className="w-3 h-3 text-amber-600" />{d.store_name}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Store CTA ── */}
      <section style={{backgroundColor: '#12213D'}}>
        <div className="max-w-6xl mx-auto px-6 py-16 sm:flex sm:items-center sm:justify-between gap-10">
          <div>
            <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-3" style={{color: 'rgba(146,81,10,0.9)'}}>For retailers</p>
            <h2 className="font-serif text-3xl font-bold text-white mb-3">Own a cigar shop?</h2>
            <p className="max-w-md leading-relaxed" style={{color: 'rgba(255,255,255,0.45)'}}>
              List your full inventory, post deals, and let customers find you — free to get started.
            </p>
          </div>
          <div className="mt-6 sm:mt-0 flex-shrink-0">
            <Link to="/register" className="btn-primary inline-flex items-center gap-2 whitespace-nowrap">
              Create Store Account <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
