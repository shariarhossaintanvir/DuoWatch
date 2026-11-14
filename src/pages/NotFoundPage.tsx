import React from 'react';
import { Link } from 'react-router-dom';
import { Film, Home, Sparkles, Users } from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/common/Footer';
import { SEO } from '../components/common/SEO';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#0b0c10] text-gray-100 flex flex-col justify-between selection:bg-amber-500 selection:text-black">
      <SEO 
        title="404: Page Not Found | DuoWatch" 
        description="The cinema room, screening, or page you are looking for does not exist or may have expired. Return to the DuoWatch lobby." 
      />
      <Navbar />

      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 text-center my-8 sm:my-12">
        <div className="w-14 h-14 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-5">
          <Film className="w-7 h-7" />
        </div>

        <span className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20 mb-3">
          Error 404
        </span>

        <h1 className="text-3xl sm:text-5xl font-bold font-['Outfit'] text-white mb-2 tracking-tight">
          Page Not Found
        </h1>
        <h2 className="text-base sm:text-lg font-medium text-gray-400 mb-3 font-['Outfit']">
          The requested page or private room does not exist
        </h2>
        <p className="text-xs sm:text-sm text-gray-400 max-w-md mb-8 leading-relaxed px-2">
          The room link may have expired after 24 hours, was entered incorrectly, or the page has been moved.
        </p>

        {/* Primary and secondary navigation buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm justify-center">
          <Link
            to="/"
            className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs sm:text-sm px-5 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <Home className="w-4 h-4" />
            Return to Home
          </Link>

          <Link
            to="/create"
            className="w-full sm:w-auto bg-[#1c1f2a] hover:bg-[#282d3c] text-gray-200 border border-[#282d3c] font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            Create Room
          </Link>

          <Link
            to="/join"
            className="w-full sm:w-auto bg-[#1c1f2a] hover:bg-[#282d3c] text-gray-200 border border-[#282d3c] font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <Users className="w-4 h-4 text-emerald-400" />
            Join Room
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
};
