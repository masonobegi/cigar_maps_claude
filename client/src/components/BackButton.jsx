import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function BackButton({ label = 'Back', to }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => to ? navigate(to) : navigate(-1)}
      className="flex items-center gap-1 text-stone-400 hover:text-amber-400 transition-colors py-1 -ml-1 mb-3 min-h-[44px]"
    >
      <ChevronLeft className="w-5 h-5" />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
