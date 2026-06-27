import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Store, LayoutDashboard, Menu, X, Flame, Bell } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import NotificationPanel from './NotificationPanel';
import SearchAutocomplete from './SearchAutocomplete';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    if (!user || user.account_type === 'store') return;
    const fetchCount = () => {
      api.getNotificationCount().then(d => setNotifCount(d.count)).catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => { setNotifOpen(false); setMenuOpen(false); }, [location.pathname]);

  function handleLogout() {
    logout();
    navigate('/');
    setMenuOpen(false);
  }

  const isStore = user?.account_type === 'store';
  const dashPath = isStore ? '/store-dashboard' : '/dashboard';

  return (
    <>
      <nav className="sticky top-0 z-50 bg-stone-950/95 backdrop-blur border-b border-stone-800">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-1.5 flex-shrink-0 mr-1">
            <Flame className="w-5 h-5 text-amber-500" />
            <span className="font-serif font-bold text-lg text-amber-400 tracking-wide">CigarBuddy</span>
          </Link>

          {/* Search */}
          <div className="flex-1 max-w-md hidden sm:block">
            <SearchAutocomplete />
          </div>

          <div className="flex-1 md:flex-none" />

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            <Link to="/stores" className={`btn-ghost text-sm ${location.pathname.startsWith('/stores') ? 'text-amber-400' : ''}`}>Stores</Link>
            <Link to="/deals" className={`btn-ghost text-sm ${location.pathname === '/deals' ? 'text-amber-400' : ''}`}>Deals</Link>
            {user ? (
              <>
                <Link to={dashPath} className={`btn-ghost text-sm flex items-center gap-1.5 ${location.pathname === dashPath ? 'text-amber-400' : ''}`}>
                  {isStore ? <Store className="w-4 h-4" /> : <LayoutDashboard className="w-4 h-4" />}
                  {isStore ? 'My Store' : 'My Humidor'}
                </Link>
                {!isStore && (
                  <button
                    onClick={() => setNotifOpen(o => !o)}
                    className={`relative btn-ghost p-2 ${notifOpen ? 'text-amber-400' : ''}`}
                  >
                    <Bell className="w-5 h-5" />
                    {notifCount > 0 && (
                      <span className="absolute top-1 right-1 w-4 h-4 bg-amber-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                        {notifCount > 9 ? '9+' : notifCount}
                      </span>
                    )}
                  </button>
                )}
                <button onClick={handleLogout} className="btn-ghost p-2 text-stone-500 hover:text-red-400">
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn-ghost text-sm">Sign In</Link>
                <Link to="/register" className="btn-primary text-sm py-2 px-4">Join Free</Link>
              </>
            )}
          </div>

          {/* Mobile: bell + menu */}
          <div className="flex md:hidden items-center gap-1">
            {user && !isStore && (
              <button onClick={() => setNotifOpen(o => !o)} className="relative btn-ghost p-2">
                <Bell className="w-5 h-5" />
                {notifCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-amber-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                    {notifCount > 9 ? '9+' : notifCount}
                  </span>
                )}
              </button>
            )}
            <button className="btn-ghost p-2" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-stone-800 bg-stone-950">
            <div className="p-4 border-b border-stone-800">
              <SearchAutocomplete onSubmit={() => setMenuOpen(false)} />
            </div>
            <div className="p-2 flex flex-col gap-1">
              <Link to="/stores" onClick={() => setMenuOpen(false)} className="btn-ghost text-sm py-3">Stores</Link>
              <Link to="/deals" onClick={() => setMenuOpen(false)} className="btn-ghost text-sm py-3">Deals</Link>
              {user ? (
                <>
                  <Link to={dashPath} onClick={() => setMenuOpen(false)} className="btn-ghost text-sm py-3 flex items-center gap-2">
                    {isStore ? <Store className="w-4 h-4" /> : <LayoutDashboard className="w-4 h-4" />}
                    {isStore ? 'My Store' : 'My Humidor'}
                  </Link>
                  <button onClick={handleLogout} className="btn-ghost text-sm py-3 text-left flex items-center gap-2 text-stone-400">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </>
              ) : (
                <div className="flex gap-2 p-2">
                  <Link to="/login" onClick={() => setMenuOpen(false)} className="btn-secondary flex-1 text-center text-sm">Sign In</Link>
                  <Link to="/register" onClick={() => setMenuOpen(false)} className="btn-primary flex-1 text-center text-sm">Join Free</Link>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Notification panel */}
      <NotificationPanel
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        onCountChange={setNotifCount}
      />
    </>
  );
}
