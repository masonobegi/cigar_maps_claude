import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X, MapPin, DollarSign, SlidersHorizontal, ArrowUpDown, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../services/api';
import CigarCard from '../components/CigarCard';

const NAVY  = '#E8DDD0';
const MUTED = '#9E8E7E';
const LABEL = '#B0A090';
const AMBER = '#D4882A';

const STRENGTHS = [
  { value: 'mild', label: 'Mild' },
  { value: 'mild-medium', label: 'Mild-Medium' },
  { value: 'medium', label: 'Medium' },
  { value: 'medium-full', label: 'Medium-Full' },
  { value: 'full', label: 'Full' },
];

const SORTS = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'price_asc', label: 'Price: Low → High' },
  { value: 'price_desc', label: 'Price: High → Low' },
  { value: 'newest', label: 'Newest' },
];

const RATING_OPTIONS = [
  { value: '', label: 'Any rating' },
  { value: '90', label: '90+ (Excellent)' },
  { value: '85', label: '85+ (Very Good)' },
  { value: '80', label: '80+ (Good)' },
];

function FilterSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid #3D3428', paddingBottom: '1rem', marginBottom: '1rem' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full text-left mb-2"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: LABEL }}>{title}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5" style={{ color: MUTED }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: MUTED }} />}
      </button>
      {open && children}
    </div>
  );
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ strengths: [], countries: [], wrappers: [], brands: [] });
  const [cities, setCities] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  // URL params
  const q           = params.get('q') || '';
  const strength    = params.get('strength') || '';
  const wrapper     = params.get('wrapper') || '';
  const brand       = params.get('brand') || '';
  const country     = params.get('country') || '';
  const state       = params.get('state') || '';
  const city        = params.get('city') || '';
  const min_price   = params.get('min_price') || '';
  const max_price   = params.get('max_price') || '';
  const in_stock_only = params.get('in_stock_only') || '';
  const min_rating  = params.get('min_rating') || '';
  const sort        = params.get('sort') || 'popular';
  const page        = parseInt(params.get('page') || '1');

  // Local draft state (committed on Search press)
  const [localQ, setLocalQ] = useState(q);
  const [localCity, setLocalCity] = useState(city);
  const [localMinPrice, setLocalMinPrice] = useState(min_price);
  const [localMaxPrice, setLocalMaxPrice] = useState(max_price);

  useEffect(() => {
    api.getFilters().then(setFilterOptions);
    api.getStoreCities().then(setCities);
  }, []);

  useEffect(() => {
    setLoading(true);
    const p = { limit: 24, page, sort };
    if (q)            p.q = q;
    if (brand)        p.brand = brand;
    if (strength)     p.strength = strength;
    if (wrapper)      p.wrapper = wrapper;
    if (country)      p.country = country;
    if (state)        p.state = state;
    if (city)         p.city = city;
    if (min_price)    p.min_price = min_price;
    if (max_price)    p.max_price = max_price;
    if (in_stock_only) p.in_stock_only = '1';
    if (min_rating)   p.min_rating = min_rating;

    api.searchCigars(p)
      .then(d => { setResults(d.cigars); setTotal(d.total); })
      .finally(() => setLoading(false));
  }, [q, brand, strength, wrapper, country, state, city, min_price, max_price, in_stock_only, min_rating, sort, page]);

  function updateParam(key, val) {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  function applySearch(e) {
    if (e) e.preventDefault();
    const next = new URLSearchParams(params);
    if (localQ.trim())      next.set('q', localQ.trim());      else next.delete('q');
    if (localCity.trim())   next.set('city', localCity.trim()); else next.delete('city');
    if (localMinPrice)      next.set('min_price', localMinPrice); else next.delete('min_price');
    if (localMaxPrice)      next.set('max_price', localMaxPrice); else next.delete('max_price');
    next.delete('page');
    setParams(next);
  }

  function clearAll() {
    setLocalQ(''); setLocalCity(''); setLocalMinPrice(''); setLocalMaxPrice('');
    setParams({});
  }

  const activeFilters = [
    q          && { key: 'q',           label: `"${q}"`,         clear: () => { setLocalQ(''); updateParam('q', ''); } },
    brand      && { key: 'brand',        label: brand,            clear: () => updateParam('brand', '') },
    strength   && { key: 'strength',     label: strength,         clear: () => updateParam('strength', '') },
    wrapper    && { key: 'wrapper',      label: wrapper,          clear: () => updateParam('wrapper', '') },
    country    && { key: 'country',      label: country,          clear: () => updateParam('country', '') },
    state      && { key: 'state',        label: state,            clear: () => updateParam('state', '') },
    city       && { key: 'city',         label: `📍 ${city}`,     clear: () => { setLocalCity(''); updateParam('city', ''); } },
    min_price  && { key: 'min_price',    label: `$${min_price}+`, clear: () => { setLocalMinPrice(''); updateParam('min_price', ''); } },
    max_price  && { key: 'max_price',    label: `Up to $${max_price}`, clear: () => { setLocalMaxPrice(''); updateParam('max_price', ''); } },
    in_stock_only && { key: 'in_stock_only', label: 'In Stock',  clear: () => updateParam('in_stock_only', '') },
    min_rating && { key: 'min_rating',   label: `${min_rating}+ rated`, clear: () => updateParam('min_rating', '') },
  ].filter(Boolean);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">

      {/* Search bar */}
      <form onSubmit={applySearch} className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: MUTED }} />
          <input value={localQ} onChange={e => setLocalQ(e.target.value)}
            placeholder="Search cigars, brands, flavors..." className="input pl-12 py-3 text-base" />
        </div>
        <button type="submit" className="btn-primary px-6">Search</button>
        <button type="button" onClick={() => setShowFilters(!showFilters)}
          className="btn-secondary flex items-center gap-2"
          style={activeFilters.length > 0 ? { borderColor: AMBER, color: AMBER } : {}}>
          <SlidersHorizontal className="w-4 h-4" />
          <span>Filters</span>
          {activeFilters.length > 0 && (
            <span className="text-white text-xs rounded-full w-4 h-4 flex items-center justify-center"
              style={{ backgroundColor: AMBER }}>{activeFilters.length}</span>
          )}
        </button>
      </form>

      <div className="flex gap-6">

        {/* Sidebar filters */}
        {showFilters && (
          <aside className="w-56 flex-shrink-0 hidden sm:block">
            <div className="card p-4 sticky top-20">

              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold" style={{ color: NAVY }}>Filters</span>
                {activeFilters.length > 0 && (
                  <button onClick={clearAll} className="text-xs transition-colors" style={{ color: MUTED }}
                    onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                    onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                    Clear all
                  </button>
                )}
              </div>

              <FilterSection title="Strength">
                <div className="flex flex-col gap-1.5">
                  {STRENGTHS.map(s => (
                    <label key={s.value} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="strength" checked={strength === s.value}
                        onChange={() => updateParam('strength', strength === s.value ? '' : s.value)}
                        className="accent-amber-700" />
                      <span className="text-sm" style={{ color: NAVY }}>{s.label}</span>
                    </label>
                  ))}
                </div>
              </FilterSection>

              <FilterSection title="Wrapper">
                <select value={wrapper} onChange={e => updateParam('wrapper', e.target.value)} className="input py-1.5 text-sm">
                  <option value="">All Wrappers</option>
                  {filterOptions.wrappers.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </FilterSection>

              <FilterSection title="Brand">
                <select value={brand} onChange={e => updateParam('brand', e.target.value)} className="input py-1.5 text-sm">
                  <option value="">All Brands</option>
                  {filterOptions.brands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </FilterSection>

              <FilterSection title="Origin">
                <select value={country} onChange={e => updateParam('country', e.target.value)} className="input py-1.5 text-sm mb-2">
                  <option value="">All Countries</option>
                  {filterOptions.countries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FilterSection>

              <FilterSection title="Rating">
                <div className="flex flex-col gap-1.5">
                  {RATING_OPTIONS.map(r => (
                    <label key={r.value} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="min_rating" checked={min_rating === r.value}
                        onChange={() => updateParam('min_rating', r.value)}
                        className="accent-amber-700" />
                      <span className="text-sm flex items-center gap-1" style={{ color: NAVY }}>
                        {r.value && <Star className="w-3 h-3" style={{ color: AMBER, fill: AMBER }} />}
                        {r.label}
                      </span>
                    </label>
                  ))}
                </div>
              </FilterSection>

              <FilterSection title="Price Range">
                <div className="flex items-center gap-2 mb-2">
                  <div className="relative flex-1">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: MUTED }} />
                    <input type="number" placeholder="Min" value={localMinPrice}
                      onChange={e => setLocalMinPrice(e.target.value)} className="input pl-6 py-1.5 text-sm" min="0" />
                  </div>
                  <span style={{ color: MUTED }}>–</span>
                  <div className="relative flex-1">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: MUTED }} />
                    <input type="number" placeholder="Max" value={localMaxPrice}
                      onChange={e => setLocalMaxPrice(e.target.value)} className="input pl-6 py-1.5 text-sm" min="0" />
                  </div>
                </div>
                <button onClick={applySearch} className="text-xs transition-colors" style={{ color: AMBER }}>
                  Apply
                </button>
              </FilterSection>

              <FilterSection title="Availability" defaultOpen={true}>
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={in_stock_only === '1'}
                      onChange={e => updateParam('in_stock_only', e.target.checked ? '1' : '')}
                      className="accent-amber-700" />
                    <span className="text-sm" style={{ color: NAVY }}>In stock only</span>
                  </label>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: MUTED }}>Near city</label>
                    <div className="relative">
                      <MapPin className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: MUTED }} />
                      <input value={localCity} onChange={e => setLocalCity(e.target.value)}
                        placeholder="City name" list="city-suggestions" className="input pl-7 py-1.5 text-sm" />
                      <datalist id="city-suggestions">
                        {cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}
                      </datalist>
                    </div>
                    {localCity !== city && (
                      <button onClick={applySearch} className="text-xs mt-1 transition-colors" style={{ color: AMBER }}>
                        Apply city
                      </button>
                    )}
                  </div>
                </div>
              </FilterSection>

            </div>
          </aside>
        )}

        {/* Mobile filters drawer */}
        {showFilters && (
          <div className="sm:hidden w-full card p-4 mb-4">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: LABEL }}>Strength</label>
                <select value={strength} onChange={e => updateParam('strength', e.target.value)} className="input py-1.5 text-sm">
                  <option value="">Any Strength</option>
                  {STRENGTHS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: LABEL }}>Wrapper</label>
                <select value={wrapper} onChange={e => updateParam('wrapper', e.target.value)} className="input py-1.5 text-sm">
                  <option value="">Any Wrapper</option>
                  {filterOptions.wrappers.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: LABEL }}>Brand</label>
                <select value={brand} onChange={e => updateParam('brand', e.target.value)} className="input py-1.5 text-sm">
                  <option value="">All Brands</option>
                  {filterOptions.brands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: LABEL }}>Country</label>
                <select value={country} onChange={e => updateParam('country', e.target.value)} className="input py-1.5 text-sm">
                  <option value="">All Countries</option>
                  {filterOptions.countries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: LABEL }}>Min Rating</label>
                <select value={min_rating} onChange={e => updateParam('min_rating', e.target.value)} className="input py-1.5 text-sm">
                  {RATING_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: LABEL }}>Near City</label>
                <div className="relative">
                  <MapPin className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: MUTED }} />
                  <input value={localCity} onChange={e => setLocalCity(e.target.value)}
                    placeholder="City" list="city-suggestions-m" className="input pl-7 py-1.5 text-sm" />
                  <datalist id="city-suggestions-m">
                    {cities.map(c => <option key={`${c.city}-${c.state}`} value={c.city} />)}
                  </datalist>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: MUTED }} />
                <input type="number" placeholder="Min $" value={localMinPrice}
                  onChange={e => setLocalMinPrice(e.target.value)} className="input pl-6 py-1.5 text-sm" />
              </div>
              <div className="relative flex-1">
                <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: MUTED }} />
                <input type="number" placeholder="Max $" value={localMaxPrice}
                  onChange={e => setLocalMaxPrice(e.target.value)} className="input pl-6 py-1.5 text-sm" />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" checked={in_stock_only === '1'}
                onChange={e => updateParam('in_stock_only', e.target.checked ? '1' : '')} className="accent-amber-700" />
              <span className="text-sm" style={{ color: NAVY }}>In stock only</span>
            </label>
            <div className="flex gap-2">
              <button onClick={applySearch} className="btn-primary flex-1 text-sm">Apply</button>
              {activeFilters.length > 0 && (
                <button onClick={clearAll} className="btn-secondary text-sm">Clear all</button>
              )}
            </div>
          </div>
        )}

        {/* Main results area */}
        <div className="flex-1 min-w-0">

          {/* Active filter chips */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {activeFilters.map(f => (
                <span key={f.key} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: '#2E2820', border: '1px solid #453C2E', color: LABEL }}>
                  {f.label}
                  <button onClick={f.clear} className="ml-0.5 transition-colors" style={{ color: MUTED }}
                    onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                    onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <button onClick={clearAll} className="text-xs px-2 transition-colors" style={{ color: MUTED }}
                onMouseEnter={e => e.currentTarget.style.color = AMBER}
                onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                Clear all
              </button>
            </div>
          )}

          {/* Sort + count bar */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <p className="text-sm" style={{ color: MUTED }}>
              {loading ? 'Searching...' : `${total.toLocaleString()} cigar${total !== 1 ? 's' : ''}${city ? ` near ${city}` : ''}`}
            </p>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4" style={{ color: MUTED }} />
              <select value={sort} onChange={e => updateParam('sort', e.target.value)}
                className="input py-1.5 text-sm" style={{ minHeight: 0, width: 'auto' }}>
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* Results */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 12 }).map((_, i) => <div key={i} className="card h-52 skeleton" />)}
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-4xl mb-4">🔍</div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: NAVY }}>No cigars found</h3>
              <p className="text-sm" style={{ color: MUTED }}>Try different terms or loosen your filters.</p>
              {city && <p className="text-sm mt-1" style={{ color: MUTED }}>No stores in "{city}" carry matching cigars.</p>}
              {activeFilters.length > 0 && (
                <button onClick={clearAll} className="btn-secondary mt-4 text-sm">Clear all filters</button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {results.map(c => <CigarCard key={c.id} cigar={c} />)}
            </div>
          )}

          {/* Pagination */}
          {total > 24 && (
            <div className="flex justify-center gap-2 mt-8">
              <button disabled={page <= 1} onClick={() => updateParam('page', page - 1)} className="btn-secondary disabled:opacity-40">Previous</button>
              <span className="flex items-center px-4 text-sm" style={{ color: MUTED }}>
                Page {page} of {Math.ceil(total / 24)}
              </span>
              <button disabled={page >= Math.ceil(total / 24)} onClick={() => updateParam('page', page + 1)} className="btn-secondary disabled:opacity-40">Next</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
