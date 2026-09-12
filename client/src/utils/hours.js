const RANGE = /(\d+)(?::(\d+))?(am|pm)\s*[-–]\s*(\d+)(?::(\d+))?(am|pm)/ig;

// A day can be written as more than one shift: "12pm-6pm, 7pm-10pm" is a shop
// that shuts for an hour in between. Reading only the first says it is closed
// all evening; reading first-open to last-close says it is open through the
// break. So read them all, in order.
export function parseHoursRanges(str) {
  if (!str || str === 'Closed') return [];
  const toMins = (h, m, ap) => {
    let hour = parseInt(h);
    const min = parseInt(m || 0);
    if (ap.toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (ap.toLowerCase() === 'am' && hour === 12) hour = 0;
    return hour * 60 + min;
  };
  const out = [];
  for (const m of String(str).matchAll(RANGE)) {
    out.push({ open: toMins(m[1], m[2], m[3]), close: toMins(m[4], m[5], m[6]) });
  }
  return out;
}

export function parseHoursString(str) {
  return parseHoursRanges(str)[0] || null;
}

export function getStoreStatus(hours) {
  if (!hours || typeof hours !== 'object') return { isOpen: null, label: null };
  // No hours on record is "we don't know", never "closed". Most listings come
  // from map data without hours, and the fall-through below used to call every
  // one of them "Closed today" — Anthony's among them, on a weekday afternoon.
  const known = Object.values(hours).some(v => v && String(v).trim());
  if (!known) return { isOpen: null, label: null };

  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = dayNames[now.getDay()];
  const todayStr = hours[today];
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (!todayStr || todayStr === 'Closed') {
    // Find next open day
    for (let d = 1; d <= 7; d++) {
      const nextDay = dayNames[(now.getDay() + d) % 7];
      const nextStr = hours[nextDay];
      if (nextStr && nextStr !== 'Closed') {
        const parsed = parseHoursString(nextStr);
        if (parsed) {
          const dayLabel = d === 1 ? 'tomorrow' : nextDay;
          const openHour = Math.floor(parsed.open / 60);
          const openMin = parsed.open % 60;
          const ampm = openHour >= 12 ? 'pm' : 'am';
          const h = openHour > 12 ? openHour - 12 : openHour || 12;
          const timeStr = openMin > 0 ? `${h}:${String(openMin).padStart(2,'0')}${ampm}` : `${h}${ampm}`;
          return { isOpen: false, label: `Opens ${dayLabel} at ${timeStr}`, todayHours: todayStr };
        }
      }
    }
    return { isOpen: false, label: 'Closed today', todayHours: todayStr };
  }

  const shifts = parseHoursRanges(todayStr);
  if (!shifts.length) return { isOpen: null, label: todayStr, todayHours: todayStr };

  for (const parsed of shifts) {
    // Closing after midnight ("11am-2am") gives a close time at or before open.
    if (parsed.close <= parsed.open) {
      if (nowMins >= parsed.open || nowMins < parsed.close) {
        return { isOpen: true, label: `Open until ${formatTime(parsed.close)}`, todayHours: todayStr };
      }
      continue;
    }
    if (nowMins >= parsed.open && nowMins < parsed.close) {
      const minsLeft = parsed.close - nowMins;
      const label = minsLeft <= 30
        ? `Closes in ${minsLeft}m`
        : minsLeft <= 90
        ? `Closes in ${Math.round(minsLeft / 30) * 30}m`
        : `Open until ${formatTime(parsed.close)}`;
      return { isOpen: true, label, todayHours: todayStr };
    }
  }

  // Shut now; a shift later today still opens.
  const later = shifts.find(r => nowMins < r.open);
  if (later) {
    const minsUntil = later.open - nowMins;
    const label = minsUntil < 60
      ? `Opens in ${minsUntil}m`
      : `Opens at ${formatTime(later.open)}`;
    return { isOpen: false, label, todayHours: todayStr };
  }

  return { isOpen: false, label: 'Closed now', todayHours: todayStr };
}

function formatTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h > 12 ? h - 12 : h || 12;
  return m > 0 ? `${hour}:${String(m).padStart(2,'0')}${ampm}` : `${hour}${ampm}`;
}
