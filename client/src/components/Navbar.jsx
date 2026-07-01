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
  const isStaff = user?.account_type === 'admin' || user?.account_type === 'staff';
  const dashPath = isStore ? '/store-dashboard' : '/dashboard';

  return (
    <>
      <nav className="sticky top-0 z-50" style={{backgroundColor: '#201C16'}}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-1.5 flex-shrink-0 mr-1">
            <Flame className="w-5 h-5 text-amber-400" />
            <span className="font-serif font-bold text-lg text-amber-300 tracking-wide">CigarBuddy</span>
          </Link>

          {/* Search */}
          <div className="flex-1 max-w-md hidden sm:block">
            <SearchAutocomplete />
          </div>

          <div className="flex-1 md:flex-none" />

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            <Link to="/stores" className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${location.pathname.startsWith('/stores') ? 'text-amber-300' : 'text-blue-200 hover:text-white hover:bg-white/10'}`}>Stores</Link>
            <Link to="/deals" className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${location.pathname === '/deals' ? 'text-amber-300' : 'text-blue-200 hover:text-white hover:bg-white/10'}`}>Deals</Link>
            {user ? (
              <>
                <Link to={dashPath} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${location.pathname === dashPath ? 'text-amber-300' : 'text-blue-200 hover:text-white hover:bg-white/10'}`}>
                  {isStore ? <Store className="w-4 h-4" /> : <LayoutDashboard className="w-4 h-4" />}
                  {isStore ? 'My Store' : 'My Humidor'}
                </Link>
                {isStaff && (
                  <Link to="/admin" className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${location.pathname === '/admin' ? 'text-amber-300' : 'text-blue-200 hover:text-white hover:bg-white/10'}`}>Staff Panel</Link>
                )}
                {!isStore && !isStaff && (
                  <button onClick={() => setNotifOpen(o => !o)} className={`relative p-2 rounded-lg transition-colors ${notifOpen ? 'text-amber-300' : 'text-blue-200 hover:text-white hover:bg-white/10'}`}>
                    <Bell className="w-5 h-5" />
                    {notifCount > 0 && (
                      <span className="absolute top-1 right-1 w-4 h-4 bg-amber-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                        {notifCount > 9 ? '9+' : notifCount}
                      </span>
                    )}
                  </button>
                )}
                <button onClick={handleLogout} className="p-2 rounded-lg text-blue-300 hover:text-red-300 hover:bg-white/10 transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="px-3 py-2 rounded-lg text-sm font-medium text-blue-200 hover:text-white hover:bg-white/10 transition-colors">Sign In</Link>
                <Link to="/register" className="btn-primary text-sm py-2 px-4">Join Free</Link>
              </>
            )}
          </div>

          {/* Mobile: bell + menu */}
          <div className="flex md:hidden items-center gap-1">
            {user && !isStore && (
              <button onClick={() => setNotifOpen(o => !o)} className="relative p-2 rounded-lg text-blue-200 hover:text-white hover:bg-white/10 transition-colors">
                <Bell className="w-5 h-5" />
                {notifCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-amber-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                    {notifCount > 9 ? '9+' : notifCount}
                  </span>
                )}
              </button>
            )}
            <button className="p-2 rounded-lg text-blue-200 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-white/10" style={{backgroundColor: '#1A1612'}}>
            <div className="p-4 border-b border-white/10">
              <SearchAutocomplete onSubmit={() => setMenuOpen(false)} />
            </div>
            <div className="p-2 flex flex-col gap-1">
              <Link to="/stores" onClick={() => setMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-blue-200 hover:text-white hover:bg-white/10 transition-colors">Stores</Link>
              <Link to="/deals" onClick={() => setMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-blue-200 hover:text-white hover:bg-white/10 transition-colors">Deals</Link>
              {user ? (
                <>
                  <Link to={dashPath} onClick={() => setMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-blue-200 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2">
                    {isStore ? <Store className="w-4 h-4" /> : <LayoutDashboard className="w-4 h-4" />}
                    {isStore ? 'My Store' : 'My Humidor'}
                  </Link>
                  <button onClick={handleLogout} className="px-4 py-3 rounded-lg text-sm font-medium text-red-300 hover:bg-white/10 transition-colors text-left flex items-center gap-2">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </>
              ) : (
                <div className="flex gap-2 p-2">
                  <Link to="/login" onClick={() => setMenuOpen(false)} className="flex-1 text-center px-4 py-3 rounded-lg text-sm font-medium text-blue-200 border border-white/20 hover:bg-white/10 transition-colors">Sign In</Link>
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
