import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useCinema } from '../context/CinemaContext';
import { RoomService } from '../lib/roomService';
import { Users, Key, ArrowLeft, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';

export const JoinRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { joinSession, myParticipantId } = useCinema();

  const [roomCode, setRoomCode] = useState<string>(() => searchParams.get('code') || '');
  const [passcode, setPasscode] = useState<string>(() => searchParams.get('passcode') || '');
  const [displayName, setDisplayName] = useState<string>('Partner');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const codeParam = searchParams.get('code');
    const passParam = searchParams.get('passcode');
    if (codeParam) setRoomCode(codeParam.toUpperCase());
    if (passParam) setPasscode(passParam);
  }, [searchParams]);

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
        if (result.error === 'ROOM_FULL') {
          msg = 'This private cinema room is full (capacity strictly limited to 2 participants).';
        } else if (result.error === 'INVALID_GUEST_PASSCODE') {
          msg = 'Invalid invitation passcode for this cinema room.';
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
    <div className="min-h-screen bg-[#0b0c10] text-gray-100 flex flex-col justify-center py-12 px-4 relative selection:bg-amber-500 selection:text-black">
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-emerald-500/10 blur-[120px] pointer-events-none rounded-full" />

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
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-black flex items-center justify-center font-bold shadow-lg shadow-emerald-500/20">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white font-['Outfit']">Join Private Cinema</h2>
              <p className="text-xs text-gray-400">Enter invite details to connect to the session</p>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-6 p-3.5 rounded-xl bg-red-950/80 border border-red-500/40 text-xs text-red-200 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Room Code */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Room Code
              </label>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="e.g. DUO-8X9K"
                maxLength={16}
                required
                className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 font-mono tracking-widest uppercase focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
            </div>

            {/* Passcode */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-emerald-400" />
                Invitation Passcode
              </label>
              <input
                type="text"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Secret invite passcode from host"
                required
                className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 font-mono focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
            </div>

            {/* Partner Display Name */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Your Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Jordan"
                maxLength={24}
                required
                className="w-full bg-[#0b0c10] border border-[#282d3c] rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-bold text-sm py-3.5 rounded-xl shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all active:scale-95 mt-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying Capacity & Authorizing...
                </>
              ) : (
                'Enter Private Cinema'
              )}
            </button>
          </form>

          {/* Security Guarantee */}
          <div className="mt-6 pt-5 border-t border-[#282d3c] flex items-center justify-center gap-2 text-xs text-gray-500">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Encrypted WebRTC P2P • No Cloud Logs • Zero-Cost</span>
          </div>
        </div>
      </div>
    </div>
  );
};
