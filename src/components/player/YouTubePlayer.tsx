import React, { useEffect, useRef, useState } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { AlertCircle, ExternalLink, Search, Film } from 'lucide-react';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export const YouTubePlayer: React.FC = () => {
  const { session, mediaState, updateMediaState } = useCinema();
  const isOwner = session?.role === 'owner';

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [isPlayerReady, setIsPlayerReady] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState<string>('');
  const [isApplyingHostSync, setIsApplyingHostSync] = useState<boolean>(false);

  // Parse YouTube video ID from URL or input
  const extractVideoId = (input: string): string | null => {
    const trimmed = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/;
    const match = trimmed.match(regExp);
    return match ? match[1] : null;
  };

  // Load YouTube IFrame API Script
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    const initPlayer = () => {
      if (!containerRef.current || playerRef.current) return;

      const playerDiv = document.createElement('div');
      playerDiv.id = 'duowatch-yt-player';
      containerRef.current.appendChild(playerDiv);

      playerRef.current = new window.YT.Player('duowatch-yt-player', {
        videoId: mediaState.videoId || 'dQw4w9WgXcQ',
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: isOwner ? 1 : 0, // Guest controls disabled to ensure host authority
          disablekb: isOwner ? 0 : 1,
          fs: 0, // We use custom fullscreen on the cinema container
          modestbranding: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            setIsPlayerReady(true);
            setErrorMessage(null);
          },
          onStateChange: (event: any) => {
            if (!isOwner || isApplyingHostSync) return;

            // YT.PlayerState: PLAYING (1), PAUSED (2), BUFFERING (3), CUED (5)
            if (event.data === 1) { // Playing
              const time = playerRef.current?.getCurrentTime() || 0;
              updateMediaState({ isPlaying: true, currentTime: time });
            } else if (event.data === 2) { // Paused
              const time = playerRef.current?.getCurrentTime() || 0;
              updateMediaState({ isPlaying: false, currentTime: time });
            }
          },
          onError: (event: any) => {
            let msg = 'Failed to load video.';
            switch (event.data) {
              case 2:
                msg = 'Invalid video ID or URL format.';
                break;
              case 5:
                msg = 'HTML5 player playback error.';
                break;
              case 100:
                msg = 'Video not found, removed, or set to private.';
                break;
              case 101:
              case 150:
                msg = 'The video owner does not allow embedded playback outside YouTube.';
                break;
            }
            setErrorMessage(msg);
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try {
          playerRef.current.destroy();
        } catch (e) {}
        playerRef.current = null;
      }
      setIsPlayerReady(false);
    };
  }, []);

  // Periodic Host Heartbeat: keeps partner synchronized during long movie playback
  useEffect(() => {
    if (!isOwner || !isPlayerReady || !playerRef.current) return;

    const interval = setInterval(() => {
      if (typeof playerRef.current.getCurrentTime === 'function') {
        const time = playerRef.current.getCurrentTime();
        const duration = playerRef.current.getDuration() || mediaState.duration;
        const playerState = playerRef.current.getPlayerState();
        const isPlaying = playerState === 1;

        updateMediaState({
          currentTime: time,
          duration,
          isPlaying,
        });
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isOwner, isPlayerReady, updateMediaState, mediaState.duration]);

  // Synchronize Guest with Host (Drift Calculation & Correction)
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || isOwner) return;

    try {
      setIsApplyingHostSync(true);

      // 1. Video ID sync
      if (mediaState.videoId && typeof playerRef.current.getVideoData === 'function') {
        const currentId = playerRef.current.getVideoData()?.video_id;
        if (currentId !== mediaState.videoId) {
          playerRef.current.loadVideoById(mediaState.videoId, mediaState.currentTime);
          setErrorMessage(null);
        }
      }

      // 2. Compute calculated host time accounting for time elapsed since update was sent
      const elapsedSec = (Date.now() - (mediaState.clientTimestamp || Date.now())) / 1000;
      const targetTime = mediaState.currentTime + (mediaState.isPlaying ? Math.max(0, elapsedSec) : 0);
      const guestCurrentTime = playerRef.current.getCurrentTime?.() || 0;
      const drift = Math.abs(guestCurrentTime - targetTime);

      // Drift threshold: 0.75 seconds
      if (drift > 0.75) {
        playerRef.current.seekTo(targetTime, true);
      }

      // 3. Play / Pause state sync
      const guestPlayerState = playerRef.current.getPlayerState?.();
      if (mediaState.isPlaying && guestPlayerState !== 1 && guestPlayerState !== 3) {
        playerRef.current.playVideo();
      } else if (!mediaState.isPlaying && guestPlayerState === 1) {
        playerRef.current.pauseVideo();
      }
    } catch (e) {
      console.warn('Guest sync error:', e);
    } finally {
      setTimeout(() => setIsApplyingHostSync(false), 300);
    }
  }, [mediaState, isPlayerReady, isOwner]);

  // Handle Host changing video
  const handleLoadNewVideo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;

    const id = extractVideoId(inputUrl);
    if (!id) {
      setErrorMessage('Please enter a valid YouTube URL or 11-character video ID.');
      return;
    }

    setErrorMessage(null);
    setInputUrl('');
    updateMediaState({
      videoId: id,
      currentTime: 0,
      isPlaying: true,
    });

    if (playerRef.current?.loadVideoById) {
      playerRef.current.loadVideoById(id, 0);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden group">
      {/* Video Container */}
      <div 
        ref={containerRef} 
        className="w-full h-full flex items-center justify-center aspect-video pointer-events-auto"
      />

      {/* Host Video Search / URL Input Bar (Visible to Host) */}
      {isOwner && (
        <div className="absolute top-4 left-4 right-4 z-20 max-w-xl mx-auto opacity-90 hover:opacity-100 transition-opacity">
          <form 
            onSubmit={handleLoadNewVideo}
            className="flex items-center gap-2 bg-[#14161d]/90 backdrop-blur-md border border-[#282d3c] p-1.5 rounded-xl shadow-2xl focus-within:border-amber-500/60 transition-colors"
          >
            <Film className="w-5 h-5 text-amber-400 ml-2 shrink-0" />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Paste YouTube video link or ID (e.g. https://youtu.be/...)"
              className="w-full bg-transparent text-sm text-gray-200 placeholder-gray-500 focus:outline-none px-2"
            />
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-transform active:scale-95 shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              Load
            </button>
          </form>
        </div>
      )}

      {/* Guest Notice: Host Authoritative */}
      {!isOwner && (
        <div className="absolute top-4 left-4 z-10 pointer-events-none">
          <span className="text-[11px] font-medium bg-[#14161d]/80 backdrop-blur-md text-amber-300/90 border border-amber-500/30 px-2.5 py-1 rounded-full shadow-lg flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Host-Authoritative Playback Active
          </span>
        </div>
      )}

      {/* Embed Restriction or Playback Error Notice */}
      {errorMessage && (
        <div className="absolute inset-0 z-30 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-4">
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
            {isOwner && (
              <button
                onClick={() => setErrorMessage(null)}
                className="bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                Choose Another Video
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
