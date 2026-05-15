import { useState } from 'react';
import { Share2, Check, Link as LinkIcon } from 'lucide-react';

export default function ShareButton({ title, text, className = '' }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {}
    }
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <button onClick={handleShare}
      className={`flex items-center gap-1.5 text-xs text-stone-500 hover:text-amber-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-stone-800 ${className}`}>
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : 'Share'}
    </button>
  );
}
