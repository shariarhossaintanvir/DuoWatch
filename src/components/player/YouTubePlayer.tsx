import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { AlertCircle, ExternalLink, Search, Film } from 'lucide-react';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

// YT.PlayerState constants
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;

// Drift correction threshold (seconds). Position updates within this window are not corrected to prevent micro-buffering.
const DRIFT_THRESHOLD_SEC = 2.5;

// Remote command lock timeout (ms)
const APPLY_LOCKOUT_MS = 500;

export const YouTubePlayer: React.FC = () => {
  const {
    session,
    myParticipantId,
    mediaState,
    updateMediaState,
    playerVolume,
    isPlayerMuted,
  } = useCinema();

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const isPlayerReadyRef = useRef<boolean>(false);
  const [isPlayerReady, setIsPlayerReady] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState<string>('');

  // Synchronization guards
  const isApplyingRemoteRef = useRef<boolean>(false);
  const applyLockoutTimerRef = useRef<number | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const lastProcessedTokenRef = useRef<string | null>(null);
  const mediaStateRef = useRef(mediaState);
  mediaStateRef.current = mediaState;

  // Helper to safely apply remote lockout
  const setRemoteLockout = useCallback((durationMs: number = APPLY_LOCKOUT_MS) => {
    isApplyingRemoteRef.current = true;
    if (applyLockoutTimerRef.current) {
      clearTimeout(applyLockoutTimerRef.current);
    }
    applyLockoutTimerRef.current = window.setTimeout(() => {
      isApplyingRemoteRef.current = false;
      applyLockoutTimerRef.current = null;
    }, durationMs);
  }, []);

  // Parse YouTube video ID from URL or bare ID
  const extractVideoId = (input: string): string | null => {
    const trimmed = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([\w-]{11})/;
    const match = trimmed.match(regExp);
    return match ? match[1] : null;
  };

  // Apply volume/mute to the player
  const applyVolumeToPlayer = useCallback(() => {
    if (!playerRef.current || !isPlayerReadyRef.current) return;
    try {
      if (typeof playerRef.current.setVolume === 'function') {
        playerRef.current.setVolume(playerVolume);
      }
      if (typeof playerRef.current.mute === 'function') {
        if (isPlayerMuted) {
          playerRef.current.mute();
        } else {
          playerRef.current.unMute();
        }
      }
    } catch { }
  }, [playerVolume, isPlayerMuted]);

  // Keep latest onStateChange handler in ref to completely avoid stale closures
  const onStateChangeRef = useRef<(event: any) => void>(() => { });
  onStateChangeRef.current = (event: any) => {
    if (isApplyingRemoteRef.current) return;

    const state = event.data;
    const player = playerRef.current;
    if (!player) return;

    const time = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
    const currentVideoId = loadedVideoIdRef.current || mediaStateRef.current.videoId;

    if (state === YT_PLAYING) {
      updateMediaState({
        action: 'play',
        isPlaying: true,
        currentTime: time,
        videoId: currentVideoId,
      });
    } else if (state === YT_PAUSED) {
      updateMediaState({
        action: 'pause',
        isPlaying: false,
        currentTime: time,
        videoId: currentVideoId,
      });
    }
  };

  // Player initialisation (runs once)
  useEffect(() => {
    const initPlayer = () => {
      if (!containerRef.current || playerRef.current) return;

      const playerDiv = document.createElement('div');
      playerDiv.id = 'duowatch-yt-player';
      containerRef.current.appendChild(playerDiv);

      const initialVideoId = mediaStateRef.current.videoId || 'dQw4w9WgXcQ';

      playerRef.current = new window.YT.Player('duowatch-yt-player', {
        videoId: initialVideoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          disablekb: 0,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            isPlayerReadyRef.current = true;
            setIsPlayerReady(true);
            setErrorMessage(null);
            loadedVideoIdRef.current = initialVideoId;
            applyVolumeToPlayer();

            // If active media state has a different videoId (e.g. from host state snapshot), load it
            const activeVideoId = mediaStateRef.current.videoId;
            if (activeVideoId && activeVideoId !== initialVideoId && playerRef.current?.loadVideoById) {
              loadedVideoIdRef.current = activeVideoId;
              playerRef.current.loadVideoById(activeVideoId, mediaStateRef.current.currentTime || 0);
            }
          },

          onStateChange: (event: any) => {
            onStateChangeRef.current(event);
          },

          onError: (event: any) => {
            let msg = 'Failed to load video.';
            switch (event.data) {
              case 2: msg = 'Invalid video ID or URL format.'; break;
              case 5: msg = 'HTML5 player playback error.'; break;
              case 100: msg = 'Video not found, removed, or set to private.'; break;
              case 101:
              case 150: msg = 'The video owner does not allow embedded playback outside YouTube.'; break;
            }
            setErrorMessage(msg);
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else if (!window.onYouTubeIframeAPIReady) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = initPlayer;
    } else {
      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousCallback?.();
        initPlayer();
      };
    }

    return () => {
      if (applyLockoutTimerRef.current) {
        clearTimeout(applyLockoutTimerRef.current);
      }
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try { playerRef.current.destroy(); } catch { }
        playerRef.current = null;
      }
      isPlayerReadyRef.current = false;
      setIsPlayerReady(false);
      loadedVideoIdRef.current = null;
      lastProcessedTokenRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Volume / mute sync (local only, never broadcast)
  useEffect(() => {
    applyVolumeToPlayer();
  }, [applyVolumeToPlayer]);

  // Periodic position heartbeat from Host (position drift correction only)
  useEffect(() => {
    if (session?.role !== 'owner' || !isPlayerReady) return;

    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player || !isPlayerReadyRef.current) return;
      // Do not send heartbeat if mediaState is paused or changing
      if (!mediaStateRef.current.isPlaying) return;

      const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
      if (state !== YT_PLAYING) return; // Only heartbeat while actively playing

      const time = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
      const duration = typeof player.getDuration === 'function' ? player.getDuration() : mediaStateRef.current.duration;

      updateMediaState({
        action: 'heartbeat',
        isPlaying: true,
        currentTime: time,
        duration,
        videoId: loadedVideoIdRef.current || mediaStateRef.current.videoId,
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [session?.role, isPlayerReady, updateMediaState]);

  // Playback sync effect: handles both remote broadcasts and local PlayerControls commands
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return;

    // Deduplicate identical message pulses
    const updateToken = `${mediaState.lastUpdatedBy}:${mediaState.clientTimestamp}:${mediaState.action}:${mediaState.isPlaying}:${mediaState.currentTime}`;
    if (updateToken === lastProcessedTokenRef.current) return;
    lastProcessedTokenRef.current = updateToken;

    const player = playerRef.current;
    const action = mediaState.action;
    const incomingVideoId = mediaState.videoId;
    const isSelfAction = mediaState.lastUpdatedBy === myParticipantId;

    try {
      // 1. VIDEO CHANGE: ONLY allowed when action === 'video_change' or 'state_snapshot'
      const shouldLoadVideo = incomingVideoId &&
        incomingVideoId !== loadedVideoIdRef.current &&
        (action === 'video_change' || action === 'state_snapshot');

      if (shouldLoadVideo) {
        loadedVideoIdRef.current = incomingVideoId;
        setRemoteLockout(800);
        player.loadVideoById(incomingVideoId, mediaState.currentTime || 0);
        setErrorMessage(null);
        return;
      }

      // If own heartbeat, ignore
      if (isSelfAction && action === 'heartbeat') {
        return;
      }

      // 2. HEARTBEAT: drift correction during steady-state playback
      if (action === 'heartbeat') {
        if (!mediaState.isPlaying) return;
        const rawElapsed = (Date.now() - (mediaState.clientTimestamp || Date.now())) / 1000;
        const elapsedSec = Math.min(0.5, Math.max(0, rawElapsed));
        const targetTime = mediaState.currentTime + elapsedSec;
        const localTime = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
        const drift = Math.abs(localTime - targetTime);

        if (drift > DRIFT_THRESHOLD_SEC) {
          setRemoteLockout(500);
          player.seekTo(targetTime, true);
        }
        return;
      }

      // 3. PLAY / PAUSE / SEEK / STATE_SNAPSHOT (Remote peer OR self from PlayerControls)
      const rawElapsed = (Date.now() - (mediaState.clientTimestamp || Date.now())) / 1000;
      const elapsedSec = Math.min(0.5, Math.max(0, rawElapsed));
      const targetTime = mediaState.currentTime + (mediaState.isPlaying ? elapsedSec : 0);
      const localTime = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
      const drift = Math.abs(localTime - targetTime);
      const localPlayerState = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;

      // Handle seek: explicit seek action or significant drift
      if (action === 'seek' || drift > DRIFT_THRESHOLD_SEC) {
        if (Math.abs(localTime - targetTime) > 0.5) {
          setRemoteLockout(500);
          player.seekTo(targetTime, true);
        }
      }

      // Handle Play / Pause: applies to both remote broadcasts and local PlayerControls clicks
      if (mediaState.isPlaying) {
        if (localPlayerState !== YT_PLAYING && localPlayerState !== YT_BUFFERING) {
          setRemoteLockout(500);
          player.playVideo();
        }
      } else {
        if (localPlayerState === YT_PLAYING || localPlayerState === YT_BUFFERING) {
          setRemoteLockout(500);
          player.pauseVideo();
        }
      }
    } catch (e) {
      console.warn('YouTubePlayer playback sync error:', e);
    }
  }, [mediaState, isPlayerReady, myParticipantId, setRemoteLockout]);

  // Local video-change handler (search bar submit)
  const handleLoadNewVideo = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const id = extractVideoId(inputUrl);
    if (!id) {
      setErrorMessage('Please enter a valid YouTube URL or 11-character video ID.');
      return;
    }

    setErrorMessage(null);
    setInputUrl('');

    // Skip if already loaded
    if (id === loadedVideoIdRef.current) return;

    loadedVideoIdRef.current = id;
    setRemoteLockout(800);

    // Update shared state with explicit action tag
    updateMediaState({ action: 'video_change', videoId: id, currentTime: 0, isPlaying: true });

    // Load locally
    if (playerRef.current?.loadVideoById) {
      playerRef.current.loadVideoById(id, 0);
    }
  }, [inputUrl, updateMediaState, setRemoteLockout]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden group">
      {/* Video Container */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center aspect-video pointer-events-auto"
      />

      {/* Shared Video Search / URL Input Bar (Authorized for both Host and Partner) */}
      <div className="absolute top-2 sm:top-4 left-2 sm:left-4 right-2 sm:right-4 z-20 max-w-xl mx-auto opacity-90 hover:opacity-100 transition-opacity">
        <form
          onSubmit={handleLoadNewVideo}
          className="flex items-center gap-1.5 sm:gap-2 bg-[#14161d]/95 backdrop-blur-md border border-[#282d3c] p-1 sm:p-1.5 rounded-xl shadow-2xl focus-within:border-amber-500/60 transition-colors"
        >
          <Film className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 ml-1.5 sm:ml-2 shrink-0" />
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="YouTube link or ID (e.g. https://youtu.be/...)"
            aria-label="YouTube video URL or video ID"
            className="w-full bg-transparent text-xs sm:text-sm text-gray-200 placeholder-gray-500 focus:outline-none px-1.5 sm:px-2 min-w-0"
          />
          <button
            type="submit"
            aria-label="Load YouTube video"
            className="bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shrink-0"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden xs:inline sm:inline">Load</span>
          </button>
        </form>
      </div>

      {/* Shared Playback Synchronization Badge */}
      <div className="absolute bottom-4 left-4 z-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[11px] font-medium bg-[#14161d]/80 backdrop-blur-md text-amber-300/90 border border-amber-500/30 px-2.5 py-1 rounded-md shadow-lg flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Shared YouTube Playback Active
        </span>
      </div>

      {/* Embed Restriction or Playback Error Notice */}
      {errorMessage && (
        <div className="absolute inset-0 z-30 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-semibold text-gray-100 mb-1">Playback Notice</h3>
          <p className="text-sm text-gray-400 max-w-md mb-6">{errorMessage}</p>

          <div className="flex items-center gap-3">
            {mediaState.videoId && (
              <a
                href={`https://www.youtube.com/watch?v=${mediaState.videoId}`}
                target="_blank"
                rel="noreferrer"
                className="bg-[#1c1f2a] hover:bg-[#282d3c] text-gray-200 text-xs font-medium px-4 py-2 rounded-lg border border-[#282d3c] flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open on YouTube
              </a>
            )}
            <button
              onClick={() => setErrorMessage(null)}
              className="bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
