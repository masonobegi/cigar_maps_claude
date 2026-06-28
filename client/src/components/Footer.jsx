import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="flex border-t border-amber-200/80 px-6 py-4 items-center justify-between text-xs" style={{backgroundColor: '#f0e4d4', color: '#9a7050'}}>
      <div className="flex items-center gap-1.5">
        <Flame className="w-3.5 h-3.5 text-amber-700" />
        <span>© {new Date().getFullYear()} CigarBuddy</span>
      </div>
      <div className="flex items-center gap-4">
        <Link to="/privacy" className="hover:text-stone-400 transition-colors">Privacy Policy</Link>
        <Link to="/terms" className="hover:text-stone-400 transition-colors">Terms of Service</Link>
      </div>
    </footer>
  );
}
