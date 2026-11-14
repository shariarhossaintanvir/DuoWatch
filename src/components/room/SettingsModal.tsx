import React, { useState, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { X, Sliders, Network, Activity, Info, ShieldCheck } from 'lucide-react';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    closeSettings,
    connectionStatus,
    rttMs,
    streamStats,
  } = useCinema();

  const [driftThreshold, setDriftThreshold] = useState<number>(0.75);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSettingsOpen) {
        closeSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, closeSettings]);

  if (!isSettingsOpen) return null;

  const getStatusBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return <span className="text-emerald-400 font-medium">Connected (P2P Direct)</span>;
      case 'connecting':
        return <span className="text-amber-400 font-medium animate-pulse">Connecting...</span>;
      case 'reconnecting':
        return <span className="text-amber-400 font-medium animate-pulse">Reconnecting...</span>;
      case 'failed':
        return <span className="text-red-400 font-medium">Direct P2P Failed (STUN only)</span>;
      default:
        return <span className="text-gray-400 font-medium capitalize">{connectionStatus}</span>;
    }
  };

  return (
    <div
      onClick={closeSettings}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#14161d] border border-[#282d3c] rounded-xl shadow-2xl p-5 sm:p-6 relative animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
      >
        {/* Close Button */}
        <button
          onClick={closeSettings}
          aria-label="Close settings modal"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-100 p-1.5 rounded-lg hover:bg-[#1c1f2a] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 pr-8">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-100 font-['Outfit']">Cinema & Network Settings</h3>
            <p className="text-xs text-gray-400">Drift tolerance, WebRTC transport, and P2P telemetry</p>
          </div>
        </div>

        {/* Section 1: YouTube Drift Correction */}
        <div className="mb-5 sm:mb-6 bg-[#0b0c10] border border-[#282d3c] rounded-lg p-3.5 sm:p-4">
          <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-400" />
            Playback Drift Tolerance
          </h4>

          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Drift Correction Threshold</span>
              <span className="font-mono text-amber-400">{driftThreshold.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min={0.25}
              max={2.5}
              step={0.05}
              value={driftThreshold}
              onChange={(e) => setDriftThreshold(parseFloat(e.target.value))}
              aria-label="Playback drift correction threshold slider"
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-[#1c1f2a] rounded-lg appearance-none"
            />
            <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
              If the partner’s playback drifts from the authoritative room position by more than this threshold, DuoWatch gently aligns playback.
            </p>
          </div>
        </div>

        {/* Section 2: WebRTC & Zero-Cost Network Telemetry */}
        <div className="bg-[#0b0c10] border border-[#282d3c] rounded-lg p-3.5 sm:p-4">
          <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Network className="w-4 h-4 text-amber-400" />
            P2P Network Telemetry
          </h4>

          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
              <span className="text-gray-400">Transport Security</span>
              <span className="text-gray-200 font-mono flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                DTLS-SRTP P2P Encrypted
              </span>
            </div>
            <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
              <span className="text-gray-400">P2P State</span>
              {getStatusBadge()}
            </div>
            <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
              <span className="text-gray-400">Round Trip Time (RTT)</span>
              <span className="text-gray-200 font-mono">{rttMs > 0 ? `${rttMs} ms` : 'Measuring...'}</span>
            </div>
            {streamStats?.codec && (
              <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
                <span className="text-gray-400">Video Codec</span>
                <span className="text-amber-400 font-mono font-medium">{streamStats.codec}</span>
              </div>
            )}
            {streamStats?.outbound && streamStats.outbound.frameWidth > 0 && (
              <>
                <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
                  <span className="text-gray-400">Outgoing Video</span>
                  <span className="text-emerald-400 font-mono">
                    {streamStats.outbound.frameWidth} × {streamStats.outbound.frameHeight} ({streamStats.outbound.frameHeight >= 1080 ? '1080p Full HD' : `${streamStats.outbound.frameHeight}p`})
                  </span>
                </div>
                <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
                  <span className="text-gray-400">Outgoing Bitrate / FPS</span>
                  <span className="text-gray-200 font-mono">
                    {(streamStats.outbound.bitrateBps / 1_000_000).toFixed(2)} Mbps • {streamStats.outbound.fps} FPS
                  </span>
                </div>
                <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
                  <span className="text-gray-400">Encoder Limiter</span>
                  <span className="text-gray-300 font-mono capitalize">
                    {streamStats.outbound.qualityLimitationReason === 'none' ? 'None (Optimal 1080p)' : streamStats.outbound.qualityLimitationReason}
                  </span>
                </div>
              </>
            )}
            {streamStats?.inbound && streamStats.inbound.frameWidth > 0 && (
              <>
                <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
                  <span className="text-gray-400">Incoming Video</span>
                  <span className="text-emerald-400 font-mono">
                    {streamStats.inbound.frameWidth} × {streamStats.inbound.frameHeight} ({streamStats.inbound.frameHeight >= 1080 ? '1080p Full HD' : `${streamStats.inbound.frameHeight}p`})
                  </span>
                </div>
                <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
                  <span className="text-gray-400">Incoming Bitrate / FPS</span>
                  <span className="text-gray-200 font-mono">
                    {(streamStats.inbound.bitrateBps / 1_000_000).toFixed(2)} Mbps • {streamStats.inbound.fps} FPS
                  </span>
                </div>
                <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
                  <span className="text-gray-400">Frame Health / Jitter</span>
                  <span className="text-gray-300 font-mono text-[11px]">
                    {streamStats.inbound.framesDropped} dropped • {streamStats.inbound.jitter}ms jitter ({streamStats.inbound.packetsLost} lost)
                  </span>
                </div>
              </>
            )}
            <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
              <span className="text-gray-400">STUN Infrastructure</span>
              <span className="text-gray-300 font-mono text-[11px]">Google STUN & Twilio STUN</span>
            </div>
            <div className="flex flex-wrap justify-between items-center py-1 border-b border-[#1c1f2a] gap-1">
              <span className="text-gray-400">Signaling Channel</span>
              <span className="text-gray-300 font-mono text-[11px]">Supabase Private Realtime</span>
            </div>
          </div>

          <div className="mt-4 p-2.5 rounded-lg bg-[#14161d] border border-[#282d3c] flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <strong>Zero-Cost Architecture:</strong> DuoWatch operates purely peer-to-peer over public STUN without paid TURN relay servers. Direct P2P connects residential, home, and mobile networks without intermediate servers. If on an enterprise/university network with symmetric NAT, direct P2P may be restricted.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
