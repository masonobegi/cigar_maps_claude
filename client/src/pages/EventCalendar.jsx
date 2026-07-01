import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Star, X, CalendarDays, MapPin, Clock, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

// ── LocalStorage star helpers ─────────────────────────────────────────────────

const STAR_KEY = 'cb_starred_events';

function loadStarred() {
  try {
    const raw = localStorage.getItem(STAR_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveStarred(set) {
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify([...set]));
  } catch {}
}

// ── Calendar math ─────────────────────────────────────────────────────────────

function startOfMonth(year, month) {
  return new Date(year, month, 1);
}

// Returns array of Date objects for the 5-week Mon-Sun grid covering the month
function buildGrid(year, month) {
  const first = startOfMonth(year, month);
  // Monday = 0 offset; getDay() returns 0=Sun…6=Sat
  const dayOfWeek = first.getDay(); // 0=Sun
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // steps back to Monday
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - offset);

  const cells = [];
  for (let i = 0; i < 35; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function toDateKey(date) {
  // Returns "YYYY-MM-DD" in local time
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function eventDateKey(eventDateStr) {
  // event_date may be "2025-07-15T19:00:00" or "2025-07-15" — take first 10 chars
  return eventDateStr ? eventDateStr.slice(0, 10) : null;
}

function formatEventTime(eventDateStr) {
  if (!eventDateStr) return '';
  const d = new Date(eventDateStr);
  if (isNaN(d.getTime())) return eventDateStr;
  return d.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── Pill colors by RSVP status ────────────────────────────────────────────────

function pillStyle(event, starred) {
  if (starred) return { backgroundColor: '#92400e', borderColor: '#D4882A' };
  if (event.my_rsvp === 'going') return { backgroundColor: '#14532d', borderColor: '#16a34a' };
  if (event.my_rsvp === 'maybe') return { backgroundColor: '#1e3a5f', borderColor: '#3b82f6' };
  return { backgroundColor: '#2a2218', borderColor: '#453C2E' };
}

// ── RSVP status label ─────────────────────────────────────────────────────────

const RSVP_LABELS = { going: 'Going', maybe: 'Maybe', null: 'Not going' };

// ── Day Cell ──────────────────────────────────────────────────────────────────

function DayCell({ date, currentMonth, events, starred, today, onEventClick }) {
  const [expanded, setExpanded] = useState(false);
  const isCurrentMonth = date.getMonth() === currentMonth;
  const isToday = toDateKey(date) === toDateKey(today);
  const MAX_VISIBLE = 3;
  const visible = expanded ? events : events.slice(0, MAX_VISIBLE);
  const hiddenCount = events.length - MAX_VISIBLE;

  return (
    <div
      style={{
        minHeight: 90,
        backgroundColor: isToday ? '#2a2218' : '#1C1914',
        borderColor: isToday ? '#D4882A' : '#453C2E',
        borderWidth: 1,
        borderStyle: 'solid',
        padding: '4px 5px',
        position: 'relative',
      }}
    >
      {/* Day number */}
      <div
        style={{
          fontSize: 12,
          fontWeight: isToday ? 700 : 400,
          color: isToday ? '#D4882A' : isCurrentMonth ? '#E8DDD0' : '#6b5e4e',
          marginBottom: 3,
          lineHeight: 1,
        }}
      >
        {isToday ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: '50%',
              backgroundColor: '#D4882A',
              color: '#1C1914',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {date.getDate()}
          </span>
        ) : (
          date.getDate()
        )}
      </div>

      {/* Event pills */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visible.map((ev) => {
          const isStarred = starred.has(ev.id);
          return (
            <button
              key={ev.id}
              onClick={() => onEventClick(ev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 5px',
                borderRadius: 4,
                border: '1px solid',
                fontSize: 10,
                lineHeight: 1.4,
                textAlign: 'left',
                cursor: 'pointer',
                width: '100%',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                ...pillStyle(ev, isStarred),
                color: '#E8DDD0',
              }}
              title={ev.title}
            >
              {isStarred && (
                <Star style={{ width: 8, height: 8, fill: '#D4882A', color: '#D4882A', flexShrink: 0 }} />
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ev.title}
              </span>
            </button>
          );
        })}

        {!expanded && hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(true)}
            style={{
              fontSize: 10,
              color: '#D4882A',
              background: 'none',
              border: 'none',
              padding: '1px 5px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            +{hiddenCount} more
          </button>
        )}
        {expanded && hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(false)}
            style={{
              fontSize: 10,
              color: '#9ca3af',
              background: 'none',
              border: 'none',
              padding: '1px 5px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

// ── Event Detail Modal ────────────────────────────────────────────────────────

function EventModal({ event, starred, onClose, onToggleStar, onRsvp }) {
  const isStarred = starred.has(event.id);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [currentRsvp, setCurrentRsvp] = useState(event.my_rsvp);

  async function handleRsvp(status) {
    setRsvpLoading(true);
    try {
      const newStatus = currentRsvp === status ? null : status;
      await api.rsvpEvent(event.id, newStatus);
      setCurrentRsvp(newStatus);
      if (onRsvp) onRsvp(event.id, newStatus);
    } catch (e) {
      console.error(e);
    } finally {
      setRsvpLoading(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#262018',
          border: '1px solid #453C2E',
          borderRadius: 12,
          maxWidth: 480,
          width: '100%',
          padding: 24,
          position: 'relative',
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#9ca3af',
            padding: 4,
          }}
        >
          <X style={{ width: 18, height: 18 }} />
        </button>

        {/* Star toggle */}
        <button
          onClick={() => onToggleStar(event.id)}
          style={{
            position: 'absolute',
            top: 12,
            right: 42,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
          }}
          title={isStarred ? 'Unstar event' : 'Star event'}
        >
          <Star
            style={{
              width: 18,
              height: 18,
              fill: isStarred ? '#D4882A' : 'none',
              color: isStarred ? '#D4882A' : '#9ca3af',
            }}
          />
        </button>

        {/* Title */}
        <h2
          style={{
            color: '#E8DDD0',
            fontSize: 20,
            fontWeight: 700,
            marginBottom: 4,
            paddingRight: 60,
            lineHeight: 1.3,
          }}
        >
          {event.title}
        </h2>

        {/* Store */}
        <Link
          to={`/stores/${event.store_id}`}
          onClick={onClose}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            color: '#D4882A',
            fontSize: 14,
            textDecoration: 'none',
            marginBottom: 16,
          }}
        >
          <MapPin style={{ width: 14, height: 14 }} />
          {event.store_name}
        </Link>

        {/* Date/time */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#b5a898',
            fontSize: 14,
            marginBottom: 12,
          }}
        >
          <Clock style={{ width: 14, height: 14, flexShrink: 0 }} />
          {formatEventTime(event.event_date)}
        </div>

        {/* Attendance counts */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginBottom: 16,
            fontSize: 13,
            color: '#b5a898',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Users style={{ width: 13, height: 13 }} />
            <strong style={{ color: '#E8DDD0' }}>{event.going_count ?? 0}</strong> going
          </span>
          <span>
            <strong style={{ color: '#E8DDD0' }}>{event.maybe_count ?? 0}</strong> maybe
          </span>
        </div>

        {/* Description */}
        {event.description && (
          <p
            style={{
              color: '#c9bfb3',
              fontSize: 14,
              lineHeight: 1.6,
              marginBottom: 20,
              borderTop: '1px solid #453C2E',
              paddingTop: 12,
            }}
          >
            {event.description}
          </p>
        )}

        {/* RSVP buttons */}
        <div
          style={{
            borderTop: '1px solid #453C2E',
            paddingTop: 16,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <span style={{ color: '#b5a898', fontSize: 13, marginRight: 4 }}>RSVP:</span>
          {['going', 'maybe'].map((status) => (
            <button
              key={status}
              disabled={rsvpLoading}
              onClick={() => handleRsvp(status)}
              style={{
                padding: '6px 16px',
                borderRadius: 8,
                border: '1px solid',
                fontSize: 13,
                fontWeight: 600,
                cursor: rsvpLoading ? 'wait' : 'pointer',
                transition: 'all 0.15s',
                ...(currentRsvp === status
                  ? {
                      backgroundColor: status === 'going' ? '#166534' : '#1e3a5f',
                      borderColor: status === 'going' ? '#16a34a' : '#3b82f6',
                      color: '#fff',
                    }
                  : {
                      backgroundColor: 'transparent',
                      borderColor: '#453C2E',
                      color: '#b5a898',
                    }),
              }}
            >
              {status === 'going' ? 'Going' : 'Maybe'}
            </button>
          ))}
          {currentRsvp && (
            <button
              disabled={rsvpLoading}
              onClick={() => handleRsvp(null)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid #453C2E',
                fontSize: 12,
                cursor: rsvpLoading ? 'wait' : 'pointer',
                backgroundColor: 'transparent',
                color: '#9ca3af',
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function EventCalendar() {
  const { user, loading: authLoading } = useAuth();
  const today = new Date();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // event object for modal
  const [starred, setStarred] = useState(loadStarred);

  // Map: "YYYY-MM-DD" -> event[]
  const eventsByDay = {};
  for (const ev of events) {
    const key = eventDateKey(ev.event_date);
    if (!key) continue;
    if (!eventsByDay[key]) eventsByDay[key] = [];
    eventsByDay[key].push(ev);
  }

  const fetchEvents = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getCalendarEvents();
      setEvents(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function toggleStar(id) {
    setStarred(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveStarred(next);
      return next;
    });
  }

  function handleRsvpUpdate(eventId, newStatus) {
    setEvents(prev =>
      prev.map(ev => ev.id === eventId ? { ...ev, my_rsvp: newStatus } : ev)
    );
    if (selected && selected.id === eventId) {
      setSelected(ev => ({ ...ev, my_rsvp: newStatus }));
    }
  }

  // ── Not logged in ──
  if (!authLoading && !user) {
    return (
      <div
        style={{
          minHeight: '70vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1C1914',
        }}
      >
        <div style={{ textAlign: 'center', padding: 32 }}>
          <CalendarDays style={{ width: 48, height: 48, color: '#453C2E', margin: '0 auto 16px' }} />
          <h2 style={{ color: '#E8DDD0', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Sign in to see your Event Calendar
          </h2>
          <p style={{ color: '#b5a898', fontSize: 15, marginBottom: 24 }}>
            Follow stores to get their events on your personal calendar.
          </p>
          <Link
            to="/login"
            style={{
              display: 'inline-block',
              padding: '10px 28px',
              backgroundColor: '#D4882A',
              color: '#1C1914',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 15,
              textDecoration: 'none',
            }}
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  const grid = buildGrid(year, month);

  // Count events in the visible month for the summary bar
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEventCount = events.filter(ev => (ev.event_date || '').startsWith(monthKey)).length;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#1C1914',
        padding: '24px 16px',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <h1
            style={{
              color: '#E8DDD0',
              fontSize: 26,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 4,
            }}
          >
            <CalendarDays style={{ width: 26, height: 26, color: '#D4882A' }} />
            Event Calendar
          </h1>
          <p style={{ color: '#b5a898', fontSize: 14 }}>
            Events from stores you follow + your RSVPs
          </p>
        </div>

        {/* Month navigation */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            backgroundColor: '#262018',
            border: '1px solid #453C2E',
            borderRadius: 10,
            padding: '10px 16px',
          }}
        >
          <button
            onClick={prevMonth}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#b5a898',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronLeft style={{ width: 20, height: 20 }} />
          </button>

          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#E8DDD0', fontSize: 18, fontWeight: 700 }}>
              {MONTH_NAMES[month]} {year}
            </div>
            <div style={{ color: '#b5a898', fontSize: 12 }}>
              {loading
                ? 'Loading…'
                : `${monthEventCount} event${monthEventCount !== 1 ? 's' : ''} this month`}
            </div>
          </div>

          <button
            onClick={nextMonth}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#b5a898',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronRight style={{ width: 20, height: 20 }} />
          </button>
        </div>

        {/* Legend */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginBottom: 12,
            flexWrap: 'wrap',
            fontSize: 12,
            color: '#b5a898',
          }}
        >
          {[
            { color: '#D4882A', label: 'Starred' },
            { color: '#16a34a', label: 'Going' },
            { color: '#3b82f6', label: 'Maybe' },
            { color: '#453C2E', label: 'Event' },
          ].map(({ color, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  backgroundColor: color,
                }}
              />
              {label}
            </span>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              backgroundColor: '#3b1a1a',
              border: '1px solid #7f1d1d',
              borderRadius: 8,
              padding: '10px 16px',
              color: '#fca5a5',
              fontSize: 14,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {/* Calendar grid */}
        <div
          style={{
            border: '1px solid #453C2E',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          {/* Day-of-week headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              backgroundColor: '#262018',
              borderBottom: '1px solid #453C2E',
            }}
          >
            {DAY_LABELS.map((d) => (
              <div
                key={d}
                style={{
                  padding: '8px 4px',
                  textAlign: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#b5a898',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Grid cells */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
            }}
          >
            {grid.map((date, i) => {
              const key = toDateKey(date);
              const dayEvents = eventsByDay[key] || [];
              return (
                <DayCell
                  key={i}
                  date={date}
                  currentMonth={month}
                  events={dayEvents}
                  starred={starred}
                  today={today}
                  onEventClick={setSelected}
                />
              );
            })}
          </div>
        </div>

        {/* Empty state */}
        {!loading && events.length === 0 && (
          <div
            style={{
              marginTop: 24,
              textAlign: 'center',
              padding: '32px 16px',
              backgroundColor: '#262018',
              border: '1px solid #453C2E',
              borderRadius: 10,
            }}
          >
            <CalendarDays style={{ width: 36, height: 36, color: '#453C2E', margin: '0 auto 12px' }} />
            <p style={{ color: '#b5a898', fontSize: 15, marginBottom: 8 }}>No events yet</p>
            <p style={{ color: '#6b5e4e', fontSize: 13 }}>
              Follow stores and turn on community notifications to see their events here.
            </p>
            <Link
              to="/stores"
              style={{
                display: 'inline-block',
                marginTop: 16,
                padding: '8px 20px',
                backgroundColor: '#D4882A',
                color: '#1C1914',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 13,
                textDecoration: 'none',
              }}
            >
              Browse Stores
            </Link>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#b5a898', fontSize: 14 }}>
            Loading events…
          </div>
        )}
      </div>

      {/* Event Detail Modal */}
      {selected && (
        <EventModal
          event={selected}
          starred={starred}
          onClose={() => setSelected(null)}
          onToggleStar={toggleStar}
          onRsvp={handleRsvpUpdate}
        />
      )}
    </div>
  );
}
