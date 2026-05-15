import { useEffect, useState } from 'react';

const KEY = 'cb_recently_viewed';
const MAX = 8;

export function useRecentlyViewed() {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  });

  function add(cigar) {
    setItems(prev => {
      const filtered = prev.filter(i => i.id !== cigar.id);
      const next = [{ id: cigar.id, brand: cigar.brand, name: cigar.name, strength: cigar.strength }, ...filtered].slice(0, MAX);
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }

  function clear() {
    localStorage.removeItem(KEY);
    setItems([]);
  }

  return { items, add, clear };
}
