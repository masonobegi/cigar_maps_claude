import { Link } from 'react-router-dom';
import { Flame, Search, Store } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 text-center">
      <div className="mb-6">
        <div className="text-7xl mb-4">🚬</div>
        <h1 className="font-serif text-4xl font-bold text-stone-100 mb-2">Lost in the smoke</h1>
        <p className="text-stone-500 text-lg max-w-sm mx-auto">
          That page doesn't exist. Maybe it burned down or was never rolled in the first place.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mt-4">
        <Link to="/" className="btn-primary flex items-center gap-2">
          <Flame className="w-4 h-4" /> Back to Home
        </Link>
        <Link to="/search" className="btn-secondary flex items-center gap-2">
          <Search className="w-4 h-4" /> Search Cigars
        </Link>
        <Link to="/stores" className="btn-secondary flex items-center gap-2">
          <Store className="w-4 h-4" /> Browse Stores
        </Link>
      </div>

      <p className="text-stone-700 text-xs mt-8">Error 404</p>
    </div>
  );
}
