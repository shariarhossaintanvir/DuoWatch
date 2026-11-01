import React, { useState, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { VoiceManager } from '../../lib/audio';
import type { AudioDeviceOption } from '../../lib/audio';
import { X, Sliders, Mic, Network, Activity, Info } from 'lucide-react';

export const SettingsModal: React.FC = () => {
  const { 
    isSettingsOpen, 
    closeSettings, 
    connectionStatus, 
    rttMs, 
    audioLevel, 
    isMicActive 
  } = useCinema();

  const [devices, setDevices] = useState<AudioDeviceOption[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [driftThreshold, setDriftThreshold] = useState<number>(0.75);

  useEffect(() => {
    if (isSettingsOpen) {
      VoiceManager.getAvailableMicrophones().then((list) => {
        setDevices(list);
        if (list.length > 0 && !selectedDevice) {
          setSelectedDevice(list[0].deviceId);
        }
      });
    }
  }, [isSettingsOpen, selectedDevice]);

  if (!isSettingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#14161d] border border-[#282d3c] rounded-2xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={closeSettings}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-100 p-1.5 rounded-xl hover:bg-[#1c1f2a] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-100">Cinema & Device Settings</h3>
            <p className="text-xs text-gray-400">Audio devices, drift tolerance, and network telemetry</p>
          </div>
        </div>

        {/* Section 1: Microphone & Voice */}
        <div className="mb-6 bg-[#0b0c10] border border-[#282d3c] rounded-xl p-4">
          <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Mic className="w-4 h-4 text-amber-400" />
            Audio Input & Microphone
          </h4>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Microphone Device</label>
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="w-full bg-[#1c1f2a] border border-[#282d3c] rounded-xl px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-amber-500/50"
              >
                {devices.length === 0 ? (
                  <option value="">Default System Microphone</option>
                ) : (
                  devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Live Audio Meter */}
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Microphone Input Level</span>
                <span className="font-mono text-emerald-400">
                  {isMicActive ? `${Math.round(audioLevel * 100)}%` : 'Microphone Inactive'}
                </span>
              </div>
              <div className="w-full h-2 bg-[#1c1f2a] rounded-full overflow-hidden border border-[#282d3c]">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-amber-500 transition-all duration-75 rounded-full"
                  style={{ width: `${isMicActive ? Math.min(100, audioLevel * 100) : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: YouTube Drift Correction */}
        <div className="mb-6 bg-[#0b0c10] border border-[#282d3c] rounded-xl p-4">
          <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-400" />
            Playback Drift Tolerance
          </h4>

          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Drift Correction Threshold</span>
              <span className="font-mono text-amber-400">{driftThreshold.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min={0.25}
              max={2.0}
              step={0.05}
              value={driftThreshold}
              onChange={(e) => setDriftThreshold(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-[#1c1f2a] rounded-lg appearance-none"
            />
            <p className="text-[11px] text-gray-500 mt-2">
              If the partner’s video lags behind the host by more than this threshold, DuoWatch smoothly synchronizes playback automatically.
            </p>
          </div>
        </div>

        {/* Section 3: WebRTC & Zero-Cost Network Architecture */}
        <div className="bg-[#0b0c10] border border-[#282d3c] rounded-xl p-4">
          <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Network className="w-4 h-4 text-amber-400" />
            P2P Network Telemetry
          </h4>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-[#1c1f2a]">
              <span className="text-gray-400">Connection Transport</span>
              <span className="text-gray-200 font-mono">WebRTC DTLS-SRTP P2P</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1c1f2a]">
              <span className="text-gray-400">P2P State</span>
              <span className="text-emerald-400 font-medium capitalize">{connectionStatus}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1c1f2a]">
              <span className="text-gray-400">Round Trip Time (RTT)</span>
              <span className="text-gray-200 font-mono">{rttMs > 0 ? `${rttMs} ms` : 'Measuring...'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1c1f2a]">
              <span className="text-gray-400">STUN Infrastructure</span>
              <span className="text-gray-300 font-mono text-[11px]">Google STUN & Twilio STUN</span>
            </div>
          </div>

          <div className="mt-4 p-2.5 rounded-lg bg-[#14161d] border border-[#282d3c] flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <strong>Zero-Cost Architecture:</strong> DuoWatch operates purely peer-to-peer over public STUN without paid TURN relay servers. Direct P2P connects virtually all residential, mobile, and home networks.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
