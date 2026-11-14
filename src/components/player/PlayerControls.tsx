import React from 'react';
import { useCinema } from '../../context/CinemaContext';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Lightbulb,
  LightbulbOff,
  Share2,
  Sliders,
  Film,
  Monitor
} from 'lucide-react';
import { YoutubeIcon } from '../common/YoutubeIcon';
import type { MovieMode } from '../../types/cinema';

interface PlayerControlsProps {
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  onToggleFullscreen,
  isFullscreen
}) => {
  const {
    session,
    mediaState,
    changeMovieMode,
    cinemaLights,
    toggleCinemaLights,
    openSettings,
    openShareModal,
    playerVolume,
    isPlayerMuted,
    setPlayerVolume,
    togglePlayerMute,
    playMedia,
    pauseMedia,
    seekMedia,
  } = useCinema();

  const isOwner = session?.role === 'owner';

  const modes: { id: MovieMode; label: string; icon: any }[] = [
    { id: 'youtube', label: 'YouTube Together', icon: YoutubeIcon },
    { id: 'local', label: 'Local Movie', icon: Film },
    { id: 'screen', label: 'Screen Share', icon: Monitor },
  ];

  const handleTogglePlayPause = () => {
    if (mediaState.isPlaying) {
      pauseMedia();
    } else {
      playMedia();
    }
  };

  const handleSeekDelta = (deltaSec: number) => {
    const target = Math.max(0, (mediaState.currentTime || 0) + deltaSec);
    seekMedia(target);
  };

  return (
    <div className="w-full bg-[#14161d]/95 backdrop-blur-md border-t border-[#282d3c] px-2.5 sm:px-4 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-2 sm:gap-3 text-gray-300 select-none">
      {/* Mode Selector (Host controls, Partner indicator) */}
      <div className="flex items-center gap-1 bg-[#0b0c10]/70 p-1 rounded-lg border border-[#282d3c]">
        {modes.map(mode => {
          const Icon = mode.icon;
          const isActive = mediaState.mode === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => isOwner && changeMovieMode(mode.id)}
              disabled={!isOwner}
              title={isOwner ? `Switch to ${mode.label}` : `Active mode: ${mode.label} (Host controlled)`}
              aria-label={mode.label}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-amber-500 text-black shadow-md font-semibold'
                  : isOwner
                    ? 'text-gray-400 hover:text-gray-100 hover:bg-[#1c1f2a]'
                    : 'text-gray-500 cursor-default'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{mode.label}</span>
            </button>
          );
        })}
      </div>

      {/* Shared Playback Controls (Play/Pause/Seek for both Host and Partner) */}
      <div className="flex items-center gap-1.5 bg-[#0b0c10]/70 p-1 rounded-lg border border-[#282d3c]">
        {/* -10s Seek */}
        <button
          onClick={() => handleSeekDelta(-10)}
          title="Rewind 10 seconds (Shared)"
          aria-label="Rewind 10 seconds"
          className="p-1.5 sm:p-2 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-[#1c1f2a] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Play / Pause Toggle */}
        <button
          onClick={handleTogglePlayPause}
          title={mediaState.isPlaying ? 'Pause (Shared)' : 'Play (Shared)'}
          aria-label={mediaState.isPlaying ? 'Pause playback' : 'Start playback'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            mediaState.isPlaying
              ? 'bg-amber-500 text-black hover:bg-amber-400 shadow-md'
              : 'bg-[#1c1f2a] border border-[#282d3c] text-amber-400 hover:bg-[#282d3c]'
          }`}
        >
          {mediaState.isPlaying ? (
            <>
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play</span>
            </>
          )}
        </button>

        {/* +10s Seek */}
        <button
          onClick={() => handleSeekDelta(10)}
          title="Forward 10 seconds (Shared)"
          aria-label="Forward 10 seconds"
          className="p-1.5 sm:p-2 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-[#1c1f2a] transition-colors"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Center Audio Controls: Master Volume Slider (Hidden on small mobile) */}
      <div className="hidden md:flex items-center gap-2">
        <div className="flex items-center gap-2 bg-[#0b0c10]/70 px-3 py-1.5 rounded-lg border border-[#282d3c]">
          <button
            onClick={togglePlayerMute}
            title={isPlayerMuted || playerVolume === 0 ? "Unmute sound" : "Mute sound"}
            aria-label={isPlayerMuted || playerVolume === 0 ? "Unmute sound" : "Mute sound"}
            className="hover:text-amber-400 transition-colors"
          >
            {isPlayerMuted || playerVolume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={isPlayerMuted ? 0 : playerVolume}
            onChange={(e) => setPlayerVolume(Number(e.target.value))}
            title={`Volume: ${isPlayerMuted ? 0 : playerVolume}%`}
            aria-label="Volume slider"
            className="w-20 accent-amber-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg appearance-none"
          />
        </div>
      </div>

      {/* Right Controls: Cinema Lights, Share, Settings, Fullscreen */}
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Cinema Lights Dimmer */}
        <button
          onClick={toggleCinemaLights}
          title={cinemaLights ? 'Cinema lights off (Dimmed)' : 'Cinema lights on'}
          aria-label={cinemaLights ? 'Turn off dimmed lights' : 'Dim cinema lights'}
          className={`p-2 sm:p-2.5 rounded-lg border transition-colors ${
            cinemaLights
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
              : 'bg-[#1c1f2a] border-[#282d3c] text-gray-400 hover:text-gray-200'
          }`}
        >
          {cinemaLights ? <Lightbulb className="w-4 h-4 text-amber-400" /> : <LightbulbOff className="w-4 h-4" />}
        </button>

        {/* Invite & Share Button */}
        <button
          onClick={openShareModal}
          title="Share room invitation"
          aria-label="Invite partner to room"
          className="bg-[#1c1f2a] hover:bg-[#282d3c] border border-[#282d3c] text-amber-400 p-2 sm:p-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors"
        >
          <Share2 className="w-4 h-4" />
          <span className="hidden lg:inline">Invite Partner</span>
        </button>

        {/* Device Settings Modal */}
        <button
          onClick={openSettings}
          title="Audio & Network Settings"
          aria-label="Open settings"
          className="bg-[#1c1f2a] hover:bg-[#282d3c] border border-[#282d3c] text-gray-400 hover:text-gray-200 p-2 sm:p-2.5 rounded-lg transition-colors"
        >
          <Sliders className="w-4 h-4" />
        </button>

        {/* Fullscreen Toggle */}
        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Cinema Fullscreen'}
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          className="bg-[#1c1f2a] hover:bg-[#282d3c] border border-[#282d3c] text-gray-400 hover:text-gray-200 p-2 sm:p-2.5 rounded-lg transition-colors"
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
