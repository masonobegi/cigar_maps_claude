import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Award, Star, Flame, Package, BookOpen, Globe, Lock } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const COUNTRY_FLAGS = {
  'Nicaragua':          { flag: '🇳🇮', color: 'from-blue-900/40 to-blue-800/20' },
  'Dominican Republic': { flag: '🇩🇴', color: 'from-red-900/40 to-red-800/20' },
  'Honduras':           { flag: '🇭🇳', color: 'from-blue-900/40 to-sky-800/20' },
  'Cuba':               { flag: '🇨🇺', color: 'from-red-900/40 to-red-800/20' },
  'Ecuador':            { flag: '🇪🇨', color: 'from-yellow-900/40 to-yellow-800/20' },
  'Mexico':             { flag: '🇲🇽', color: 'from-green-900/40 to-green-800/20' },
  'Brazil':             { flag: '🇧🇷', color: 'from-green-900/40 to-emerald-800/20' },
  'Peru':               { flag: '🇵🇪', color: 'from-red-900/40 to-red-800/20' },
  'Cameroon':           { flag: '🇨🇲', color: 'from-green-900/40 to-yellow-800/20' },
  'Indonesia':          { flag: '🇮🇩', color: 'from-red-900/40 to-red-800/20' },
  'Philippines':        { flag: '🇵🇭', color: 'from-blue-900/40 to-red-800/20' },
  'Costa Rica':         { flag: '🇨🇷', color: 'from-red-900/40 to-blue-800/20' },
  'Panama':             { flag: '🇵🇦', color: 'from-red-900/40 to-red-800/20' },
  'Colombia':           { flag: '🇨🇴', color: 'from-yellow-900/40 to-red-800/20' },
};

const BADGES = [
  { id: 'first_smoke',    icon: '🚬', name: 'First Smoke',      desc: 'Log your first cigar',           check: s => s.total_smoked >= 1 },
  { id: 'five_smokes',    icon: '🔥', name: 'Five Deep',        desc: 'Log 5 cigars',                   check: s => s.total_smoked >= 5 },
  { id: 'ten_smokes',     icon: '💨', name: 'Regular Smoker',   desc: 'Log 10 cigars',                  check: s => s.total_smoked >= 10 },
  { id: 'twenty_five',    icon: '🏆', name: 'Aficionado',       desc: 'Log 25 cigars',                  check: s => s.total_smoked >= 25 },
  { id: 'first_review',   icon: '✍️', name: 'Critic',           desc: 'Write your first review',        check: s => s.total_reviews >= 1 },
  { id: 'five_reviews',   icon: '📖', name: 'Connoisseur',      desc: 'Write 5 reviews',                check: s => s.total_reviews >= 5 },
  { id: 'humidor_ten',    icon: '📦', name: 'Stocking Up',      desc: '10 cigars in your humidor',      check: s => s.humidor_count >= 10 },
  { id: 'three_countries',icon: '🌍', name: 'Globe Trotter',    desc: 'Smoke cigars from 3 countries',  check: s => s.countries_smoked >= 3 },
  { id: 'five_countries', icon: '🗺️', name: 'World Traveler',   desc: 'Smoke cigars from 5 countries',  check: s => s.countries_smoked >= 5 },
  { id: 'nicaragua',      icon: '🇳🇮', name: 'Puro Nicaragua',  desc: 'Smoke a Nicaraguan puro',        check: s => (s.countries || []).includes('Nicaragua') },
  { id: 'cuba',           icon: '🇨🇺', name: 'Habano',          desc: 'Smoke a Cuban cigar',            check: s => (s.countries || []).includes('Cuba') },
  { id: 'padron_fan',     icon: '⭐', name: 'Padron Fan',       desc: 'Log a Padron cigar',             check: s => (s.brands || []).includes('Padron') },
  { id: 'high_rater',     icon: '💯', name: 'High Standards',   desc: 'Give a 95+ rating',              check: s => s.highest_rating >= 95 },
  { id: 'wishlist_five',  icon: '❤️', name: 'The List',         desc: '5 cigars on your smoke list',    check: s => s.smoke_list_count >= 5 },
  { id: 'follower',       icon: '🏪', name: 'Local Loyalist',   desc: 'Follow 3 stores',                check: s => s.followed_stores >= 3 },
];

