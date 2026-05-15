import { Link, useLocation } from 'react-router-dom';
import { Home, Search, Store, Tag, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function BottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const path = location.pathname;

  const dashTo = user?.account_type === 'store' ? '/store-dashboard' : user ? '/dashboard' : '/login';
  const dashLabel = user?.account_type === 'store' ? 'My Store' : 'My Humidor';

  const items = [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/search', icon: Search, label: 'Search' },
    { to: '/stores', icon: Store, label: 'Stores' },
    { to: '/deals', icon: Tag, label: 'Deals' },
    { to: dashTo, icon: LayoutDashboard, label: dashLabel },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-stone-950/98 backdrop-blur border-t border-stone-800"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex">
        {items.map(({ to, icon: Icon, label }) => {
          const active = path === to || (to !== '/' && path.startsWith(to));
          return (
            <Link
              key={to}
              to={to}
              className={`flex-1 flex flex-col items-center justify-center pt-2 pb-2 gap-0.5 min-h-[52px] transition-colors ${
                active ? 'text-amber-400' : 'text-stone-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
