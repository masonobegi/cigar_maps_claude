import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Clock, CheckCircle } from 'lucide-react';
import { getStoreStatus } from '../utils/hours';

const TEXT = '#E8DDD0';
const MUTED = '#9E8E7E';
const BORDER = '#453C2E';
const AMBER = '#D4882A';

// Open is green, anything else is quiet grey, a lounge is gold: the three
// things a smoker scans a list for.
const OPEN = { backgroundColor: '#0B3320', color: '#4ADE80', border: '1px solid #14532D' };
const CLOSED = { backgroundColor: '#2A2520', color: '#A8998A', border: `1px solid ${BORDER}` };
const LOUNGE = { backgroundColor: '#3A2E0A', color: '#F5C542', border: '1px solid #6B5314' };

/**
 * A shop has a lounge if the column says so. Nothing else.
 *
 * This used to read `has_lounge === 1 || store_type === 'cigar_lounge'`, which
 * made the badge impossible to take off: a sweep that read a shop's own site,
 * found it describes no lounge and cleared has_lounge was overruled at render
 * time by the classifier's guess at the shop's type. The two are separate
 * facts — what kind of shop this is, and whether you can sit down and smoke in
 * it — and a type fix should not silently restore a badge a person removed.
 *
 * The import still sets has_lounge from a `cigar_lounge` type on a listing
 * nobody has corrected, so no badge disappears from this change; what changes
 * is that removing one now works.
 */
export function hasLounge(store) {
  return store.has_lounge === 1;
}

/**
 * Only hours somebody stands behind earn an Open or Closed badge: read off the
 * shop's own website, given by its owner, taken from its chain's store list, or
 * set by staff. Map hours are shown as what they are — about half the ones we
 * could check against a shop's own site were wrong on some day, and a green
 * "Open now" on top of that sends a customer to a locked door.
 */
const CONFIRMED_HOURS = new Set(['website', 'owner', 'staff', 'chain']);
export function hoursConfirmed(store) {
  return CONFIRMED_HOURS.has(store.hours_source);
}

/** A shop we could not confirm is still trading says so, quietly. */
export function unconfirmedShop(store) {
  return store.operating_status === 'likely_closed';
}

/** A steady colour per shop, so a monogram reads as that shop's, not a blank. */
function tint(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = [28, 18, 36, 12, 44, 8];
  const hue = hues[h % hues.length];
  return `linear-gradient(135deg, hsl(${hue} 45% 26%), hsl(${hue} 50% 16%))`;
}

function initials(name) {
  const words = String(name || '').replace(/^the\s+/i, '').split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
  return (words.slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
}

/**
 * The shop's picture: the owner's upload first, then the image its own website
 * offers for sharing, then a monogram. A picture that fails to load (plenty of
 * sites refuse to be embedded) falls back to the monogram instead of a broken
 * image.
 */
export function StoreThumb({ store, size = 72 }) {
  const src = store.logo_url || store.cover_url || store.web_image_url;
  const [failed, setFailed] = useState(false);
  const isLogo = /logo/i.test(String(src || ''));
  const box = { width: size, height: size, flexShrink: 0 };
  if (!src || failed) {
    return (
      <div className="rounded-xl flex items-center justify-center font-serif font-bold select-none"
        style={{ ...box, background: tint(store.name), color: '#F3E6D3', fontSize: size * 0.34 }} aria-hidden="true">
        {initials(store.name)}
      </div>
    );
  }
  return (
    <div className="rounded-xl overflow-hidden" style={{ ...box, backgroundColor: isLogo ? '#F4EEE6' : '#2A2520' }}>
      <img src={src.replace(/^http:\/\//, 'https://')} alt="" loading="lazy" referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full" style={{ objectFit: isLogo ? 'contain' : 'cover', padding: isLogo ? 6 : 0 }} />
    </div>
  );
}

/** Street and city on one line: three Anthony's in Tucson are three different doors. */
function whereLine(store) {
  const street = (store.address || '').trim();
  const town = [store.city, store.state].filter(Boolean).join(', ');
  if (street && town) return `${street}, ${town}`;
  return street || town || 'Location on the map';
}

/**
 * One line about today. Open: when it closes, and the day's hours. Closed:
 * when it next opens. Unknown: say so plainly, never guess "closed".
 */
function HoursLine({ status, today, confirmed }) {
  const pretty = s => String(s || '').replace('-', '–');
  if (!confirmed) {
    if (!today) return <span style={{ color: '#7A6D60' }}>Hours not listed</span>;
    return <span>Today {pretty(today)}<span style={{ color: '#7A6D60' }}> · from map data, not confirmed</span></span>;
  }
  if (status.isOpen === true) {
    return <span>{status.label}{today ? <span style={{ color: MUTED }}> · {pretty(today)}</span> : null}</span>;
  }
  if (status.isOpen === false) return <span>{status.label || 'Closed now'}</span>;
  if (today) return <span>Today {pretty(today)}</span>;
  return <span style={{ color: '#7A6D60' }}>Hours not listed</span>;
}

export default function StoreCard({ store }) {
  const status = store.open_status || getStoreStatus(store.hours);
  const today = status.today || store.today_hours;
  const lounge = hasLounge(store);
  const confirmed = hoursConfirmed(store);
  const unsure = unconfirmedShop(store);

  return (
    <Link to={`/stores/${store.id}`}
      className="card p-3.5 flex gap-3.5 transition-colors"
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#5A4A34'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; }}>
      <StoreThumb store={store} />

      <div className="min-w-0 flex-1 flex flex-col">
        {/*
          A shop paid to sit at the top of this list, so the card says so.
          Deliberately above the name and in muted grey rather than the amber
          every other badge uses: a disclosure is not a feature, and a
          disclosure a reader has to hunt for is not one at all. The server
          only ever marks a row it lifted, never one that earned its place.
        */}
        {store.sponsored && (
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
            style={{ color: MUTED }}>Sponsored</p>
        )}

        <div className="flex items-start gap-1.5">
          <h2 className="font-semibold leading-snug line-clamp-2" style={{ color: TEXT }}>{store.name}</h2>
          {store.verified === 1 && <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#4ADE80' }} aria-label="Verified" />}
        </div>

        <p className="text-xs mt-0.5 flex items-start gap-1" style={{ color: MUTED }}>
          <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span className="line-clamp-1">{whereLine(store)}</span>
          {store.distance_mi !== null && store.distance_mi !== undefined && (
            <span className="flex-shrink-0 font-semibold" style={{ color: AMBER }}>· {store.distance_mi} mi</span>
          )}
        </p>

        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          {confirmed && !unsure && status.isOpen === true && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={OPEN}>Open now</span>
          )}
          {confirmed && !unsure && status.isOpen === false && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={CLOSED}>Closed</span>
          )}
          {lounge && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={LOUNGE}>Lounge</span>
          )}
        </div>

        <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: confirmed && status.isOpen ? '#9FD9B0' : MUTED }}>
          <Clock className="w-3 h-3 flex-shrink-0" />
          <HoursLine status={status} today={today} confirmed={confirmed} />
        </p>

        {unsure && (
          <p className="text-xs mt-1" style={{ color: '#7A6D60' }}>
            We couldn't confirm this shop is still open. Call or check before you go.
          </p>
        )}
      </div>
    </Link>
  );
}
