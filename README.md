# DuoWatch — Private Cinema for Two

> **High-fidelity, zero-cost private cinema theater for exactly two people.**  
> Built with React 19, TypeScript, Tailwind CSS, WebRTC, and Supabase Free Tier.

[![Tests](https://img.shields.io/badge/tests-20%20passed-emerald)](https://github.com)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Hosting](https://img.shields.io/badge/hosting-Cloudflare%20Pages%20Free-orange)](https://pages.cloudflare.com)
[![Signaling](https://img.shields.io/badge/signaling-Supabase%20Free-emerald)](https://supabase.com)
[![Media](https://img.shields.io/badge/media-WebRTC%20P2P%20Encrypted-amber)](https://webrtc.org)
[![Budget](https://img.shields.io/badge/cost-$0%20Zero%20Cost%20First-success)](https://github.com)

---

## 1. Overview & Strictly $0 Budget

DuoWatch is a zero-cost-first virtual cinema engineered exclusively for **two participants: an Owner (Host) and a Partner (Guest)**.

- **Zero Cloud Storage**: Video files are decoded in-browser and transmitted direct peer-to-peer via encrypted WebRTC. No video is ever uploaded to any server.
- **Zero Paid Subscriptions**: Runs 100% within free tiers of Cloudflare Pages and Supabase.
- **Zero Registration**: Instant cryptographic invitation tokens without mandatory account creation or credit card requirements.
- **Strict Capacity Enforcement**: Server-side PostgreSQL row locking and token authorization guarantee that no third party can ever join or eavesdrop.

---

## 2. Three Distinct Cinema Modes

### 🎬 Mode A: YouTube Together
- Official embedded YouTube IFrame API integration.
- Host-authoritative playback controls (play, pause, seek, and video changes).
- Sub-second clock offset calculation and automatic drift correction (re-aligns playback if drift exceeds 0.75 seconds).
- Graceful handling of restricted/unembeddable videos with direct YouTube links.

### 📼 Mode B: Local File Streaming
- Host selects any local video file (`.mp4`, `.webm`, `.mkv`) on their machine.
- Decoded locally with `URL.createObjectURL` and captured via `HTMLMediaElement.captureStream()`.
- Streamed directly to Partner over WebRTC DTLS-SRTP.
- Decoded video frames and audio stream directly to the partner’s screen with zero server uploads.

### 🖥️ Mode C: Screen & Tab Sharing
- Share any browser tab, desktop window, or entire monitor via `navigator.mediaDevices.getDisplayMedia`.
- Streams system and tab audio when supported by the browser.
- Native capture termination handling and mobile browser detection.

---

## 3. Communication & Real-Time Presence

- **WebRTC Voice Chat**: Live voice communication with hardware echo cancellation, noise suppression, and auto gain control.
- **Speaking Indicator**: Real-time Web Audio FFT analysis with animated glowing pulse rings around speaking participant avatars.
- **Private Text Chat**: Low-latency ephemeral chat sent over WebRTC DataChannels with zero persistent database logging.
- **Floating Emoji Reactions**: Live floating emoji reactions (`🍿`, `❤️`, `😂`, `👏`, `🔥`, `🎬`) animating across the cinema screen.
- **Connection Diagnostics**: Live Round Trip Time (RTT), connection state, and audio input level meters.

---

## 4. Security & Privacy Guarantees

1. **Strict 2-Person Limit**: Enforced using PostgreSQL `FOR UPDATE` row locks and server-side RPC functions. Any third participant attempt is rejected with `ROOM_FULL`.
2. **Cryptographic Host Authority**: Owner controls are authenticated with a 32-byte cryptographic token hash. Guests cannot tamper with room modes or playback.
3. **End-to-End Encryption**: Voice and media streams are encrypted with DTLS-SRTP; DataChannels use SCTP over DTLS.
4. **Zero Credential Exposure**: Client code only accesses public `anon` credentials; all mutations flow through `SECURITY DEFINER` procedures with RLS.
5. **No Persistent Chat History**: Chat messages live strictly in browser component state and disappear when the tab closes.

---

## 5. Quick Start (Local Development)

### Prerequisites
- Node.js `v20+` or `v24+`
- npm `v10+` or `v11+`

### 1. Clone & Install
```bash
git clone https://github.com/your-username/duowatch.git
cd duowatch
npm install
```

### 2. Environment Setup
```bash
cp .env.example .env
```
*(By default, `VITE_ENABLE_LOCAL_FALLBACK=true` is enabled, allowing seamless two-tab testing on localhost without needing live Supabase credentials!)*

### 3. Run Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in two separate browser tabs or private windows to test private cinema rooms in real time!

### 4. Run Automated Tests
```bash
npm test
```
Executes the comprehensive Vitest test suite (Crypto, Security Audit, Room Capacity, and YouTube Sync).

### 5. Production Build
```bash
npm run build
```
Generates an optimized static production bundle in `dist/` ready for Cloudflare Pages.

---

## 6. Project Architecture

```
duowatch/
├── dist/                     # Optimized production bundle
├── public/
│   ├── _redirects            # Cloudflare Pages SPA rewrite rules
│   └── favicon.svg           # Cinema film projector icon
├── src/
│   ├── components/
│   │   ├── chat/             # ChatSidebar, EmojiReactions
│   │   ├── common/           # YoutubeIcon, StatusBadge
│   │   ├── player/           # CinemaPlayer, YouTubePlayer, LocalFilePlayer, ScreenSharePlayer, PlayerControls
│   │   ├── room/             # ParticipantCard, RoomShareModal, SettingsModal
│   │   └── Navbar.tsx        # Cinema header with controls & lights dimmer
│   ├── context/
│   │   └── CinemaContext.tsx # Central React State & P2P WebRTC orchestration
│   ├── lib/
│   │   ├── audio.ts          # Web Audio API voice & FFT level analyzer
│   │   ├── crypto.ts         # Web Crypto random tokens & SHA-256
│   │   ├── roomService.ts    # Room creation, join validation & capacity
│   │   ├── signaling.ts      # Dual-engine signaling (Supabase Realtime + BroadcastChannel)
│   │   ├── supabase.ts       # Supabase client initializer
│   │   └── webrtc.ts         # RTCPeerConnection, DataChannel, STUN & streams
│   ├── pages/
│   │   ├── CinemaRoomPage.tsx
│   │   ├── CreateRoomPage.tsx
│   │   ├── JoinRoomPage.tsx
│   │   ├── LandingPage.tsx
│   │   ├── NotFoundPage.tsx
│   │   ├── PrivacyPage.tsx
│   │   └── TermsPage.tsx
│   ├── types/
│   │   └── cinema.ts         # Domain TypeScript definitions
│   ├── App.tsx               # Client router
│   ├── index.css             # Tailwind v4 & dark cinema theme tokens
│   └── main.tsx              # Application entry point
├── supabase/
│   └── migrations/           # PostgreSQL RLS & atomic join procedures
├── tests/                    # Automated test suites
├── docs/                     # Full technical & deployment documentation
├── .env.example              # Environment variables template
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 7. Documentation Index

- [Deployment Guide (Cloudflare Pages)](docs/deployment-guide.md)
- [Supabase Setup & SQL Migrations](docs/supabase-setup.md)
- [Security & Threat Model](docs/security.md)
- [Test Report & Execution Results](docs/test-report.md)
- [Known Limitations & Network Disclosures](docs/known-limitations.md)
- [Troubleshooting & FAQ](docs/troubleshooting.md)

---

## 8. License

MIT License. Designed and developed for private, zero-cost synchronized viewing.
