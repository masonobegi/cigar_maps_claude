import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Store, LayoutDashboard, Menu, X, Bell, CalendarDays } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import NotificationPanel from './NotificationPanel';
import SearchAutocomplete from './SearchAutocomplete';

function NavLink({ to, children, exact }) {
  const location = useLocation();
  const active = exact ? location.pathname === to : location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
  return (
    <Link to={to} className={`nav-link ${active ? 'nav-link-active' : ''}`}>
      {children}
    </Link>
  );
}

function MobileNavLink({ to, onClick, children }) {
  const location = useLocation();
  const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
  return (
    <Link to={to} onClick={onClick} className={`mobile-nav-link ${active ? 'mobile-nav-link-active' : ''}`}>
      {children}
    </Link>
  );
}

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
      <nav className="sticky top-0 z-50"
        style={{ backgroundColor: '#1D1912', borderBottom: '1px solid #3D3428' }}>
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center gap-3">

          {/* Logo */}
          <Link to="/" className="flex-shrink-0"
            style={{ fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 600, fontSize: '1.0625rem', color: '#C9882A', textDecoration: 'none', letterSpacing: '0.01em', lineHeight: 1 }}>
            CigarBuddy
          </Link>

          {/* Search */}
          <div className="flex-1 max-w-xs hidden sm:block">
            <SearchAutocomplete />
          </div>

          <div className="flex-1" />

          {/* Desktop nav */}
          <div className="hidden md:flex items-center">
            <NavLink to="/search" exact>Cigars</NavLink>
            <NavLink to="/stores">Stores</NavLink>
            <NavLink to="/deals" exact>Deals</NavLink>
            {user && !isStore && (
              <NavLink to="/calendar" exact>Calendar</NavLink>
            )}

            {user ? (
              <>
                <div className="mx-2 self-stretch flex items-center">
                  <div style={{ width: 1, height: 16, backgroundColor: '#3D3428' }} />
                </div>
                <NavLink to={dashPath}>
                  {isStore ? 'My Store' : 'Humidor'}
                </NavLink>
                {isStaff && <NavLink to="/admin">Staff</NavLink>}
                {!isStore && !isStaff && (
                  <button
                    onClick={() => setNotifOpen(o => !o)}
                    className={`nav-link ${notifOpen ? 'nav-link-active' : ''}`}
                    style={{ position: 'relative' }}>
                    <Bell className="w-[17px] h-[17px]" />
                    {notifCount > 0 && (
                      <span style={{
                        position: 'absolute', top: 4, right: 4,
                        width: 14, height: 14,
                        backgroundColor: '#C9882A',
                        borderRadius: '50%',
                        fontSize: 8, fontWeight: 700,
                        color: '#17130E',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {notifCount > 9 ? '9+' : notifCount}
                      </span>
                    )}
                  </button>
                )}
                <button onClick={handleLogout} className="nav-link nav-link-danger" style={{ marginLeft: 2 }}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" exact>Sign in</NavLink>
                <Link to="/register" className="btn-primary ml-2" style={{ padding: '0.4rem 0.875rem', fontSize: '0.8125rem' }}>
                  Join
                </Link>
              </>
            )}
          </div>

          {/* Mobile: bell + hamburger */}
          <div className="flex md:hidden items-center gap-0.5">
            {user && !isStore && (
              <button
                onClick={() => setNotifOpen(o => !o)}
                className={`nav-link ${notifOpen ? 'nav-link-active' : ''}`}
                style={{ position: 'relative' }}>
                <Bell className="w-5 h-5" />
                {notifCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 14, height: 14,
                    backgroundColor: '#C9882A',
                    borderRadius: '50%',
                    fontSize: 8, fontWeight: 700,
                    color: '#17130E',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {notifCount > 9 ? '9+' : notifCount}
                  </span>
                )}
              </button>
            )}
            <button className="nav-link" onClick={() => setMenuOpen(m => !m)}>
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden" style={{ backgroundColor: '#1A1711', borderTop: '1px solid #3D3428' }}>
            <div className="p-4" style={{ borderBottom: '1px solid #3D3428' }}>
              <SearchAutocomplete onSubmit={() => setMenuOpen(false)} />
            </div>
            <div className="p-3 flex flex-col gap-0.5">
              <MobileNavLink to="/search" onClick={() => setMenuOpen(false)}>Cigars</MobileNavLink>
              <MobileNavLink to="/stores" onClick={() => setMenuOpen(false)}>Stores</MobileNavLink>
              <MobileNavLink to="/deals" onClick={() => setMenuOpen(false)}>Deals</MobileNavLink>
              {user && !isStore && (
                <MobileNavLink to="/calendar" onClick={() => setMenuOpen(false)}>Calendar</MobileNavLink>
              )}
              {user ? (
                <>
                  <MobileNavLink to={dashPath} onClick={() => setMenuOpen(false)}>
                    {isStore ? 'My Store' : 'My Humidor'}
                  </MobileNavLink>
                  {isStaff && (
                    <MobileNavLink to="/admin" onClick={() => setMenuOpen(false)}>Staff Panel</MobileNavLink>
                  )}
                  <button
                    onClick={handleLogout}
                    className="mobile-nav-link text-left"
                    style={{ color: '#8A6060', marginTop: 4 }}>
                    Sign out
                  </button>
                </>
              ) : (
                <div className="flex gap-2 pt-2">
                  <Link to="/login" onClick={() => setMenuOpen(false)} className="btn-secondary flex-1 justify-center">Sign in</Link>
                  <Link to="/register" onClick={() => setMenuOpen(false)} className="btn-primary flex-1 justify-center">Join free</Link>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      <NotificationPanel
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        onCountChange={setNotifCount}
      />
    </>
  );
}
