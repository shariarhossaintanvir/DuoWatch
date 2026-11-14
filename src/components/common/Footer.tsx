import React from 'react';
import { Link } from 'react-router-dom';
import { Film } from 'lucide-react';

const CURRENT_YEAR = new Date().getFullYear();

export const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-[#282d3c] bg-[#0b0c10] py-6 text-xs text-gray-500">
      <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
        {/* Brand & Copyright */}
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3">
          <Link to="/" className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors">
            <Film className="w-4 h-4 text-amber-400" />
            <span className="font-semibold tracking-tight font-['Outfit']">DuoWatch</span>
          </Link>
          <span className="hidden sm:inline text-gray-600">|</span>
          <span className="text-gray-400">Private Watch Party for Two</span>
          <span className="hidden sm:inline text-gray-600">|</span>
          <span className="text-gray-400">© {CURRENT_YEAR} DuoWatch. All rights reserved.</span>
        </div>

        {/* Navigation Links */}
        <nav aria-label="Footer navigation" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link to="/" className="hover:text-amber-400 transition-colors py-1">Home</Link>
          <Link to="/create" className="hover:text-amber-400 transition-colors py-1">Create Room</Link>
          <Link to="/join" className="hover:text-amber-400 transition-colors py-1">Join Room</Link>
          <Link to="/privacy" className="hover:text-amber-400 transition-colors py-1">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-amber-400 transition-colors py-1">Terms and Conditions</Link>
        </nav>
      </div>
    </footer>
  );
};
