import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Flame, Store, X } from 'lucide-react';
import { api } from '../services/api';

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const STRENGTH_DOT = {
  mild: 'bg-green-400', 'mild-medium': 'bg-lime-400',
  medium: 'bg-amber-400', 'medium-full': 'bg-orange-400', full: 'bg-red-400',
};

export default function SearchAutocomplete({ placeholder = 'Search cigars, brands, cities...', className = '', onSubmit }) {
  const [val, setVal] = useState('');
  const [results, setResults] = useState({ cigars: [], stores: [] });
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // Keyboard shortcut: / focuses search
  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const search = useCallback(debounce(async (q) => {
    if (q.length < 2) { setResults({ cigars: [], stores: [] }); setLoading(false); return; }
    setLoading(true);
    try {
      const [cigarsRes, storesRes] = await Promise.all([
        api.searchCigars({ q, limit: 5, sort: 'popular' }),
        api.searchStores({ q }),
      ]);
      setResults({ cigars: cigarsRes.cigars, stores: storesRes.slice(0, 3) });
      setOpen(true);
      setHighlighted(-1);
    } catch {}
    finally { setLoading(false); }
  }, 220), []);

  useEffect(() => { search(val); }, [val]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!dropdownRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const allItems = [
    ...results.cigars.map(c => ({ type: 'cigar', ...c })),
    ...results.stores.map(s => ({ type: 'store', ...s })),
  ];

  function handleKeyDown(e) {
    if (!open || allItems.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, allItems.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)); }
    else if (e.key === 'Enter') {
      if (highlighted >= 0) {
        e.preventDefault();
        selectItem(allItems[highlighted]);
      }
    }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  }

  function selectItem(item) {
    setOpen(false);
    setVal('');
    if (item.type === 'cigar') navigate(`/cigars/${item.id}`);
    else navigate(`/stores/${item.id}`);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!val.trim()) return;
    setOpen(false);
    if (onSubmit) onSubmit(val.trim());
    else navigate(`/search?q=${encodeURIComponent(val.trim())}`);
    setVal('');
  }

  const showDropdown = open && val.length >= 2 && (allItems.length > 0 || loading);

  return (
    <div className={`relative ${className}`}>
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
          <input
            ref={inputRef}
            value={val}
            onChange={e => setVal(e.target.value)}
            onFocus={() => val.length >= 2 && setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="input pl-9 pr-8 py-2 text-sm w-full"
            autoComplete="off"
          />
          {val && (
            <button type="button" onClick={() => { setVal(''); setOpen(false); inputRef.current?.focus(); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-600 hover:text-stone-400 p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </form>

      {/* Keyboard hint */}
      {!val && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none hidden sm:flex items-center gap-1">
          <kbd className="text-[9px] text-stone-600 bg-stone-800 border border-stone-700 rounded px-1 py-0.5 font-mono">/</kbd>
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1.5 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl z-50 overflow-hidden max-h-80 overflow-y-auto">

          {loading && results.cigars.length === 0 && (
            <div className="px-4 py-3 text-xs text-stone-500 flex items-center gap-2">
              <div className="w-3 h-3 border border-amber-500 border-t-transparent rounded-full animate-spin" />
              Searching...
            </div>
          )}

          {results.cigars.length > 0 && (
            <div>
              <p className="px-3 py-1.5 text-[10px] font-semibold text-stone-600 uppercase tracking-wider">Cigars</p>
              {results.cigars.map((c, i) => {
                const idx = i;
                return (
                  <button key={c.id} onClick={() => selectItem({ type: 'cigar', ...c })}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors ${highlighted === idx ? 'bg-stone-800' : 'hover:bg-stone-800/60'}`}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STRENGTH_DOT[c.strength] || 'bg-stone-600'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-amber-500/70 font-medium uppercase tracking-wider">{c.brand}</p>
                      <p className="text-sm font-medium text-stone-200 truncate leading-tight">{c.name}</p>
                    </div>
                    {c.avg_rating > 0 && (
                      <span className="text-xs text-amber-400 font-bold flex-shrink-0">{c.avg_rating}</span>
                    )}
                    {c.store_count > 0 && (
                      <span className="text-[10px] text-stone-500 flex-shrink-0">{c.store_count} stores</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {results.stores.length > 0 && (
            <div className={results.cigars.length > 0 ? 'border-t border-stone-800' : ''}>
              <p className="px-3 py-1.5 text-[10px] font-semibold text-stone-600 uppercase tracking-wider">Stores</p>
              {results.stores.map((s, i) => {
                const idx = results.cigars.length + i;
                return (
                  <button key={s.id} onClick={() => selectItem({ type: 'store', ...s })}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors ${highlighted === idx ? 'bg-stone-800' : 'hover:bg-stone-800/60'}`}>
                    <Store className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-200 truncate">{s.name}</p>
                      <p className="text-[10px] text-stone-500">{s.city}, {s.state}</p>
                    </div>
                    {s.is_open === true && <span className="text-[10px] text-emerald-400 flex-shrink-0">Open</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Full search footer */}
          {val.trim() && (
            <button onClick={handleSubmit}
              className="w-full text-left px-3 py-2.5 text-xs text-stone-500 hover:text-amber-400 hover:bg-stone-800/60 transition-colors border-t border-stone-800 flex items-center gap-2">
              <Search className="w-3 h-3" />
              Search all results for "{val}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
