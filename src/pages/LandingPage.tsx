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
  Radio,
  AlertCircle
} from 'lucide-react';
import { YoutubeIcon } from '../components/common/YoutubeIcon';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/common/Footer';
import { SEO } from '../components/common/SEO';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [quickRoomCode, setQuickRoomCode] = useState<string>('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleQuickJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = quickRoomCode.trim().toUpperCase();
    if (!cleanCode) {
      setJoinError('Please enter a cinema room code to join.');
      return;
    }
    if (cleanCode.length < 4) {
      setJoinError('Room codes are at least 4 characters (e.g. DUO-8X9K).');
      return;
    }
    setJoinError(null);
    navigate(`/join?code=${encodeURIComponent(cleanCode)}`);
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] text-gray-100 flex flex-col justify-between selection:bg-amber-500 selection:text-black overflow-x-clip">
      <SEO 
        title="DuoWatch: Private Watch Party for Two" 
        description="High-fidelity private watch party theater for exactly two people. Synchronized YouTube, P2P local file video streaming, and screen sharing." 
        path="/"
      />

      {/* Global Responsive Navigation */}
      <Navbar />

      {/* Main Hero Container */}
      <main className="max-w-6xl mx-auto px-4 py-12 sm:py-16 flex flex-col items-center text-center w-full">
        {/* Technical Specification Chip */}
        <div className="inline-flex items-center gap-2 bg-[#14161d] border border-[#282d3c] px-3 py-1 rounded-md text-xs text-gray-300 mb-6">
          <Users className="w-3.5 h-3.5 text-amber-400" />
          <span>Private Two-Participant Rooms | Direct WebRTC Transport</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold font-['Outfit'] tracking-tight max-w-3xl leading-tight mb-4 text-white">
          Synchronized Watch Party for <span className="text-amber-400">Two</span>
        </h1>

        {/* Subtitle */}
        <p className="text-sm sm:text-base md:text-lg text-gray-400 max-w-2xl mb-8 leading-relaxed font-normal">
          Watch synchronized YouTube videos, stream local video files peer to peer, or share your screen with synchronized audio. No user accounts, cloud video storage, or subscription fees.
        </p>

        {/* Primary Call to Action & Quick Join Box */}
        <div className="w-full max-w-lg flex flex-col sm:flex-row items-center justify-center gap-3 mb-3">
          <Link
            to="/create"
            className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-6 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <Play className="w-4 h-4 fill-black" />
            Create Watch Room
          </Link>

          <form 
            onSubmit={handleQuickJoin} 
            className="w-full sm:w-auto flex items-center gap-1.5 bg-[#14161d] border border-[#282d3c] p-1 rounded-lg focus-within:border-amber-500/60 transition-colors"
          >
            <input
              type="text"
              value={quickRoomCode}
              onChange={(e) => {
                setQuickRoomCode(e.target.value);
                if (joinError) setJoinError(null);
              }}
              placeholder="Room Code (e.g. DUO-8X9K)"
              className="bg-transparent text-xs text-gray-200 placeholder-gray-500 px-3 py-2 focus:outline-none flex-1 sm:w-44 font-mono uppercase min-w-0"
              aria-label="Room Code"
            />
            <button
              type="submit"
              disabled={!quickRoomCode.trim()}
              className="bg-[#1c1f2a] hover:bg-[#282d3c] disabled:opacity-40 text-amber-400 text-xs font-semibold px-3 py-2 rounded-md flex items-center gap-1 transition-colors shrink-0"
            >
              Join
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* Quick Join Error Message */}
        {joinError && (
          <div className="flex items-center gap-1.5 text-xs text-red-400 mb-6">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{joinError}</span>
          </div>
        )}

        <div className="mb-8 sm:mb-12" />

        {/* The 3 Watch Modes */}
        <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-5 text-left mb-14 sm:mb-16">
          {/* Mode A: YouTube Together */}
          <div className="bg-[#14161d] border border-[#282d3c] p-5 rounded-xl transition-colors">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mb-4">
              <YoutubeIcon className="w-5 h-5 text-red-500" />
            </div>
            <h3 className="text-sm font-semibold text-gray-100 mb-2 font-['Outfit']">
              Mode A: YouTube Together
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-3">
              Official embedded YouTube player with host play, pause, seek, and timestamp synchronization to keep both viewers aligned.
            </p>
            <span className="text-[11px] font-medium text-amber-400 flex items-center gap-1">
              Official IFrame Player API
            </span>
          </div>

          {/* Mode B: Local File Streaming */}
          <div className="bg-[#14161d] border border-[#282d3c] p-5 rounded-xl transition-colors">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
              <Film className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-gray-100 mb-2 font-['Outfit']">
              Mode B: Local File Streaming
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-3">
              Select a local video file (MP4, WebM, MKV) to stream directly to your partner over WebRTC peer to peer. Decoded in browser with zero cloud uploads.
            </p>
            <span className="text-[11px] font-medium text-amber-400 flex items-center gap-1">
              Direct WebRTC Peer Connection
            </span>
          </div>

          {/* Mode C: Screen Sharing */}
          <div className="bg-[#14161d] border border-[#282d3c] p-5 rounded-xl transition-colors">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-4">
              <Monitor className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-gray-100 mb-2 font-['Outfit']">
              Mode C: Screen and Tab Sharing
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-3">
              Share an application window, browser tab, or monitor directly to your partner with optional system audio capture.
            </p>
            <span className="text-[11px] font-medium text-amber-400 flex items-center gap-1">
              <Radio className="w-3.5 h-3.5" />
              Tab and System Audio Support
            </span>
          </div>
        </div>

        {/* Technical Architecture & Privacy Specifications */}
        <div className="w-full bg-[#14161d] border border-[#282d3c] rounded-xl p-5 sm:p-7 text-left mb-12 sm:mb-16">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-['Outfit']">Technical Architecture and Privacy Specifications</h2>
              <p className="text-xs text-gray-400">Verifiable technical properties of the DuoWatch watch party system</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 sm:gap-5 text-xs text-gray-300">
            <div className="space-y-1">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                Two-Participant Limit
              </span>
              <p className="text-gray-400 leading-relaxed">
                PostgreSQL row locking limits room capacity to exactly two concurrent participants per room.
              </p>
            </div>

            <div className="space-y-1">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                Session Tokens
              </span>
              <p className="text-gray-400 leading-relaxed">
                Host authority is authenticated with an ephemeral token stored securely in browser session storage.
              </p>
            </div>

            <div className="space-y-1">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                WebRTC DTLS-SRTP
              </span>
              <p className="text-gray-400 leading-relaxed">
                Direct peer-to-peer media streams and data channels are encrypted end to end without intermediary video servers.
              </p>
            </div>

            <div className="space-y-1">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                Zero Cloud Storage
              </span>
              <p className="text-gray-400 leading-relaxed">
                Video files and chat messages are never uploaded to or stored on remote application servers.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Global Unified Footer */}
      <Footer />
    </div>
  );
};
