import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, ArrowLeft, CheckCircle2, AlertTriangle, Shield, Scale, Network } from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/common/Footer';
import { SEO } from '../components/common/SEO';

export const TermsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#0b0c10] text-gray-200 flex flex-col justify-between selection:bg-amber-500 selection:text-black">
      <SEO 
        title="Terms and Conditions: DuoWatch" 
        description="Terms and Conditions for DuoWatch. Covers private room use, acceptable use, user responsibilities, YouTube API compliance, and network limitations."
        path="/terms"
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
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white font-['Outfit']">Terms and Conditions</h1>
              <p className="text-xs text-gray-400">Rules, responsibilities, and operational guidelines</p>
            </div>
          </div>

          {/* Legal Review Notice */}
          <div className="mb-6 p-3 rounded-lg bg-[#0b0c10] border border-amber-500/30 text-xs text-amber-300 leading-relaxed">
            <strong>Notice for Owner Review:</strong> These terms document the operational rules, third-party API dependencies, and technical limitations of DuoWatch. Formal legal review by qualified legal counsel is required prior to commercial release.
          </div>

          <div className="space-y-6 text-sm text-gray-300 leading-relaxed">
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                1. Private Two-Person Scope
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                DuoWatch is engineered exclusively for private, synchronized communications between exactly two individuals (Host and Partner). The service does not support and must not be used for public broadcasting, mass distribution, or automated data extraction.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                2. User Content Responsibility
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Users are solely responsible for local media files selected for streaming (Mode B) and any screen, tab, or window content shared (Mode C). You represent and warrant that you hold the necessary rights, licenses, or permissions to view and share any content displayed to your partner.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400 shrink-0" />
                3. YouTube API Compliance
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Mode A uses the official YouTube IFrame Player API. By using Mode A, users agree to be bound by the YouTube Terms of Service (<a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">youtube.com/t/terms</a>) and Google Privacy Policy (<a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">policies.google.com/privacy</a>). DuoWatch does not block advertisements, alter video streams, or bypass YouTube DRM protections.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <Network className="w-4 h-4 text-amber-400 shrink-0" />
                4. Peer-to-Peer Network Limitations
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                DuoWatch uses WebRTC direct peer-to-peer transport with public STUN servers for NAT discovery. The service operates without intermediate TURN relay servers. Direct peer connection reliability depends on user network configurations; restrictive corporate firewalls or symmetric NAT configurations may occasionally prevent direct connection.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <Scale className="w-4 h-4 text-amber-400 shrink-0" />
                5. Acceptable Use and Restrictions
              </h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Users agree not to: (a) attempt to bypass the two-participant room capacity limit, (b) reverse engineer signaling protocols to impersonate other room hosts, (c) transmit unlawful, abusive, or infringing material, or (d) interfere with the operation of the signaling infrastructure.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white">6. Disclaimer of Warranties</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                The software and services are provided on an &quot;as is&quot; and &quot;as available&quot; basis, without warranty of any kind, whether express, statutory, or implied, including warranties of merchantability, fitness for a particular purpose, or uninterrupted availability.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-semibold text-white">7. Limitation of Liability</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                To the maximum extent permitted by applicable law, DuoWatch and its contributors shall not be liable for any indirect, incidental, special, or consequential damages resulting from the use of or inability to use the service.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};
