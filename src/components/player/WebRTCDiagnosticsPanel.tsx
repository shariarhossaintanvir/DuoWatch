import React, { useState, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { Activity, ChevronDown, ChevronUp, Radio, AlertCircle, CheckCircle2, Shield, Eye } from 'lucide-react';
import { computeDiagnosticStatus } from '../../lib/diagnostics';

interface VideoElementState {
  isMounted: boolean;
  readyState: number;
  paused: boolean;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  isPlaying: boolean;
}

interface WebRTCDiagnosticsPanelProps {
  hasPresentedFrames: boolean;
  isPlaybackUnlocked: boolean;
  isAutoplayBlocked: boolean;
  isMutedByPolicy: boolean;
  isAttemptingPlay: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const WebRTCDiagnosticsPanel: React.FC<WebRTCDiagnosticsPanelProps> = ({
  hasPresentedFrames,
  isPlaybackUnlocked,
  isAutoplayBlocked,
  isMutedByPolicy,
  isAttemptingPlay,
  videoRef,
}) => {
  const {
    session,
    connectionStatus,
    streamStats,
    rttMs,
    localMediaStream,
    remoteMediaStream,
  } = useCinema();

  const isOwner = session?.role === 'owner';
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Poll video element state inside an effect to prevent accessing mutable refs during render
  const [elementState, setElementState] = useState<VideoElementState>({
    isMounted: false,
    readyState: 0,
    paused: true,
    videoWidth: 0,
    videoHeight: 0,
    currentTime: 0,
    isPlaying: false,
  });

  useEffect(() => {
    const updateElementState = () => {
      const vid = videoRef.current;
      if (!vid) {
        setElementState({
          isMounted: false,
          readyState: 0,
          paused: true,
          videoWidth: 0,
          videoHeight: 0,
          currentTime: 0,
          isPlaying: false,
        });
        return;
      }

      setElementState({
        isMounted: true,
        readyState: vid.readyState,
        paused: vid.paused,
        videoWidth: vid.videoWidth || 0,
        videoHeight: vid.videoHeight || 0,
        currentTime: vid.currentTime || 0,
        isPlaying: !vid.paused && vid.currentTime > 0,
      });
    };

    updateElementState();
    const interval = window.setInterval(updateElementState, 1000);
    return () => clearInterval(interval);
  }, [videoRef]);

  const localVideoTrack = localMediaStream?.getVideoTracks()[0] || null;
  const localAudioTrack = localMediaStream?.getAudioTracks()[0] || null;
  const remoteVideoTrack = remoteMediaStream?.getVideoTracks()[0] || null;
  const remoteAudioTrack = remoteMediaStream?.getAudioTracks()[0] || null;

  const decision = computeDiagnosticStatus({
    isOwner,
    connectionStatus,
    hasLocalVideoTrack: Boolean(localVideoTrack && localVideoTrack.readyState === 'live'),
    hasRemoteVideoTrack: Boolean(remoteVideoTrack && remoteVideoTrack.readyState === 'live'),
    outboundBytes: streamStats?.outbound?.bytesSent || 0,
    outboundFrames: streamStats?.outbound?.framesSent || 0,
    inboundBytes: streamStats?.inbound?.bytesReceived || 0,
    inboundFramesDecoded: streamStats?.inbound?.framesDecoded || 0,
    hasPresentedFrames,
    isAutoplayBlocked,
    isVideoPlaying: elementState.isPlaying,
    isAttemptingPlay,
  });

  return (
    <div className="absolute top-2 right-2 z-40 flex flex-col items-end select-none font-mono">
      {/* Collapsed Pill Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border backdrop-blur-md shadow-lg text-[10px] sm:text-[11px] transition-all cursor-pointer ${decision.badgeBg}`}
        aria-label="Toggle WebRTC Diagnostics Panel"
      >
        <Activity className="w-3 h-3 animate-pulse" />
        <span className="font-semibold">{decision.status}</span>
        {rttMs > 0 && <span className="opacity-80">({rttMs}ms)</span>}
        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {/* Expanded HUD Card */}
      {isExpanded && (
        <div className="mt-2 w-72 sm:w-80 bg-[#0d1017]/95 border border-[#282d3c] rounded-xl shadow-2xl p-3 text-[11px] text-gray-300 backdrop-blur-md flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-800 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-100 font-sans">
              <Radio className="w-3.5 h-3.5 text-amber-400" />
              <span>WebRTC Media Diagnostics</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
              {isOwner ? 'Host (Sender)' : 'Partner (Receiver)'}
            </span>
          </div>

          {/* Decision Tree Status */}
          <div className="bg-[#141822] border border-[#222838] p-2 rounded-lg flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              {decision.status === 'PLAYBACK_WORKING' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span className={`font-bold text-xs ${decision.color}`}>{decision.label}</span>
            </div>
            <p className="text-[10px] text-gray-400 leading-snug">{decision.message}</p>
          </div>

          {/* Connection & Network Grid */}
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="bg-[#141822] p-1.5 rounded border border-[#222838]">
              <span className="text-gray-500 block">P2P State</span>
              <span className="font-semibold text-gray-200 capitalize">{connectionStatus}</span>
            </div>
            <div className="bg-[#141822] p-1.5 rounded border border-[#222838]">
              <span className="text-gray-500 block">Round-Trip Time</span>
              <span className="font-semibold text-gray-200">{rttMs > 0 ? `${rttMs} ms` : 'Measuring...'}</span>
            </div>
            <div className="bg-[#141822] p-1.5 rounded border border-[#222838]">
              <span className="text-gray-500 block">Negotiated Codec</span>
              <span className="font-semibold text-gray-200">{streamStats?.codec || 'Auto (VP8/H.264)'}</span>
            </div>
            <div className="bg-[#141822] p-1.5 rounded border border-[#222838]">
              <span className="text-gray-500 block">Security</span>
              <span className="font-semibold text-emerald-400 flex items-center gap-1">
                <Shield className="w-2.5 h-2.5" /> DTLS-SRTP
              </span>
            </div>
          </div>

          {/* Media Track States */}
          <div className="bg-[#141822] p-2 rounded-lg border border-[#222838] flex flex-col gap-1 text-[10px]">
            <span className="text-gray-500 font-semibold mb-0.5">Media Tracks</span>
            {isOwner ? (
              <>
                <div className="flex justify-between">
                  <span>Local Video:</span>
                  <span className={localVideoTrack ? 'text-emerald-400' : 'text-gray-500'}>
                    {localVideoTrack ? `${localVideoTrack.readyState} (${localVideoTrack.muted ? 'muted' : 'active'})` : 'none'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Local Audio:</span>
                  <span className={localAudioTrack ? 'text-emerald-400' : 'text-gray-500'}>
                    {localAudioTrack ? `${localAudioTrack.readyState} (${localAudioTrack.muted ? 'muted' : 'active'})` : 'none'}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Remote Video:</span>
                  <span className={remoteVideoTrack ? 'text-emerald-400' : 'text-gray-500'}>
                    {remoteVideoTrack ? `${remoteVideoTrack.readyState} (${remoteVideoTrack.muted ? 'muted' : 'active'})` : 'none'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Remote Audio:</span>
                  <span className={remoteAudioTrack ? 'text-emerald-400' : 'text-gray-500'}>
                    {remoteAudioTrack ? `${remoteAudioTrack.readyState} (${remoteAudioTrack.muted ? 'muted' : 'active'})` : 'none'}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Telemetry Numbers */}
          <div className="bg-[#141822] p-2 rounded-lg border border-[#222838] flex flex-col gap-1 text-[10px]">
            <span className="text-gray-500 font-semibold mb-0.5">RTP Stream Metrics</span>
            {isOwner ? (
              <>
                <div className="flex justify-between">
                  <span>Frames Sent:</span>
                  <span className="text-gray-200">{streamStats?.outbound?.framesSent || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Bytes Sent:</span>
                  <span className="text-gray-200">{((streamStats?.outbound?.bytesSent || 0) / (1024 * 1024)).toFixed(2)} MB</span>
                </div>
                <div className="flex justify-between">
                  <span>Bitrate:</span>
                  <span className="text-emerald-400">
                    {streamStats?.outbound?.bitrateBps ? `${(streamStats.outbound.bitrateBps / 1_000_000).toFixed(2)} Mbps` : '0 Mbps'}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Bytes Received:</span>
                  <span className="text-gray-200">{((streamStats?.inbound?.bytesReceived || 0) / (1024 * 1024)).toFixed(2)} MB</span>
                </div>
                <div className="flex justify-between">
                  <span>Frames Decoded:</span>
                  <span className="text-emerald-400 font-bold">{streamStats?.inbound?.framesDecoded || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Frames Dropped:</span>
                  <span className={streamStats?.inbound?.framesDropped ? 'text-amber-400' : 'text-gray-400'}>
                    {streamStats?.inbound?.framesDropped || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Bitrate:</span>
                  <span className="text-emerald-400">
                    {streamStats?.inbound?.bitrateBps ? `${(streamStats.inbound.bitrateBps / 1_000_000).toFixed(2)} Mbps` : '0 Mbps'}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* HTML5 Video Element State */}
          <div className="bg-[#141822] p-2 rounded-lg border border-[#222838] flex flex-col gap-1 text-[10px]">
            <span className="text-gray-500 font-semibold mb-0.5 flex items-center gap-1">
              <Eye className="w-3 h-3 text-amber-400" />
              <span>Video Presentation Engine</span>
            </span>
            <div className="flex justify-between">
              <span>Presented Frames:</span>
              <span className={hasPresentedFrames ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                {hasPresentedFrames ? 'YES (Rendered)' : 'Pending initial frame'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Element State:</span>
              <span className="text-gray-200">
                {elementState.isMounted
                  ? `readyState ${elementState.readyState} • ${elementState.paused ? 'paused' : 'playing'}`
                  : 'unmounted'}
              </span>
            </div>
            {elementState.videoWidth > 0 && (
              <div className="flex justify-between">
                <span>Native Resolution:</span>
                <span className="text-gray-200">{elementState.videoWidth}×{elementState.videoHeight}</span>
              </div>
            )}
            {!isOwner && (
              <>
                <div className="flex justify-between">
                  <span>Playback Unlocked:</span>
                  <span className={isPlaybackUnlocked ? 'text-emerald-400' : 'text-amber-400'}>
                    {isPlaybackUnlocked ? 'YES' : 'Awaiting gesture'}
                  </span>
                </div>
                {isMutedByPolicy && (
                  <div className="flex justify-between text-amber-400">
                    <span>Audio State:</span>
                    <span>Muted by Policy (Tap to unmute)</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
