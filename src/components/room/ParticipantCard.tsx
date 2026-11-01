import React from 'react';
import { useCinema } from '../../context/CinemaContext';
import { Mic, MicOff, Crown, HeartHandshake, Wifi, WifiOff } from 'lucide-react';

export const ParticipantCard: React.FC = () => {
  const { participants, connectionStatus, rttMs } = useCinema();

  const owner = participants.find(p => p.role === 'owner');
  const partner = participants.find(p => p.role === 'partner');

  return (
    <div className="flex items-center gap-2 select-none">
      {/* Host Avatar Card */}
      <div 
        className={`flex items-center gap-2 bg-[#14161d] border px-3 py-1.5 rounded-xl transition-all ${
          owner?.isSpeaking
            ? 'border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
            : 'border-[#282d3c]'
        }`}
      >
        <div className="relative">
          <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center font-bold text-xs">
            {owner ? owner.displayName.charAt(0).toUpperCase() : 'H'}
          </div>
          <span 
            className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#14161d] ${
              owner?.isOnline ? 'bg-emerald-400' : 'bg-gray-500'
            }`} 
          />
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-gray-200 truncate max-w-[80px]">
              {owner ? owner.displayName : 'Host'}
            </span>
            <Crown className="w-3 h-3 text-amber-400 shrink-0" />
          </div>
          <span className="text-[10px] text-amber-400/80 font-medium">Owner</span>
        </div>

        {owner && (
          <div className="text-gray-400 ml-1">
            {owner.isMuted ? (
              <MicOff className="w-3 h-3 text-red-400" />
            ) : (
              <Mic className="w-3 h-3 text-emerald-400" />
            )}
          </div>
        )}
      </div>

      {/* Partner Avatar Card */}
      <div 
        className={`flex items-center gap-2 bg-[#14161d] border px-3 py-1.5 rounded-xl transition-all ${
          partner?.isSpeaking
            ? 'border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
            : 'border-[#282d3c]'
        }`}
      >
        <div className="relative">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 flex items-center justify-center font-bold text-xs">
            {partner ? partner.displayName.charAt(0).toUpperCase() : '?'}
          </div>
          <span 
            className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#14161d] ${
              partner?.isOnline ? 'bg-emerald-400' : 'bg-gray-500'
            }`} 
          />
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-gray-200 truncate max-w-[80px]">
              {partner ? partner.displayName : 'Waiting...'}
            </span>
            <HeartHandshake className="w-3 h-3 text-emerald-400 shrink-0" />
          </div>
          <span className="text-[10px] text-emerald-400/80 font-medium">Partner</span>
        </div>

        {partner && (
          <div className="text-gray-400 ml-1">
            {partner.isMuted ? (
              <MicOff className="w-3 h-3 text-red-400" />
            ) : (
              <Mic className="w-3 h-3 text-emerald-400" />
            )}
          </div>
        )}
      </div>

      {/* RTT / Connection Pill */}
      {connectionStatus === 'connected' && rttMs > 0 && (
        <div 
          className="hidden sm:flex items-center gap-1 bg-[#14161d] border border-[#282d3c] px-2 py-1 rounded-lg text-[10px] text-gray-400 font-mono"
          title={`Round Trip Time: ${rttMs}ms`}
        >
          <Wifi className="w-3 h-3 text-emerald-400" />
          <span>{rttMs}ms</span>
        </div>
      )}

      {connectionStatus === 'reconnecting' && (
        <div className="hidden sm:flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-lg text-[10px] text-amber-300 font-medium">
          <WifiOff className="w-3 h-3 text-amber-400 animate-pulse" />
          <span>Reconnecting</span>
        </div>
      )}
    </div>
  );
};
