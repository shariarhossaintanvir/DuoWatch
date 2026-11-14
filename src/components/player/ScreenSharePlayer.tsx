import React, { useRef, useState, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { Monitor, StopCircle, AlertTriangle, ShieldCheck, Volume2 } from 'lucide-react';

export const ScreenSharePlayer: React.FC = () => {
  const {
    session,
    localMediaStream,
    remoteMediaStream,
    setLocalMediaStream,
    updateMediaState,
    playerVolume,
    isPlayerMuted
  } = useCinema();
  const isOwner = session?.role === 'owner';

  const hostPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const guestVideoRef = useRef<HTMLVideoElement>(null);

  // Synchronize player volume and mute state
  useEffect(() => {
    const video = isOwner ? hostPreviewVideoRef.current : guestVideoRef.current;
    if (video) {
      video.volume = playerVolume / 100;
      video.muted = isPlayerMuted;
    }
  }, [playerVolume, isPlayerMuted, isOwner]);

  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAudioShared, setHasAudioShared] = useState<boolean>(false);
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState<boolean>(false);

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
      if (videoTrack && 'contentHint' in videoTrack) {
        try {
          (videoTrack as any).contentHint = 'detail';
        } catch { }
      }
      const audioTracks = stream.getAudioTracks();
      setHasAudioShared(audioTracks.length > 0);

      // Listen for browser native "Stop Sharing" button click
      videoTrack.onended = () => {
        stopScreenShare();
      };

      setLocalMediaStream(stream);
      setIsSharing(true);
      updateMediaState({ action: 'state_snapshot', mode: 'screen', isPlaying: true });
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
    updateMediaState({ action: 'state_snapshot', mode: 'screen', isPlaying: false });
  };

  // Cleanup on unmount only
  const localStreamRef = useRef<MediaStream | null>(null);
  localStreamRef.current = localMediaStream;

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
      setLocalMediaStream(null);
    };
  }, [setLocalMediaStream]);

  // Sync isSharing state with localMediaStream
  useEffect(() => {
    setIsSharing(Boolean(localMediaStream));
  }, [localMediaStream]);

  // Attach local stream to Host preview video element
  useEffect(() => {
    if (isOwner && hostPreviewVideoRef.current) {
      if (localMediaStream) {
        hostPreviewVideoRef.current.srcObject = localMediaStream;
        hostPreviewVideoRef.current.play().catch(e => console.warn('Host preview play:', e));
      } else {
        hostPreviewVideoRef.current.srcObject = null;
      }
    }
  }, [isOwner, localMediaStream]);

  // Attach remote stream to Guest video element
  useEffect(() => {
    if (!isOwner && guestVideoRef.current) {
      if (remoteMediaStream && remoteMediaStream.getVideoTracks().length > 0) {
        if (guestVideoRef.current.srcObject !== remoteMediaStream) {
          guestVideoRef.current.srcObject = remoteMediaStream;
        }
        guestVideoRef.current.play().then(() => {
          setIsAutoplayBlocked(false);
        }).catch(e => {
          console.warn('Guest screen play error:', e);
          setIsAutoplayBlocked(true);
        });
      } else {
        guestVideoRef.current.srcObject = null;
      }
    }
  }, [isOwner, remoteMediaStream]);

  // Handle Partner user gesture screen playback unlock
  const handlePartnerScreenPlay = async () => {
    const video = guestVideoRef.current;
    if (!video) return;

    try {
      if (remoteMediaStream && video.srcObject !== remoteMediaStream) {
        video.srcObject = remoteMediaStream;
      }
      video.playsInline = true;
      video.volume = playerVolume / 100;
      video.muted = isPlayerMuted;
      await video.play();
      setIsAutoplayBlocked(false);
    } catch (err: any) {
      console.warn('Screen unmuted playback blocked, trying muted sequence:', err);
      try {
        video.muted = true;
        await video.play();
        if (!isPlayerMuted) {
          video.muted = false;
          video.volume = playerVolume / 100;
        }
        setIsAutoplayBlocked(false);
      } catch (e) {
        console.error('Screen play failed:', e);
      }
    }
  };

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
              <div className="absolute top-2 sm:top-4 right-2 sm:right-4 z-20 flex flex-wrap items-center justify-end gap-1.5 sm:gap-3">
                {hasAudioShared && (
                  <span className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[11px] sm:text-xs px-2.5 py-1 rounded-md flex items-center gap-1 shadow-lg backdrop-blur-md">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">System Audio Shared</span>
                    <span className="xs:hidden">Audio On</span>
                  </span>
                )}
                <button
                  onClick={stopScreenShare}
                  aria-label="Stop screen sharing"
                  className="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-lg shadow-red-500/20 transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  <span>Stop Sharing</span>
                </button>
              </div>
            </div>
          ) : (
            /* Start Sharing CTA */
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
              <div className="w-16 h-16 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-6 shadow-xl">
                <Monitor className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-100 mb-2">Screen & Tab Sharing</h3>
              <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                Share any browser tab, desktop window, or full screen. Streamed directly to your partner with optional system audio.
              </p>

              <button
                onClick={startScreenShare}
                disabled={!isScreenShareSupported}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-6 py-3 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-amber-500/20"
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
        <div className="w-full h-full flex items-center justify-center relative">
          {remoteMediaStream && remoteMediaStream.getVideoTracks().length > 0 ? (
            <div className="w-full h-full flex items-center justify-center relative">
              <video
                ref={guestVideoRef}
                autoPlay
                playsInline
                className="w-full h-full max-h-full object-contain"
              />
              {isAutoplayBlocked && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-30">
                  <Monitor className="w-12 h-12 text-amber-400 mb-3 animate-pulse" />
                  <h4 className="text-sm font-semibold text-gray-100 mb-2">Host is sharing their screen</h4>
                  <button
                    onClick={handlePartnerScreenPlay}
                    className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs px-5 py-2.5 rounded-lg shadow-lg transition-colors"
                  >
                    Click to Watch Shared Screen
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm">
              <div className="w-14 h-14 rounded-xl bg-[#14161d] border border-[#282d3c] flex items-center justify-center text-amber-400 mb-4 animate-pulse">
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
        <div className="absolute top-4 left-4 right-4 z-30 max-w-md mx-auto bg-red-950/90 border border-red-500/40 backdrop-blur-md p-3 rounded-lg text-xs text-red-200 flex items-start gap-2 shadow-xl">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
