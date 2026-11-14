import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom';
import { useCinema } from '../context/CinemaContext';
import { RoomService } from '../lib/roomService';
import { Users, Key, ArrowLeft, Loader2, ShieldCheck, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/common/Footer';
import { SEO } from '../components/common/SEO';

function extractPasscodeFromUrl(hash: string, searchParams: URLSearchParams): string {
  // 1. Prioritize hash fragment (secure format: #passcode=... or raw hash)
  if (hash) {
    const clean = hash.replace(/^#/, '').trim();
    if (clean.startsWith('passcode=')) {
      const params = new URLSearchParams(clean);
      const val = params.get('passcode');
      if (val) return val.trim();
    } else if (clean.length >= 16) {
      return clean;
    }
  }

  // 2. Fallback to query parameter (backward compatibility)
  const queryVal = searchParams.get('passcode');
  if (queryVal) return queryVal.trim();

  return '';
}

export const JoinRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { joinSession, myParticipantId } = useCinema();

  const [roomCode, setRoomCode] = useState<string>(() => (searchParams.get('code') || '').toUpperCase());
  const [passcode, setPasscode] = useState<string>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    return extractPasscodeFromUrl(hash, searchParams);
  });
  const [showPasscode, setShowPasscode] = useState<boolean>(false);
  const [displayName, setDisplayName] = useState<string>('Partner');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const codeParam = searchParams.get('code');
    const hash = typeof window !== 'undefined' ? (window.location.hash || location.hash) : location.hash;

    // Sanitize visible browser address bar: clear fragment and query passcode
    if (typeof window !== 'undefined' && (hash || searchParams.has('passcode'))) {
      const activeCode = (codeParam || roomCode || '').toUpperCase();
      const sanitizedUrl = `${window.location.pathname}${activeCode ? `?code=${encodeURIComponent(activeCode)}` : ''}`;
      window.history.replaceState(null, '', sanitizedUrl);
    }
  }, [searchParams, location.hash, roomCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) {
      setErrorMessage('Please enter the 8-character Room Code.');
      return;
    }
    if (!passcode.trim()) {
      setErrorMessage('Please enter the room passcode.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await RoomService.joinRoom(
        roomCode.trim().toUpperCase(),
        myParticipantId,
        displayName.trim() || 'Partner',
        passcode.trim(),
        'partner'
      );

      if (!result.success || !result.room) {
        let msg = 'Failed to join room.';
        if (result.error === 'ROOM_FULL' || result.error === 'PLATFORM_OCCUPIED') {
          msg = 'This private room has reached maximum capacity (strictly 2 participants globally).';
        } else if (result.error === 'INVALID_GUEST_PASSCODE') {
          msg = 'Invalid invitation passcode for this room.';
        } else if (result.error === 'ROOM_NOT_FOUND_OR_EXPIRED') {
          msg = 'This private room was not found or has expired.';
        } else if (result.error) {
          msg = result.error;
        }
        setErrorMessage(msg);
        setIsLoading(false);
        return;
      }

      const joined = await joinSession(result.room, displayName.trim() || 'Partner');
      if (joined) {
        navigate(`/room/${result.room.roomCode}`);
      } else {
        setErrorMessage('Room joined, but failed to establish peer signaling connection.');
        setIsLoading(false);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred while joining.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] text-gray-100 flex flex-col justify-between selection:bg-amber-500 selection:text-black">
      <SEO 
        title="Join Private Watch Room: DuoWatch" 
        description="Join a private DuoWatch room with your invite code and secret passcode to watch movies together in real-time."
        path="/join"
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
            <div className="w-9 h-9 rounded-lg bg-emerald-500 text-black flex items-center justify-center font-bold shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white font-['Outfit']">Join Watch Room</h1>
              <p className="text-xs text-gray-400">Enter invite details to connect to the session</p>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-5 p-3 rounded-lg bg-red-950/80 border border-red-500/40 text-xs text-red-200 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Room Code */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Room Code
              </label>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => {
                  setRoomCode(e.target.value.toUpperCase());
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="e.g. DUO-8X9K"
                maxLength={16}
                required
                className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-lg px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 font-mono tracking-widest uppercase focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
            </div>

            {/* Passcode */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-emerald-400" />
                Invitation Passcode
              </label>
              <div className="relative">
                <input
                  type={showPasscode ? "text" : "password"}
                  value={passcode}
                  onChange={(e) => {
                    setPasscode(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Secret invite passcode from host"
                  required
                  className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-lg px-3.5 py-2.5 pr-11 text-sm text-gray-100 placeholder-gray-500 font-mono focus:outline-none focus:border-emerald-500/60 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPasscode(prev => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-emerald-400 p-1 rounded-md hover:bg-[#1c1f2a] transition-colors"
                  title={showPasscode ? 'Hide Passcode' : 'Show Passcode'}
                  aria-label={showPasscode ? 'Hide Passcode' : 'Show Passcode'}
                >
                  {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Partner Display Name */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Your Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="e.g. Jordan"
                maxLength={24}
                required
                className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-lg px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold text-sm py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors mt-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying Capacity and Authorizing...
                </>
              ) : (
                'Enter Watch Room'
              )}
            </button>
          </form>

          {/* Security Guarantee */}
          <div className="mt-5 pt-4 border-t border-[#282d3c] flex flex-wrap items-center justify-center gap-2 text-xs text-gray-500 text-center">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Encrypted WebRTC P2P | No Cloud Video Storage | Direct Signaling</span>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};
