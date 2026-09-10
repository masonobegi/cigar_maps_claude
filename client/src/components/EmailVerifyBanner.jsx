import { useState } from 'react';
import { Mail, X } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const KEY = 'cb_verify_banner_hidden_v1';

/**
 * Slim reminder for signed-in accounts that have not confirmed their email.
 * In-stock alerts and claim decisions are delivered by email, so an
 * unconfirmed address means the account silently misses them.
 */
export default function EmailVerifyBanner() {
  const { user } = useAuth();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
  });

  if (!user || user.email_verified || hidden) return null;

  async function send() {
    setSending(true);
    try { await api.sendVerification(); setSent(true); } catch {} finally { setSending(false); }
  }

  function dismiss() {
    setHidden(true);
    try { sessionStorage.setItem(KEY, '1'); } catch {}
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm"
      style={{ backgroundColor: '#2D1E06', borderBottom: '1px solid #4D3010', color: '#E0B15A' }}>
      <Mail className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 min-w-0">
        {sent
          ? `Confirmation link sent to ${user.email}. Check your inbox.`
          : 'Confirm your email to get in-stock alerts and claim updates.'}
      </span>
      {!sent && (
        <button onClick={send} disabled={sending}
          className="text-xs font-semibold px-3 py-1 rounded-full flex-shrink-0 disabled:opacity-50"
          style={{ backgroundColor: '#A8681A', color: '#F5EAD8' }}>
          {sending ? 'Sending...' : 'Send link'}
        </button>
      )}
      <button onClick={dismiss} className="p-1 flex-shrink-0 hover:opacity-70" aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
