import { useState, useEffect } from 'react';
import { Download, X, Share, Plus } from 'lucide-react';

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null);     // Android/desktop beforeinstallprompt
  const [showIOS, setShowIOS] = useState(false);  // iOS manual instructions
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  useEffect(() => {
    // Already installed or dismissed this session
    if (isInStandaloneMode) { setInstalled(true); return; }
    if (sessionStorage.getItem('install_dismissed')) { setDismissed(true); return; }

    // Android/Chrome — catch beforeinstallprompt
    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS — show manual instructions after a delay
    if (isIOS && !isInStandaloneMode) {
      const timer = setTimeout(() => setShowIOS(true), 3000);
      return () => { clearTimeout(timer); window.removeEventListener('beforeinstallprompt', handler); };
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function dismiss() {
    setDismissed(true);
    setShowIOS(false);
    setPrompt(null);
    sessionStorage.setItem('install_dismissed', '1');
  }

  async function installAndroid() {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  }

  if (installed || dismissed || (!prompt && !showIOS)) return null;

  // Android / Desktop install banner
  if (prompt) {
    return (
      <div className="fixed bottom-20 md:bottom-6 left-4 right-4 z-50 max-w-sm mx-auto">
        <div className="bg-stone-900 border border-amber-800/50 rounded-2xl p-4 shadow-2xl flex items-center gap-3">
          <img src="/icons/icon-72.png" alt="CigarBuddy" className="w-12 h-12 rounded-xl flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-stone-100 text-sm">Add CigarBuddy to your home screen</p>
            <p className="text-xs text-stone-500 mt-0.5">Works like a native app, offline too</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <button onClick={installAndroid} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
              <Download className="w-3.5 h-3.5" /> Install
            </button>
            <button onClick={dismiss} className="text-xs text-stone-600 hover:text-stone-400 text-center">Not now</button>
          </div>
        </div>
      </div>
    );
  }

  // iOS instructions
  if (showIOS) {
    return (
      <div className="fixed bottom-20 left-4 right-4 z-50 max-w-sm mx-auto">
        <div className="bg-stone-900 border border-amber-800/50 rounded-2xl p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <img src="/icons/icon-72.png" alt="CigarBuddy" className="w-10 h-10 rounded-xl flex-shrink-0" />
              <div>
                <p className="font-semibold text-stone-100 text-sm">Install CigarBuddy</p>
                <p className="text-xs text-stone-500">Add to your home screen</p>
              </div>
            </div>
            <button onClick={dismiss} className="text-stone-600 hover:text-stone-400 p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col gap-2 text-sm text-stone-300">
            <div className="flex items-center gap-2.5 bg-stone-800/50 rounded-xl p-2.5">
              <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Share className="w-4 h-4 text-white" />
              </div>
              <span className="text-xs">Tap the <span className="text-blue-400 font-medium">Share</span> button in Safari</span>
            </div>
            <div className="flex items-center gap-2.5 bg-stone-800/50 rounded-xl p-2.5">
              <div className="w-7 h-7 bg-stone-700 rounded-lg flex items-center justify-center flex-shrink-0">
                <Plus className="w-4 h-4 text-stone-300" />
              </div>
              <span className="text-xs">Tap <span className="text-stone-200 font-medium">Add to Home Screen</span></span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
