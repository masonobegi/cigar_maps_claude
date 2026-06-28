import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Store, ArrowRight, MapPin, Star, CheckCircle, Package, ChevronRight, Phone } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRecentlyViewed } from '../hooks/useRecentlyViewed';
import CigarCard from '../components/CigarCard';

const STRENGTH_COLORS = {
  mild: 'border-green-600/60 text-green-700', 'mild-medium': 'border-lime-600/60 text-lime-700',
  medium: 'border-amber-600/60 text-amber-700', 'medium-full': 'border-orange-600/60 text-orange-700',
  full: 'border-red-600/60 text-red-700',
};

function OpenBadge({ isOpen }) {
  if (isOpen === null) return null;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${isOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {isOpen ? '● Open' : '● Closed'}
    </span>
  );
}

function StoreCard({ store }) {
  const mapsUrl = store.address
    ? `https://maps.google.com/?q=${encodeURIComponent([store.address, store.city, store.state].filter(Boolean).join(', '))}`
    : `https://maps.google.com/?q=${encodeURIComponent([store.name, store.city, store.state].filter(Boolean).join(', '))}`;

  return (
    <div className="card overflow-hidden">
      <Link to={`/stores/${store.id}`} className="flex items-start gap-3 p-4 hover:bg-amber-50/60 transition-colors">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Store className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-stone-200 text-sm truncate">{store.name}</p>
            {store.verified === 1 && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
            <OpenBadge isOpen={store.is_open} />
          </div>
          <p className="text-xs text-stone-500 mt-0.5">{store.city}, {store.state}</p>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-500">
            <span className="flex items-center gap-1"><Package className="w-3 h-3" />{store.inventory_count} cigars</span>
            {store.avg_rating > 0 && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" />{store.avg_rating.toFixed(1)}</span>}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-stone-400 flex-shrink-0 mt-1" />
      </Link>
      <div className="flex border-t border-stone-800">
        {store.phone && (
          <a href={`tel:${store.phone}`} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-stone-500 hover:text-amber-600 hover:bg-amber-50 transition-colors">
            <Phone className="w-3.5 h-3.5" /> Call
          </a>
        )}
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-stone-500 hover:text-amber-600 hover:bg-amber-50 transition-colors border-l border-stone-800">
          <MapPin className="w-3.5 h-3.5" /> Directions
        </a>
        <Link to={`/stores/${store.id}`} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-stone-500 hover:text-amber-600 hover:bg-amber-50 transition-colors border-l border-stone-800">
          <Package className="w-3.5 h-3.5" /> Menu
        </Link>
      </div>
    </div>
  );
}

function SectionHeader({ children, action }) {
  return (
    <div className="flex items-end justify-between mb-5">
      <h2 className="font-serif text-xl font-bold text-stone-100 border-l-4 border-amber-500 pl-3 leading-tight">{children}</h2>
      {action && <div className="text-sm text-amber-600 hover:text-amber-700">{action}</div>}
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { items: recentlyViewed } = useRecentlyViewed();
  const [topCigars, setTopCigars] = useState([]);
  const [stores, setStores] = useState([]);
  const [nearbyStores, setNearbyStores] = useState([]);
  const [nearbyCigars, setNearbyCigars] = useState([]);
  const [deals, setDeals] = useState([]);
  const [cities, setCities] = useState([]);
  const [searchVal, setSearchVal] = useState('');
  const [cityInput, setCityInput] = useState('');
  const navigate = useNavigate();

  const userCity = user?.location_city;

  useEffect(() => {
    api.searchCigars({ limit: 8, sort: 'popular' }).then(d => setTopCigars(d.cigars));
    api.searchStores().then(setStores);
    api.getDeals().then(setDeals);
    api.getStoreCities().then(setCities);
    if (userCity) {
      api.searchStores({ city: userCity }).then(setNearbyStores);
      api.searchCigars({ city: userCity, limit: 8, in_stock_only: '1', sort: 'popular' }).then(d => setNearbyCigars(d.cigars));
    }
  }, [userCity]);

  function handleSearch(e) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchVal.trim()) params.set('q', searchVal.trim());
    if (cityInput.trim()) params.set('city', cityInput.trim());
    if (!searchVal.trim() && cityInput.trim()) {
      navigate(`/stores?city=${encodeURIComponent(cityInput.trim())}`);
    } else {
      navigate(`/search?${params}`);
    }
  }

  const openNowStores = stores.filter(s => s.is_open === true).slice(0, 3);

  return (
    <div>
      {/* Hero — navy background flows naturally from the navbar, no jarring cut */}
      <section className="relative overflow-hidden" style={{background: 'linear-gradient(150deg, #1e3464 0%, #1a2744 55%, #16203c 100%)'}}>
        <div className="absolute inset-0 opacity-[0.03]" style={{backgroundImage: 'repeating-linear-gradient(45deg, #c2a060 0, #c2a060 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px'}} />
        {/* Fade hero into body so there's no hard edge */}
        <div className="absolute bottom-0 left-0 right-0 h-20" style={{background: 'linear-gradient(to bottom, transparent, #f0ece3)'}} />

        <div className="relative max-w-5xl mx-auto px-6 pt-12 pb-20">
          <div className="max-w-2xl">
            <p className="text-amber-400/70 text-xs font-semibold tracking-[0.2em] uppercase mb-4">Premium Cigar Discovery</p>
            <h1 className="font-serif text-4xl sm:text-5xl font-bold text-white mb-4 leading-[1.1]">
              Find Your<br className="hidden sm:block" /> <span className="text-amber-300">Perfect Smoke</span>
            </h1>
            <p className="text-blue-200/70 text-base sm:text-lg mb-8 max-w-md leading-relaxed">
              Search premium cigars, find retailers with live inventory, and track your personal collection.
            </p>

            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-300/50" />
                <input
                  value={searchVal}
                  onChange={e => setSearchVal(e.target.value)}
                  placeholder="Cigar name, brand, flavor..."
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder-blue-300/40 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:bg-white/15 transition-all"
                  style={{fontSize: 16}}
                />
              </div>
              <div className="relative sm:w-40">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-300/50" />
                <input
                  value={cityInput}
                  onChange={e => setCityInput(e.target.value)}
                  placeholder="City"
                  list="home-cities"
                  className="w-full pl-10 pr-4 py-3.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder-blue-300/40 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:bg-white/15 transition-all"
                  style={{fontSize: 16}}
                />
                <datalist id="home-cities">{cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}</datalist>
              </div>
              <button type="submit" className="btn-primary rounded-xl px-7">Search</button>
            </form>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-blue-300/40 text-xs">Quick:</span>
              {['mild', 'medium', 'full'].map(s => (
                <button key={s} onClick={() => navigate(`/search?strength=${s}`)}
                  className="text-xs px-3 py-1.5 rounded-full border border-white/20 text-blue-200/70 hover:border-amber-400/60 hover:text-amber-300 capitalize transition-all">
                  {s}
                </button>
              ))}
              <button onClick={() => navigate('/search?in_stock_only=1')}
                className="text-xs px-3 py-1.5 rounded-full border border-emerald-500/30 text-emerald-400/70 hover:border-emerald-400 hover:text-emerald-300 transition-all">
                In Stock
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* City strip */}
      {cities.length > 0 && (
        <div className="border-b border-stone-800 overflow-x-auto" style={{backgroundColor: '#ede8df'}}>
          <div className="flex items-center gap-5 px-6 py-2.5 min-w-max">
            <span className="text-xs text-stone-400 flex-shrink-0 font-medium">Shops near</span>
            {cities.slice(0, 10).map(c => (
              <Link key={`${c.city}-${c.state}`} to={`/stores?city=${encodeURIComponent(c.city)}`}
                className="text-xs text-stone-400 hover:text-amber-600 transition-colors whitespace-nowrap">
                {c.city}<span className="text-stone-300 ml-1">({c.store_count})</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-10 flex flex-col gap-12">

        {userCity && nearbyStores.length > 0 && (
          <section>
            <SectionHeader action={
              <Link to={`/stores?city=${encodeURIComponent(userCity)}`} className="flex items-center gap-1 font-medium hover:text-amber-700">
                All <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            }>
              Stores in {userCity}
            </SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {nearbyStores.slice(0, 3).map(s => <StoreCard key={s.id} store={s} />)}
            </div>
            {nearbyCigars.length > 0 && (
              <div className="mt-5">
                <p className="text-sm text-stone-400 mb-3">Available in {userCity}:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {nearbyCigars.slice(0, 4).map(c => <CigarCard key={c.id} cigar={c} />)}
                </div>
              </div>
            )}
          </section>
        )}

        {!userCity && openNowStores.length > 0 && (
          <section>
            <SectionHeader action={
              <Link to="/stores?open_now=1" className="flex items-center gap-1 font-medium hover:text-amber-700">
                All stores <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            }>
              <span className="inline-flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse inline-block" />
                Open Right Now
              </span>
            </SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {openNowStores.map(s => <StoreCard key={s.id} store={s} />)}
            </div>
          </section>
        )}

        {recentlyViewed.length > 0 && (
          <section>
            <SectionHeader>Recently Viewed</SectionHeader>
            <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-4 px-4">
              {recentlyViewed.map(c => (
                <Link key={c.id} to={`/cigars/${c.id}`}
                  className="flex-shrink-0 card p-3.5 w-36 hover:shadow-sm transition-all group">
                  <p className="text-[10px] text-amber-600/70 font-semibold uppercase tracking-wider truncate">{c.brand}</p>
                  <p className="text-xs font-semibold text-stone-200 group-hover:text-amber-700 transition-colors leading-tight mt-1 line-clamp-2">{c.name}</p>
                  {c.strength && (
                    <span className={`text-[9px] font-medium mt-2 inline-block capitalize border px-1.5 py-0.5 rounded-full ${STRENGTH_COLORS[c.strength] || 'text-stone-400 border-stone-300'}`}>
                      {c.strength}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionHeader action={
            <Link to="/search?sort=rating" className="flex items-center gap-1 font-medium hover:text-amber-700">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          }>
            Top Rated
          </SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {topCigars.map(c => <CigarCard key={c.id} cigar={c} />)}
          </div>
        </section>

        {deals.length > 0 && (
          <section>
            <SectionHeader action={
              <Link to="/deals" className="flex items-center gap-1 font-medium hover:text-amber-700">
                All deals <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            }>
              Deals &amp; Events
            </SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {deals.slice(0, 3).map(d => (
                <Link key={d.id} to={`/stores/${d.store_id}`}
                  className="card p-4 hover:shadow-sm hover:border-amber-300/60 transition-all">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-semibold text-stone-200 text-sm leading-tight">{d.title}</p>
                    {d.discount_percent && (
                      <span className="bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                        -{d.discount_percent}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-400 line-clamp-2 mb-3">{d.description}</p>
                  <p className="text-xs text-stone-300 flex items-center gap-1.5">
                    <Store className="w-3 h-3 text-amber-500" />{d.store_name}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionHeader action={
            <Link to="/stores" className="flex items-center gap-1 font-medium hover:text-amber-700">
              All stores <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          }>
            All Retailers
          </SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stores.slice(0, 6).map(s => <StoreCard key={s.id} store={s} />)}
          </div>
        </section>

        {/* Store owner CTA */}
        <section className="rounded-2xl overflow-hidden" style={{background: 'linear-gradient(135deg, #1a2744 0%, #1e3464 100%)'}}>
          <div className="px-8 py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center mx-auto mb-4">
              <Store className="w-6 h-6 text-amber-400" />
            </div>
            <h2 className="font-serif text-2xl font-bold text-white mb-2">Own a Cigar Shop?</h2>
            <p className="text-blue-200/70 mb-6 max-w-sm mx-auto text-sm leading-relaxed">
              List your full inventory, post deals, and broadcast to your followers. Free to get started.
            </p>
            <Link to="/register" className="btn-primary inline-flex items-center gap-2">
              Create Store Account <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

      </div>
    </div>
  );
}
