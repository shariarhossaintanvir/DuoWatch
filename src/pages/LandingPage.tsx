import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Film, 
  Monitor, 
  ShieldCheck, 
  Users, 
  Lock, 
  ArrowRight, 
  Play, 
  Zap, 
  Radio 
} from 'lucide-react';
import { YoutubeIcon } from '../components/common/YoutubeIcon';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [quickRoomCode, setQuickRoomCode] = useState<string>('');

  const handleQuickJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickRoomCode.trim()) {
      navigate(`/join?code=${encodeURIComponent(quickRoomCode.trim().toUpperCase())}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] text-gray-100 flex flex-col justify-between selection:bg-amber-500 selection:text-black">
      {/* Top Ambient Cinema Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-amber-500/10 blur-[130px] pointer-events-none rounded-full" />

      {/* Main Hero Container */}
      <main className="relative max-w-6xl mx-auto px-4 py-16 sm:py-24 flex flex-col items-center text-center z-10">
        {/* Subtle Live Badge */}
        <div className="inline-flex items-center gap-2 bg-[#14161d] border border-[#282d3c] px-3.5 py-1.5 rounded-full text-xs text-amber-300 mb-8 shadow-xl">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Zero-Cost • End-to-End Encrypted WebRTC • Strictly 2 People</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-black font-['Outfit'] tracking-tight max-w-4xl leading-tight mb-6 text-white">
          Your Private Cinema for <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500">Exactly Two</span>.
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-xl text-gray-400 max-w-2xl mb-10 leading-relaxed font-normal">
          Watch synchronized YouTube videos, stream local movie files directly from your computer, or share your screen with synchronized audio. No accounts, no uploads, no subscription fees.
        </p>

        {/* Primary Call to Action & Quick Join Box */}
        <div className="w-full max-w-lg flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
          <Link
            to="/create"
            className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm px-8 py-3.5 rounded-xl shadow-xl shadow-amber-500/20 flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <Play className="w-4 h-4 fill-black" />
            Create Cinema Room
          </Link>

          <form onSubmit={handleQuickJoin} className="w-full sm:w-auto flex items-center gap-1.5 bg-[#14161d] border border-[#282d3c] p-1 rounded-xl shadow-xl focus-within:border-amber-500/60 transition-colors">
            <input
              type="text"
              value={quickRoomCode}
              onChange={(e) => setQuickRoomCode(e.target.value)}
              placeholder="Room Code (e.g. DUO-8X9K)"
              className="bg-transparent text-xs text-gray-200 placeholder-gray-500 px-3 py-2.5 focus:outline-none w-44 font-mono uppercase"
            />
            <button
              type="submit"
              disabled={!quickRoomCode.trim()}
              className="bg-[#1c1f2a] hover:bg-[#282d3c] disabled:opacity-40 text-amber-400 text-xs font-semibold px-3.5 py-2.5 rounded-lg flex items-center gap-1 transition-all active:scale-95"
            >
              Join
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* The 3 Movie Modes */}
        <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-6 text-left mb-20">
          {/* Mode A: YouTube Together */}
          <div className="bg-[#14161d]/80 border border-[#282d3c] p-6 rounded-2xl shadow-xl hover:border-amber-500/40 transition-colors group">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
              <YoutubeIcon className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-base font-bold text-gray-100 mb-2 font-['Outfit']">
              Mode A: YouTube Together
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              Official embedded YouTube player with host-authoritative play, pause, seek, and drift correction. Sub-second clock synchronization keeps both partners aligned.
            </p>
            <span className="text-[11px] font-semibold text-amber-400 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5" />
              Clock Drift Correction
            </span>
          </div>

          {/* Mode B: Local File Streaming */}
          <div className="bg-[#14161d]/80 border border-[#282d3c] p-6 rounded-2xl shadow-xl hover:border-amber-500/40 transition-colors group">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
              <Film className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-100 mb-2 font-['Outfit']">
              Mode B: Local File Streaming
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              Pick any local video file (MP4, WebM, MKV) to stream peer-to-peer. Decoded directly in your browser and transmitted via WebRTC. Zero cloud storage or video uploads.
            </p>
            <span className="text-[11px] font-semibold text-amber-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              100% Zero Video Uploads
            </span>
          </div>

          {/* Mode C: Screen Sharing */}
          <div className="bg-[#14161d]/80 border border-[#282d3c] p-6 rounded-2xl shadow-xl hover:border-amber-500/40 transition-colors group">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
              <Monitor className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-100 mb-2 font-['Outfit']">
              Mode C: Screen & Tab Sharing
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              Share any application window, browser tab, or monitor. Includes system audio capture so you can watch anime, livestreams, or presentations in high fidelity.
            </p>
            <span className="text-[11px] font-semibold text-amber-400 flex items-center gap-1">
              <Radio className="w-3.5 h-3.5" />
              Tab & System Audio Support
            </span>
          </div>
        </div>

        {/* Security & Strict 2-Participant Architecture */}
        <div className="w-full bg-[#14161d]/50 border border-[#282d3c] rounded-3xl p-8 sm:p-10 text-left mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white font-['Outfit']">Strict Security & Zero-Cost Architecture</h3>
              <p className="text-xs text-gray-400">Engineered with server-verifiable cryptographic guarantees</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 text-xs text-gray-300">
            <div className="space-y-1.5">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-amber-400" />
                Atomic 2-Person Limit
              </span>
              <p className="text-gray-400 leading-relaxed">
                Database row-locking strictly rejects any 3rd participant attempt. Private rooms cannot be overfilled or eavesdropped on.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                Cryptographic Keys
              </span>
              <p className="text-gray-400 leading-relaxed">
                Owner controls are bound to a cryptographically secure token hash. Guests cannot alter cinema settings or impersonate the host.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                Encrypted DTLS-SRTP
              </span>
              <p className="text-gray-400 leading-relaxed">
                Direct peer-to-peer WebRTC connections encrypt both voice and media streams end-to-end without middleman servers.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Strictly $0 Budget
              </span>
              <p className="text-gray-400 leading-relaxed">
                Powered by Cloudflare Pages Free, Supabase Free Realtime, and public STUN. Zero credit card or subscription fees needed.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-[#282d3c] bg-[#0b0c10] py-8 text-xs text-gray-500">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-amber-400" />
            <span className="text-gray-300 font-semibold">DuoWatch</span>
            <span>— Private Cinema for Two</span>
          </div>

          <div className="flex items-center gap-6">
            <Link to="/privacy" className="hover:text-gray-300 transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-gray-300 transition-colors">Terms of Service</Link>
            <span>$0 Zero-Cost Production Architecture</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
