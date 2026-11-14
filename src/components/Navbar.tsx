import React, { useState, useEffect } from 'react';
import { useCinema } from '../context/CinemaContext';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ParticipantCard } from './room/ParticipantCard';
import { 
  Film, 
  MessageSquare, 
  LogOut, 
  Sliders, 
  Lightbulb, 
  LightbulbOff, 
  Share2,
  Menu,
  X,
  Home,
  Sparkles,
  Users,
  ShieldCheck,
  FileText
} from 'lucide-react';

interface NavbarProps {
  onToggleChat?: () => void;
  isChatOpen?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleChat, isChatOpen }) => {
  const { 
    session, 
    leaveRoom, 
    openSettings, 
    openShareModal, 
    cinemaLights, 
    toggleCinemaLights,
    chatMessages 
  } = useCinema();

  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  const handleLeave = () => {
    if (window.confirm('Are you sure you want to leave this private cinema session?')) {
      leaveRoom();
      navigate('/');
    }
  };

  return (
    <header className="w-full bg-[#14161d] border-b border-[#282d3c] px-3 sm:px-4 py-2.5 flex items-center justify-between z-30 select-none relative">
      {/* Brand Logo */}
      <Link 
        to="/" 
        onClick={() => setIsMobileMenuOpen(false)}
        className="flex items-center gap-2 sm:gap-2.5 group shrink-0"
      >
        <div className="w-8 h-8 rounded-lg bg-amber-500 text-black flex items-center justify-center font-bold shrink-0">
          <Film className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm sm:text-base font-bold tracking-tight text-white flex items-center gap-1 font-['Outfit']">
            Duo<span className="text-amber-400">Watch</span>
          </span>
          <span className="text-[10px] text-gray-400 -mt-0.5 font-medium tracking-wide hidden sm:inline">
            Private Watch Party for Two
          </span>
        </div>
      </Link>

      {/* Center: In-Room Participants & Status */}
      {session && (
        <div className="hidden md:flex items-center gap-4">
          <ParticipantCard />
        </div>
      )}

      {/* Right Actions */}
      <div className="flex items-center gap-1 sm:gap-2">
        {session ? (
          <>
            {/* Share / Invite */}
            <button
              onClick={openShareModal}
              title="Invite Cinema Partner"
              className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Invite</span>
            </button>

            {/* Toggle Cinema Lights */}
            <button
              onClick={toggleCinemaLights}
              title={cinemaLights ? 'Turn on lights' : 'Dim lights'}
              className="p-2 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-[#1c1f2a] border border-[#282d3c] transition-colors"
            >
              {cinemaLights ? <Lightbulb className="w-4 h-4 text-amber-400" /> : <LightbulbOff className="w-4 h-4" />}
            </button>

            {/* Toggle Chat */}
            {onToggleChat && (
              <button
                onClick={onToggleChat}
                title="Toggle Chat Sidebar"
                className={`relative p-2 rounded-lg border transition-colors ${
                  isChatOpen
                    ? 'bg-amber-500 text-black border-amber-500 font-semibold'
                    : 'text-gray-400 hover:text-gray-100 bg-[#1c1f2a] border-[#282d3c]'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                {chatMessages.length > 0 && !isChatOpen && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400" />
                )}
              </button>
            )}

            {/* Settings */}
            <button
              onClick={openSettings}
              title="Settings"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-100 bg-[#1c1f2a] border border-[#282d3c] transition-colors"
            >
              <Sliders className="w-4 h-4" />
            </button>

            {/* Leave Room */}
            <button
              onClick={handleLeave}
              title="Leave Room"
              className="p-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-colors ml-0.5 sm:ml-1"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-5 text-xs font-medium text-gray-400 mr-2">
              <Link 
                to="/" 
                className={`transition-colors hover:text-gray-200 ${location.pathname === '/' ? 'text-amber-400 font-semibold' : ''}`}
              >
                Home
              </Link>
              <Link 
                to="/join" 
                className={`transition-colors hover:text-gray-200 ${location.pathname === '/join' ? 'text-amber-400 font-semibold' : ''}`}
              >
                Join Room
              </Link>
              <Link 
                to="/privacy" 
                className={`transition-colors hover:text-gray-200 ${location.pathname === '/privacy' ? 'text-amber-400 font-semibold' : ''}`}
              >
                Privacy Policy
              </Link>
              <Link 
                to="/terms" 
                className={`transition-colors hover:text-gray-200 ${location.pathname === '/terms' ? 'text-amber-400 font-semibold' : ''}`}
              >
                Terms and Conditions
              </Link>
            </nav>

            <Link 
              to="/create" 
              className="hidden sm:inline-flex bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs px-3.5 py-1.5 rounded-lg transition-colors items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Create Room</span>
            </Link>

            {/* Mobile Hamburger Menu Button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(prev => !prev)}
              aria-label={isMobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
              aria-expanded={isMobileMenuOpen}
              className="md:hidden p-2 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-[#1c1f2a] border border-[#282d3c] transition-colors"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5 text-amber-400" /> : <Menu className="w-5 h-5" />}
            </button>
          </>
        )}
      </div>

      {/* Mobile Navigation Dropdown / Drawer (When !session) */}
      {!session && isMobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div 
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden fixed inset-0 top-[53px] bg-black/70 z-40 transition-opacity"
            aria-hidden="true"
          />

          {/* Drawer Menu */}
          <div 
            className="md:hidden absolute top-full left-0 right-0 bg-[#14161d] border-b border-[#282d3c] p-4 flex flex-col gap-2 z-50"
          >
            <Link
              to="/"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === '/' 
                  ? 'bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/30' 
                  : 'text-gray-300 hover:bg-[#1c1f2a] hover:text-white'
              }`}
            >
              <Home className="w-4 h-4 text-amber-400" />
              <span>Home</span>
            </Link>

            <Link
              to="/join"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === '/join' 
                  ? 'bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/30' 
                  : 'text-gray-300 hover:bg-[#1c1f2a] hover:text-white'
              }`}
            >
              <Users className="w-4 h-4 text-emerald-400" />
              <span>Join Room</span>
            </Link>

            <Link
              to="/create"
              onClick={() => setIsMobileMenuOpen(false)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold bg-amber-500 hover:bg-amber-400 text-black transition-colors my-1"
            >
              <Sparkles className="w-4 h-4" />
              <span>Create Watch Room</span>
            </Link>

            <div className="pt-2 border-t border-[#282d3c] flex flex-col gap-1">
              <Link
                to="/privacy"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  location.pathname === '/privacy' 
                    ? 'text-amber-400 font-semibold' 
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c1f2a]'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Privacy Policy</span>
              </Link>

              <Link
                to="/terms"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  location.pathname === '/terms' 
                    ? 'text-amber-400 font-semibold' 
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c1f2a]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Terms and Conditions</span>
              </Link>
            </div>
          </div>
        </>
      )}
    </header>
  );
};
