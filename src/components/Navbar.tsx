import React from 'react';
import { useCinema } from '../context/CinemaContext';
import { Link, useNavigate } from 'react-router-dom';
import { ParticipantCard } from './room/ParticipantCard';
import { 
  Film, 
  MessageSquare, 
  LogOut, 
  Sliders, 
  Lightbulb, 
  LightbulbOff, 
  Share2 
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

  const handleLeave = () => {
    if (window.confirm('Are you sure you want to leave this private cinema session?')) {
      leaveRoom();
      navigate('/');
    }
  };

  return (
    <header className="w-full bg-[#14161d]/90 backdrop-blur-md border-b border-[#282d3c] px-4 py-2.5 flex items-center justify-between z-30 select-none">
      {/* Brand Logo */}
      <Link to="/" className="flex items-center gap-2.5 group">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-black flex items-center justify-center font-black shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform">
          <Film className="w-5 h-5" />
        </div>
        <div className="flex flex-col">
          <span className="text-base font-black tracking-tight text-white flex items-center gap-1 font-['Outfit']">
            Duo<span className="text-amber-400">Watch</span>
          </span>
          <span className="text-[10px] text-gray-400 -mt-1 font-medium tracking-wide">
            Private Cinema for Two
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
      <div className="flex items-center gap-2">
        {session ? (
          <>
            {/* Share / Invite */}
            <button
              onClick={openShareModal}
              className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Invite</span>
            </button>

            {/* Toggle Cinema Lights */}
            <button
              onClick={toggleCinemaLights}
              title={cinemaLights ? 'Turn on lights' : 'Dim lights'}
              className="p-2 rounded-xl text-gray-400 hover:text-amber-400 hover:bg-[#1c1f2a] border border-[#282d3c] transition-colors"
            >
              {cinemaLights ? <Lightbulb className="w-4 h-4 text-amber-400" /> : <LightbulbOff className="w-4 h-4" />}
            </button>

            {/* Toggle Chat */}
            {onToggleChat && (
              <button
                onClick={onToggleChat}
                title="Toggle Chat Sidebar"
                className={`relative p-2 rounded-xl border transition-colors ${
                  isChatOpen
                    ? 'bg-amber-500 text-black border-amber-500 font-semibold'
                    : 'text-gray-400 hover:text-gray-100 bg-[#1c1f2a] border-[#282d3c]'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                {chatMessages.length > 0 && !isChatOpen && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>
            )}

            {/* Settings */}
            <button
              onClick={openSettings}
              title="Settings"
              className="p-2 rounded-xl text-gray-400 hover:text-gray-100 bg-[#1c1f2a] border border-[#282d3c] transition-colors"
            >
              <Sliders className="w-4 h-4" />
            </button>

            {/* Leave Room */}
            <button
              onClick={handleLeave}
              title="Leave Room"
              className="p-2 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-colors ml-1"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div className="flex items-center gap-4 text-xs font-medium text-gray-400">
            <Link to="/privacy" className="hover:text-gray-200 transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-gray-200 transition-colors">Terms</Link>
            <Link 
              to="/create" 
              className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-1.5 rounded-xl transition-all shadow-md shadow-amber-500/20 active:scale-95"
            >
              Create Cinema
            </Link>
          </div>
        )}
      </div>
    </header>
  );
};
