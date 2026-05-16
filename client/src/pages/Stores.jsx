import { useState, useEffect, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Store, MapPin, Package, Search, CheckCircle, Star, Users, Filter, X, Clock, Navigation, Map, List } from 'lucide-react';
import { api } from '../services/api';
import { getStoreStatus } from '../utils/hours';

const StoreMap = lazy(() => import('../components/StoreMap'));

export default function Stores() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState([]);
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [city, setCity] = useState(searchParams.get('city') || '');
  const [openNow, setOpenNow] = useState(searchParams.get('open_now') === '1');
  const [hasLounge, setHasLounge] = useState(false);
  const [hasHumidor, setHasHumidor] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'map'
  const [userLocation, setUserLocation] = useState(null);

  useEffect(() => { api.getStoreCities().then(setCities); }, []);

  useEffect(() => {
    setLoading(true);
    const p = {};
    if (q) p.q = q;
    if (city) p.city = city;
    if (openNow) p.open_now = '1';
    if (hasLounge) p.has_lounge = '1';
    if (hasHumidor) p.has_walk_in_humidor = '1';
    api.searchStores(p).then(setStores).finally(() => setLoading(false));
  }, [q, city, openNow, hasLounge, hasHumidor]);

  function applySearch(e) {
    e.preventDefault();
    const p = {};
    if (q) p.q = q;
    if (city) p.city = city;
    if (openNow) p.open_now = '1';
    setSearchParams(p);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lng}&format=json`, {
            headers: { 'User-Agent': 'CigarBuddy/1.0' }
          });
          const data = await res.json();
          const detectedCity = data.address?.city || data.address?.town || data.address?.village || '';
          if (detectedCity) setCity(detectedCity);
        } catch {}
        setGeoLoading(false);
      },
      () => setGeoLoading(false),
      { timeout: 8000 }
    );
  }

  const hasFilters = q || city || openNow || hasLounge || hasHumidor;

  // Map view — full screen
  if (viewMode === 'map') {
    return (
      <div className="fixed inset-0 z-40" style={{ top: '56px', bottom: '64px' }}>
        <Suspense fallback={<div className="w-full h-full bg-stone-950 flex items-center justify-center"><div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" /></div>}>
          <StoreMap
            stores={stores}
            userLocation={userLocation}
            onClose={() => setViewMode('list')}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-serif text-2xl font-bold text-stone-100 mb-1">Cigar Retailers</h1>
          <p className="text-stone-500 text-sm">Find premium cigar shops with real-time inventory</p>
        </div>
        {/* Map / List toggle */}
        <div className="flex bg-stone-800 rounded-xl p-1 gap-1">
          <button onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'list' ? 'bg-stone-700 text-stone-100' : 'text-stone-500 hover:text-stone-300'}`}>
            <List className="w-4 h-4" /> List
          </button>
          <button onClick={() => { setViewMode('map'); if (!userLocation) useMyLocation(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'map' ? 'bg-amber-600 text-white' : 'text-stone-500 hover:text-stone-300'}`}>
            <Map className="w-4 h-4" /> Map
          </button>
        </div>
      </div>

      {/* Search + filter */}
      <form onSubmit={applySearch} className="flex gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store name..." className="input pl-10 py-2.5" />
        </div>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
          <input value={city} onChange={e => setCity(e.target.value)} placeholder="City" className="input pl-9 py-2.5 w-36" list="store-cities" />
          <datalist id="store-cities">{cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}</datalist>
        </div>
        <button type="button" onClick={useMyLocation} disabled={geoLoading}
          className="btn-secondary flex items-center gap-1.5 px-3 disabled:opacity-60" title="Use my location">
          {geoLoading
            ? <div className="w-4 h-4 border border-amber-500 border-t-transparent rounded-full animate-spin" />
            : <Navigation className="w-4 h-4" />}
          <span className="hidden sm:inline text-sm">Near Me</span>
        </button>
        <button type="submit" className="btn-primary px-5">Search</button>
        <button type="button" onClick={() => setShowFilters(!showFilters)} className={`btn-secondary flex items-center gap-1.5 ${hasFilters ? 'border-amber-600 text-amber-400' : ''}`}>
          <Filter className="w-4 h-4" />
        </button>
      </form>

      {showFilters && (
        <div className="card p-4 mb-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={openNow} onChange={e => setOpenNow(e.target.checked)} className="accent-amber-500" />
            <span className="text-sm text-stone-300">Open right now</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={hasLounge} onChange={e => setHasLounge(e.target.checked)} className="accent-amber-500" />
            <span className="text-sm text-stone-300">Has Lounge</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={hasHumidor} onChange={e => setHasHumidor(e.target.checked)} className="accent-amber-500" />
            <span className="text-sm text-stone-300">Walk-in Humidor</span>
          </label>
          {hasFilters && (
            <button onClick={() => { setQ(''); setCity(''); setOpenNow(false); setHasLounge(false); setHasHumidor(false); setSearchParams({}); }} className="text-xs text-stone-500 hover:text-amber-400 flex items-center gap-1">
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      )}

      {/* City quick-links */}
      {!q && !city && cities.length > 0 && (
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
          {cities.map(c => (
            <button key={`${c.city}-${c.state}`} onClick={() => setCity(c.city)}
              className="text-xs whitespace-nowrap px-3 py-1.5 rounded-full bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-amber-400 transition-colors flex-shrink-0">
              {c.city}, {c.state} <span className="text-stone-600 ml-1">({c.store_count})</span>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-stone-600 mb-4">
        {loading ? 'Loading...' : `${stores.length} store${stores.length !== 1 ? 's' : ''} found`}
      </p>

      {loading ? (
        <div className="flex flex-col gap-4">{[1,2,3].map(i => <div key={i} className="card h-32 animate-pulse bg-stone-800" />)}</div>
      ) : stores.length === 0 ? (
        <div className="text-center py-16">
          <Store className="w-10 h-10 text-stone-700 mx-auto mb-3" />
          <p className="text-stone-400">No stores found. Try different filters.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {stores.map(store => {
            let parsedHours = {};
            try { parsedHours = JSON.parse(store.hours || '{}'); } catch {}
            const status = getStoreStatus(parsedHours);
            return (
            <Link key={store.id} to={`/stores/${store.id}`} className="card p-5 hover:border-stone-600 transition-colors group">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                  <Store className="w-6 h-6 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h2 className="font-semibold text-stone-100 group-hover:text-amber-300 transition-colors">{store.name}</h2>
                    {store.verified === 1 && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                    {status.label && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${status.isOpen ? 'bg-emerald-900/40 text-emerald-400' : 'bg-stone-800 text-stone-500'}`}>
                        {status.isOpen ? '● ' : ''}{status.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-stone-500 mb-2">
                    <MapPin className="w-3 h-3" />{store.city}, {store.state}
                  </div>
                  {store.description && <p className="text-sm text-stone-400 line-clamp-2 mb-2">{store.description}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                    <span className="flex items-center gap-1"><Package className="w-3 h-3" />{store.inventory_count} SKUs</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{store.follower_count} followers</span>
                    {store.avg_rating > 0 && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" />{store.avg_rating.toFixed(1)}</span>}
                    {store.today_hours && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{store.today_hours}</span>}
                  </div>
                  {store.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {store.tags.map(t => <span key={t} className="text-[10px] bg-stone-800 text-stone-500 px-2 py-0.5 rounded-full">{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
