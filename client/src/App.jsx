import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import Home from './pages/Home';
import Search from './pages/Search';
import CigarDetail from './pages/CigarDetail';
import StoreProfile from './pages/StoreProfile';
import Stores from './pages/Stores';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import StoreDashboard from './pages/StoreDashboard';
import Deals from './pages/Deals';
import AdminPanel from './pages/AdminPanel';
import NotFound from './pages/NotFound';
import Passport from './pages/Passport';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import EventCalendar from './pages/EventCalendar';
import Footer from './components/Footer';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-stone-500 text-sm">Loading...</p>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <Routes location={location} key={location.pathname}>
      <Route path="/" element={<Home />} />
      <Route path="/search" element={<Search />} />
      <Route path="/cigars/:id" element={<CigarDetail />} />
      <Route path="/stores" element={<Stores />} />
      <Route path="/stores/:id" element={<StoreProfile />} />
      <Route path="/deals" element={<Deals />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/store-dashboard" element={<RequireAuth><StoreDashboard /></RequireAuth>} />
      <Route path="/passport" element={<RequireAuth><Passport /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><AdminPanel /></RequireAuth>} />
      <Route path="/calendar" element={<RequireAuth><EventCalendar /></RequireAuth>} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      {/* pb-20 ensures content clears the bottom nav on mobile; safe-area handled in CSS */}
      <main className="flex-1 pb-20 md:pb-6 page-enter">
        <AnimatedRoutes />
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppLayout />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
