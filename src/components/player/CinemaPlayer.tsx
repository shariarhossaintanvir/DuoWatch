import React, { useRef, useState, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { YouTubePlayer } from './YouTubePlayer';
import { LocalFilePlayer } from './LocalFilePlayer';
import { ScreenSharePlayer } from './ScreenSharePlayer';
import { PlayerControls } from './PlayerControls';

export const CinemaPlayer: React.FC = () => {
  const { mediaState, reactions, cinemaLights } = useCinema();
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Monitor Fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!playerContainerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await playerContainerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
    }
  };

  return (
    <div 
      ref={playerContainerRef}
      className={`relative w-full flex-1 flex flex-col bg-black rounded-2xl overflow-hidden border border-[#282d3c] shadow-2xl transition-all duration-500 ${
        cinemaLights ? 'ring-2 ring-amber-500/30 shadow-[0_0_80px_rgba(245,158,11,0.15)]' : ''
      }`}
    >
      {/* Main Video Viewport */}
      <div className="relative flex-1 w-full h-full min-h-[360px] bg-[#050608] flex items-center justify-center overflow-hidden">
        {mediaState.mode === 'youtube' && <YouTubePlayer />}
        {mediaState.mode === 'local' && <LocalFilePlayer />}
        {mediaState.mode === 'screen' && <ScreenSharePlayer />}

        {/* Floating Emoji Reactions Overlay */}
        <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
          {reactions.map((r) => (
            <div
              key={r.id}
              style={{ left: `${r.xOffset}%` }}
              className="absolute bottom-12 text-4xl animate-bounce-float select-none drop-shadow-lg flex flex-col items-center"
            >
              <span>{r.emoji}</span>
              <span className="text-[10px] text-white/80 bg-black/60 px-1.5 py-0.5 rounded-full mt-1 font-sans">
                {r.senderName}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Cinema Player Controls */}
      <PlayerControls 
        onToggleFullscreen={toggleFullscreen} 
        isFullscreen={isFullscreen} 
      />
    </div>
  );
};
