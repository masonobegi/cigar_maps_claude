import { useState } from 'react';
import { Flame } from 'lucide-react';

const KEY = 'cb_age_ok_v1';

function readOk() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/**
 * Tobacco products are 21+ in the US. This is an attestation gate shown once
 * per browser; declining routes the visitor away from the site.
 */
export default function AgeGate() {
  const [ok, setOk] = useState(readOk);
  const [declined, setDeclined] = useState(false);

  if (ok) return null;

  function accept() {
    try { localStorage.setItem(KEY, '1'); } catch {}
    setOk(true);
  }

  function decline() {
    setDeclined(true);
    setTimeout(() => { window.location.href = 'https://www.google.com'; }, 1500);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(12, 9, 6, 0.96)' }} role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
      <div className="w-full max-w-md rounded-2xl p-7 text-center"
        style={{ backgroundColor: '#1A1410', border: '1px solid #453C2E', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#352A18' }}>
          <Flame className="w-7 h-7" style={{ color: '#D4882A' }} />
        </div>
        <h1 id="age-gate-title" className="font-serif text-2xl font-bold mb-2" style={{ color: '#E8DDD0' }}>Are you 21 or older?</h1>
        <p className="text-sm mb-6" style={{ color: '#9E8E7E' }}>
          CigarBuddy is a directory and logbook for premium cigars. You must be of legal age to purchase tobacco in your location to continue.
        </p>
        {declined ? (
          <p className="text-sm" style={{ color: '#F87171' }}>Sorry, you must be 21 or older to use CigarBuddy.</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={accept} className="btn-primary px-6 py-3 text-sm">Yes, I am 21 or older</button>
            <button onClick={decline} className="btn-secondary px-6 py-3 text-sm">No, I am under 21</button>
          </div>
        )}
        <p className="text-[11px] mt-5" style={{ color: '#6B5F52' }}>
          CigarBuddy does not sell tobacco. Listings show what local retailers carry.
        </p>
      </div>
    </div>
  );
}
