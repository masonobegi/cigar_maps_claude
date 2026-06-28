import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Store, ArrowRight, MapPin, Star, CheckCircle, Package, ChevronRight, Phone } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRecentlyViewed } from '../hooks/useRecentlyViewed';
import CigarCard from '../components/CigarCard';

const MARQUEE_ITEMS = [
  'Toro', 'Robusto', 'Churchill', 'Corona', 'Belicoso',
  'Maduro', 'Connecticut', 'Habano', 'Perfecto', 'Torpedo',
  'Lancero', 'Lonsdale', 'Figurado', 'Double Corona', 'Gordo',
];

function OpenBadge({ isOpen }) {
  if (isOpen === null) return null;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${isOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {isOpen ? '● Open' : '● Closed'}
    </span>
  );
}

function StoreRow({ store }) {
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent([store.name, store.city, store.state].filter(Boolean).join(', '))}`;
  return (
    <Link to={`/stores/${store.id}`}
      className="flex items-center gap-4 py-4 px-1 border-b group transition-colors hover:bg-amber-900/5"
      style={{borderColor: '#c0b09e'}}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{backgroundColor: '#e8dfd2'}}>
        <Store className="w-4 h-4" style={{color: '#c17a2a'}} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm" style={{color: '#1a2744'}}>{store.name}</span>
          {store.verified === 1 && <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
          <OpenBadge isOpen={store.is_open} />
        </div>
        <p className="text-xs mt-0.5" style={{color: '#9a8e82'}}>{store.city}, {store.state} · {store.inventory_count} cigars{store.avg_rating > 0 ? ` · ★ ${store.avg_rating.toFixed(1)}` : ''}</p>
      </div>
      <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-30 group-hover:opacity-60 transition-opacity" style={{color: '#1a2744'}} />
    </Link>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { items: recentlyViewed } = useRecentlyViewed();
  const [topCigars, setTopCigars] = useState([]);
  const [stores, setStores] = useState([]);
  const [deals, setDeals] = useState([]);
  const [cities, setCities] = useState([]);
  const [searchVal, setSearchVal] = useState('');
  const [cityInput, setCityInput] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.searchCigars({ limit: 8, sort: 'popular' }).then(d => setTopCigars(d.cigars));
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

  const allItems = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];

  return (
    <div>

      {/* ── Editorial Hero ── */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-14 sm:pt-24 sm:pb-20">
        <div className="flex items-center gap-3 mb-7">
          <div className="h-px w-10 flex-shrink-0" style={{backgroundColor: '#c17a2a'}} />
          <p className="text-xs font-bold tracking-[0.22em] uppercase" style={{color: '#c17a2a'}}>
            {cities.length > 0
              ? cities.slice(0, 3).map(c => c.city).join(' · ')
              : 'Portland · Vancouver · Lake Oswego'}
          </p>
        </div>

        <div className="sm:flex sm:items-start sm:gap-20">
          <div className="flex-1 max-w-2xl">
            <h1 className="font-serif font-bold leading-[1.05] mb-6" style={{fontSize: 'clamp(2.6rem, 6vw, 4.5rem)', color: '#1a2744'}}>
              Discover your<br />
              next{' '}
              <em style={{fontStyle: 'italic', color: '#c17a2a'}}>perfect</em>
              {' '}smoke.
            </h1>
            <p className="text-lg leading-relaxed mb-8 max-w-lg" style={{color: '#6a5e52'}}>
              Search premium cigars, find local retailers with live inventory, and track your personal collection — all in one place.
            </p>

            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 max-w-lg mb-5">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{color: '#9a8e82'}} />
                <input
                  value={searchVal}
                  onChange={e => setSearchVal(e.target.value)}
                  placeholder="Cigar name, brand, wrapper..."
                  className="input pl-11"
                />
              </div>
              <div className="relative sm:w-36">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{color: '#9a8e82'}} />
                <input
                  value={cityInput}
                  onChange={e => setCityInput(e.target.value)}
                  placeholder="City"
                  list="home-cities"
                  className="input pl-10"
                />
                <datalist id="home-cities">{cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}</datalist>
              </div>
              <button type="submit" className="btn-primary">Search</button>
            </form>

            <div className="flex gap-2 flex-wrap">
              {['mild', 'medium', 'full'].map(s => (
                <button key={s} onClick={() => navigate(`/search?strength=${s}`)}
                  className="text-xs px-4 py-2 rounded-full border capitalize transition-all"
                  style={{borderColor: '#c0b09e', color: '#6a5e52'}}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#c17a2a'; e.currentTarget.style.color = '#c17a2a'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#c0b09e'; e.currentTarget.style.color = '#6a5e52'; }}>
                  {s}
                </button>
              ))}
              <button onClick={() => navigate('/search?in_stock_only=1')}
                className="text-xs px-4 py-2 rounded-full border transition-all"
                style={{borderColor: '#b0c8b0', color: '#4a7a4a'}}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#4a7a4a'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#b0c8b0'; }}>
                In Stock
              </button>
            </div>
          </div>

          {/* Right — decorative stat column, visible on larger screens */}
          <div className="hidden lg:flex flex-col gap-6 pt-2 min-w-[160px]">
            {[
              { n: stores.length || '5+', label: 'Local Retailers' },
              { n: topCigars.length || '25+', label: 'Premium Cigars' },
              { n: cities.length || '3', label: 'Cities' },
            ].map(({ n, label }) => (
              <div key={label}>
                <p className="font-serif text-5xl font-bold leading-none" style={{color: '#1a2744'}}>{n}</p>
                <p className="text-xs mt-1 font-medium tracking-wide uppercase" style={{color: '#9a8e82'}}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Marquee ── */}
      <div className="overflow-hidden py-3.5 border-y" style={{backgroundColor: '#1a2744', borderColor: '#243459'}}>
        <div className="animate-marquee">
          {allItems.map((item, i) => (
            <span key={i} className="flex items-center gap-5 px-5 text-sm font-medium tracking-wide whitespace-nowrap" style={{color: 'rgba(255,255,255,0.6)'}}>
              {item}
              <span style={{color: '#c17a2a', fontSize: 8}}>◆</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Top Rated Cigars ── */}
      {topCigars.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-14">
          <div className="flex items-baseline justify-between mb-8">
            <div>
              <p className="text-xs font-bold tracking-[0.18em] uppercase mb-1" style={{color: '#c17a2a'}}>Collection</p>
              <h2 className="font-serif text-3xl font-bold" style={{color: '#1a2744'}}>Top Rated</h2>
            </div>
            <Link to="/search?sort=rating" className="text-sm font-medium transition-colors flex items-center gap-1"
              style={{color: '#9a8e82'}}
              onMouseEnter={e => e.currentTarget.style.color = '#1a2744'}
              onMouseLeave={e => e.currentTarget.style.color = '#9a8e82'}>
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {topCigars.map(c => <CigarCard key={c.id} cigar={c} />)}
          </div>
        </section>
      )}

      {/* ── Stores ── */}
      {stores.length > 0 && (
        <section className="py-14" style={{backgroundColor: '#ccc3b4'}}>
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex items-baseline justify-between mb-8">
              <div>
                <p className="text-xs font-bold tracking-[0.18em] uppercase mb-1" style={{color: '#c17a2a'}}>Where to shop</p>
                <h2 className="font-serif text-3xl font-bold" style={{color: '#1a2744'}}>Local Retailers</h2>
              </div>
              <Link to="/stores" className="text-sm font-medium transition-colors flex items-center gap-1"
                style={{color: '#9a8e82'}}
                onMouseEnter={e => e.currentTarget.style.color = '#1a2744'}
                onMouseLeave={e => e.currentTarget.style.color = '#9a8e82'}>
                All stores <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12">
              {stores.slice(0, 6).map(s => <StoreRow key={s.id} store={s} />)}
            </div>
          </div>
        </section>
      )}

      {/* ── Deals ── */}
      {deals.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-14">
          <div className="flex items-baseline justify-between mb-8">
            <div>
              <p className="text-xs font-bold tracking-[0.18em] uppercase mb-1" style={{color: '#c17a2a'}}>Limited time</p>
              <h2 className="font-serif text-3xl font-bold" style={{color: '#1a2744'}}>Deals &amp; Events</h2>
            </div>
            <Link to="/deals" className="text-sm font-medium flex items-center gap-1" style={{color: '#9a8e82'}}
              onMouseEnter={e => e.currentTarget.style.color = '#1a2744'}
              onMouseLeave={e => e.currentTarget.style.color = '#9a8e82'}>
              All deals <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {deals.slice(0, 3).map(d => (
              <Link key={d.id} to={`/stores/${d.store_id}`}
                className="rounded-2xl p-5 border transition-all hover:shadow-sm"
                style={{backgroundColor: '#f5f0e8', borderColor: '#c8baa8'}}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-semibold text-sm leading-tight" style={{color: '#1a2744'}}>{d.title}</p>
                  {d.discount_percent && (
                    <span className="bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                      -{d.discount_percent}%
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed mb-3 line-clamp-2" style={{color: '#7a6e62'}}>{d.description}</p>
                <p className="text-xs flex items-center gap-1.5" style={{color: '#9a8e82'}}>
                  <Store className="w-3 h-3" style={{color: '#c17a2a'}} />{d.store_name}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Store owner CTA ── */}
      <section style={{backgroundColor: '#1a2744'}}>
        <div className="max-w-6xl mx-auto px-6 py-16 sm:flex sm:items-center sm:justify-between gap-10">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3" style={{color: 'rgba(193,122,42,0.8)'}}>For retailers</p>
            <h2 className="font-serif text-3xl font-bold text-white mb-3">Own a cigar shop?</h2>
            <p className="max-w-md leading-relaxed" style={{color: 'rgba(255,255,255,0.55)'}}>
              List your inventory, post deals, and let customers find you. Free to get started.
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
