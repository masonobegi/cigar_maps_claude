import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="flex border-t border-white/10 px-6 py-4 items-center justify-between text-xs" style={{backgroundColor: '#162040', color: '#93a8cc'}}>
      <div className="flex items-center gap-1.5">
        <Flame className="w-3.5 h-3.5 text-amber-700" />
        <span>© {new Date().getFullYear()} CigarBuddy</span>
      </div>
      <div className="flex items-center gap-4">
        <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
        <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
      </div>
    </footer>
  );
}
