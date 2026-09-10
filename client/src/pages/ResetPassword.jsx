import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Flame, CheckCircle } from 'lucide-react';
import { api } from '../services/api';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const uid = searchParams.get('uid');
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Those passwords do not match');
    setLoading(true);
    try {
      await api.resetPassword({ uid, token, password });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const linkBroken = !uid || !token;

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Flame className="w-6 h-6 text-amber-500" />
            <span className="font-serif text-xl font-bold text-stone-100">CigarBuddy</span>
          </div>
          <h1 className="font-serif text-2xl font-bold text-stone-100">Choose a new password</h1>
        </div>

        <div className="card p-6">
          {linkBroken ? (
            <div className="text-center">
              <p className="text-stone-300 text-sm mb-4">This reset link is missing information. Ask for a new one.</p>
              <Link to="/forgot-password" className="btn-primary inline-block">Send a new link</Link>
            </div>
          ) : done ? (
            <div className="text-center">
              <CheckCircle className="w-8 h-8 mx-auto mb-3 text-emerald-400" />
              <p className="text-stone-200 font-medium mb-1">Password updated</p>
              <p className="text-stone-500 text-sm mb-5">You can sign in with your new password now.</p>
              <Link to="/login" className="btn-primary inline-block">Sign in</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-medium block mb-1 text-stone-400">New password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  className="input" placeholder="At least 6 characters" minLength={6} required autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1 text-stone-400">Confirm password</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  className="input" placeholder="Type it again" minLength={6} required />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Saving...' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
