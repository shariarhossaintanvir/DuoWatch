import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCinema } from '../context/CinemaContext';
import { RoomService } from '../lib/roomService';
import type { MovieMode } from '../types/cinema';
import { Film, Monitor, Shield, ArrowLeft, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { YoutubeIcon } from '../components/common/YoutubeIcon';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/common/Footer';
import { SEO } from '../components/common/SEO';

export const CreateRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const { joinSession, myParticipantId } = useCinema();

  const [roomName, setRoomName] = useState<string>('Midnight Screenings');
  const [hostName, setHostName] = useState<string>('Host');
  const [initialMode, setInitialMode] = useState<MovieMode>('youtube');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostName.trim()) {
      setErrorMessage('Please enter your display name.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await RoomService.createRoom(
        roomName.trim() || 'Private Cinema',
        hostName.trim(),
        initialMode,
        myParticipantId
      );

      if (!result.success || !result.room) {
        setErrorMessage(result.error || 'Failed to create room.');
        setIsLoading(false);
        return;
      }

      // Explicitly register Host participant with their cryptographic session credential
      const joinResult = await RoomService.joinRoom(
        result.room.roomCode,
        myParticipantId,
        hostName.trim(),
        result.room.ownerToken!,
        'owner'
      );

      if (!joinResult.success || !joinResult.room) {
        setErrorMessage(joinResult.error || 'Failed to initialize host participant session.');
        setIsLoading(false);
        return;
      }

      const sessionToJoin = {
        ...joinResult.room,
        guestPasscode: result.room.guestPasscode || joinResult.room.guestPasscode,
      };
      sessionStorage.setItem(`duowatch_session_${result.room.roomCode}`, JSON.stringify(sessionToJoin));

      const joined = await joinSession(sessionToJoin, hostName.trim());
      if (joined) {
        navigate(`/room/${result.room.roomCode}`);
      } else {
        setErrorMessage('Room created, but failed to initialize signaling session.');
        setIsLoading(false);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred.');
      setIsLoading(false);
    }
  };

  const modeOptions: { id: MovieMode; title: string; desc: string; icon: any }[] = [
    {
      id: 'youtube',
      title: 'YouTube Together',
      desc: 'Synchronized YouTube player with timestamp alignment.',
      icon: YoutubeIcon,
    },
    {
      id: 'local',
      title: 'Local File Stream',
      desc: 'Pick any local video on your computer to stream direct peer to peer.',
      icon: Film,
    },
    {
      id: 'screen',
      title: 'Screen Sharing',
      desc: 'Share any browser tab or desktop window with audio.',
      icon: Monitor,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0b0c10] text-gray-100 flex flex-col justify-between selection:bg-amber-500 selection:text-black">
      <SEO 
        title="Create Private Watch Room: DuoWatch" 
        description="Launch a private watch room for two people. Choose between YouTube Together, local movie streaming, or screen sharing with zero cloud uploads."
        path="/create"
      />

      <Navbar />

      <main className="flex-1 flex flex-col justify-center py-8 sm:py-12 px-4 w-full max-w-lg mx-auto">
        {/* Back Link */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-amber-400 transition-colors mb-4 font-medium self-start"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        {/* Card Container */}
        <div className="bg-[#14161d] border border-[#282d3c] rounded-xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-amber-500 text-black flex items-center justify-center font-bold shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white font-['Outfit']">Create Watch Room</h1>
              <p className="text-xs text-gray-400">Owner session with host playback authority</p>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-5 p-3 rounded-lg bg-red-950/80 border border-red-500/40 text-xs text-red-200 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Room Name Input */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Room Name
              </label>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g. Midnight Movie Club"
                maxLength={40}
                className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-lg px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>

            {/* Host Name Input */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Your Display Name (Host)
              </label>
              <input
                type="text"
                value={hostName}
                onChange={(e) => {
                  setHostName(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="e.g. Alex"
                maxLength={24}
                required
                className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-lg px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>

            {/* Initial Mode Choice */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Initial Watch Mode
              </label>
              <div className="grid grid-cols-1 gap-2">
                {modeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = initialMode === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => setInitialMode(opt.id)}
                      className={`cursor-pointer p-3 rounded-lg border transition-colors flex items-start gap-3 ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500/60 text-white'
                          : 'bg-[#0b0c10] border-[#282d3c] text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <div className={`p-1.5 rounded-md shrink-0 ${isSelected ? 'bg-amber-500 text-black' : 'bg-[#1c1f2a] text-gray-300'}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-gray-100">{opt.title}</span>
                        <span className="text-[11px] text-gray-400 leading-tight mt-0.5">{opt.desc}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors mt-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Initializing Room Session...
                </>
              ) : (
                'Create Room'
              )}
            </button>
          </form>

          {/* Security Guarantee */}
          <div className="mt-5 pt-4 border-t border-[#282d3c] flex flex-wrap items-center justify-center gap-2 text-xs text-gray-500 text-center">
            <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Strict Two-Person Limit | Ephemeral Session | No Account Required</span>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};
