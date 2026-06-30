import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Filter, X, MapPin, DollarSign, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import { api } from '../services/api';
import CigarCard from '../components/CigarCard';

const NAVY  = '#DCE5F0';
const MUTED = '#7B8C9C';
const LABEL = '#96A8B8';
const AMBER = '#D4882A';

const STRENGTHS = ['mild', 'mild-medium', 'medium', 'medium-full', 'full'];
const SORTS = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'newest', label: 'Newest' },
];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ strengths: [], countries: [] });
  const [cities, setCities] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  // Read from URL
  const q = params.get('q') || '';
  const strength = params.get('strength') || '';
  const country = params.get('country') || '';
  const city = params.get('city') || '';
  const min_price = params.get('min_price') || '';
  const max_price = params.get('max_price') || '';
  const in_stock_only = params.get('in_stock_only') || '';
  const sort = params.get('sort') || 'popular';
  const page = parseInt(params.get('page') || '1');

  // Local form state
  const [localQ, setLocalQ] = useState(q);
  const [localCity, setLocalCity] = useState(city);
  const [localMinPrice, setLocalMinPrice] = useState(min_price);
  const [localMaxPrice, setLocalMaxPrice] = useState(max_price);

  useEffect(() => { api.getFilters().then(setFilterOptions); api.getStoreCities().then(setCities); }, []);

  useEffect(() => {
    setLoading(true);
    const p = { limit: 24, page, sort };
    if (q) p.q = q;
    if (strength) p.strength = strength;
    if (country) p.country = country;
    if (city) p.city = city;
    if (min_price) p.min_price = min_price;
    if (max_price) p.max_price = max_price;
    if (in_stock_only) p.in_stock_only = '1';

    api.searchCigars(p)
      .then(d => { setResults(d.cigars); setTotal(d.total); })
      .finally(() => setLoading(false));
  }, [q, strength, country, city, min_price, max_price, in_stock_only, sort, page]);

  function updateParam(key, val) {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val); else next.delete(key);
    next.delete('page');
    setParams(next);
  }

  function applySearch(e) {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (localQ.trim()) next.set('q', localQ.trim()); else next.delete('q');
    if (localCity.trim()) next.set('city', localCity.trim()); else next.delete('city');
    if (localMinPrice) next.set('min_price', localMinPrice); else next.delete('min_price');
    if (localMaxPrice) next.set('max_price', localMaxPrice); else next.delete('max_price');
    next.delete('page');
    setParams(next);
  }

  function clearAll() {
    setLocalQ(''); setLocalCity(''); setLocalMinPrice(''); setLocalMaxPrice('');
    setParams({});
  }

  const activeFilters = [
    q && { key: 'q', label: `"${q}"`, clear: () => { setLocalQ(''); updateParam('q', ''); } },
    strength && { key: 'strength', label: strength, clear: () => updateParam('strength', '') },
    country && { key: 'country', label: country, clear: () => updateParam('country', '') },
    city && { key: 'city', label: `📍 ${city}`, clear: () => { setLocalCity(''); updateParam('city', ''); } },
    min_price && { key: 'min_price', label: `$${min_price}+`, clear: () => { setLocalMinPrice(''); updateParam('min_price', ''); } },
    max_price && { key: 'max_price', label: `Up to $${max_price}`, clear: () => { setLocalMaxPrice(''); updateParam('max_price', ''); } },
    in_stock_only && { key: 'in_stock_only', label: 'In Stock', clear: () => updateParam('in_stock_only', '') },
  ].filter(Boolean);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Search bar */}
      <form onSubmit={applySearch} className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{color: MUTED}} />
          <input value={localQ} onChange={e => setLocalQ(e.target.value)} placeholder="Search cigars, brands, flavors..." className="input pl-12 py-3 text-base" />
        </div>
        <div className="relative sm:w-44">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{color: MUTED}} />
          <input
            value={localCity}
            onChange={e => setLocalCity(e.target.value)}
            placeholder="City"
            className="input pl-9 py-3"
            list="city-suggestions"
          />
          <datalist id="city-suggestions">
            {cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}
          </datalist>
        </div>
        <button type="submit" className="btn-primary px-6">Search</button>
        <button type="button" onClick={() => setShowFilters(!showFilters)}
          className="btn-secondary flex items-center gap-2"
          style={activeFilters.length > 0 ? {borderColor: AMBER, color: AMBER} : {}}>
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilters.length > 0 && (
            <span className="text-white text-xs rounded-full w-4 h-4 flex items-center justify-center"
              style={{backgroundColor: AMBER}}>{activeFilters.length}</span>
          )}
        </button>
      </form>

      {/* Filters panel */}
      {showFilters && (
        <div className="card p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Strength */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{color: LABEL}}>Strength</label>
            <div className="flex flex-col gap-1.5">
              {STRENGTHS.map(s => (
                <label key={s} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="strength" checked={strength === s} onChange={() => updateParam('strength', strength === s ? '' : s)} className="accent-amber-700" />
                  <span className="text-sm capitalize" style={{color: NAVY}}>{s}</span>
                </label>
              ))}
              {strength && (
                <button onClick={() => updateParam('strength', '')} className="text-xs text-left mt-1 transition-colors"
                  style={{color: MUTED}}
                  onMouseEnter={e => e.currentTarget.style.color = AMBER}
                  onMouseLeave={e => e.currentTarget.style.color = MUTED}>Clear</button>
              )}
            </div>
          </div>

          {/* Origin */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{color: LABEL}}>Origin Country</label>
            <select value={country} onChange={e => updateParam('country', e.target.value)} className="input py-2 text-sm">
              <option value="">All Countries</option>
              {filterOptions.countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Price range */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{color: LABEL}}>Price Range</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{color: MUTED}} />
                <input type="number" placeholder="Min" value={localMinPrice} onChange={e => setLocalMinPrice(e.target.value)} className="input pl-7 py-2 text-sm" min="0" />
              </div>
              <span style={{color: MUTED}}>–</span>
              <div className="relative flex-1">
                <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{color: MUTED}} />
                <input type="number" placeholder="Max" value={localMaxPrice} onChange={e => setLocalMaxPrice(e.target.value)} className="input pl-7 py-2 text-sm" min="0" />
              </div>
            </div>
            <button onClick={applySearch} className="text-xs mt-1.5 transition-colors"
              style={{color: AMBER}}
              onMouseEnter={e => e.currentTarget.style.color = '#6B3A07'}
              onMouseLeave={e => e.currentTarget.style.color = AMBER}>Apply price</button>
          </div>

          {/* Toggles */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{color: LABEL}}>Availability</label>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={in_stock_only === '1'} onChange={e => updateParam('in_stock_only', e.target.checked ? '1' : '')} className="accent-amber-700" />
              <span className="text-sm" style={{color: NAVY}}>In stock at stores only</span>
            </label>
            {activeFilters.length > 0 && (
              <button onClick={clearAll} className="text-xs flex items-center gap-1 mt-3 transition-colors"
                style={{color: MUTED}}
                onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                <X className="w-3 h-3" /> Clear all filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {activeFilters.length > 0 && !showFilters && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilters.map(f => (
            <span key={f.key} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full"
              style={{backgroundColor: '#253348', border: '1px solid #2B3D57', color: LABEL}}>
              {f.label}
              <button onClick={f.clear} className="ml-0.5 transition-colors"
                style={{color: MUTED}}
                onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button onClick={clearAll} className="text-xs px-2 transition-colors"
            style={{color: MUTED}}
            onMouseEnter={e => e.currentTarget.style.color = AMBER}
            onMouseLeave={e => e.currentTarget.style.color = MUTED}>Clear all</button>
        </div>
      )}

      {/* Sort + count bar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-sm" style={{color: MUTED}}>
          {loading ? 'Searching...' : `${total.toLocaleString()} cigar${total !== 1 ? 's' : ''} found${city ? ` available in ${city}` : ''}`}
        </p>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4" style={{color: MUTED}} />
          <select value={sort} onChange={e => updateParam('sort', e.target.value)} className="input py-1.5 text-sm" style={{minHeight: 0, width: 'auto'}}>
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="card h-52 skeleton" />)}
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold mb-2" style={{color: NAVY}}>No cigars found</h3>
          <p className="text-sm" style={{color: MUTED}}>Try different search terms or adjust your filters.</p>
          {city && <p className="text-sm mt-1" style={{color: MUTED}}>No stores in "{city}" carry matching cigars.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {results.map(c => <CigarCard key={c.id} cigar={c} />)}
        </div>
      )}

      {/* Pagination */}
      {total > 24 && (
        <div className="flex justify-center gap-2 mt-8">
          <button disabled={page <= 1} onClick={() => updateParam('page', page - 1)} className="btn-secondary disabled:opacity-40">Previous</button>
          <span className="flex items-center px-4 text-sm" style={{color: MUTED}}>Page {page} of {Math.ceil(total / 24)}</span>
          <button disabled={page >= Math.ceil(total / 24)} onClick={() => updateParam('page', page + 1)} className="btn-secondary disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
