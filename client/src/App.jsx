import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
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
import InstallPrompt from './components/InstallPrompt';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Spinner() {
  return <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />;
}

function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 pb-16 md:pb-0">
        <Routes>
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
          <Route path="/admin" element={<RequireAuth><AdminPanel /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <BottomNav />
      <InstallPrompt />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </BrowserRouter>
  );
}
