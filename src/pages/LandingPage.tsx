import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Film, 
  Monitor, 
  ShieldCheck, 
  Users, 
  Lock, 
  ArrowRight, 
  Play, 
  AlertCircle
} from 'lucide-react';
import { YoutubeIcon } from '../components/common/YoutubeIcon';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/common/Footer';
import { SEO } from '../components/common/SEO';
import { RoomService } from '../lib/roomService';
import type { PlatformAvailability } from '../types/cinema';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [quickRoomCode, setQuickRoomCode] = useState<string>('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [platformAvailability, setPlatformAvailability] = useState<PlatformAvailability | null>(null);

  useEffect(() => {
    let mounted = true;
    RoomService.checkPlatformAvailability()
      .then((res) => {
        if (mounted) setPlatformAvailability(res);
      })
      .catch(() => { });

    const interval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      RoomService.checkPlatformAvailability()
        .then((res) => {
          if (mounted) setPlatformAvailability(res);
        })
        .catch(() => { });
    }, 30000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

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

  const isOccupied = platformAvailability?.status === 'occupied';

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
          {isOccupied ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
              <span>Global Capacity: 2/2 In Session • Platform Occupied</span>
            </>
          ) : (
            <>
              <Users className="w-3.5 h-3.5 text-amber-400" />
              <span>Strict Two-Participant Global Capacity • Direct WebRTC</span>
            </>
          )}
        </div>

        {/* Hero Title */}
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold font-['Outfit'] tracking-tight max-w-3xl leading-tight mb-4 text-white">
          Synchronized Watch Party for <span className="text-amber-400">Two</span>
        </h1>

        {/* Subtitle */}
        <p className="text-sm sm:text-base md:text-lg text-gray-400 max-w-2xl mb-8 leading-relaxed font-normal">
          Watch synchronized YouTube videos, stream local video files peer to peer, or share your screen with synchronized audio. No user accounts, cloud video storage, or subscription fees.
        </p>

        {/* Occupied Notification Banner */}
        {isOccupied && (
          <div className="w-full max-w-lg mb-4 p-3.5 rounded-lg bg-[#14161d] border border-amber-500/40 text-xs text-gray-300 flex items-start gap-2.5 text-left shadow-lg">
            <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-300 mb-0.5">DuoWatch is currently occupied</p>
              <p className="text-gray-400">Two people are watching together right now. Please try again when their session ends.</p>
            </div>
          </div>
        )}

        {/* Primary Call to Action & Quick Join Box */}
        <div className="w-full max-w-lg flex flex-col sm:flex-row items-center justify-center gap-3 mb-3">
          {isOccupied ? (
            <Link
              to="/create"
              className="w-full sm:w-auto bg-[#1c1f2a] border border-amber-500/60 hover:bg-[#282d3c] text-amber-300 font-semibold text-sm px-6 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Lock className="w-4 h-4 text-amber-400" />
              View Waiting Room
            </Link>
          ) : (
            <Link
              to="/create"
              className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-6 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Play className="w-4 h-4 fill-black" />
              Create Watch Room
            </Link>
          )}

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
            <h3 className="text-base font-semibold text-white mb-2 font-['Outfit']">YouTube Together</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Synchronized YouTube video playback with sub-second time alignment and shared play/pause controls.
            </p>
          </div>

          {/* Mode B: Local Video Streaming */}
          <div className="bg-[#14161d] border border-[#282d3c] p-5 rounded-xl transition-colors">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
              <Film className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-base font-semibold text-white mb-2 font-['Outfit']">Local File Streaming</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Select any local MP4 or MKV movie file. Streamed peer-to-peer via WebRTC with zero server upload.
            </p>
          </div>

          {/* Mode C: Screen Sharing */}
          <div className="bg-[#14161d] border border-[#282d3c] p-5 rounded-xl transition-colors">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-4">
              <Monitor className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-base font-semibold text-white mb-2 font-['Outfit']">Screen Sharing</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Stream any application window, browser tab, or full desktop with synchronized system audio.
            </p>
          </div>
        </div>

        {/* Zero-Trust Architecture Security Badges */}
        <div className="w-full bg-[#14161d]/60 border border-[#282d3c] rounded-xl p-6 sm:p-8 text-left">
          <div className="flex items-center gap-2.5 mb-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
              Privacy-First Architecture
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-400">
            <div>
              <strong className="text-gray-200 block mb-1">Strict Global Capacity</strong>
              Only 2 active participants globally across the entire platform.
            </div>
            <div>
              <strong className="text-gray-200 block mb-1">Direct WebRTC P2P</strong>
              Encrypted DTLS-SRTP peer-to-peer audio and video transport.
            </div>
            <div>
              <strong className="text-gray-200 block mb-1">Zero Cloud Storage</strong>
              Local media is decoded directly in-browser. Nothing is saved to servers.
            </div>
            <div>
              <strong className="text-gray-200 block mb-1">No Account Needed</strong>
              Ephemeral sessions with cryptographic token hashes and passcodes.
            </div>
          </div>
        </div>
      </main>

      {/* Global Footer */}
      <Footer />
    </div>
  );
};
