import React, { useState, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { X, Copy, Check, ShieldAlert, Key, Link as LinkIcon, Users, Eye, EyeOff } from 'lucide-react';

export const RoomShareModal: React.FC = () => {
  const { session, isShareModalOpen, closeShareModal } = useCinema();
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedPasscode, setCopiedPasscode] = useState<boolean>(false);
  const [showPasscode, setShowPasscode] = useState<boolean>(false);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isShareModalOpen) {
        closeShareModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isShareModalOpen, closeShareModal]);

  if (!isShareModalOpen || !session) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const inviteUrl = `${origin}/join?code=${encodeURIComponent(session.roomCode)}${session.guestPasscode ? `#passcode=${encodeURIComponent(session.guestPasscode)}` : ''
    }`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {
      console.warn('Copy failed', e);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(session.roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (e) {
      console.warn('Copy failed', e);
    }
  };

  const handleCopyPasscode = async () => {
    if (!session.guestPasscode) return;
    try {
      await navigator.clipboard.writeText(session.guestPasscode);
      setCopiedPasscode(true);
      setTimeout(() => setCopiedPasscode(false), 2000);
    } catch (e) {
      console.warn('Copy passcode failed', e);
    }
  };

  return (
    <div
      onClick={closeShareModal}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#14161d] border border-[#282d3c] rounded-xl shadow-2xl p-5 sm:p-6 relative animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Close Button */}
        <button
          onClick={closeShareModal}
          aria-label="Close share modal"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-100 p-1.5 rounded-lg hover:bg-[#1c1f2a] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5 pr-8">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-100 font-['Outfit']">Invite Your Cinema Partner</h3>
            <p className="text-xs text-gray-400">Share this secret link to watch together</p>
          </div>
        </div>

        {/* Full Secure Invite Link */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-300 mb-1.5 flex items-center gap-1.5">
            <LinkIcon className="w-3.5 h-3.5 text-amber-400" />
            1-Click Invitation Link
          </label>
          <div className="flex items-center gap-2 bg-[#0b0c10] border border-[#282d3c] rounded-lg p-1.5 focus-within:border-amber-500/50">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className="flex-1 bg-transparent text-xs text-gray-300 font-mono px-2 focus:outline-none select-all min-w-0"
              aria-label="1-Click Invitation Link"
            />
            <button
              onClick={handleCopyLink}
              aria-label="Copy invitation link"
              className="bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shrink-0"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Room Code & Passcode for manual entry */}
        <div className="grid grid-cols-1 xs:grid-cols-2 gap-3 mb-5">
          <div className="bg-[#0b0c10] border border-[#282d3c] rounded-lg p-3">
            <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider block mb-1">
              Room Code
            </span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-gray-200 font-mono">
                {session.roomCode}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                className="text-gray-400 hover:text-amber-400 transition-colors p-1.5 rounded-lg hover:bg-[#1c1f2a]"
                title="Copy Room Code"
                aria-label="Copy Room Code"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="bg-[#0b0c10] border border-[#282d3c] rounded-lg p-3">
            <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider flex items-center gap-1 mb-1">
              <Key className="w-3 h-3 text-amber-400" />
              Guest Passcode
            </span>
            <div className="flex items-center justify-between gap-1.5">
              <span
                className="text-xs font-semibold text-gray-200 font-mono truncate select-all tracking-wider"
                title={session.guestPasscode && showPasscode ? session.guestPasscode : undefined}
              >
                {session.guestPasscode
                  ? (showPasscode ? session.guestPasscode : '••••••••••••••••')
                  : 'Protected'}
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                {session.guestPasscode && (
                  <button
                    type="button"
                    onClick={() => setShowPasscode(prev => !prev)}
                    className="text-gray-400 hover:text-amber-400 p-1.5 rounded-lg hover:bg-[#1c1f2a] transition-colors"
                    title={showPasscode ? 'Hide Passcode' : 'Show Passcode'}
                    aria-label={showPasscode ? 'Hide Passcode' : 'Show Passcode'}
                  >
                    {showPasscode ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 text-amber-400/80 hover:text-amber-400" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyPasscode}
                  disabled={!session.guestPasscode}
                  className="text-gray-400 hover:text-amber-400 p-1.5 rounded-lg hover:bg-[#1c1f2a] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Copy Passcode"
                  aria-label="Copy Passcode"
                >
                  {copiedPasscode ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Security & Strict 2-Participant Guard */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[11px] text-gray-300 leading-relaxed">
            <strong className="text-amber-300">Strict 2-Person Limit:</strong> Only one partner can join this room. Any third party attempt is rejected automatically at the database level.
          </div>
        </div>
      </div>
    </div>
  );
};
