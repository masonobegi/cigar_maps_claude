import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Store, MapPin, Package, Search, CheckCircle, Star, Users, Filter, X, Clock, Navigation, Map, List } from 'lucide-react';
import { api } from '../services/api';
import StoreCard from '../components/StoreCard';
import { saveLocation as persistLocation, clearSavedLocation } from '../utils/location';

const StoreMap = lazy(() => import('../components/StoreMap'));

const NAVY   = '#E8DDD0';
const MUTED  = '#9E8E7E';
const LABEL  = '#B0A090';
const BORDER = '#453C2E';
const AMBER  = '#D4882A';

const RADII = [10, 25, 50, 100];
const TYPE_LABEL = { cigar_lounge: 'Lounge', cigar_shop: 'Cigar shop', tobacco_shop: 'Tobacco shop', smoke_shop: 'Smoke shop' };
const TYPE_CHIPS = [
  { value: 'cigar_shop', label: 'Cigar shop' },
  { value: 'cigar_lounge', label: 'Lounge' },
  { value: 'tobacco_shop', label: 'Tobacco shop' },
  { value: 'smoke_shop', label: 'Smoke shop' },
];

function Chip({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="text-xs whitespace-nowrap px-3 py-1.5 rounded-full font-medium transition-colors"
      style={active
        ? { color: AMBER, border: `1px solid ${AMBER}`, backgroundColor: '#2E2820' }
        : { color: MUTED, border: `1px solid ${BORDER}`, backgroundColor: '#1A1410' }}>
      {label}
    </button>
  );
}


