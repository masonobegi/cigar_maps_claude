import { Link, useLocation } from 'react-router-dom';
import { Home, Search, Store, BookMarked, LayoutDashboard } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

export default function BottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const path = location.pathname;
  const [notifCount, setNotifCount] = useState(0);

  useEffect(() => {
    if (!user || user.account_type === 'store') return;
    api.getNotificationCount().then(d => setNotifCount(d.count)).catch(() => {});
    const iv = setInterval(() => api.getNotificationCount().then(d => setNotifCount(d.count)).catch(() => {}), 30000);
    return () => clearInterval(iv);
  }, [user]);

  const isStore = user?.account_type === 'store';

  const items = [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/search', icon: Search, label: 'Search' },
    { to: '/stores', icon: Store, label: 'Stores' },
    {
      to: user && !isStore ? '/passport' : user ? '/store-dashboard' : '/login',
      icon: BookMarked,
      label: isStore ? 'My Store' : 'Passport',
    },
    {
      to: user ? '/dashboard' : '/login',
      icon: LayoutDashboard,
      label: 'Humidor',
    },
  ].filter(item => !(isStore && item.label === 'Humidor'));

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-stone-950/98 backdrop-blur border-t border-stone-800"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex">
        {items.map(({ to, icon: Icon, label }) => {
          const active = path === to || (to !== '/' && path.startsWith(to));
          const showBadge = label === 'Humidor' && notifCount > 0;
          return (
            <Link key={to} to={to}
              className={`flex-1 flex flex-col items-center justify-center pt-2 pb-2 gap-0.5 min-h-[52px] transition-colors relative ${active ? 'text-amber-400' : 'text-stone-500'}`}>
              <div className="relative">
                <Icon className="w-5 h-5" />
                {showBadge && (
                  <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 bg-amber-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center">
                    {notifCount > 9 ? '9+' : notifCount}
                  </span>
                )}
              </div>
              <span className="text-[9px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
