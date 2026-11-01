import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';

export const TermsPage: React.FC = () => {
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
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-white font-['Outfit']">Terms of Service</h1>
              <p className="text-xs text-gray-400">Rules and Guidelines for DuoWatch Cinema</p>
            </div>
          </div>

          <div className="space-y-6 text-sm text-gray-300 leading-relaxed">
            <section className="space-y-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                1. Private Two-Person Use Only
              </h2>
              <p className="text-xs text-gray-400">
                DuoWatch is strictly intended for private communication and synchronized viewing between two individuals (Owner and Partner). Public rebroadcasting, scraping, or mass distribution is prohibited.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                2. User Content Responsibility
              </h2>
              <p className="text-xs text-gray-400">
                Users are solely responsible for local files chosen for streaming (Mode B) and content displayed through screen sharing (Mode C). You must hold the appropriate rights or licenses to view shared content with your partner.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-white">3. YouTube Terms Compliance</h2>
              <p className="text-xs text-gray-400">
                Mode A utilizes the official YouTube IFrame Player API. By using Mode A, users agree to be bound by the YouTube Terms of Service (<a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">youtube.com/t/terms</a>). DuoWatch does not strip advertisements, alter content streams, or circumvent access restrictions.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-white">4. Zero-Cost Architecture & Network Limitations</h2>
              <p className="text-xs text-gray-400">
                DuoWatch is engineered for a strictly $0 budget using free-tier services and direct WebRTC peer connections. We do not maintain paid TURN relay servers. Direct peer-to-peer streaming works reliably across standard residential, broadband, and mobile networks; however, restrictive corporate firewalls or symmetric NAT configurations may occasionally prevent direct P2P connections.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-white">5. Disclaimer of Warranty</h2>
              <p className="text-xs text-gray-400">
                The software is provided &quot;as is&quot;, without warranty of any kind, express or implied. DuoWatch shall not be liable for any damages arising out of the use or inability to use the service.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
