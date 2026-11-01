import React, { useState } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { 
  Mic, 
  MicOff, 
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
    isMicActive, 
    isMuted, 
    toggleMicrophone, 
    toggleMute, 
    openSettings, 
    openShareModal, 
    audioLevel 
  } = useCinema();

  const isOwner = session?.role === 'owner';
  const [volume, setVolume] = useState<number>(1);
  const [isVolumeMuted, setIsVolumeMuted] = useState<boolean>(false);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsVolumeMuted(val === 0);
  };

  const toggleVolumeMute = () => {
    setIsVolumeMuted(prev => !prev);
  };

  const modes: { id: MovieMode; label: string; icon: any }[] = [
    { id: 'youtube', label: 'YouTube Together', icon: YoutubeIcon },
    { id: 'local', label: 'Local Movie', icon: Film },
    { id: 'screen', label: 'Screen Share', icon: Monitor },
  ];

  return (
    <div className="w-full bg-[#14161d]/90 backdrop-blur-md border-t border-[#282d3c] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-gray-300 select-none">
      {/* Mode Selector (Host controls, Partner indicator) */}
      <div className="flex items-center gap-1.5 bg-[#0b0c10]/70 p-1 rounded-xl border border-[#282d3c]">
        {modes.map(mode => {
          const Icon = mode.icon;
          const isActive = mediaState.mode === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => isOwner && changeMovieMode(mode.id)}
              disabled={!isOwner}
              title={isOwner ? `Switch to ${mode.label}` : `Active mode: ${mode.label} (Host controlled)`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
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

      {/* Center Voice & Audio Controls */}
      <div className="flex items-center gap-2">
        {/* Microphone Enable / Disable */}
        <button
          onClick={toggleMicrophone}
          title={isMicActive ? 'Turn off microphone' : 'Turn on microphone'}
          className={`relative p-2.5 rounded-xl border transition-all active:scale-95 ${
            isMicActive
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20 shadow-lg shadow-emerald-500/10'
              : 'bg-[#1c1f2a] border-[#282d3c] text-gray-400 hover:text-gray-200'
          }`}
        >
          {isMicActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          {isMicActive && !isMuted && (
            <span 
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"
              style={{ opacity: Math.max(0.3, audioLevel) }}
            />
          )}
        </button>

        {/* Mic Mute / Unmute (when mic is active) */}
        {isMicActive && (
          <button
            onClick={toggleMute}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              isMuted
                ? 'bg-red-500/20 border-red-500/40 text-red-400'
                : 'bg-[#1c1f2a] border-[#282d3c] text-emerald-400'
            }`}
          >
            {isMuted ? 'Muted' : 'Unmuted'}
          </button>
        )}

        {/* Master Volume Slider */}
        <div className="hidden md:flex items-center gap-2 bg-[#0b0c10]/70 px-3 py-1.5 rounded-xl border border-[#282d3c]">
          <button onClick={toggleVolumeMute} className="hover:text-amber-400 transition-colors">
            {isVolumeMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isVolumeMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-20 accent-amber-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg appearance-none"
          />
        </div>
      </div>

      {/* Right Controls: Cinema Lights, Share, Settings, Fullscreen */}
      <div className="flex items-center gap-2">
        {/* Cinema Lights Dimmer */}
        <button
          onClick={toggleCinemaLights}
          title={cinemaLights ? 'Cinema lights off (Dimmed)' : 'Cinema lights on'}
          className={`p-2.5 rounded-xl border transition-all active:scale-95 ${
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
          className="bg-[#1c1f2a] hover:bg-[#282d3c] border border-[#282d3c] text-amber-400 p-2.5 rounded-xl flex items-center gap-1.5 text-xs font-medium transition-all active:scale-95"
        >
          <Share2 className="w-4 h-4" />
          <span className="hidden lg:inline">Invite Partner</span>
        </button>

        {/* Device Settings Modal */}
        <button
          onClick={openSettings}
          title="Audio & Network Settings"
          className="bg-[#1c1f2a] hover:bg-[#282d3c] border border-[#282d3c] text-gray-400 hover:text-gray-200 p-2.5 rounded-xl transition-all active:scale-95"
        >
          <Sliders className="w-4 h-4" />
        </button>

        {/* Fullscreen Toggle */}
        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Cinema Fullscreen'}
          className="bg-[#1c1f2a] hover:bg-[#282d3c] border border-[#282d3c] text-gray-400 hover:text-gray-200 p-2.5 rounded-xl transition-all active:scale-95"
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
