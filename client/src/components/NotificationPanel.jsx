import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bell, X, Check, CheckCheck, Store, Tag, Megaphone, Star, Package } from 'lucide-react';
import { api } from '../services/api';

const TYPE_CONFIG = {
  announcement: { icon: Megaphone, color: 'text-amber-400', bg: 'bg-amber-900/30' },
  deal:         { icon: Tag,       color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
  new_arrival:  { icon: Package,   color: 'text-blue-400',    bg: 'bg-blue-900/30' },
  event:        { icon: Star,      color: 'text-purple-400',  bg: 'bg-purple-900/30' },
};

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationPanel({ open, onClose, onCountChange }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.getNotifications().then(n => {
      setNotifications(n);
      onCountChange(n.filter(x => !x.is_read).length);
    }).finally(() => setLoading(false));
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  async function markRead(id) {
    await api.markNotificationRead(id);
    setNotifications(ns => ns.map(n => n.id === id ? { ...n, is_read: 1 } : n));
    onCountChange(prev => Math.max(0, prev - 1));
  }

  async function markAll() {
    await api.markAllNotificationsRead();
    setNotifications(ns => ns.map(n => ({ ...n, is_read: 1 })));
    onCountChange(0);
  }

  const unread = notifications.filter(n => !n.is_read).length;

  return (
    <>
      {/* Backdrop (mobile) */}
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} />}

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed top-14 right-0 md:right-4 z-50 w-full md:w-96 max-h-[80vh] flex flex-col bg-stone-900 border-b md:border border-stone-700 md:rounded-xl shadow-2xl transition-all duration-200 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-800">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-500" />
            <span className="font-semibold text-stone-100">Notifications</span>
            {unread > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {unread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <button onClick={markAll} className="btn-ghost text-xs flex items-center gap-1 py-1.5">
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
            <button onClick={onClose} className="btn-ghost p-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex flex-col gap-2 p-3">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-stone-800 rounded-lg animate-pulse" />)}
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Bell className="w-8 h-8 text-stone-700 mx-auto mb-2" />
              <p className="text-stone-400 font-medium text-sm">No notifications yet</p>
              <p className="text-stone-600 text-xs mt-1">Follow stores to get updates on deals, new arrivals, and events.</p>
              <Link to="/stores" onClick={onClose} className="btn-primary text-xs py-1.5 px-4 mt-4 inline-flex">
                Browse Stores
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-stone-800/50">
              {notifications.map(n => {
                const { icon: Icon, color, bg } = TYPE_CONFIG[n.type] || TYPE_CONFIG.announcement;
                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 p-4 transition-colors ${!n.is_read ? 'bg-amber-950/10' : ''} hover:bg-stone-800/50`}
                  >
                    <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-amber-500/80 truncate">{n.store_name}</p>
                          <p className={`text-sm font-medium leading-tight mt-0.5 ${!n.is_read ? 'text-stone-100' : 'text-stone-300'}`}>
                            {n.title}
                          </p>
                        </div>
                        {!n.is_read && (
                          <button onClick={() => markRead(n.id)} className="flex-shrink-0 p-1 hover:bg-stone-700 rounded-lg text-stone-600 hover:text-amber-400 transition-colors">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-stone-500 mt-1 line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-stone-600">{timeAgo(n.created_at)}</span>
                        {n.store_id && (
                          <Link
                            to={`/stores/${n.store_id}`}
                            onClick={onClose}
                            className="text-[10px] text-amber-600 hover:text-amber-400 flex items-center gap-0.5"
                          >
                            <Store className="w-2.5 h-2.5" /> View store
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
