import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCinema } from '../context/CinemaContext';
import { Navbar } from '../components/Navbar';
import { CinemaPlayer } from '../components/player/CinemaPlayer';
import { ChatSidebar } from '../components/chat/ChatSidebar';
import { RoomShareModal } from '../components/room/RoomShareModal';
import { SettingsModal } from '../components/room/SettingsModal';
import { RoomService } from '../lib/roomService';
import { Loader2, ArrowLeft } from 'lucide-react';
import { SEO } from '../components/common/SEO';

export const CinemaRoomPage: React.FC = () => {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { session, joinSession, cinemaLights } = useCinema();

  const [isChatOpen, setIsChatOpen] = useState<boolean>(true);
  const [isRestoring, setIsRestoring] = useState<boolean>(!session);

  // Auto-close chat sidebar by default on small mobile screens (< 768px) to maximize theater viewing
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsChatOpen(false);
    }
  }, []);

  // Restore session from sessionStorage on browser refresh
  useEffect(() => {
    if (!session && roomCode) {
      const saved = RoomService.getSavedSession(roomCode);
      if (saved) {
        joinSession(saved, saved.role === 'owner' ? 'Host' : 'Partner').finally(() => {
          setIsRestoring(false);
        });
      } else {
        setIsRestoring(false);
      }
    } else {
      setIsRestoring(false);
    }
  }, [session, roomCode, joinSession]);

  if (isRestoring) {
    return (
      <div className="min-h-screen bg-[#0b0c10] flex flex-col items-center justify-center text-gray-400 p-4">
        <SEO 
          title="Restoring Session | DuoWatch" 
          description="Restoring your private watch party session..." 
        />
        <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-3" />
        <p className="text-xs">Restoring room session...</p>
      </div>
    );
  }

  // If no session is active, guide the user to join
  if (!session) {
    return (
      <div className="min-h-screen bg-[#0b0c10] flex flex-col items-center justify-center p-4 text-center selection:bg-amber-500 selection:text-black">
        <SEO 
          title={`Cinema Room ${roomCode || ''} | DuoWatch`} 
          description={`Room ${roomCode || ''} is protected. Enter the invitation passcode to join this private room.`} 
        />
        <div className="bg-[#14161d] border border-[#282d3c] p-6 sm:p-7 rounded-xl max-w-md w-full shadow-xl">
          <h1 className="text-xl font-bold text-gray-100 mb-2 font-['Outfit']">Private Watch Room</h1>
          <p className="text-xs text-gray-400 mb-6 leading-relaxed">
            Room <strong className="text-amber-400 font-mono">{roomCode}</strong> is protected. Please enter the invitation passcode to join.
          </p>
          <div className="flex flex-col gap-2.5">
            <button
              onClick={() => navigate(`/join?code=${encodeURIComponent(roomCode || '')}`)}
              className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs py-2.5 rounded-lg transition-colors"
            >
              Enter Passcode to Join
            </button>
            <button
              onClick={() => navigate('/')}
              className="bg-[#1c1f2a] hover:bg-[#282d3c] text-gray-300 text-xs py-2.5 rounded-lg border border-[#282d3c] flex items-center justify-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Return to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-500 overflow-x-hidden ${
      cinemaLights ? 'bg-[#040507]' : 'bg-[#0b0c10]'
    }`}>
      <SEO 
        title={`Cinema Room: ${session.roomName || roomCode} | DuoWatch`} 
        description="Private watch party room on DuoWatch. Synchronized YouTube playback, P2P video stream, and private chat for two." 
      />

      {/* Navbar with chat toggle */}
      <div className={`transition-opacity duration-500 ${cinemaLights ? 'opacity-40 hover:opacity-100' : 'opacity-100'}`}>
        <Navbar 
          onToggleChat={() => setIsChatOpen(prev => !prev)} 
          isChatOpen={isChatOpen} 
        />
      </div>

      {/* Main Theater Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Cinema Screen Container */}
        <div className="flex-1 flex flex-col p-2 sm:p-4 md:p-5 overflow-hidden">
          <CinemaPlayer />
        </div>

        {/* Collapsible Chat & Reactions Sidebar */}
        <ChatSidebar 
          isOpen={isChatOpen} 
          onClose={() => setIsChatOpen(false)} 
        />
      </div>

      {/* Modals */}
      <RoomShareModal />
      <SettingsModal />
    </div>
  );
};
