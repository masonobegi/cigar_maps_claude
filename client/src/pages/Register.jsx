import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Flame, User, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const [form, setForm] = useState({ email: '', password: '', name: '', account_type: 'user' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await register(form.email, form.password, form.name, form.account_type);
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
          <h1 className="text-xl font-bold text-stone-100">Create your account</h1>
          <p className="text-stone-500 text-sm mt-1">Join the community of premium cigar enthusiasts</p>
        </div>

        <div className="card p-6">
          {/* Account type selector */}
          <div className="grid grid-cols-2 gap-2 mb-5 p-1 bg-stone-800/50 rounded-xl">
            {[
              { type: 'user', label: 'Enthusiast', icon: User, desc: 'Track & discover' },
              { type: 'store', label: 'Retailer', icon: Store, desc: 'Sell & promote' },
            ].map(({ type, label, icon: Icon, desc }) => (
              <button
                key={type}
                type="button"
                onClick={() => set('account_type', type)}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg transition-all ${
                  form.account_type === type
                    ? 'bg-amber-600 text-white shadow-lg'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-sm font-semibold">{label}</span>
                <span className={`text-[10px] ${form.account_type === type ? 'text-amber-100' : 'text-stone-600'}`}>{desc}</span>
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800/50 text-red-400 text-sm rounded-lg p-3 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">
                {form.account_type === 'store' ? 'Your Name' : 'Full Name'}
              </label>
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder={form.account_type === 'store' ? 'Jane Smith' : 'Marcus Rivera'}
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="you@example.com"
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="At least 6 characters"
                className="input"
                required
                minLength={6}
              />
            </div>

            {form.account_type === 'store' && (
              <div className="bg-amber-900/20 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-400">
                After registering, you'll set up your store profile including location, hours, and inventory.
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary mt-1">
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-stone-800 text-center">
            <p className="text-sm text-stone-500">
              Already have an account?{' '}
              <Link to="/login" className="text-amber-400 hover:text-amber-300">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
