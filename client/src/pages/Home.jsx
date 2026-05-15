import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, TrendingUp, Tag, Store, Flame, ArrowRight, MapPin, Clock, Star, CheckCircle, Package, History, Bell, ChevronRight, Phone } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRecentlyViewed } from '../hooks/useRecentlyViewed';
import CigarCard from '../components/CigarCard';

const STRENGTH_COLORS = {
  mild: 'border-green-700 text-green-400', 'mild-medium': 'border-lime-700 text-lime-400',
  medium: 'border-amber-700 text-amber-400', 'medium-full': 'border-orange-700 text-orange-400',
  full: 'border-red-700 text-red-400',
};

function OpenIndicator({ isOpen, todayHours }) {
  if (isOpen === null) return null;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${isOpen ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/30 text-red-500'}`}>
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
      <Link to={`/stores/${store.id}`} className="flex items-start gap-3 p-4 hover:bg-stone-800/30 transition-colors">
        <div className="w-10 h-10 rounded-xl bg-amber-900/30 flex items-center justify-center flex-shrink-0">
          <Store className="w-5 h-5 text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-stone-200 text-sm truncate">{store.name}</p>
            {store.verified === 1 && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
            <OpenIndicator isOpen={store.is_open} />
          </div>
          <p className="text-xs text-stone-500 mt-0.5">{store.city}, {store.state}</p>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-600">
            <span className="flex items-center gap-1"><Package className="w-3 h-3" />{store.inventory_count}</span>
            {store.avg_rating > 0 && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" />{store.avg_rating.toFixed(1)}</span>}
            {store.today_hours && <span>{store.today_hours}</span>}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-stone-700 flex-shrink-0 mt-1" />
      </Link>
      {/* Quick action bar */}
      <div className="flex border-t border-stone-800/60">
        {store.phone && (
          <a href={`tel:${store.phone}`} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-stone-500 hover:text-amber-400 hover:bg-stone-800/40 transition-colors">
            <Phone className="w-3.5 h-3.5" /> Call
          </a>
        )}
        <a href={mapsUrl} target="_blank" rel="noopener" className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-stone-500 hover:text-amber-400 hover:bg-stone-800/40 transition-colors border-l border-stone-800/60">
          <MapPin className="w-3.5 h-3.5" /> Directions
        </a>
        <Link to={`/stores/${store.id}`} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-stone-500 hover:text-amber-400 hover:bg-stone-800/40 transition-colors border-l border-stone-800/60">
          <Package className="w-3.5 h-3.5" /> Menu
        </Link>
      </div>
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
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-950/40 via-stone-950 to-stone-950" />
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#d97706 0,#d97706 1px,transparent 0,transparent 50%)', backgroundSize: '14px 14px' }} />
        <div className="relative max-w-4xl mx-auto px-4 pt-10 pb-12 text-center">
          <h1 className="font-serif text-3xl sm:text-5xl font-bold text-stone-50 mb-2 leading-tight">
            Find Your <span className="text-amber-400">Perfect Smoke</span>
          </h1>
          <p className="text-stone-400 text-base sm:text-lg mb-7 max-w-lg mx-auto">
            Search premium cigars, find retailers with live inventory, track your collection.
          </p>

          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 max-w-2xl mx-auto mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-500" />
              <input value={searchVal} onChange={e => setSearchVal(e.target.value)} placeholder="Cigar name, brand, flavor..." className="input pl-12 py-3.5 text-base rounded-xl" />
            </div>
            <div className="relative sm:w-44">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
              <input value={cityInput} onChange={e => setCityInput(e.target.value)} placeholder="City" className="input pl-10 py-3.5 text-base rounded-xl" list="home-cities" />
              <datalist id="home-cities">{cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}</datalist>
            </div>
            <button type="submit" className="btn-primary rounded-xl px-7 text-base">Search</button>
          </form>

          {/* Strength quick filters */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className="text-xs text-stone-600">Quick:</span>
            {['mild', 'medium', 'full'].map(s => (
              <button key={s} onClick={() => navigate(`/search?strength=${s}`)} className={`text-xs px-3 py-1.5 rounded-full border capitalize transition-all ${STRENGTH_COLORS[s]} hover:bg-stone-800/50`}>{s}</button>
            ))}
            <button onClick={() => navigate('/search?in_stock_only=1')} className="text-xs px-3 py-1.5 rounded-full border border-emerald-700 text-emerald-400 hover:bg-emerald-900/20 transition-all">In Stock</button>
          </div>
        </div>
      </section>

      {/* City quick links bar */}
      {cities.length > 0 && (
        <div className="border-y border-stone-800 bg-stone-900/40 overflow-x-auto">
          <div className="flex items-center gap-4 px-4 py-2.5 min-w-max">
            <span className="text-xs text-stone-600 flex-shrink-0">Shops in:</span>
            {cities.slice(0, 10).map(c => (
              <Link key={`${c.city}-${c.state}`} to={`/stores?city=${encodeURIComponent(c.city)}`} className="text-xs text-stone-400 hover:text-amber-400 transition-colors whitespace-nowrap">
                {c.city} <span className="text-stone-700">({c.store_count})</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col gap-10">

        {/* Personalized "Near You" section */}
        {userCity && nearbyStores.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-amber-500" />
                <h2 className="font-serif text-xl font-bold text-stone-100">Stores in {userCity}</h2>
              </div>
              <Link to={`/stores?city=${encodeURIComponent(userCity)}`} className="text-sm text-amber-500 hover:text-amber-400 flex items-center gap-1">
                All <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {nearbyStores.slice(0, 3).map(s => <StoreCard key={s.id} store={s} />)}
            </div>

            {nearbyCigars.length > 0 && (
              <div className="mt-5">
                <p className="text-sm text-stone-500 mb-3">Available in {userCity}:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {nearbyCigars.slice(0, 4).map(c => <CigarCard key={c.id} cigar={c} />)}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Open Now — always shown, but after personalized if present */}
        {!userCity && openNowStores.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                <h2 className="font-serif text-xl font-bold text-stone-100">Open Right Now</h2>
              </div>
              <Link to="/stores?open_now=1" className="text-sm text-amber-500 hover:text-amber-400 flex items-center gap-1">All <ArrowRight className="w-4 h-4" /></Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {openNowStores.map(s => <StoreCard key={s.id} store={s} />)}
            </div>
          </section>
        )}

        {/* Recently Viewed */}
        {recentlyViewed.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <History className="w-5 h-5 text-stone-500" />
              <h2 className="font-serif text-xl font-bold text-stone-100">Recently Viewed</h2>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
              {recentlyViewed.map(c => (
                <Link key={c.id} to={`/cigars/${c.id}`}
                  className="flex-shrink-0 card p-3 w-36 hover:border-stone-600 transition-colors group">
                  <p className="text-[10px] text-amber-500/80 font-medium uppercase tracking-wider truncate">{c.brand}</p>
                  <p className="text-xs font-semibold text-stone-200 group-hover:text-amber-300 transition-colors leading-tight mt-0.5 line-clamp-2">{c.name}</p>
                  {c.strength && (
                    <span className={`text-[9px] font-medium mt-1.5 inline-block capitalize ${STRENGTH_COLORS[c.strength] || ''}`}>
                      {c.strength}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Top Rated */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-amber-500" />
              <h2 className="font-serif text-xl font-bold text-stone-100">Top Rated</h2>
            </div>
            <Link to="/search?sort=rating" className="text-sm text-amber-500 hover:text-amber-400 flex items-center gap-1">View all <ArrowRight className="w-4 h-4" /></Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {topCigars.map(c => <CigarCard key={c.id} cigar={c} />)}
          </div>
        </section>

        {/* Deals */}
        {deals.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-500" />
                <h2 className="font-serif text-xl font-bold text-stone-100">Deals & Events</h2>
              </div>
              <Link to="/deals" className="text-sm text-amber-500 hover:text-amber-400 flex items-center gap-1">All <ArrowRight className="w-4 h-4" /></Link>
            </div>
            <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {deals.slice(0, 3).map(d => (
                <Link key={d.id} to={`/stores/${d.store_id}`} className="card p-4 border-amber-900/20 hover:border-amber-700/40 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-semibold text-stone-100 text-sm leading-tight">{d.title}</p>
                    {d.discount_percent && <span className="bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">-{d.discount_percent}%</span>}
                  </div>
                  <p className="text-xs text-stone-400 line-clamp-2 mb-2">{d.description}</p>
                  <p className="text-xs text-stone-600 flex items-center gap-1"><Store className="w-3 h-3" />{d.store_name}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* All stores */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Store className="w-5 h-5 text-amber-500" />
              <h2 className="font-serif text-xl font-bold text-stone-100">All Retailers</h2>
            </div>
            <Link to="/stores" className="text-sm text-amber-500 hover:text-amber-400 flex items-center gap-1">All stores <ArrowRight className="w-4 h-4" /></Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stores.slice(0, 6).map(s => <StoreCard key={s.id} store={s} />)}
          </div>
        </section>

        {/* Store CTA */}
        <section className="card p-6 sm:p-8 bg-gradient-to-br from-amber-950/30 to-stone-900 border-amber-900/30 text-center">
          <Store className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <h2 className="font-serif text-xl sm:text-2xl font-bold text-stone-100 mb-2">Own a Cigar Shop?</h2>
          <p className="text-stone-400 mb-5 max-w-md mx-auto text-sm">
            List your full inventory, post deals, and broadcast to your followers. Free to get started.
          </p>
          <Link to="/register" className="btn-primary inline-flex items-center gap-2">
            Create Store Account <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
