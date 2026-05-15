import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Flame } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.account_type === 'store' ? '/store-dashboard' : '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Flame className="w-7 h-7 text-amber-500" />
            <span className="font-serif text-2xl font-bold text-amber-400">CigarBuddy</span>
          </div>
          <h1 className="text-xl font-bold text-stone-100">Welcome back</h1>
          <p className="text-stone-500 text-sm mt-1">Sign in to your account</p>
        </div>

        <div className="card p-6">
          {error && (
            <div className="bg-red-900/30 border border-red-800/50 text-red-400 text-sm rounded-lg p-3 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary mt-2">
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-stone-800 text-center">
            <p className="text-sm text-stone-500">
              Don't have an account?{' '}
              <Link to="/register" className="text-amber-400 hover:text-amber-300">Join CigarBuddy</Link>
            </p>
          </div>
        </div>

        <div className="mt-4 p-3 bg-stone-900/50 rounded-lg border border-stone-800 text-xs text-stone-500">
          <p className="font-medium text-stone-400 mb-1">Demo accounts:</p>
          <p>Smoker: smoker@demo.com / password123</p>
          <p>Store: store1@demo.com / password123</p>
        </div>
      </div>
    </div>
  );
}
