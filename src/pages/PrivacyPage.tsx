import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Lock, HardDrive, EyeOff, Server, Database, Globe } from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/common/Footer';
import { SEO } from '../components/common/SEO';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#0b0c10] text-gray-200 flex flex-col justify-between selection:bg-amber-500 selection:text-black">
      <SEO 
        title="Privacy Policy: DuoWatch" 
        description="Comprehensive technical privacy policy for DuoWatch. Covers anonymous authentication, room lifecycle, WebRTC peer data channels, and third-party services."
        path="/privacy"
      />

      <Navbar />

      <main className="flex-1 py-8 sm:py-12 px-4 w-full max-w-3xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-amber-400 transition-colors mb-5 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <div className="bg-[#14161d] border border-[#282d3c] rounded-xl p-5 sm:p-8 shadow-xl">
          <div className="flex items-center gap-3 mb-6 sm:mb-8">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white font-['Outfit']">Privacy Policy</h1>
              <p className="text-xs text-gray-400">Technical data practices and retention policies</p>
            </div>
          </div>

          {/* Legal Review Notice */}
          <div className="mb-6 p-3 rounded-lg bg-[#0b0c10] border border-amber-500/30 text-xs text-amber-300 leading-relaxed">
            <strong>Notice for Owner Review:</strong> This policy documents the actual technical data handling practices, storage locations, and third-party integrations of the DuoWatch software application. Formal jurisdiction-specific legal review is required prior to production commercial deployment.
          </div>

          <div className="space-y-6 text-sm text-gray-300 leading-relaxed">
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
                1. Zero Video Storage and Processing
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                DuoWatch does not store, host, process, or record video streams, local files, or screen recordings on any server. In Mode B (Local File Streaming) and Mode C (Screen Sharing), video and audio data are captured and encoded client-side inside your browser and transmitted directly between peer browsers via WebRTC.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                2. Authentication and Anonymous Identity
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                DuoWatch does not require user accounts, email addresses, passwords, or telephone numbers. When connecting to a room, the application initiates an anonymous Supabase authentication session. This anonymous token is used strictly to grant authorization to the room signaling channel in PostgreSQL and Realtime. It is never associated with personal identity or cross-site profiles.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-400 shrink-0" />
                3. Room Information and Data Retention
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                When a watch room is created, the system stores: (a) an 8-character room code, (b) the room name, (c) a cryptographic owner token hash, (d) a guest passcode hash, and (e) temporary participant presence records. All room metadata and participant entries automatically expire in the PostgreSQL database after 24 hours and are cleaned up by automated database procedures.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-amber-400 shrink-0" />
                4. Ephemeral Chat and Reactions
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Text messages and emoji reactions sent in the theater room are transmitted directly between viewers through WebRTC DataChannels. Messages are kept exclusively in volatile browser memory and are never written to database tables or server logs. When you close or refresh the room tab, all message history is permanently discarded.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-amber-400 shrink-0" />
                5. Third-Party Infrastructure and Services
              </h2>
              <div className="text-xs text-gray-400 space-y-1.5 leading-relaxed">
                <p>DuoWatch interacts with the following external service providers:</p>
                <ul className="list-disc pl-5 space-y-1 text-gray-400">
                  <li><strong>Supabase:</strong> Provides managed PostgreSQL database, authentication endpoints, and WebSocket Realtime infrastructure for WebRTC SDP offer/answer signaling.</li>
                  <li><strong>Public STUN Providers (Google & Twilio):</strong> Used strictly for NAT discovery during WebRTC peer connection setup. STUN servers only inspect network IP and port headers to establish direct connections; they do not receive media or chat content.</li>
                  <li><strong>YouTube IFrame API:</strong> In Mode A, video streams are delivered directly by YouTube according to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">YouTube Terms of Service</a> and <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">Google Privacy Policy</a>. DuoWatch only transmits synchronization timestamps (play, pause, seek) between peers.</li>
                </ul>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-amber-400 shrink-0" />
                6. Local Storage and Tracking
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                DuoWatch does not use tracking cookies, analytics trackers, or third-party advertising SDKs. Browser sessionStorage is used solely to maintain your active room credentials across browser refreshes for that single session.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white">7. User Rights and Data Deletion</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Because rooms expire automatically after 24 hours and messages are never stored on servers, no persistent personal profile exists to export or delete. Closing your browser session immediately clears local tokens.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};
