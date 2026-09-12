import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MapPin, Clock, Armchair } from 'lucide-react';
import { api } from '../services/api';
import StoreCard from '../components/StoreCard';

const HEADING = '#E8DDD0';
const MUTED = '#9E8E7E';
const LABEL = '#7A6D60';
const AMBER = '#D4882A';

/**
 * The pages people search for: "cigar shops tampa", not the name of a shop they
 * have never heard of. One page per state, and one per city that holds more
 * than a single shop — a list of one is a page search engines are right to
 * ignore, and the shop's own page answers it better anyway.
 */
export default function CigarShops() {
  const { slug } = useParams();
  return slug ? <Place slug={slug} /> : <PlaceIndex />;
}

function Place({ slug }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null); setError(null);
    api.getPlace(slug).then(setData).catch(e => setError(e.message));
  }, [slug]);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="mb-4" style={{ color: MUTED }}>No page for that place.</p>
        <Link to="/cigar-shops" className="btn-secondary">All cities and states</Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
        <div className="card h-20 skeleton" />
        {[1, 2, 3, 4].map(i => <div key={i} className="card h-24 skeleton" />)}
      </div>
    );
  }

  const { place, stores, nearby, with_hours: withHours, with_lounge: withLounge } = data;
  const openNow = stores.filter(s => s.is_open === true).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6">
      <nav className="text-xs flex items-center gap-1.5 flex-wrap" style={{ color: LABEL }}>
        <Link to="/cigar-shops" className="hover:underline">Cigar shops</Link>
        {place.kind === 'city' && (
          <>
            <span aria-hidden="true">›</span>
            <Link to={`/cigar-shops/${place.state_slug}`} className="hover:underline">{place.state_name}</Link>
          </>
        )}
        <span aria-hidden="true">›</span>
        <span>{place.name}</span>
      </nav>

      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-bold" style={{ color: HEADING }}>
          Cigar shops in {place.name}
        </h1>
        <p className="text-sm" style={{ color: MUTED }}>
          {stores.length} shop{stores.length === 1 ? '' : 's'}
          {withHours > 0 && <> · <Clock className="w-3.5 h-3.5 inline -mt-0.5" /> {withHours} with hours from the shop&apos;s own site</>}
          {withLounge > 0 && <> · <Armchair className="w-3.5 h-3.5 inline -mt-0.5" /> {withLounge} with a lounge</>}
        </p>
        {openNow > 0 && (
          <p className="text-sm" style={{ color: '#9FD9B0' }}>{openNow} open right now</p>
        )}
      </header>

      <div className="flex flex-col gap-3">
        {stores.map(s => <StoreCard key={s.id} store={s} />)}
      </div>

      {nearby.length > 0 && (
        <section className="flex flex-col gap-3 pt-2">
          <h2 className="font-serif text-lg font-semibold" style={{ color: HEADING }}>
            {place.kind === 'city' ? `Other cities in ${place.state_name}` : 'Other states'}
          </h2>
          <div className="flex flex-wrap gap-2">
            {nearby.map(n => (
              <Link key={n.slug} to={`/cigar-shops/${n.slug}`}
                className="text-sm px-3 py-1.5 rounded-full border transition-colors"
                style={{ borderColor: '#3A3128', color: MUTED }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#5A4A34'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#3A3128'; }}>
                {n.name || `${n.city}, ${n.state}`} <span style={{ color: LABEL }}>{n.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PlaceIndex() {
  const [places, setPlaces] = useState(null);

  useEffect(() => { api.getPlaces().then(setPlaces).catch(() => setPlaces({ cities: [], states: [] })); }, []);

  if (!places) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
        {[1, 2, 3].map(i => <div key={i} className="card h-28 skeleton" />)}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-bold" style={{ color: HEADING }}>Cigar shops by place</h1>
        <p className="text-sm" style={{ color: MUTED }}>
          Every shop here had to prove it is a cigar shop, and its hours were read off its own website.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-semibold" style={{ color: HEADING }}>Cities</h2>
        <div className="flex flex-wrap gap-2">
          {places.cities.map(c => (
            <Link key={c.slug} to={`/cigar-shops/${c.slug}`}
              className="text-sm px-3 py-1.5 rounded-full border transition-colors"
              style={{ borderColor: '#3A3128', color: HEADING }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#5A4A34'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#3A3128'; }}>
              {c.city}, {c.state} <span style={{ color: LABEL }}>{c.count}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-semibold" style={{ color: HEADING }}>States</h2>
        <div className="flex flex-wrap gap-2">
          {places.states.map(s => (
            <Link key={s.slug} to={`/cigar-shops/${s.slug}`}
              className="text-sm px-3 py-1.5 rounded-full border transition-colors"
              style={{ borderColor: '#3A3128', color: HEADING }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#5A4A34'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#3A3128'; }}>
              {s.name} <span style={{ color: LABEL }}>{s.count}</span>
            </Link>
          ))}
        </div>
      </section>

      <p className="text-xs flex items-start gap-1.5" style={{ color: LABEL }}>
        <MapPin className="w-3.5 h-3.5 flex-none mt-0.5" style={{ color: AMBER }} />
        <span>A town with a single shop has no page of its own — that shop&apos;s own page says more than a list of one would.</span>
      </p>
    </div>
  );
}
