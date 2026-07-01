import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';

const TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function loadSavedLocation() {
  try { return JSON.parse(localStorage.getItem('cb_location_v1') || 'null'); } catch { return null; }
}

export default function StoreMap({ stores, userLocation, onClose }) {
  const saved   = userLocation || loadSavedLocation();
  const center  = saved ? [saved.lat, saved.lng] : [38.5, -96];
  const zoom    = saved ? 11 : 4;

  const storesWithCoords = stores.filter(s => s.lat && s.lng);

  return (
    <div className="relative w-full" style={{ height: '500px' }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} maxZoom={18} />

        {/* User location marker */}
        {saved && (
          <CircleMarker
            center={[saved.lat, saved.lng]}
            radius={8}
            fillColor="#3b82f6"
            color="#ffffff"
            weight={2}
            fillOpacity={0.9}
          >
            <Popup>You are here</Popup>
          </CircleMarker>
        )}

        {/* Store markers */}
        {storesWithCoords.map(store => (
          <CircleMarker
            key={store.id}
            center={[store.lat, store.lng]}
            radius={8}
            fillColor="#C8963C"
            color="#8B6420"
            weight={2}
            fillOpacity={0.9}
          >
            <Popup>
              <div style={{ minWidth: '160px' }}>
                <p style={{ fontWeight: 700, marginBottom: '2px', color: '#1a1a1a' }}>
                  {store.name}
                </p>
                <p style={{ fontSize: '12px', color: '#555', marginBottom: '4px' }}>
                  {store.city}, {store.state}
                </p>
                {store.distance_mi != null && (
                  <p style={{ fontSize: '12px', color: '#C8963C', marginBottom: '4px', fontWeight: 600 }}>
                    {store.distance_mi} mi away
                  </p>
                )}
                <Link
                  to={`/stores/${store.id}`}
                  style={{
                    display: 'inline-block',
                    marginTop: '4px',
                    fontSize: '12px',
                    color: '#8B6420',
                    fontWeight: 600,
                    textDecoration: 'underline',
                  }}
                >
                  View Store &rarr;
                </Link>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Close / back to list button */}
      {onClose && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 1000,
            background: 'rgba(26,20,16,0.92)',
            border: '1px solid #453C2E',
            color: '#E8DDD0',
            borderRadius: '10px',
            padding: '6px 14px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ✕ Close map
        </button>
      )}
    </div>
  );
}
