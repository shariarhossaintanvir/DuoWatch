import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCinema } from '../context/CinemaContext';
import { RoomService } from '../lib/roomService';
import type { MovieMode } from '../types/cinema';
import { Film, Monitor, Shield, ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { YoutubeIcon } from '../components/common/YoutubeIcon';

export const CreateRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const { joinSession } = useCinema();

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
        initialMode
      );

      if (!result.success || !result.room) {
        setErrorMessage(result.error || 'Failed to create room.');
        setIsLoading(false);
        return;
      }

      const joined = await joinSession(result.room, hostName.trim());
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
      desc: 'Synchronized YouTube player with clock drift correction.',
      icon: YoutubeIcon,
    },
    {
      id: 'local',
      title: 'Local File Stream',
      desc: 'Pick any local video on your PC to stream direct P2P.',
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
    <div className="min-h-screen bg-[#0b0c10] text-gray-100 flex flex-col justify-center py-12 px-4 relative selection:bg-amber-500 selection:text-black">
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-amber-500/10 blur-[120px] pointer-events-none rounded-full" />

      <div className="w-full max-w-lg mx-auto relative z-10">
        {/* Back Link */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-amber-400 transition-colors mb-6 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        {/* Card Container */}
        <div className="bg-[#14161d] border border-[#282d3c] rounded-3xl p-8 sm:p-10 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-black flex items-center justify-center font-bold shadow-lg shadow-amber-500/20">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white font-['Outfit']">Create Private Cinema</h2>
              <p className="text-xs text-gray-400">Owner session with cryptographic host authority</p>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-6 p-3 rounded-xl bg-red-950/80 border border-red-500/40 text-xs text-red-200">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Room Name Input */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Cinema Room Name
              </label>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g. Midnight Movie Club"
                maxLength={40}
                className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-500/60 transition-colors"
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
                onChange={(e) => setHostName(e.target.value)}
                placeholder="e.g. Alex"
                maxLength={24}
                required
                className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>

            {/* Initial Mode Choice */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                Initial Movie Mode
              </label>
              <div className="grid grid-cols-1 gap-2.5">
                {modeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = initialMode === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => setInitialMode(opt.id)}
                      className={`cursor-pointer p-3.5 rounded-2xl border transition-all flex items-start gap-3 ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500/60 text-white shadow-md'
                          : 'bg-[#0b0c10] border-[#282d3c] text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <div className={`p-2 rounded-xl shrink-0 ${isSelected ? 'bg-amber-500 text-black' : 'bg-[#1c1f2a] text-gray-300'}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-gray-100">{opt.title}</span>
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
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm py-3.5 rounded-xl shadow-xl shadow-amber-500/20 flex items-center justify-center gap-2 transition-all active:scale-95 mt-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating Cryptographic Session...
                </>
              ) : (
                'Launch Private Cinema'
              )}
            </button>
          </form>

          {/* Security Guarantee */}
          <div className="mt-6 pt-5 border-t border-[#282d3c] flex items-center justify-center gap-2 text-xs text-gray-500">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span>Strict 2-Person Limit • Ephemeral State • No Registration</span>
          </div>
        </div>
      </div>
    </div>
  );
};
