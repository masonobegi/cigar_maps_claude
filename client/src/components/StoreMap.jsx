import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Store, MapPin, Package, Star, Clock, Navigation, X, CheckCircle, Phone } from 'lucide-react';
import { api } from '../services/api';
import { getStoreStatus } from '../utils/hours';

// Lazy-load Leaflet only when the map is actually rendered (saves bundle size)
let L = null;

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function createIcon(isOpen, verified) {
  if (!L) return null;
  const color = isOpen === true ? '#10b981' : isOpen === false ? '#ef4444' : '#d97706';
  const ring  = verified ? '#d97706' : '#44403c';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">
      <filter id="sh"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.4"/></filter>
      <path d="M16 0C9.4 0 4 5.4 4 12c0 9 12 28 12 28S28 21 28 12C28 5.4 22.6 0 16 0z"
        fill="${color}" stroke="${ring}" stroke-width="2.5" filter="url(#sh)"/>
      <circle cx="16" cy="12" r="5" fill="white" opacity="0.9"/>
      <text x="16" y="16" text-anchor="middle" font-size="7" fill="${color}" font-weight="bold">🚬</text>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -42],
  });
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export default function StoreMap({ stores, userLocation, onClose }) {
  const mapRef    = useRef(null);
  const mapObj    = useRef(null);
  const markersRef= useRef([]);
  const [selected, setSelected]   = useState(null);
  const [geocoding, setGeocoding] = useState(false);
  const [ready, setReady]         = useState(false);

  // Load Leaflet CSS
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id   = 'leaflet-css';
      link.rel  = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
  }, []);

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;

    import('leaflet').then(mod => {
      L = mod.default;

      const center = userLocation
        ? [userLocation.lat, userLocation.lng]
        : [39.5, -98.35]; // center of US

      const zoom = userLocation ? 11 : 4;

      const map = L.map(mapRef.current, {
        center, zoom,
        zoomControl: false,
        attributionControl: true,
      });

      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 18 }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // User location dot
      if (userLocation) {
        L.circleMarker([userLocation.lat, userLocation.lng], {
          radius: 10, fillColor: '#3b82f6', color: '#fff', weight: 2,
          fillOpacity: 0.9,
        }).addTo(map).bindPopup('You are here');
      }

      mapObj.current = map;
      setReady(true);
    });

    return () => {
      if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
    };
  }, []);

  // Add store markers when map + stores are ready
  useEffect(() => {
    if (!ready || !mapObj.current || !L) return;

    // Remove old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const storesWithCoords = stores.filter(s => s.lat && s.lng);

    storesWithCoords.forEach(store => {
      let hours = {};
      try { hours = JSON.parse(store.hours || '{}'); } catch {}
      const status = getStoreStatus(hours);

      const icon   = createIcon(status.isOpen, store.verified);
      const marker = L.marker([store.lat, store.lng], { icon })
        .addTo(mapObj.current)
        .on('click', () => setSelected(store));

      markersRef.current.push(marker);
    });

    // Geocode stores without coordinates on demand
    const missing = stores.filter(s => !s.lat || !s.lng);
    if (missing.length > 0 && missing.length < 20) {
      setGeocoding(true);
      Promise.all(
        missing.map(s =>
          fetch(`/api/stores/${s.id}/geocode`, { method: 'POST' })
            .then(r => r.ok ? r.json() : null)
            .then(coords => coords ? { ...s, lat: coords.lat, lng: coords.lng } : null)
            .catch(() => null)
        )
      ).then(results => {
        results.filter(Boolean).forEach(store => {
          let hours = {};
          try { hours = JSON.parse(store.hours || '{}'); } catch {}
          const status = getStoreStatus(hours);
          const icon   = createIcon(status.isOpen, store.verified);
          const marker = L.marker([store.lat, store.lng], { icon })
            .addTo(mapObj.current)
            .on('click', () => setSelected(store));
          markersRef.current.push(marker);
        });
        setGeocoding(false);
      });
    }

    // Fit bounds to all markers if we have some
    if (storesWithCoords.length > 1 && !userLocation) {
      const group = L.featureGroup(markersRef.current.filter(m => m.getLatLng));
      if (group.getBounds().isValid()) mapObj.current.fitBounds(group.getBounds(), { padding: [40, 40] });
    }
  }, [ready, stores]);

  // Center on user when location changes
  useEffect(() => {
    if (userLocation && mapObj.current) {
      mapObj.current.setView([userLocation.lat, userLocation.lng], 12, { animate: true });
    }
  }, [userLocation]);

  let selectedStatus = null;
  if (selected) {
    let hours = {};
    try { hours = JSON.parse(selected.hours || '{}'); } catch {}
    selectedStatus = getStoreStatus(hours);
  }

  const distanceKm = selected && userLocation
    ? haversineKm(userLocation.lat, userLocation.lng, selected.lat, selected.lng)
    : null;

  return (
    <div className="relative w-full h-full">
      {/* Map container */}
      <div ref={mapRef} className="w-full h-full" />

      {/* Geocoding indicator */}
      {geocoding && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-stone-900/90 text-xs text-stone-400 px-3 py-1.5 rounded-full flex items-center gap-2">
          <div className="w-3 h-3 border border-amber-500 border-t-transparent rounded-full animate-spin" />
          Finding stores on map...
        </div>
      )}

      {/* Close button */}
      {onClose && (
        <button onClick={onClose}
          className="absolute top-3 right-3 z-[1000] bg-stone-900/90 border border-stone-700 text-stone-300 rounded-xl p-2 hover:bg-stone-800 transition-colors">
          <X className="w-5 h-5" />
        </button>
      )}

      {/* Selected store bottom sheet */}
      {selected && (
        <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-stone-900 border-t border-stone-700 rounded-t-2xl p-4 shadow-2xl">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 bg-amber-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
              <Store className="w-5 h-5 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="font-semibold text-stone-100">{selected.name}</p>
                {selected.verified === 1 && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                {selectedStatus?.label && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${selectedStatus.isOpen ? 'bg-emerald-900/40 text-emerald-400' : 'bg-stone-800 text-stone-500'}`}>
                    {selectedStatus.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                {[selected.address, selected.city, selected.state].filter(Boolean).join(', ')}
                {distanceKm && <span className="text-amber-500 ml-2">{distanceKm < 1 ? `${Math.round(distanceKm*1000)}m away` : `${distanceKm.toFixed(1)} km away`}</span>}
              </p>
            </div>
            <button onClick={() => setSelected(null)} className="text-stone-600 hover:text-stone-400 p-1 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-stone-500 mb-3">
            <span className="flex items-center gap-1"><Package className="w-3 h-3" />{selected.inventory_count || 0} SKUs</span>
            {selected.avg_rating > 0 && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" />{parseFloat(selected.avg_rating).toFixed(1)}</span>}
          </div>

          <div className="flex gap-2">
            <Link to={`/stores/${selected.id}`}
              className="flex-1 btn-primary text-sm flex items-center justify-center gap-1.5">
              <Package className="w-4 h-4" /> View Menu
            </Link>
            {selected.phone && (
              <a href={`tel:${selected.phone}`}
                className="btn-secondary px-4 flex items-center gap-1.5 text-sm">
                <Phone className="w-4 h-4" /> Call
              </a>
            )}
            <a href={`https://maps.google.com/?q=${encodeURIComponent([selected.address, selected.city, selected.state].filter(Boolean).join(', '))}`}
              target="_blank" rel="noopener"
              className="btn-secondary px-4 flex items-center gap-1.5 text-sm">
              <Navigation className="w-4 h-4" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
