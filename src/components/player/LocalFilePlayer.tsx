import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { Upload, Film, AlertTriangle, ShieldCheck, Play, Pause, RotateCcw, Sparkles } from 'lucide-react';

export const LocalFilePlayer: React.FC = () => {
  const {
    session,
    mediaState,
    remoteMediaStream,
    remoteStreamRevision,
    localMediaStream,
    setLocalMediaStream,
    updateMediaState,
    playerVolume,
    isPlayerMuted,
    streamStats,
  } = useCinema();

  const isOwner = session?.role === 'owner';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hostVideoRef = useRef<HTMLVideoElement>(null);
  const guestVideoRef = useRef<HTMLVideoElement>(null);
  const capturedStreamRef = useRef<MediaStream | null>(null);

  // Synchronize player volume and mute state
  useEffect(() => {
    const video = isOwner ? hostVideoRef.current : guestVideoRef.current;
    if (video) {
      video.volume = playerVolume / 100;
      video.muted = isPlayerMuted;
    }
  }, [playerVolume, isPlayerMuted, isOwner]);

  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [fileObjectUrl, setFileObjectUrl] = useState<string | null>(null);
  const [hasCaptureStreamSupport, setHasCaptureStreamSupport] = useState<boolean>(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isLocalPlaying, setIsLocalPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [sourceResolution, setSourceResolution] = useState<{ width: number; height: number } | null>(null);
  const [guestResolution, setGuestResolution] = useState<{ width: number; height: number } | null>(null);

  // Phase 22 Partner Playback & Stream Flowing States
  const [_isVideoPlaying, setIsVideoPlaying] = useState<boolean>(false);
  const [isPlaybackUnlocked, setIsPlaybackUnlocked] = useState<boolean>(false);
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState<boolean>(false);
  const [hasDecodedFrames, setHasDecodedFrames] = useState<boolean>(false);
  const [isStreamMuted, setIsStreamMuted] = useState<boolean>(false);
  const [isAttemptingPlay, setIsAttemptingPlay] = useState<boolean>(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Feature detection for captureStream
  useEffect(() => {
    const testVideo = document.createElement('video');
    const hasCapture = Boolean(
      (testVideo as any).captureStream ||
      (testVideo as any).mozCaptureStream
    );
    setHasCaptureStreamSupport(hasCapture);
    if (!hasCapture && isOwner) {
      setStreamError('Your current browser does not support HTMLMediaElement.captureStream(). Please use Chrome, Edge, or Firefox for local file streaming.');
    }
  }, [isOwner]);

  // Clean up Object URL and captured media stream on unmount
  const fileObjectUrlRef = useRef<string | null>(null);
  useEffect(() => {
    fileObjectUrlRef.current = fileObjectUrl;
  }, [fileObjectUrl]);

  useEffect(() => {
    return () => {
      if (fileObjectUrlRef.current) {
        URL.revokeObjectURL(fileObjectUrlRef.current);
      }
      if (capturedStreamRef.current) {
        capturedStreamRef.current.getTracks().forEach(t => {
          try { t.stop(); } catch { }
        });
        capturedStreamRef.current = null;
      }
      setLocalMediaStream(null);
    };
  }, [setLocalMediaStream]);

  // Ensure fileObjectUrl is bound to hostVideoRef if mounted after selection
  useEffect(() => {
    if (isOwner && hostVideoRef.current && fileObjectUrl) {
      if (hostVideoRef.current.src !== fileObjectUrl) {
        hostVideoRef.current.src = fileObjectUrl;
        hostVideoRef.current.load();
      }
    }
  }, [isOwner, fileObjectUrl]);

  // --- Host Stream Capture Lifecycle Management ---
  const initializeStreamCapture = useCallback(() => {
    if (!hostVideoRef.current || !isOwner) return;
    const vid = hostVideoRef.current;

    if (vid.duration && !isNaN(vid.duration)) {
      setDuration(vid.duration);
    }
    const w = vid.videoWidth || 0;
    const h = vid.videoHeight || 0;
    if (w > 0 && h > 0) {
      setSourceResolution({ width: w, height: h });
    }

    try {
      let stream = capturedStreamRef.current;
      if (!stream) {
        if (typeof (vid as any).captureStream === 'function') {
          stream = (vid as any).captureStream(30);
        } else if (typeof (vid as any).mozCaptureStream === 'function') {
          stream = (vid as any).mozCaptureStream(30);
        }
        capturedStreamRef.current = stream;
      }

      if (stream) {
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        console.log(`[DuoWatch Diagnostics] Host captureStream: readyState=${vid.readyState}, videoTracks=${videoTracks.length}, audioTracks=${audioTracks.length}, size=${w}x${h}`);

        if (videoTracks[0] && 'contentHint' in videoTracks[0]) {
          try {
            (videoTracks[0] as any).contentHint = 'motion';
          } catch { }
        }

        setLocalMediaStream(stream);
        setStreamError(null);
      } else {
        setStreamError('Could not initialize media stream capture from selected video.');
      }
    } catch (err: any) {
      console.error('Error in captureStream:', err);
      setStreamError(`CaptureStream failed: ${err.message}`);
    }
  }, [isOwner, setLocalMediaStream]);

  // --- Partner Remote Stream Attachment & Track Event Handling ---
  useEffect(() => {
    if (isOwner || !guestVideoRef.current) return;
    const video = guestVideoRef.current;

    if (remoteMediaStream && remoteMediaStream.getVideoTracks().length > 0) {
      if (video.srcObject !== remoteMediaStream) {
        video.srcObject = remoteMediaStream;
      }
      const vTrack = remoteMediaStream.getVideoTracks()[0];
      setIsStreamMuted(vTrack.muted);

      const onUnmute = () => {
        console.log('[DuoWatch Diagnostics] Partner: Remote video track unmuted (media packets flowing).');
        setIsStreamMuted(false);
        if (video.videoWidth > 0) {
          setHasDecodedFrames(true);
        }
      };
      const onMute = () => {
        console.log('[DuoWatch Diagnostics] Partner: Remote video track muted (buffering/paused).');
        setIsStreamMuted(true);
      };
      const onEnded = () => {
        console.log('[DuoWatch Diagnostics] Partner: Remote video track ended.');
        setHasDecodedFrames(false);
        setIsVideoPlaying(false);
      };

      vTrack.addEventListener('unmute', onUnmute);
      vTrack.addEventListener('mute', onMute);
      vTrack.addEventListener('ended', onEnded);

      // Attempt initial autoplay if not already unlocked
      if (!isPlaybackUnlocked) {
        video.play().then(() => {
          setIsPlaybackUnlocked(true);
          setIsAutoplayBlocked(false);
          setIsVideoPlaying(true);
          setPlaybackError(null);
        }).catch(e => {
          console.warn('[DuoWatch Diagnostics] Guest autoplay prevented by browser policy (gesture required):', e);
          setIsAutoplayBlocked(true);
        });
      }

      return () => {
        vTrack.removeEventListener('unmute', onUnmute);
        vTrack.removeEventListener('mute', onMute);
        vTrack.removeEventListener('ended', onEnded);
      };
    } else {
      video.srcObject = null;
      setIsVideoPlaying(false);
      setHasDecodedFrames(false);
    }
  }, [isOwner, remoteMediaStream, remoteStreamRevision, isPlaybackUnlocked]);

  // Synchronize Host local playback when remote play/pause/seek arrives from Partner
  useEffect(() => {
    if (!isOwner || !hostVideoRef.current) return;
    const vid = hostVideoRef.current;
    const action = mediaState.action;

    if (action === 'play' && vid.paused) {
      vid.play().then(() => {
        setIsLocalPlaying(true);
        initializeStreamCapture();
      }).catch(() => { });
    } else if (action === 'pause' && !vid.paused) {
      vid.pause();
      setIsLocalPlaying(false);
    } else if (action === 'seek' && typeof mediaState.currentTime === 'number') {
      if (Math.abs(vid.currentTime - mediaState.currentTime) > 1.5) {
        vid.currentTime = mediaState.currentTime;
        setCurrentTime(mediaState.currentTime);
      }
    }
  }, [isOwner, mediaState.action, mediaState.currentTime, mediaState.isPlaying, initializeStreamCapture]);

  // Synchronize Partner local playback element with room mediaState
  useEffect(() => {
    if (isOwner || !guestVideoRef.current) return;
    const vid = guestVideoRef.current;
    if (mediaState.isPlaying && vid.paused && isPlaybackUnlocked) {
      vid.play().catch(e => console.warn('[DuoWatch Diagnostics] Partner play on sync:', e));
    } else if (!mediaState.isPlaying && !vid.paused) {
      vid.pause();
    }
  }, [isOwner, mediaState.isPlaying, isPlaybackUnlocked]);

  // Partner playback control with bounded timeout & user gesture unlock (Phase 22 Repair)
  const handlePartnerPlay = async () => {
    const video = guestVideoRef.current;
    if (!video) return;

    setPlaybackError(null);
    setIsAttemptingPlay(true);

    // Bounded safety timeout: ensure isAttemptingPlay NEVER remains stuck indefinitely
    let isTimedOut = false;
    const timeoutId = window.setTimeout(() => {
      isTimedOut = true;
      setIsAttemptingPlay(false);
      if (!hasDecodedFrames) {
        console.log('[DuoWatch Diagnostics] Partner playback attempt timed out waiting for frames from host.');
      }
    }, 4500);

    try {
      if (remoteMediaStream && video.srcObject !== remoteMediaStream) {
        video.srcObject = remoteMediaStream;
      }

      video.playsInline = true;
      video.volume = playerVolume / 100;
      video.muted = isPlayerMuted;

      try {
        await video.play();
        if (!isTimedOut) {
          setIsPlaybackUnlocked(true);
          setIsAutoplayBlocked(false);
          setIsVideoPlaying(true);
          setPlaybackError(null);
        }
      } catch (err: any) {
        if (err.name === 'NotAllowedError') {
          // Fallback: Start muted first to satisfy browser gesture requirements
          console.warn('[DuoWatch Diagnostics] Unmuted playback blocked, trying muted fallback...');
          video.muted = true;
          await video.play();
          if (!isTimedOut) {
            setIsPlaybackUnlocked(true);
            setIsAutoplayBlocked(false);
            setPlaybackError(null);
            // Re-apply unmuted if user didn't mute
            if (!isPlayerMuted) {
              video.muted = false;
              video.volume = playerVolume / 100;
            }
          }
        } else {
          throw err;
        }
      }

      // If the room state indicates paused, send play action to Host
      if (!mediaState.isPlaying) {
        updateMediaState({ action: 'play', isPlaying: true, currentTime: mediaState.currentTime || 0 });
      }
    } catch (err: any) {
      console.warn('[DuoWatch Diagnostics] Partner playback attempt error:', err);
      setPlaybackError(err.message || 'Browser blocked media playback. Click Retry.');
    } finally {
      window.clearTimeout(timeoutId);
      setIsAttemptingPlay(false);
    }
  };

  // Handle local video file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/') && !/\.(mp4|webm|ogg|mkv|mov|m4v)$/i.test(file.name)) {
      setStreamError('Unsupported file type. Please select a valid video file (MP4, WebM, Ogg, MKV, MOV).');
      return;
    }

    setStreamError(null);
    setSelectedFileName(file.name);

    if (fileObjectUrl) {
      URL.revokeObjectURL(fileObjectUrl);
    }
    if (capturedStreamRef.current) {
      capturedStreamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch { }
      });
      capturedStreamRef.current = null;
    }
    if (localMediaStream) {
      localMediaStream.getTracks().forEach(t => {
        try { t.stop(); } catch { }
      });
      setLocalMediaStream(null);
    }

    const objUrl = URL.createObjectURL(file);
    setFileObjectUrl(objUrl);
    setCurrentTime(0);
    setDuration(0);
    setSourceResolution(null);

    if (hostVideoRef.current) {
      hostVideoRef.current.src = objUrl;
      hostVideoRef.current.load();
    }
  };

  // When Partner video metadata or dimensions change
  const handleGuestMetadata = () => {
    if (guestVideoRef.current) {
      const w = guestVideoRef.current.videoWidth || 0;
      const h = guestVideoRef.current.videoHeight || 0;
      if (w > 0 && h > 0) {
        setGuestResolution({ width: w, height: h });
        setHasDecodedFrames(true);
      }
    }
  };

  // Host playback controls
  const toggleHostPlay = () => {
    if (!hostVideoRef.current || !isOwner) return;
    const vid = hostVideoRef.current;
    if (vid.paused) {
      vid.play().then(() => {
        setIsLocalPlaying(true);
        initializeStreamCapture();
        updateMediaState({ action: 'play', isPlaying: true, currentTime: vid.currentTime });
      }).catch(err => {
        console.warn('Host play error:', err);
      });
    } else {
      vid.pause();
      setIsLocalPlaying(false);
      updateMediaState({ action: 'pause', isPlaying: false, currentTime: vid.currentTime });
    }
  };

  const handleHostTimeUpdate = () => {
    if (!hostVideoRef.current) return;
    setCurrentTime(hostVideoRef.current.currentTime);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hostVideoRef.current || !isOwner) return;
    const seekTime = parseFloat(e.target.value);
    hostVideoRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
    updateMediaState({ action: 'seek', currentTime: seekTime, isPlaying: !hostVideoRef.current.paused });
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const shouldShowOverlay =
    (!isPlaybackUnlocked && isAutoplayBlocked) ||
    playbackError !== null ||
    isAttemptingPlay;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden select-none">
      {/* OWNER (HOST) VIEW */}
      {isOwner && (
        <div className="w-full h-full flex flex-col items-center justify-center">
          {fileObjectUrl ? (
            <div className="relative w-full h-full flex items-center justify-center group">
              <video
                ref={hostVideoRef}
                src={fileObjectUrl || undefined}
                onLoadedMetadata={() => {
                  initializeStreamCapture();
                  if (hostVideoRef.current) {
                    updateMediaState({
                      action: 'state_snapshot',
                      mode: 'local',
                      duration: hostVideoRef.current.duration || 0,
                      currentTime: 0,
                      isPlaying: false,
                    });
                  }
                }}
                onLoadedData={initializeStreamCapture}
                onCanPlay={initializeStreamCapture}
                onPlay={() => {
                  initializeStreamCapture();
                  setIsLocalPlaying(true);
                }}
                onPlaying={() => {
                  initializeStreamCapture();
                  setIsLocalPlaying(true);
                }}
                onPause={() => setIsLocalPlaying(false)}
                onTimeUpdate={handleHostTimeUpdate}
                playsInline
                className="w-full h-full max-h-full object-contain"
              />

              {/* Host Quality Badge */}
              {sourceResolution && (
                <div className="absolute top-2 sm:top-4 left-2 sm:left-4 z-20 pointer-events-none flex items-center gap-1.5 sm:gap-2 bg-[#14161d]/85 backdrop-blur-md border border-[#282d3c] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg shadow-lg text-[10px] sm:text-[11px] font-mono text-gray-300">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-semibold text-amber-400">
                    {sourceResolution.height >= 1080 ? '1080p Full HD' : `${sourceResolution.height}p`}
                  </span>
                  <span className="text-gray-500">•</span>
                  <span>{sourceResolution.width}×{sourceResolution.height}</span>
                  {streamStats?.outbound?.bitrateBps ? (
                    <>
                      <span className="text-gray-500">•</span>
                      <span className="text-emerald-400">{(streamStats.outbound.bitrateBps / 1_000_000).toFixed(1)} Mbps</span>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-500">•</span>
                      <span className="text-emerald-400">5.0 Mbps Target</span>
                    </>
                  )}
                </div>
              )}

              {/* Host Floating Cinema Scrubber Overlay */}
              <div className="absolute bottom-2 sm:bottom-6 left-2 sm:left-6 right-2 sm:right-6 z-20 bg-[#14161d]/90 backdrop-blur-md border border-[#282d3c] p-2 sm:p-3 rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
                <div className="flex items-center gap-2 sm:gap-3">
                  <button
                    onClick={toggleHostPlay}
                    aria-label={isLocalPlaying ? 'Pause video' : 'Play video'}
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                  >
                    {isLocalPlaying ? <Pause className="w-4 h-4 sm:w-5 sm:h-5" /> : <Play className="w-4 h-4 sm:w-5 sm:h-5 ml-0.5" />}
                  </button>

                  <div className="flex-1 flex flex-col justify-center min-w-0">
                    <input
                      type="range"
                      min={0}
                      max={duration || 100}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                      aria-label="Seek time"
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg appearance-none"
                    />
                    <div className="flex justify-between text-[10px] sm:text-[11px] text-gray-400 font-mono mt-1">
                      <span>{formatTime(currentTime)}</span>
                      <span className="truncate max-w-[120px] sm:max-w-[200px] text-gray-300 font-sans">{selectedFileName}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Change movie file"
                    className="text-xs text-gray-300 hover:text-white bg-[#1c1f2a] hover:bg-[#282d3c] px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-[#282d3c] flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Change File</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* File Picker Empty State */
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
              <div className="w-16 h-16 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-6 shadow-xl">
                <Film className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-100 mb-2">Local File Cinema</h3>
              <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                Select a video file from your computer to stream directly to your partner in real time over WebRTC. Zero cloud uploads.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/ogg,video/mkv,video/*"
                onChange={handleFileChange}
                className="hidden"
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!hasCaptureStreamSupport}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-6 py-3 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-amber-500/20 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                Select Movie File
              </button>

              <div className="flex items-center gap-1.5 text-xs text-emerald-400/90 mt-5">
                <ShieldCheck className="w-4 h-4" />
                <span>Encrypted P2P Transmit • Never Uploaded to Cloud</span>
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
                onPlay={() => setIsVideoPlaying(true)}
                onPlaying={() => {
                  setIsVideoPlaying(true);
                  setHasDecodedFrames(true);
                  setIsPlaybackUnlocked(true);
                  setIsAutoplayBlocked(false);
                  setPlaybackError(null);
                  setIsAttemptingPlay(false);
                }}
                onCanPlay={() => {
                  if (guestVideoRef.current && guestVideoRef.current.videoWidth > 0) {
                    setHasDecodedFrames(true);
                  }
                }}
                onLoadedMetadata={handleGuestMetadata}
                onResize={handleGuestMetadata}
                onPause={() => {
                  setIsVideoPlaying(false);
                }}
                onWaiting={() => {
                  console.log('[DuoWatch Diagnostics] Partner video waiting for incoming stream packets...');
                }}
                onStalled={() => {
                  console.log('[DuoWatch Diagnostics] Partner video stream stalled.');
                }}
                onError={() => {
                  const err = guestVideoRef.current?.error?.message || 'Media stream decode failed';
                  console.warn('[DuoWatch Diagnostics] Partner video error:', err);
                  setPlaybackError(`Video playback error: ${err}`);
                }}
                className="w-full h-full max-h-full object-contain"
              />

              {/* Partner Quality Badge */}
              {(guestResolution || streamStats?.inbound) && (
                <div className="absolute top-4 left-4 z-20 pointer-events-none flex items-center gap-2 bg-[#14161d]/85 backdrop-blur-md border border-[#282d3c] px-3 py-1.5 rounded-lg shadow-lg text-[11px] font-mono text-gray-300">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-semibold text-amber-400">
                    {((streamStats?.inbound?.frameHeight || guestResolution?.height || 0) >= 1080)
                      ? '1080p Full HD'
                      : `${streamStats?.inbound?.frameHeight || guestResolution?.height || 720}p`}
                  </span>
                  <span className="text-gray-500">•</span>
                  <span>
                    {streamStats?.inbound?.frameWidth || guestResolution?.width || 1920}×{streamStats?.inbound?.frameHeight || guestResolution?.height || 1080}
                  </span>
                  {streamStats?.inbound?.bitrateBps ? (
                    <>
                      <span className="text-gray-500">•</span>
                      <span className="text-emerald-400">{(streamStats.inbound.bitrateBps / 1_000_000).toFixed(1)} Mbps</span>
                    </>
                  ) : null}
                  {streamStats?.inbound?.fps ? (
                    <>
                      <span className="text-gray-500">•</span>
                      <span>{streamStats.inbound.fps} FPS</span>
                    </>
                  ) : null}
                </div>
              )}

              {/* Partner Paused Indicator when Host pauses and stream is unlocked */}
              {!mediaState.isPlaying && isPlaybackUnlocked && !shouldShowOverlay && (
                <div className="absolute top-4 right-4 z-20 pointer-events-none flex items-center gap-1.5 bg-[#14161d]/85 backdrop-blur-md border border-[#282d3c] px-3 py-1.5 rounded-lg shadow-lg text-[11px] font-mono text-amber-400 animate-in fade-in">
                  <Pause className="w-3.5 h-3.5" />
                  <span>Host Paused Cinema</span>
                </div>
              )}

              {/* Partner Buffering / Muted Stream Indicator */}
              {isStreamMuted && isPlaybackUnlocked && !shouldShowOverlay && (
                <div className="absolute bottom-4 left-4 z-20 pointer-events-none flex items-center gap-1.5 bg-[#14161d]/85 backdrop-blur-md border border-[#282d3c] px-3 py-1.5 rounded-lg shadow-lg text-[11px] font-mono text-gray-300 animate-in fade-in">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  <span>Buffering Stream...</span>
                </div>
              )}

              {/* Partner Playback Overlay */}
              {shouldShowOverlay && (
                <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-30 animate-in fade-in duration-200">
                  <div className="w-16 h-16 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
                    <Film className={`w-8 h-8 ${isAttemptingPlay ? 'animate-spin' : 'animate-pulse'}`} />
                  </div>

                  {playbackError ? (
                    <>
                      <div className="flex items-center gap-2 text-red-400 mb-2 font-semibold text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Playback Issue</span>
                      </div>
                      <p className="text-xs text-gray-400 mb-4 max-w-sm leading-relaxed">
                        {playbackError}
                      </p>
                      <button
                        onClick={handlePartnerPlay}
                        disabled={isAttemptingPlay}
                        className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-xs px-6 py-3 rounded-lg shadow-lg transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Retry Playback
                      </button>
                    </>
                  ) : isAttemptingPlay ? (
                    <>
                      <h4 className="text-sm font-semibold text-gray-100 mb-1">Starting Video Playback...</h4>
                      <p className="text-xs text-gray-400 mb-4 max-w-xs">
                        Connecting to incoming P2P video stream and initializing audio.
                      </p>
                      <button
                        onClick={() => {
                          setIsAttemptingPlay(false);
                          setPlaybackError('Playback attempt cancelled by user.');
                        }}
                        className="text-xs text-gray-400 hover:text-gray-200 underline cursor-pointer"
                      >
                        Cancel
                      </button>
                    </>
                  ) : !isPlaybackUnlocked && isAutoplayBlocked ? (
                    <>
                      <h4 className="text-base font-bold text-gray-100 mb-1">Incoming Movie Stream</h4>
                      <p className="text-xs text-gray-400 mb-5 max-w-xs leading-relaxed">
                        Host is streaming a video file. Click below to start synchronized Full HD video and audio playback.
                      </p>
                      <button
                        onClick={handlePartnerPlay}
                        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-6 py-3 rounded-lg shadow-lg shadow-amber-500/20 transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        Click to Play Video & Audio
                      </button>
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/90 mt-4 font-mono">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>DTLS-SRTP P2P Encrypted Stream</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <h4 className="text-sm font-semibold text-gray-100 mb-1">Connecting to Stream...</h4>
                      <p className="text-xs text-gray-400 mb-4 max-w-xs">
                        Waiting for initial video frames from Host.
                      </p>
                      <button
                        onClick={handlePartnerPlay}
                        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs px-5 py-2.5 rounded-lg shadow-lg transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Force Play
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm">
              <div className="w-14 h-14 rounded-xl bg-[#14161d] border border-[#282d3c] flex items-center justify-center text-amber-400 mb-4 animate-pulse">
                <Film className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-gray-200 mb-1">Waiting for Host Video</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                The cinema host is selecting a local video file. The stream will begin automatically once playback starts.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error Banner */}
      {streamError && (
        <div className="absolute top-4 left-4 right-4 z-30 max-w-md mx-auto bg-red-950/90 border border-red-500/40 backdrop-blur-md p-3 rounded-lg text-xs text-red-200 flex items-start gap-2 shadow-xl">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{streamError}</span>
        </div>
      )}
    </div>
  );
};
