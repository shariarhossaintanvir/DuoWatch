import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { RoomService } from '../../lib/roomService';
import type { PlatformAvailability } from '../../types/cinema';
import { Users, RefreshCw, Lock, ArrowLeft, AlertCircle } from 'lucide-react';

interface OccupiedWaitingScreenProps {
  onAvailable?: () => void;
  initialStatus?: PlatformAvailability | null;
}

export const OccupiedWaitingScreen: React.FC<OccupiedWaitingScreenProps> = ({
  onAvailable,
  initialStatus,
}) => {
  const navigate = useNavigate();
  const [_availability, setAvailability] = useState<PlatformAvailability | null>(initialStatus || null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [lastChecked, setLastChecked] = useState<Date>(() => new Date());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const performCheck = useCallback(async () => {
    setIsChecking(true);
    setErrorMessage(null);
    try {
      const res = await RoomService.checkPlatformAvailability();
      setAvailability(res);
      setLastChecked(new Date());
      if (res.isAvailable) {
        if (onAvailable) {
          onAvailable();
        } else {
          navigate('/create');
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to refresh availability. Please try again.');
    } finally {
      setIsChecking(false);
    }
  }, [navigate, onAvailable]);

  // Low-frequency polling: every 30s to respect Supabase Free Tier quotas
  // Pauses automatically when tab/document is hidden
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      performCheck();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [performCheck]);

  return (
    <div className="w-full max-w-lg mx-auto bg-[#14161d] border border-[#282d3c] p-6 sm:p-8 rounded-xl text-left shadow-2xl selection:bg-amber-500 selection:text-black">
      {/* Status Badge */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#282d3c]">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
          <span className="text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold">
            Platform At Capacity
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400 font-mono">
          <Users className="w-3.5 h-3.5 text-gray-400" />
          <span>2 / 2 Active</span>
        </div>
      </div>

      {/* Primary Message */}
      <div className="mb-6">
        <h2 className="text-xl sm:text-2xl font-bold font-['Outfit'] text-white tracking-tight mb-2">
          DuoWatch is currently occupied
        </h2>
        <p className="text-sm text-gray-300 leading-relaxed font-normal">
          Two people are watching together right now. Please try again when their session ends.
        </p>
      </div>

      {/* Technical Invariant Notice */}
      <div className="bg-[#0b0c10] border border-[#282d3c] p-4 rounded-lg mb-6 flex items-start gap-3">
        <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-gray-400 leading-normal">
          <p className="font-semibold text-gray-300 mb-0.5">Strict Global Capacity Invariant</p>
          <p>
            DuoWatch strictly limits the entire platform to one private room and two active viewers. Once the current watch party concludes or safely expires, the platform will open for the next session.
          </p>
        </div>
      </div>

      {/* Error Message if refresh fails */}
      {errorMessage && (
        <div className="flex items-center gap-2 text-xs text-red-400 mb-4 bg-red-500/10 border border-red-500/20 p-2.5 rounded-md" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Action Controls */}
      <div className="flex flex-col sm:flex-row items-center gap-3 mb-6">
        {/* Retry Button */}
        <button
          type="button"
          onClick={performCheck}
          disabled={isChecking}
          className="w-full sm:flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-xs py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
          aria-live="polite"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
          {isChecking ? 'Checking Platform Status...' : 'Check Availability'}
        </button>

        {/* Disabled Create Room Button */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Room creation is unavailable while the platform is occupied"
          className="w-full sm:flex-1 bg-[#1c1f2a] border border-[#282d3c] text-gray-500 font-semibold text-xs py-2.5 px-4 rounded-lg cursor-not-allowed opacity-60 text-center"
        >
          Create Room (Locked)
        </button>
      </div>

      {/* Footer Info & Navigation */}
      <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-[#282d3c]">
        <span>
          Auto-checks every 30s • Last checked {lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <Link
          to="/"
          className="text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Home
        </Link>
      </div>

      {/* Invitation Join Guidance */}
      <div className="mt-4 pt-3 border-t border-[#1c1f2a] text-center">
        <p className="text-xs text-gray-400">
          Have an invitation passcode from the current Host?{' '}
          <Link to="/join" className="text-amber-400 hover:underline font-semibold">
            Join as Partner
          </Link>
        </p>
      </div>
    </div>
  );
};
