import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Flame, CheckCircle, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const uid = searchParams.get('uid');
  const token = searchParams.get('token');
  const { user, refreshMe } = useAuth();
  const [state, setState] = useState('working');
  const [error, setError] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;      // StrictMode mounts twice in development
    ran.current = true;
    if (!uid || !token) { setState('bad'); setError('This link is missing information.'); return; }
    api.verifyEmail({ uid, token })
      .then(() => { setState('ok'); if (user) refreshMe().catch(() => {}); })
      .catch(err => { setState('bad'); setError(err.message); });
  }, []);

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Flame className="w-6 h-6 text-amber-500" />
            <span className="font-serif text-xl font-bold text-stone-100">CigarBuddy</span>
          </div>
        </div>

        <div className="card p-6 text-center">
          {state === 'working' && (
            <>
              <div className="w-8 h-8 mx-auto mb-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-stone-400 text-sm">Confirming your email...</p>
            </>
          )}
          {state === 'ok' && (
            <>
              <CheckCircle className="w-8 h-8 mx-auto mb-3 text-emerald-400" />
              <p className="text-stone-200 font-medium mb-1">Email confirmed</p>
              <p className="text-stone-500 text-sm mb-5">You will get in-stock alerts and claim updates at this address.</p>
              <Link to={user?.account_type === 'store' ? '/store-dashboard' : '/dashboard'} className="btn-primary inline-block">
                Go to your dashboard
              </Link>
            </>
          )}
          {state === 'bad' && (
            <>
              <AlertCircle className="w-8 h-8 mx-auto mb-3 text-amber-500" />
              <p className="text-stone-200 font-medium mb-1">We could not confirm that link</p>
              <p className="text-stone-500 text-sm mb-5">{error} Sign in and send yourself a fresh one.</p>
              <Link to="/login" className="btn-secondary inline-block">Sign in</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
