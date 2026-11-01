import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Lock, HardDrive, EyeOff } from 'lucide-react';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#0b0c10] text-gray-200 py-12 px-4 selection:bg-amber-500 selection:text-black">
      <div className="max-w-3xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-amber-400 transition-colors mb-8 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Cinema
        </Link>

        <div className="bg-[#14161d] border border-[#282d3c] rounded-3xl p-8 sm:p-12 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-white font-['Outfit']">Privacy Policy</h1>
              <p className="text-xs text-gray-400">DuoWatch Zero-Cost, Zero-Retention Architecture</p>
            </div>
          </div>

          <div className="space-y-6 text-sm text-gray-300 leading-relaxed">
            <section className="space-y-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-amber-400" />
                1. Zero Cloud Video Storage
              </h2>
              <p className="text-xs text-gray-400">
                DuoWatch does not store, host, or cache movie files, screen captures, or video streams on any remote servers. In Mode B (Local File Streaming) and Mode C (Screen Sharing), media is decoded client-side and transmitted peer-to-peer directly between the two connected browsers via WebRTC.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                2. Direct End-to-End Encrypted Transports
              </h2>
              <p className="text-xs text-gray-400">
                All voice audio, screen video, and data channels travel through encrypted WebRTC peer connections secured by DTLS-SRTP (Datagram Transport Layer Security / Secure Real-time Transport Protocol). No intermediary server can eavesdrop on your media or microphone audio.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-amber-400" />
                3. Ephemeral Chat & Signaling
              </h2>
              <p className="text-xs text-gray-400">
                Text messages exchanged during your cinema session are ephemeral. They exist only within active browser memory and WebRTC DataChannels. Messages are not written to persistent database logs and vanish completely upon session termination.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-white">4. YouTube Embedded Playback</h2>
              <p className="text-xs text-gray-400">
                In Mode A (YouTube Together), video streams are delivered directly by YouTube’s official embedded player according to the YouTube Terms of Service and Google Privacy Policy. DuoWatch only synchronizes playback timestamps (play, pause, seek); we never bypass YouTube DRM or content restrictions.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-white">5. Cookies and Analytics</h2>
              <p className="text-xs text-gray-400">
                DuoWatch uses zero tracking cookies, zero third-party advertising trackers, and requires no account creation or credit cards. Room authentication relies on local session tokens that expire after 24 hours.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
