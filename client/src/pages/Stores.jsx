import { useState, useEffect, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Store, MapPin, Package, Search, CheckCircle, Star, Users, Filter, X, Clock, Navigation, Map, List } from 'lucide-react';
import { api } from '../services/api';
import { getStoreStatus } from '../utils/hours';

const StoreMap = lazy(() => import('../components/StoreMap'));

const NAVY   = '#E8DDD0';
const MUTED  = '#9E8E7E';
const LABEL  = '#B0A090';
const BORDER = '#453C2E';
const AMBER  = '#D4882A';

const RADII = [10, 25, 50, 100];

function loadSavedLocation() {
  try { return JSON.parse(localStorage.getItem('cb_location_v1') || 'null'); } catch { return null; }
}

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
  const [viewMode, setViewMode] = useState('list');
  const [userLocation, setUserLocation] = useState(null);
  const [radius, setRadius] = useState(() => parseInt(localStorage.getItem('cb_radius') || '50'));
  const [showTempAddr, setShowTempAddr] = useState(false);
  const [tempAddr, setTempAddr] = useState('');
  const [tempGeoLoading, setTempGeoLoading] = useState(false);

  useEffect(() => { api.getStoreCities().then(setCities); }, []);

  useEffect(() => {
    const saved = loadSavedLocation();
    if (saved) setUserLocation(saved);
  }, []);

  useEffect(() => {
    setLoading(true);
    const p = {};
    if (q) p.q = q;
    if (city && !userLocation) p.city = city;
    if (openNow) p.open_now = '1';
    if (hasLounge) p.has_lounge = '1';
    if (hasHumidor) p.has_walk_in_humidor = '1';
    if (userLocation?.lat) { p.lat = userLocation.lat; p.lng = userLocation.lng; p.radius = radius; }
    api.searchStores(p).then(setStores).finally(() => setLoading(false));
  }, [q, city, openNow, hasLounge, hasHumidor, userLocation, radius]);

  function applySearch(e) {
    e.preventDefault();
    const p = {};
    if (q) p.q = q;
    if (city) p.city = city;
    if (openNow) p.open_now = '1';
    setSearchParams(p);
  }

  function saveLocation(loc) {
    setUserLocation(loc);
    localStorage.setItem('cb_location_v1', JSON.stringify(loc));
  }

  function clearLocation() {
    setUserLocation(null);
    localStorage.removeItem('cb_location_v1');
  }

  function changeRadius(r) {
    setRadius(r);
    localStorage.setItem('cb_radius', String(r));
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Current Location', isTemp: false };
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lng}&format=json`, {
            headers: { 'User-Agent': 'CigarBuddy/1.0' }
          });
          const data = await res.json();
          const label = data.address?.city || data.address?.town || data.address?.village || 'My Location';
          loc.label = label;
        } catch {}
        saveLocation(loc);
        setGeoLoading(false);
      },
      () => setGeoLoading(false),
      { timeout: 8000 }
    );
  }

  async function applyTempAddress() {
    if (!tempAddr.trim()) return;
    setTempGeoLoading(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(tempAddr)}&format=json&limit=1&countrycodes=us`, {
        headers: { 'User-Agent': 'CigarBuddy/1.0' }
      });
      const data = await res.json();
      if (data[0]) {
        saveLocation({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: tempAddr, isTemp: true });
        setShowTempAddr(false);
        setTempAddr('');
      }
    } catch {}
    setTempGeoLoading(false);
  }

  const hasFilters = q || city || openNow || hasLounge || hasHumidor;

  if (viewMode === 'map') {
    return (
      <div className="fixed inset-0 z-40" style={{ top: '56px', bottom: '64px' }}>
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" /></div>}>
          <StoreMap stores={stores} userLocation={userLocation} onClose={() => setViewMode('list')} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-serif text-2xl font-bold mb-1" style={{ color: NAVY }}>Cigar Retailers</h1>
          <p className="text-sm" style={{ color: MUTED }}>Find premium cigar shops with real-time inventory</p>
        </div>

        {/* Map / List toggle */}
        <div className="flex rounded-xl p-1 gap-1" style={{ backgroundColor: '#201C16' }}>
          <button onClick={() => setViewMode('list')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={viewMode === 'list'
              ? { backgroundColor: '#262018', color: NAVY, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }
              : { color: MUTED }}>
            <List className="w-4 h-4" /> List
          </button>
          <button onClick={() => { setViewMode('map'); if (!userLocation) useMyLocation(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={viewMode === 'map'
              ? { backgroundColor: AMBER, color: '#FFFFFF' }
              : { color: MUTED }}>
            <Map className="w-4 h-4" /> Map
          </button>
        </div>
      </div>

      {/* Location banner */}
      {userLocation && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl text-sm" style={{ backgroundColor: '#1A1410', border: '1px solid #453C2E' }}>
          <Navigation className="w-3.5 h-3.5 flex-shrink-0" style={{ color: AMBER }} />
          <span style={{ color: MUTED }}>
            {userLocation.isTemp ? 'Traveling to' : 'Near'}{' '}
            <span style={{ color: NAVY }} className="font-medium">{userLocation.label}</span>
          </span>
          <div className="flex items-center gap-1 ml-auto">
            {RADII.map(r => (
              <button key={r} onClick={() => changeRadius(r)} type="button"
                className="text-xs px-2 py-0.5 rounded-full transition-colors"
                style={radius === r ? { backgroundColor: AMBER, color: '#fff' } : { color: MUTED }}>
                {r}mi
              </button>
            ))}
            <button onClick={() => setShowTempAddr(!showTempAddr)} type="button" className="ml-2 text-xs" style={{ color: MUTED }}>Travel?</button>
            <button onClick={clearLocation} type="button" className="ml-1 p-0.5 hover:text-red-400" style={{ color: MUTED }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Temp address */}
      {showTempAddr && (
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: MUTED }} />
            <input value={tempAddr} onChange={e => setTempAddr(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyTempAddress()}
              placeholder="Enter a city or address for travel..." className="input pl-9 py-2" />
          </div>
          <button type="button" onClick={applyTempAddress} disabled={tempGeoLoading} className="btn-secondary px-4 text-sm disabled:opacity-60">
            {tempGeoLoading ? <div className="w-4 h-4 border border-amber-500 border-t-transparent rounded-full animate-spin" /> : 'Set'}
          </button>
          <button type="button" onClick={() => setShowTempAddr(false)} className="btn-ghost px-3"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Search + filter */}
      <form onSubmit={applySearch} className="flex gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: MUTED }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store name..." className="input pl-10 py-2.5" />
        </div>
        {!userLocation && (
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: MUTED }} />
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="City" className="input pl-9 py-2.5 w-36" list="store-cities" />
            <datalist id="store-cities">{cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}</datalist>
          </div>
        )}
        <button type="button" onClick={useMyLocation} disabled={geoLoading}
          className="btn-secondary flex items-center gap-1.5 px-3 disabled:opacity-60" title="Use my location"
          style={userLocation && !userLocation.isTemp ? { borderColor: AMBER, color: AMBER } : {}}>
          {geoLoading
            ? <div className="w-4 h-4 border border-amber-500 border-t-transparent rounded-full animate-spin" />
            : <Navigation className="w-4 h-4" />}
          <span className="hidden sm:inline text-sm">{userLocation ? 'Update' : 'Near Me'}</span>
        </button>
        <button type="submit" className="btn-primary px-5">Search</button>
        <button type="button" onClick={() => setShowFilters(!showFilters)}
          className="btn-secondary flex items-center gap-1.5"
          style={hasFilters ? { borderColor: AMBER, color: AMBER } : {}}>
          <Filter className="w-4 h-4" />
        </button>
      </form>

      {showFilters && (
        <div className="card p-4 mb-4 flex flex-wrap gap-4">
          {[
            { label: 'Open right now', checked: openNow, onChange: e => setOpenNow(e.target.checked) },
            { label: 'Has Lounge',     checked: hasLounge, onChange: e => setHasLounge(e.target.checked) },
            { label: 'Walk-in Humidor',checked: hasHumidor,onChange: e => setHasHumidor(e.target.checked) },
          ].map(({ label, checked, onChange }) => (
            <label key={label} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={checked} onChange={onChange} className="accent-amber-600" />
              <span className="text-sm font-medium" style={{ color: LABEL }}>{label}</span>
            </label>
          ))}
          {hasFilters && (
            <button onClick={() => { setQ(''); setCity(''); setOpenNow(false); setHasLounge(false); setHasHumidor(false); setSearchParams({}); }}
              className="flex items-center gap-1 text-xs" style={{ color: MUTED }}>
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
              className="text-xs whitespace-nowrap px-3 py-1.5 rounded-full flex-shrink-0 transition-colors"
              style={{ backgroundColor: '#2E2820', color: LABEL, border: `1px solid ${BORDER}` }}>
              {c.city}, {c.state}
              <span className="ml-1" style={{ color: MUTED }}>({c.store_count})</span>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs mb-4" style={{ color: MUTED }}>
        {loading ? 'Loading...' : `${stores.length} store${stores.length !== 1 ? 's' : ''} found`}
      </p>

      {loading ? (
        <div className="flex flex-col gap-4">
          {[1, 2, 3].map(i => <div key={i} className="card h-32 skeleton" />)}
        </div>
      ) : stores.length === 0 ? (
        <div className="text-center py-16">
          <Store className="w-10 h-10 mx-auto mb-3" style={{ color: '#D4CFC8' }} />
          <p style={{ color: MUTED }}>No stores found. Try different filters.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {stores.map(store => {
            let parsedHours = {};
            try { parsedHours = JSON.parse(store.hours || '{}'); } catch {}
            const status = getStoreStatus(parsedHours);

            const statusStyle = status.isOpen
              ? { backgroundColor: '#0B3320', color: '#4ADE80' }
              : { backgroundColor: '#2E2820', color: '#9E8E7E' };

            return (
              <Link key={store.id} to={`/stores/${store.id}`}
                className="card p-5 transition-colors group"
                style={{ '--hover-border': '#D4CFC8' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#3A4F68'}
                onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: '#352A18' }}>
                    <Store className="w-6 h-6" style={{ color: AMBER }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Name row */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h2 className="font-semibold transition-colors" style={{ color: NAVY }}>
                        {store.name}
                      </h2>
                      {store.verified === 1 && (
                        <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#4ADE80' }} />
                      )}
                      {status.label && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={statusStyle}>
                          {status.label}
                        </span>
                      )}
                    </div>

                    {/* Location + distance */}
                    <div className="flex items-center gap-2 text-xs mb-2" style={{ color: MUTED }}>
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{store.city}, {store.state}</span>
                      {store.distance_mi !== null && store.distance_mi !== undefined && (
                        <span className="font-semibold" style={{ color: AMBER }}>{store.distance_mi} mi</span>
                      )}
                    </div>

                    {/* Description */}
                    {store.description && (
                      <p className="text-sm line-clamp-2 mb-2" style={{ color: LABEL }}>
                        {store.description}
                      </p>
                    )}

                    {/* Stats */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: MUTED }}>
                      <span className="flex items-center gap-1">
                        <Package className="w-3 h-3" />{store.inventory_count} SKUs
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />{store.follower_count} followers
                      </span>
                      {store.avg_rating > 0 && (
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3" style={{ color: '#D4882A' }} />
                          <span style={{ color: LABEL, fontWeight: 500 }}>{store.avg_rating.toFixed(1)}</span>
                        </span>
                      )}
                      {store.today_hours && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />{store.today_hours}
                        </span>
                      )}
                    </div>

                    {/* Tags */}
                    {store.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {store.tags.map(t => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: '#2E2820', color: LABEL, border: `1px solid ${BORDER}` }}>
                            {t}
                          </span>
                        ))}
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
