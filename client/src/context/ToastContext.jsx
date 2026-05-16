import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = {
  success: <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />,
  error:   <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />,
  info:    <Info className="w-4 h-4 text-amber-400 flex-shrink-0" />,
};

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'success', duration = 3500) => {
    const id = ++nextId;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
    return id;
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast stack — above bottom nav, below modals */}
      <div className="fixed bottom-[72px] md:bottom-6 left-0 right-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className="pointer-events-auto w-full max-w-sm bg-stone-800 border border-stone-700 text-stone-100 text-sm px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 sheet-enter">
            {ICONS[t.type]}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-stone-500 hover:text-stone-300 p-1 -mr-1">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