export default function Stores() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState([]);
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [city, setCity] = useState(searchParams.get('city') || '');
  // A chip knows which state its town is in, so "Washington, DC" no longer
  // returns shops in Michigan, Missouri and Pennsylvania.
  const [cityState, setCityState] = useState(searchParams.get('state') || '');
  const [openNow, setOpenNow] = useState(searchParams.get('open_now') === '1');
  const [hasLounge, setHasLounge] = useState(false);
  const [hasHumidor, setHasHumidor] = useState(false);
  const [types, setTypes] = useState([]);
  const [hasInventory, setHasInventory] = useState(false);
  const [claimedOnly, setClaimedOnly] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [userLocation, setUserLocation] = useState(null);
  const [radius, setRadius] = useState(() => parseInt(localStorage.getItem('cb_radius') || '50'));
  const [showTempAddr, setShowTempAddr] = useState(false);
  const [tempAddr, setTempAddr] = useState('');
  const [tempGeoLoading, setTempGeoLoading] = useState(false);
  // Map mode loads whatever is in the viewport (the directory has thousands of listings)
  const [mapStores, setMapStores] = useState(null);
  // The server's answer for the current viewport: pins, cluster bubbles and an
  // exact total. Null until the first bounds report comes in.
  const [mapData, setMapData] = useState(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapBbox, setMapBbox] = useState(null);
  const mapReq = useRef({ timer: null, seq: 0 });
  // What the server says about the whole result, not just the page we hold:
  // how many shops match, whether more are waiting, how many of them have no
  // hours anyone stands behind, and whether the search was too wide to measure.
  const [listMeta, setListMeta] = useState({ total: null, next: null, unconfirmed: 0, tooMany: false, message: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const listReq = useRef(0);

  // Panning only records where we are. The fetch lives in the effect below so
  // that changing a filter refreshes the map even when it never moves.
  function handleBounds({ bbox, zoom }) {
    clearTimeout(mapReq.current.timer);
    // The zoom decides the cluster cell size, so it travels with the box.
    mapReq.current.timer = setTimeout(() => setMapBbox(`${bbox.join(',')}|${zoom}`), 350);
  }

  // Serialized so the effects below can depend on the type selection by value.
  const typeKey = types.join(',');

  // Every filter the list and the map viewport share.
  function filterParams() {
    const p = {};
    if (q) p.q = q;
    if (openNow) p.open_now = '1';
    if (hasLounge) p.has_lounge = '1';
    if (hasHumidor) p.has_walk_in_humidor = '1';
    if (typeKey) p.store_type = typeKey;
    if (hasInventory) p.has_inventory = '1';
    if (claimedOnly) p.claimed = '1';
    return p;
  }

  // The map asks its own endpoint, which groups in the database over every
  // matching listing. It used to ask the list for `limit=1000` rows and cluster
  // those in the browser: with 7,904 public listings the national view drew
  // 1,000 of them, every bubble's count was taken from that thousand, and the
  // header said "1000+ stores in view" because it was counting the rows it had
  // been handed rather than the shops that were there.
  useEffect(() => {
    if (viewMode !== 'map' || !mapBbox) return;
    const seq = ++mapReq.current.seq;
    setMapLoading(true);
    const [bbox, zoom] = mapBbox.split('|');
    api.getStoreMap({ ...filterParams(), bbox, zoom })
      .then(data => { if (seq === mapReq.current.seq) setMapData(data); })
      .catch(() => {})
      .finally(() => { if (seq === mapReq.current.seq) setMapLoading(false); });
  }, [mapBbox, viewMode, q, openNow, hasLounge, hasHumidor, typeKey, hasInventory, claimedOnly]);

  useEffect(() => { api.getStoreCities().then(setCities); }, []);

  // Location is opt-in per visit. We never quietly narrow the directory to
  // wherever the browser last saw you — the list stays nationwide until you
  // press Near Me or type a place.

  // What the map has in view. The exact number, because the server counted
  // every matching listing rather than the page it happened to return: the old
  // line said "1000+ stores in view" whenever the cap was hit, which on the
  // national view it always was.
  function mapCountLine() {
    if (!mapData) return 'Drag or zoom to explore.';
    if (mapData.too_many) return mapData.message;
    const n = mapData.total;
    if (n === 0) return 'No shops in view. Drag or zoom out to explore.';
    return `${n.toLocaleString()} ${n === 1 ? 'shop' : 'shops'} in view. Drag or zoom to explore.`;
  }

  // The parameters for the list, without the paging offset.
  function listParams() {
    const p = filterParams();
    if (city && !userLocation) {
      p.city = city;
      if (cityState) p.state = cityState;
    }
    if (userLocation?.lat) { p.lat = userLocation.lat; p.lng = userLocation.lng; p.radius = radius; }
    return p;
  }

  useEffect(() => {
    const seq = ++listReq.current;
    setLoading(true);
    api.searchStorePage(listParams())
      .then(r => {
        if (seq !== listReq.current) return;
        setStores(r.stores || []);
        setListMeta({
          total: r.total, next: r.next_offset,
          unconfirmed: r.unconfirmed_hours_nearby || 0,
          tooMany: !!r.too_many, message: r.message || null,
        });
      })
      .finally(() => { if (seq === listReq.current) setLoading(false); });
  }, [q, city, openNow, hasLounge, hasHumidor, typeKey, hasInventory, claimedOnly, userLocation, radius]);

  // "Show more" appends the next page rather than replacing the list, so a
  // customer never loses their place to see the shop below the fold.
  function showMore() {
    if (listMeta.next === null || listMeta.next === undefined || loadingMore) return;
    const seq = listReq.current;
    setLoadingMore(true);
    api.searchStorePage({ ...listParams(), offset: listMeta.next })
      .then(r => {
        if (seq !== listReq.current) return;
        setStores(prev => [...prev, ...(r.stores || [])]);
        setListMeta(m => ({ ...m, next: r.next_offset }));
      })
      .finally(() => { if (seq === listReq.current) setLoadingMore(false); });
  }

  /**
   * What the list says about itself. The old line counted the cards on screen
   * and added a "+" past 300, which is how a search that had quietly dropped
   * ninety nearby shops still read as complete.
   */
  function listCountLine() {
    if (listMeta.tooMany) return listMeta.message;
    const total = listMeta.total ?? stores.length;
    const where = userLocation ? ` within ${radius} mi of ${userLocation.label}` : '';
    const shown = total > stores.length ? `, showing ${stores.length}` : '';
    const noHours = openNow && listMeta.unconfirmed
      ? ` ${listMeta.unconfirmed} more nearby have no hours we can confirm.`
      : '';
    const narrow = !userLocation && !city && !q ? ' Use Near Me or pick a city to narrow it down.' : '';
    return `${total} store${total !== 1 ? 's' : ''} found${where}${shown}.${noHours}${narrow}`;
  }

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
    persistLocation(loc);
  }

  function clearLocation() {
    setUserLocation(null);
    clearSavedLocation();
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

  function toggleType(value) {
    setTypes(prev => prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value]);
  }

  function clearFilters() {
    setQ(''); setCity(''); setCityState(''); setOpenNow(false); setHasLounge(false); setHasHumidor(false);
    setTypes([]); setHasInventory(false); setClaimedOnly(false);
    setSearchParams({});
  }

  const FEATURE_CHIPS = [
    { label: 'Open now',        active: openNow,      onClick: () => setOpenNow(v => !v) },
    { label: 'Has inventory',   active: hasInventory, onClick: () => setHasInventory(v => !v) },
    { label: 'Claimed only',    active: claimedOnly,  onClick: () => setClaimedOnly(v => !v) },
    { label: 'Lounge',          active: hasLounge,    onClick: () => setHasLounge(v => !v) },
    { label: 'Walk-in humidor', active: hasHumidor,   onClick: () => setHasHumidor(v => !v) },
  ];

  const activeCount = types.length + FEATURE_CHIPS.filter(f => f.active).length;
  const hasFilters = !!q || !!city || activeCount > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-serif text-2xl font-bold mb-1" style={{ color: NAVY }}>Cigar Retailers</h1>
          <p className="text-sm" style={{ color: MUTED }}>Every cigar shop and lounge in the US. Live inventory where owners have claimed their listing.</p>
        </div>

        {/* Map / List toggle */}
        <div className="flex border-b" style={{ borderColor: BORDER }}>
          <button
            onClick={() => setViewMode('list')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-all"
            style={viewMode === 'list'
              ? { color: AMBER, borderBottom: `2px solid ${AMBER}`, marginBottom: '-1px' }
              : { color: MUTED, borderBottom: '2px solid transparent', marginBottom: '-1px' }}>
            <List className="w-4 h-4" /> List
          </button>
          <button
            onClick={() => setViewMode('map')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-all"
            style={viewMode === 'map'
              ? { color: AMBER, borderBottom: `2px solid ${AMBER}`, marginBottom: '-1px' }
              : { color: MUTED, borderBottom: '2px solid transparent', marginBottom: '-1px' }}>
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
            <input value={city} onChange={e => { setCity(e.target.value); setCityState(''); }} placeholder="City" className="input pl-9 py-2.5 w-36" list="store-cities" />
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
          {activeCount > 0 && (
            <span className="text-xs font-semibold px-1.5 rounded-full"
              style={{ backgroundColor: AMBER, color: '#1A1410' }}>{activeCount}</span>
          )}
        </button>
      </form>

      {showFilters && (
        <div className="card p-4 mb-4 flex flex-col gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: LABEL }}>Type</p>
            <div className="flex flex-wrap gap-2">
              {TYPE_CHIPS.map(t => (
                <Chip key={t.value} label={t.label} active={types.includes(t.value)} onClick={() => toggleType(t.value)} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: LABEL }}>Features</p>
            <div className="flex flex-wrap gap-2">
              {FEATURE_CHIPS.map(f => (
                <Chip key={f.label} label={f.label} active={f.active} onClick={f.onClick} />
              ))}
            </div>
          </div>
          {hasFilters && (
            <button type="button" onClick={clearFilters}
              className="flex items-center gap-1 text-xs self-start" style={{ color: MUTED }}>
              <X className="w-3 h-3" /> Clear all
            </button>
          )}
        </div>
      )}

      {/* City quick-links */}
      {!q && !city && cities.length > 0 && (
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
          {cities.map(c => (
            <button key={`${c.city}-${c.state}`} onClick={() => { setCity(c.city); setCityState(c.state); }}
              className="text-xs whitespace-nowrap px-3 py-1.5 rounded-full flex-shrink-0 transition-colors"
              style={{ backgroundColor: '#2E2820', color: LABEL, border: `1px solid ${BORDER}` }}>
              {c.city}, {c.state}
              <span className="ml-1" style={{ color: MUTED }}>({c.store_count})</span>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs mb-4" style={{ color: MUTED }}>
        {viewMode === 'map'
          ? (mapLoading ? 'Loading map...' : mapCountLine())
          : loading ? 'Loading...' : listCountLine()}
      </p>

      {/* Map view */}
      {viewMode === 'map' && (
        <div className="mb-6 rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
          <Suspense fallback={
            <div className="flex items-center justify-center" style={{ height: '500px', backgroundColor: '#1A1410' }}>
              <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
            </div>
          }>
            <StoreMap stores={mapStores || stores} mapData={mapData} userLocation={userLocation} onBoundsChange={handleBounds} height="560px" />
          </Suspense>
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && loading ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="card h-32 skeleton" />)}
        </div>
      ) : viewMode === 'list' && stores.length === 0 ? (
        <div className="text-center py-16">
          <Store className="w-10 h-10 mx-auto mb-3" style={{ color: '#D4CFC8' }} />
          <p style={{ color: MUTED }}>
            {listMeta.tooMany ? listMeta.message : 'No stores found. Try different filters.'}
          </p>
          {!listMeta.tooMany && openNow && listMeta.unconfirmed > 0 && (
            <p className="text-xs mt-2" style={{ color: MUTED }}>
              {listMeta.unconfirmed} nearby {listMeta.unconfirmed === 1 ? 'shop has' : 'shops have'} no
              hours we can confirm, so they are not counted as open.
            </p>
          )}
        </div>
      ) : viewMode === 'list' ? (
        <>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {stores.map(store => <StoreCard key={store.id} store={store} />)}
          </div>
          {listMeta.next !== null && listMeta.next !== undefined && (
            <div className="flex justify-center mt-6">
              <button type="button" onClick={showMore} disabled={loadingMore}
                className="text-sm px-5 py-2 rounded-full font-medium transition-colors"
                style={{ color: AMBER, border: `1px solid ${AMBER}`, backgroundColor: '#2E2820', opacity: loadingMore ? 0.6 : 1 }}>
                {loadingMore
                  ? 'Loading...'
                  : `Show more${listMeta.total ? ` (${listMeta.total - stores.length} more)` : ''}`}
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
