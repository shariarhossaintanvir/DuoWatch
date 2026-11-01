import React, { useRef, useState, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { Monitor, StopCircle, AlertTriangle, ShieldCheck, Volume2 } from 'lucide-react';

export const ScreenSharePlayer: React.FC = () => {
  const { session, localMediaStream, remoteMediaStream, setLocalMediaStream } = useCinema();
  const isOwner = session?.role === 'owner';

  const hostPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const guestVideoRef = useRef<HTMLVideoElement>(null);

  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAudioShared, setHasAudioShared] = useState<boolean>(false);

  // Check if getDisplayMedia is supported (e.g. desktop browsers)
  const isScreenShareSupported = typeof navigator !== 'undefined' && 
    Boolean(navigator.mediaDevices?.getDisplayMedia);

  // Start Screen Sharing (Host)
  const startScreenShare = async () => {
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          cursor: 'always',
        } as any,
        audio: true, // Tab / System Audio
      });

      const videoTrack = stream.getVideoTracks()[0];
      const audioTracks = stream.getAudioTracks();
      setHasAudioShared(audioTracks.length > 0);

      // Listen for browser native "Stop Sharing" button click
      videoTrack.onended = () => {
        stopScreenShare();
      };

      setLocalMediaStream(stream);
      setIsSharing(true);

      if (hostPreviewVideoRef.current) {
        hostPreviewVideoRef.current.srcObject = stream;
        hostPreviewVideoRef.current.play().catch(e => console.warn(e));
      }
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        setErrorMessage(err.message || 'Screen sharing could not be started.');
      }
    }
  };

  // Stop Screen Sharing
  const stopScreenShare = () => {
    if (localMediaStream) {
      localMediaStream.getTracks().forEach(t => t.stop());
    }
    setLocalMediaStream(null);
    setIsSharing(false);
    setHasAudioShared(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localMediaStream) {
        localMediaStream.getTracks().forEach(t => t.stop());
      }
      setLocalMediaStream(null);
    };
  }, [localMediaStream, setLocalMediaStream]);

  // Attach remote stream to Guest video element
  useEffect(() => {
    if (!isOwner && guestVideoRef.current && remoteMediaStream) {
      guestVideoRef.current.srcObject = remoteMediaStream;
      guestVideoRef.current.play().catch(e => console.warn('Guest screen play error:', e));
    }
  }, [isOwner, remoteMediaStream]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden select-none">
      {/* OWNER (HOST) VIEW */}
      {isOwner && (
        <div className="w-full h-full flex flex-col items-center justify-center">
          {isSharing ? (
            <div className="relative w-full h-full flex items-center justify-center group">
              <video
                ref={hostPreviewVideoRef}
                autoPlay
                playsInline
                muted // Host must mute preview locally to avoid audio feedback loop
                className="w-full h-full max-h-full object-contain"
              />

              {/* Screen Share Status Pill & Stop Button */}
              <div className="absolute top-4 right-4 z-20 flex items-center gap-3">
                {hasAudioShared && (
                  <span className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs px-2.5 py-1 rounded-full flex items-center gap-1 shadow-lg backdrop-blur-md">
                    <Volume2 className="w-3.5 h-3.5" />
                    System Audio Shared
                  </span>
                )}
                <button
                  onClick={stopScreenShare}
                  className="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-lg shadow-red-500/20 transition-all active:scale-95"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop Sharing
                </button>
              </div>
            </div>
          ) : (
            /* Start Sharing CTA */
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
              <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-6 shadow-xl">
                <Monitor className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-100 mb-2">Screen & Tab Sharing</h3>
              <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                Share any browser tab, desktop window, or full screen. Streamed directly to your partner with optional system audio.
              </p>

              <button
                onClick={startScreenShare}
                disabled={!isScreenShareSupported}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-6 py-3 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20 active:scale-95"
              >
                <Monitor className="w-4 h-4" />
                Select Screen or Tab
              </button>

              {!isScreenShareSupported && (
                <p className="text-xs text-amber-400/80 mt-3">
                  Screen capture is not supported on this mobile device or browser.
                </p>
              )}

              <div className="flex items-center gap-1.5 text-xs text-emerald-400/90 mt-5">
                <ShieldCheck className="w-4 h-4" />
                <span>Encrypted P2P Transmit • Zero Cloud Recording</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PARTNER (GUEST) VIEW */}
      {!isOwner && (
        <div className="w-full h-full flex items-center justify-center">
          {remoteMediaStream && remoteMediaStream.getVideoTracks().length > 0 ? (
            <video
              ref={guestVideoRef}
              autoPlay
              playsInline
              className="w-full h-full max-h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm">
              <div className="w-14 h-14 rounded-2xl bg-[#14161d] border border-[#282d3c] flex items-center justify-center text-amber-400 mb-4 animate-pulse">
                <Monitor className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-gray-200 mb-1">Waiting for Screen Share</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                The cinema host has not started screen sharing yet. The stream will appear here automatically.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="absolute top-4 left-4 right-4 z-30 max-w-md mx-auto bg-red-950/90 border border-red-500/40 backdrop-blur-md p-3 rounded-xl text-xs text-red-200 flex items-start gap-2 shadow-xl">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