export default function Passport() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [humidorItems, setHumidorItems] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [smokeList, setSmokeList] = useState([]);
  const [followedStores, setFollowedStores] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getHumidor(),
      api.getMyReviews(),
      api.getSmokeList(),
      api.getFollowedStores(),
    ]).then(([h, r, sl, fs]) => {
      setHumidorItems(h.items);
      setStats(h.stats);
      setReviews(r);
      setSmokeList(sl);
      setFollowedStores(fs);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="max-w-2xl mx-auto px-4 py-10 animate-pulse space-y-4">
      <div className="h-32 bg-stone-800 rounded-2xl" />
      <div className="h-48 bg-stone-800 rounded-2xl" />
    </div>
  );

  // Build passport data
  const smokedItems   = humidorItems.filter(i => i.status === 'smoked');
  const humidorCount  = humidorItems.filter(i => i.status === 'humidor').reduce((a, b) => a + b.quantity, 0);
  const allItems      = humidorItems;

  const countriesSmoked = [...new Set(
    smokedItems.map(i => i.country).filter(Boolean)
  )];
  const countriesInHumidor = [...new Set(
    humidorItems.filter(i => i.status === 'humidor').map(i => i.country).filter(Boolean)
  )];
  const allCountries = [...new Set([...countriesSmoked, ...countriesInHumidor])];

  const brands = [...new Set(allItems.map(i => i.brand).filter(Boolean))];
  const highestRating = reviews.length > 0 ? Math.max(...reviews.map(r => r.rating)) : 0;

  const passportStats = {
    total_smoked:     smokedItems.length,
    total_reviews:    reviews.length,
    humidor_count:    humidorCount,
    countries_smoked: countriesSmoked.length,
    countries:        countriesSmoked,
    brands,
    highest_rating:   highestRating,
    smoke_list_count: smokeList.filter(i => i.status === 'pending').length,
    followed_stores:  followedStores.length,
  };

  const earnedBadges = BADGES.filter(b => b.check(passportStats));
  const lockedBadges = BADGES.filter(b => !b.check(passportStats));

  const level = earnedBadges.length >= 12 ? 'Master'
    : earnedBadges.length >= 8  ? 'Aficionado'
    : earnedBadges.length >= 4  ? 'Enthusiast'
    : earnedBadges.length >= 1  ? 'Beginner'
    : 'New Smoker';

  const levelColor = {
    'Master': 'text-amber-400', 'Aficionado': 'text-orange-400',
    'Enthusiast': 'text-lime-400', 'Beginner': 'text-blue-400', 'New Smoker': 'text-stone-400',
  }[level];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">

      {/* Passport cover */}
      <div className="card p-6 mb-5 bg-gradient-to-br from-amber-950/60 via-stone-900 to-stone-900 border-amber-800/30 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
          <svg viewBox="0 0 100 100" className="w-full h-full fill-amber-400">
            <text y="80" font-size="80">🚬</text>
          </svg>
        </div>
        <div className="flex items-start justify-between gap-4 relative">
          <div>
            <p className="text-[10px] text-amber-600 uppercase tracking-widest font-semibold mb-1">Cigar Passport</p>
            <h1 className="font-serif text-2xl font-bold text-stone-100">{user?.name}</h1>
            <p className={`text-sm font-semibold mt-1 ${levelColor}`}>{level}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-amber-400">{earnedBadges.length}</div>
            <div className="text-xs text-stone-500">/ {BADGES.length} badges</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-600 rounded-full transition-all duration-700"
              style={{ width: `${(earnedBadges.length / BADGES.length) * 100}%` }} />
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          {[
            { label: 'Smoked',    value: passportStats.total_smoked,   icon: '💨' },
            { label: 'Reviews',   value: passportStats.total_reviews,  icon: '✍️' },
            { label: 'Humidor',   value: humidorCount,                  icon: '📦' },
            { label: 'Countries', value: passportStats.countries_smoked, icon: '🌍' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-lg">{s.icon}</div>
              <div className="text-lg font-bold text-stone-100">{s.value}</div>
              <div className="text-[9px] text-stone-600 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Country stamps */}
      {allCountries.length > 0 && (
        <div className="card p-5 mb-5">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Globe className="w-4 h-4" /> Countries Explored
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {allCountries.map(country => {
              const cfg = COUNTRY_FLAGS[country] || { flag: '🌐', color: 'from-stone-800 to-stone-800' };
              const smoked = countriesSmoked.includes(country);
              return (
                <div key={country}
                  className={`relative rounded-xl p-3 bg-gradient-to-br ${cfg.color} border ${smoked ? 'border-amber-700/40' : 'border-stone-800'} flex items-center gap-2.5`}>
                  <span className="text-2xl">{cfg.flag}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-stone-200 truncate">{country}</p>
                    <p className={`text-[9px] ${smoked ? 'text-amber-400' : 'text-stone-600'}`}>
                      {smoked ? '✓ Smoked' : 'In humidor'}
                    </p>
                  </div>
                  {smoked && (
                    <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-400 rounded-full" />
                  )}
                </div>
              );
            })}
          </div>
          {allCountries.length < 5 && (
            <p className="text-xs text-stone-600 mt-3">
              Smoke cigars from {5 - allCountries.length} more countr{5 - allCountries.length === 1 ? 'y' : 'ies'} to unlock World Traveler
            </p>
          )}
        </div>
      )}

      {/* Earned badges */}
      {earnedBadges.length > 0 && (
        <div className="card p-5 mb-5">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-500" /> Badges Earned
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {earnedBadges.map(badge => (
              <div key={badge.id} className="flex flex-col items-center gap-1.5 p-3 bg-amber-900/20 border border-amber-800/30 rounded-xl text-center">
                <span className="text-2xl">{badge.icon}</span>
                <p className="text-xs font-semibold text-amber-300 leading-tight">{badge.name}</p>
                <p className="text-[9px] text-stone-600 leading-tight">{badge.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Locked badges */}
      {lockedBadges.length > 0 && (
        <div className="card p-5 mb-5">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Lock className="w-4 h-4" /> Locked
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {lockedBadges.map(badge => (
              <div key={badge.id} className="flex flex-col items-center gap-1.5 p-3 bg-stone-800/30 border border-stone-800 rounded-xl text-center opacity-50">
                <span className="text-2xl grayscale">{badge.icon}</span>
                <p className="text-xs font-medium text-stone-500 leading-tight">{badge.name}</p>
                <p className="text-[9px] text-stone-700 leading-tight">{badge.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {humidorItems.length === 0 && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-3">🚬</div>
          <h3 className="font-semibold text-stone-200 mb-1">Your passport is empty</h3>
          <p className="text-stone-500 text-sm mb-5">Start logging cigars to earn stamps and badges.</p>
          <Link to="/search" className="btn-primary inline-flex">Find Your First Cigar</Link>
        </div>
      )}
    </div>
  );
}
