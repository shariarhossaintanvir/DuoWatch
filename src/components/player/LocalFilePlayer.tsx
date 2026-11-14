import React, { useRef, useState, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { Upload, Film, AlertTriangle, ShieldCheck, Play, Pause, RotateCcw, Sparkles } from 'lucide-react';

export const LocalFilePlayer: React.FC = () => {
  const {
    session,
    mediaState,
    remoteMediaStream,
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
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState<boolean>(false);
  const [sourceResolution, setSourceResolution] = useState<{ width: number; height: number } | null>(null);
  const [guestResolution, setGuestResolution] = useState<{ width: number; height: number } | null>(null);

  // Phase 16.1 Partner Playback States
  const [isVideoPlaying, setIsVideoPlaying] = useState<boolean>(false);
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

  // Clean up Object URL on unmount only
  const fileObjectUrlRef = useRef<string | null>(null);
  fileObjectUrlRef.current = fileObjectUrl;

  useEffect(() => {
    return () => {
      if (fileObjectUrlRef.current) {
        URL.revokeObjectURL(fileObjectUrlRef.current);
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

  // Attach remote stream to guest video element with stable srcObject check
  useEffect(() => {
    if (!isOwner && guestVideoRef.current) {
      const video = guestVideoRef.current;
      if (remoteMediaStream && remoteMediaStream.getVideoTracks().length > 0) {
        if (video.srcObject !== remoteMediaStream) {
          video.srcObject = remoteMediaStream;
        }
        // Attempt autoplay; if policy requires user gesture, mark state without crashing
        video.play().then(() => {
          setIsAutoplayBlocked(false);
          setIsVideoPlaying(true);
          setPlaybackError(null);
        }).catch(e => {
          console.warn('Guest video autoplay prevented by browser policy (gesture required):', e);
          setIsAutoplayBlocked(true);
          setIsVideoPlaying(false);
        });
      } else {
        video.srcObject = null;
        setIsVideoPlaying(false);
      }
    }
  }, [isOwner, remoteMediaStream]);

  // Synchronize Host local playback when remote play/pause/seek arrives from Partner
  useEffect(() => {
    if (!isOwner || !hostVideoRef.current) return;
    const vid = hostVideoRef.current;
    const action = mediaState.action;

    if (action === 'play' && vid.paused) {
      vid.play().then(() => setIsLocalPlaying(true)).catch(() => { });
    } else if (action === 'pause' && !vid.paused) {
      vid.pause();
      setIsLocalPlaying(false);
    } else if (action === 'seek' && typeof mediaState.currentTime === 'number') {
      if (Math.abs(vid.currentTime - mediaState.currentTime) > 1.5) {
        vid.currentTime = mediaState.currentTime;
        setCurrentTime(mediaState.currentTime);
      }
    }
  }, [isOwner, mediaState.action, mediaState.currentTime, mediaState.isPlaying]);

  // Synchronize Partner local playback element with room mediaState
  useEffect(() => {
    if (isOwner || !guestVideoRef.current) return;
    const vid = guestVideoRef.current;
    if (mediaState.isPlaying && vid.paused && !isAutoplayBlocked) {
      vid.play().catch(e => console.warn('Partner play on sync:', e));
    } else if (!mediaState.isPlaying && !vid.paused) {
      vid.pause();
    }
  }, [isOwner, mediaState.isPlaying, isAutoplayBlocked]);

  // Partner playback control and user gesture unlock sequence (Phase 16.1)
  const handlePartnerPlay = async () => {
    const video = guestVideoRef.current;
    if (!video) return;

    setPlaybackError(null);
    setIsAttemptingPlay(true);

    try {
      // 1. Ensure remote MediaStream is attached
      if (remoteMediaStream && video.srcObject !== remoteMediaStream) {
        video.srcObject = remoteMediaStream;
      }

      // 2. Configure video properties
      video.playsInline = true;
      video.volume = playerVolume / 100;
      video.muted = isPlayerMuted;

      // 3. First attempt: Standard unmuted playback
      await video.play();
      setIsAutoplayBlocked(false);
      setIsVideoPlaying(true);
      setPlaybackError(null);
    } catch (err: any) {
      console.warn('Unmuted playback blocked by browser policy, attempting muted fallback sequence:', err);
      try {
        // Fallback: Start muted first (guaranteed to succeed across all browsers on click gesture)
        video.muted = true;
        await video.play();

        // Immediately unmute if user has not muted
        if (!isPlayerMuted) {
          video.muted = false;
          video.volume = playerVolume / 100;
        }
        setIsAutoplayBlocked(false);
        setIsVideoPlaying(true);
        setPlaybackError(null);
      } catch (fallbackErr: any) {
        console.error('All playback attempts failed:', fallbackErr);
        setPlaybackError(fallbackErr.message || 'Browser blocked media playback. Click Retry.');
        setIsAutoplayBlocked(true);
        setIsVideoPlaying(false);
      }
    } finally {
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

    const objUrl = URL.createObjectURL(file);
    setFileObjectUrl(objUrl);

    if (hostVideoRef.current) {
      hostVideoRef.current.src = objUrl;
      hostVideoRef.current.load();
    }
  };

  // When Host video metadata loads, capture stream & pipe to WebRTC
  const handleHostLoadedMetadata = () => {
    if (!hostVideoRef.current || !isOwner) return;

    const vid = hostVideoRef.current;
    setDuration(vid.duration || 0);

    const w = vid.videoWidth || 0;
    const h = vid.videoHeight || 0;
    if (w > 0 && h > 0) {
      setSourceResolution({ width: w, height: h });
    }

    try {
      let stream: MediaStream | null = null;
      if (typeof (vid as any).captureStream === 'function') {
        stream = (vid as any).captureStream(30);
      } else if (typeof (vid as any).mozCaptureStream === 'function') {
        stream = (vid as any).mozCaptureStream(30);
      }

      if (stream) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && 'contentHint' in videoTrack) {
          try {
            (videoTrack as any).contentHint = 'motion';
          } catch { }
        }
        setLocalMediaStream(stream);
        updateMediaState({
          action: 'state_snapshot',
          mode: 'local',
          duration: vid.duration,
          currentTime: 0,
          isPlaying: false,
        });
      } else {
        setStreamError('Could not initialize media stream capture from selected video.');
      }
    } catch (err: any) {
      console.error('Error in captureStream:', err);
      setStreamError(`CaptureStream failed: ${err.message}`);
    }
  };

  // When Partner video metadata or dimensions change
  const handleGuestMetadata = () => {
    if (guestVideoRef.current) {
      const w = guestVideoRef.current.videoWidth || 0;
      const h = guestVideoRef.current.videoHeight || 0;
      if (w > 0 && h > 0) {
        setGuestResolution({ width: w, height: h });
      }
    }
  };

  // Host playback controls
  const toggleHostPlay = () => {
    if (!hostVideoRef.current || !isOwner) return;
    const vid = hostVideoRef.current;
    if (vid.paused) {
      vid.play();
      setIsLocalPlaying(true);
      updateMediaState({ isPlaying: true, currentTime: vid.currentTime });
    } else {
      vid.pause();
      setIsLocalPlaying(false);
      updateMediaState({ isPlaying: false, currentTime: vid.currentTime });
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
    updateMediaState({ currentTime: seekTime });
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

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
                onLoadedMetadata={handleHostLoadedMetadata}
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
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center transition-colors shrink-0"
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
                    className="text-xs text-gray-300 hover:text-white bg-[#1c1f2a] hover:bg-[#282d3c] px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-[#282d3c] flex items-center gap-1.5 shrink-0 transition-colors"
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
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-6 py-3 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-amber-500/20"
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
                  setIsAutoplayBlocked(false);
                  setPlaybackError(null);
                }}
                onPause={() => {
                  if (!mediaState.isPlaying) {
                    setIsVideoPlaying(false);
                  }
                }}
                onLoadedMetadata={handleGuestMetadata}
                onResize={handleGuestMetadata}
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

              {/* Partner Playback Overlay: Replaced misleading permanent black screen with responsive states */}
              {(!isVideoPlaying || isAutoplayBlocked) && (
                <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-30 animate-in fade-in duration-200">
                  <div className="w-16 h-16 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
                    <Film className={`w-8 h-8 ${isAttemptingPlay ? 'animate-spin' : 'animate-pulse'}`} />
                  </div>

                  {playbackError ? (
                    <>
                      <div className="flex items-center gap-2 text-red-400 mb-2 font-semibold text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Playback Failed</span>
                      </div>
                      <p className="text-xs text-gray-400 mb-4 max-w-sm leading-relaxed">
                        {playbackError}
                      </p>
                      <button
                        onClick={handlePartnerPlay}
                        disabled={isAttemptingPlay}
                        className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-xs px-6 py-3 rounded-lg shadow-lg transition-colors flex items-center gap-2"
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
                    </>
                  ) : (
                    <>
                      <h4 className="text-base font-bold text-gray-100 mb-1">Incoming Movie Stream</h4>
                      <p className="text-xs text-gray-400 mb-5 max-w-xs leading-relaxed">
                        Host is streaming a video file. Click below to start synchronized Full HD video and audio playback.
                      </p>
                      <button
                        onClick={handlePartnerPlay}
                        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-6 py-3 rounded-lg shadow-lg shadow-amber-500/20 transition-colors flex items-center gap-2"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        Click to Play Video & Audio
                      </button>
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/90 mt-4 font-mono">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>DTLS-SRTP P2P Encrypted Stream</span>
                      </div>
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
