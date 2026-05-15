export function parseHoursString(str) {
  if (!str || str === 'Closed') return null;
  const match = str.match(/(\d+)(?::(\d+))?(am|pm)\s*[-–]\s*(\d+)(?::(\d+))?(am|pm)/i);
  if (!match) return null;
  const toMins = (h, m, ap) => {
    let hour = parseInt(h);
    const min = parseInt(m || 0);
    if (ap.toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (ap.toLowerCase() === 'am' && hour === 12) hour = 0;
    return hour * 60 + min;
  };
  return {
    open: toMins(match[1], match[2], match[3]),
    close: toMins(match[4], match[5], match[6]),
  };
}

export function getStoreStatus(hours) {
  if (!hours || typeof hours !== 'object') return { isOpen: null, label: null };

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

  const parsed = parseHoursString(todayStr);
  if (!parsed) return { isOpen: null, label: todayStr, todayHours: todayStr };

  if (nowMins < parsed.open) {
    const minsUntil = parsed.open - nowMins;
    const label = minsUntil < 60
      ? `Opens in ${minsUntil}m`
      : `Opens at ${formatTime(parsed.open)}`;
    return { isOpen: false, label, todayHours: todayStr };
  }

  if (nowMins < parsed.close) {
    const minsLeft = parsed.close - nowMins;
    const label = minsLeft <= 30
      ? `Closes in ${minsLeft}m`
      : minsLeft <= 90
      ? `Closes in ${Math.round(minsLeft / 30) * 30}m`
      : `Open until ${formatTime(parsed.close)}`;
    return { isOpen: true, label, todayHours: todayStr };
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
