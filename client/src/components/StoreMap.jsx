import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { Link } from 'react-router-dom';

const TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const TYPE_LABEL = { cigar_lounge: 'Lounge', cigar_shop: 'Cigar shop', tobacco_shop: 'Tobacco shop', smoke_shop: 'Smoke shop' };

function loadSavedLocation() {
  try { return JSON.parse(localStorage.getItem('cb_location_v1') || 'null'); } catch { return null; }
}

/** Reports the visible bounding box whenever the user pans or zooms. */
function BoundsWatcher({ onChange }) {
  const map = useMap();
  function report() {
    const b = map.getBounds();
    onChange({ bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom() });
  }
  useEffect(() => { report(); }, []);
  useMapEvents({ moveend: report, zoomend: report });
  return null;
}

/**
 * Lightweight grid clustering: at low zoom, nearby stores collapse into a
 * count bubble; clicking zooms in. Avoids rendering thousands of markers.
 */
function clusterStores(stores, zoom) {
  if (zoom >= 12) return stores.map(s => ({ single: s, lat: s.lat, lng: s.lng }));
  const cellDeg = (64 * 360) / (256 * Math.pow(2, zoom)); // ~64px cells
  const cells = new Map();
  for (const s of stores) {
    const key = `${Math.floor(s.lat / cellDeg)}:${Math.floor(s.lng / cellDeg)}`;
    if (!cells.has(key)) cells.set(key, { items: [], lat: 0, lng: 0 });
    const c = cells.get(key);
    c.items.push(s); c.lat += s.lat; c.lng += s.lng;
  }
  return [...cells.values()].map(c => c.items.length === 1
    ? { single: c.items[0], lat: c.items[0].lat, lng: c.items[0].lng }
    : { count: c.items.length, claimed: c.items.filter(i => i.claimed).length, lat: c.lat / c.items.length, lng: c.lng / c.items.length });
}

function clusterIcon(count, claimed) {
  const size = count >= 100 ? 46 : count >= 20 ? 40 : 34;
  const bg = claimed ? '#B8751A' : '#5C4E3E';
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:2px solid rgba(255,255,255,0.85);color:#fff;font:600 12px Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.45)">${count}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function ClusterLayer({ stores }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const items = useMemo(() => clusterStores(stores, zoom), [stores, zoom]);

  return items.map((it, i) => it.single ? (
    <CircleMarker
      key={it.single.id}
      center={[it.lat, it.lng]}
      radius={it.single.claimed ? 9 : 7}
      fillColor={it.single.claimed ? '#D4882A' : '#7A6A58'}
      color={it.single.verified ? '#4ADE80' : it.single.claimed ? '#8B6420' : '#3F362C'}
      weight={2}
      fillOpacity={0.92}
    >
      <Popup>
        <div style={{ minWidth: '170px' }}>
          <p style={{ fontWeight: 700, marginBottom: '2px', color: '#1a1a1a' }}>{it.single.name}</p>
          <p style={{ fontSize: '12px', color: '#555', marginBottom: '4px' }}>
            {TYPE_LABEL[it.single.store_type] || 'Cigar shop'}{it.single.city ? ` · ${it.single.city}, ${it.single.state}` : it.single.state ? ` · ${it.single.state}` : ''}
          </p>
          {it.single.distance_mi != null && (
            <p style={{ fontSize: '12px', color: '#C8963C', marginBottom: '4px', fontWeight: 600 }}>{it.single.distance_mi} mi away</p>
          )}
          <p style={{ fontSize: '11px', color: it.single.claimed ? '#2E7D32' : '#8A7A66', marginBottom: '4px' }}>
            {it.single.verified ? 'Verified retailer' : it.single.claimed ? 'Claimed by owner' : 'Unclaimed listing'}
          </p>
          <Link to={`/stores/${it.single.id}`}
            style={{ display: 'inline-block', marginTop: '4px', fontSize: '12px', color: '#8B6420', fontWeight: 600, textDecoration: 'underline' }}>
            View store &rarr;
          </Link>
        </div>
      </Popup>
    </CircleMarker>
  ) : (
    <Marker
      key={`c${i}-${it.lat.toFixed(3)}-${it.lng.toFixed(3)}`}
      position={[it.lat, it.lng]}
      icon={clusterIcon(it.count, it.claimed > 0)}
      eventHandlers={{ click: () => map.setView([it.lat, it.lng], Math.min(zoom + 3, 14)) }}
    />
  ));
}

export default function StoreMap({ stores, userLocation, onClose, onBoundsChange, height = '500px', initialCenter, initialZoom }) {
  const saved   = userLocation || loadSavedLocation();
  const center  = initialCenter || (saved ? [saved.lat, saved.lng] : [38.5, -96]);
  const zoom    = initialZoom || (saved ? 11 : 4);

  const storesWithCoords = (stores || []).filter(s => s.lat && s.lng);

  return (
    <div className="relative w-full" style={{ height }}>
      <MapContainer center={center} zoom={zoom} style={{ width: '100%', height: '100%' }} scrollWheelZoom preferCanvas>
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} maxZoom={18} />
        {onBoundsChange && <BoundsWatcher onChange={onBoundsChange} />}

        {saved && (
          <CircleMarker center={[saved.lat, saved.lng]} radius={8} fillColor="#3b82f6" color="#ffffff" weight={2} fillOpacity={0.9}>
            <Popup>You are here</Popup>
          </CircleMarker>
        )}

        <ClusterLayer stores={storesWithCoords} />
      </MapContainer>

      {/* Legend */}
      <div style={{ position: 'absolute', bottom: '12px', left: '12px', zIndex: 1000, background: 'rgba(26,20,16,0.92)', border: '1px solid #453C2E',
        color: '#B0A090', borderRadius: '10px', padding: '6px 10px', fontSize: '11px', display: 'flex', gap: '12px' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#D4882A', marginRight: 5 }} />Claimed</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#7A6A58', marginRight: 5 }} />Unclaimed</span>
      </div>

      {onClose && (
        <button onClick={onClose}
          style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 1000, background: 'rgba(26,20,16,0.92)', border: '1px solid #453C2E',
            color: '#E8DDD0', borderRadius: '10px', padding: '6px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
          ✕ Close map
        </button>
      )}
    </div>
  );
}
