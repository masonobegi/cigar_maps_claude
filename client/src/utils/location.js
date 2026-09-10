/**
 * The one place a remembered location is read and written.
 *
 * A location is only usable if it still carries real coordinates. An older
 * build stored the label on its own, which rendered "Near Camas" above a
 * nationwide list: the chip advertised a filter that was never applied,
 * because the request went out without lat/lng. Validating on read means a
 * half-written entry is simply forgotten instead of quietly lying.
 *
 * Reading this is not the same as asking the browser where you are. Nothing
 * here prompts for permission — that only happens when the visitor asks for
 * it.
 */

const KEY = 'cb_location_v1';

export function loadSavedLocation() {
  try {
    const loc = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!loc) return null;
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { ...loc, lat, lng };
  } catch {
    return null;
  }
}

export function saveLocation(loc) {
  try { localStorage.setItem(KEY, JSON.stringify(loc)); } catch {}
}

export function clearSavedLocation() {
  try { localStorage.removeItem(KEY); } catch {}
}
