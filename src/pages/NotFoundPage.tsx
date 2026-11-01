import React from 'react';
import { Link } from 'react-router-dom';
import { Film, Home } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#0b0c10] text-gray-100 flex flex-col items-center justify-center p-4 text-center selection:bg-amber-500 selection:text-black">
      <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-6 shadow-2xl">
        <Film className="w-8 h-8" />
      </div>

      <h1 className="text-6xl font-black font-['Outfit'] text-white mb-2">404</h1>
      <h2 className="text-xl font-bold text-gray-200 mb-3 font-['Outfit']">Lost in the Lobby</h2>
      <p className="text-xs text-gray-400 max-w-sm mb-8 leading-relaxed">
        The cinema room or screening you are looking for does not exist or the link may have expired.
      </p>

      <Link
        to="/"
        className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-6 py-3 rounded-xl shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all active:scale-95"
      >
        <Home className="w-4 h-4" />
        Return to Lobby
      </Link>
    </div>
  );
};
