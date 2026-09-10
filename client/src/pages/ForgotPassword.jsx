import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, MailCheck } from 'lucide-react';
import { api } from '../services/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
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
            <Flame className="w-6 h-6 text-amber-500" />
            <span className="font-serif text-xl font-bold text-stone-100">CigarBuddy</span>
          </div>
          <h1 className="font-serif text-2xl font-bold text-stone-100">Reset your password</h1>
          <p className="text-stone-500 text-sm mt-1">We will email you a link to choose a new one</p>
        </div>

        <div className="card p-6">
          {sent ? (
            <div className="text-center">
              <MailCheck className="w-8 h-8 mx-auto mb-3 text-emerald-400" />
              <p className="text-stone-200 font-medium mb-1">Check your email</p>
              <p className="text-stone-500 text-sm mb-5">
                If an account exists for {email}, a reset link is on its way. It works once and expires in an hour.
              </p>
              <Link to="/login" className="btn-secondary inline-block">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-medium block mb-1 text-stone-400">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" className="input" required autoFocus />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>

        {!sent && (
          <div className="mt-4 text-center">
            <Link to="/login" className="text-sm text-stone-500 hover:text-stone-300">Back to sign in</Link>
          </div>
        )}
      </div>
    </div>
  );
}
