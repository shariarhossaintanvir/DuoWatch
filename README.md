<h1 align="center">DuoWatch</h1>

<p align="center"><strong>A Private Cinema for Two</strong></p>
<p align="center">
  Watch YouTube together, stream local movies, share your screen, and chat in a private browser-based cinema.<br>
  Strictly two participants. Peer-to-peer streaming. Zero media storage.
</p>

<p align="center">
  <a href="https://duowatch.pages.dev">Live Cinema</a> ·
  <a href="#project-overview">Overview</a> ·
  <a href="#core-features">Features</a> ·
  <a href="#technology-stack">Tech Stack</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#environment-configuration">Configuration</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="#security--privacy">Security</a> ·
  <a href="#known-limitations">Limitations</a> ·
  <a href="#testing">Testing</a>
</p>

---

> [!NOTE]
> **Production Status:** The frontend application is deployed and served via Cloudflare Pages from `main`. The Phase 21 database capacity and host validation migration (`supabase/migrations/`) is authored and staged, but awaiting scheduled production database execution. Frontend RPC calls are designed to fail closed with clear maintenance messaging if invoked against an unmigrated backend.

---

## Project Overview

**DuoWatch** is a private, real-time shared cinema web application designed specifically for two people. Whether for long-distance partners or two close friends, DuoWatch provides a synchronized, intimate viewing experience without third-party surveillance, mandatory user accounts, or costly media servers.

### Why DuoWatch?

* **Strictly Two Participants:** Unlike open conference tools or mass watch parties, DuoWatch enforces a hard platform ceiling of one Host and one Partner per room. Once the two-person capacity is reached, all additional connection attempts are strictly denied.
* **Direct Peer-to-Peer Streaming:** Local movies and screen-shares stream directly between browsers using WebRTC. Videos are never uploaded, transcoded, or retained on application servers or cloud buckets.
* **Zero-Cost Serverless Footprint:** By offloading media transmission to browser-native WebRTC and utilizing Cloudflare Pages and Supabase serverless tiers, the platform runs at zero operational infrastructure cost.
* **Privacy by Default:** Authentication is anonymous and ephemeral. Text chat resides solely in memory during the session and is never persisted to database tables.

---

## Core Features

DuoWatch provides three dedicated cinema playback modes and companion communication tools:

### Mode 1: YouTube Watch Together
* **Bilateral Playback Synchronization:** Play, pause, and seek events triggered by either participant synchronize across both browsers.
* **Dynamic Video Selection:** Load any public or unlisted YouTube video via URL or video ID.
* **Timecode Drift Correction:** Continuous playback alignment corrects drift over Supabase Realtime channels and WebRTC data channels without abrupt playback stutter.

### Mode 2: Local Movie Streaming
* **Browser-Native Capture:** The Host selects a local video file (MP4, WebM) from disk; the browser captures the media stream directly from the local HTML5 video element using `captureStream`.
* **Peer-to-Peer Transmission:** Video and audio are transmitted directly to the Partner over an encrypted WebRTC `RTCPeerConnection`.
* **Zero Cloud Storage:** The video file remains on the Host machine; no bytes are uploaded to cloud servers.
* **Synchronized Playback Controls:** Host play/pause/seek controls mirror immediately on the Partner display.

### Mode 3: Screen Sharing
* **Display Capture:** Stream a full desktop display, application window, or browser tab directly into the cinema room via `getDisplayMedia`.
* **Tab & System Audio:** Capture and transmit accompanying audio where supported by the operating system and browser.
* **Encrypted WebRTC Pipeline:** Full HD video streaming with dynamic bitrate and resolution adaptation.
* **Clean Session Termination:** Automatic stream release and UI restoration when screen sharing ends.

### Companion Capabilities
* **Ephemeral Real-Time Chat:** Exchange private text messages during the movie. Messages exist purely in application memory and vanish upon disconnection.
* **Passcode-Protected Invitations:** Rooms are protected by a cryptographically generated room code and an unguessable guest passcode.
* **Role-Based Controls:** Distinct Host (Owner) and Partner roles ensure clear control over cinema modes and room lifecycle.
* **Session Reconnection:** Secure session token hashes allow participants to seamlessly reconnect and reclaim their seat after network interruptions or page reloads.
* **Audio Clarification:** DuoWatch intentionally excludes microphone and voice chat to eliminate audio feedback and acoustic echo loops during movie playback.

---

## Technology Stack

The platform is built using modern web standards and serverless infrastructure:

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React | `19.3.1` | Declarative UI and state orchestration |
| **Language** | TypeScript | `~7.0.2` | End-to-end static typing and contract validation |
| **Build & Dev Server** | Vite | `8.3.5` | Fast compilation, bundling, and client dev server |
| **Styling** | Tailwind CSS | `4.3.3` | Responsive layout and cinema styling |
| **Icons** | Lucide React | `1.66.0` | Minimalist interface icons |
| **Routing** | React Router | `7.18.5` | Client-side SPA routing and deep links |
| **Backend & Auth** | Supabase JS | `2.118.0` | Anonymous authentication and RPC invocation |
| **Database** | PostgreSQL | 15+ | Relational schema, serialized RPCs, and RLS policies |
| **Signaling** | Supabase Realtime | — | Presence tracking and WebRTC signaling exchange |
| **Media Transport** | WebRTC | Browser Native | Peer-to-peer video, audio, and data channel transmission |
| **External Media** | YouTube IFrame API | Standard | Synchronized YouTube player integration |
| **Hosting** | Cloudflare Pages | Edge | Global edge distribution and SPA static hosting |
| **Test Runner** | Vitest | `5.0.5` | Fast concurrent unit and security test suites |
| **Code Quality** | Oxlint | `1.89.0` | High-performance JavaScript/TypeScript linter |

---

## Architecture

```text
                           +---------------------------+
                           |     Cloudflare Pages      |
                           |   (Global Edge Static)    |
                           +-------------+-------------+
                                         |
                   HTTPS Delivery        |        HTTPS Delivery
                                         v
         +-------------------------------+-------------------------------+
         |                                                               |
         v                                                               v
+------------------+                                           +------------------+
|   Host Browser   |                                           | Partner Browser  |
|  (Owner Session) |                                           | (Partner Session)|
+--------+---------+                                           +--------+---------+
         |                                                              |
         | <================= WebRTC P2P Connection ==================> |
         |       Encrypted Media Stream (Video/Audio) + DataChannel     |
         |                                                              |
         +-----------------------+           +--------------------------+
                                 |           |
               Anonymous Auth    |           |   Anonymous Auth
               PostgreSQL RPCs   |           |   PostgreSQL RPCs
               Realtime Signaling|           |   Realtime Signaling
                                 v           v
                           +---------------------------+
                           |         Supabase          |
                           |  - Anonymous Identity     |
                           |  - PostgreSQL with RLS    |
                           |  - Realtime Presence      |
                           |  - Server-Side RPCs       |
                           +---------------------------+
```

### Component Responsibilities

* **Cloudflare Pages:** Serves the pre-compiled SPA bundle globally with low latency. Static redirects (`_redirects`) handle direct URL navigation.
* **Host Browser:** Initiates room creation, serves as the WebRTC offerer, captures local media or screen capture streams, and broadcasts playback state changes.
* **Partner Browser:** Validates credentials with the guest passcode, receives the WebRTC answer, renders the incoming media stream, and syncs playback state.
* **Supabase Authentication:** Generates isolated, cryptographically distinct anonymous user IDs for both participants without tracking personal data.
* **PostgreSQL RPCs & RLS:** Enforces serialized two-participant room limits, validates session token hashes, tracks lease heartbeats, and guards room records with Row-Level Security.
* **Supabase Realtime:** Acts as the low-latency signaling conduit for SDP offer/answer exchanges, ICE candidate negotiation, and presence tracking.
* **WebRTC Peer Connection:** Direct peer-to-peer transport for high-bandwidth video and audio tracks, bypassing intermediate servers.

---

## Installation

### Prerequisites

* **Node.js:** `22.x LTS` (recommended; `20.x+` supported)
* **Package Manager:** `npm` (included with Node.js)
* **Git**

### Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/shariarhossaintanvir/DuoWatch.git
   cd DuoWatch
   ```

2. **Install dependencies:**
   ```bash
   npm ci
   ```

3. **Configure environment variables:**
   ```bash
   # On macOS / Linux:
   cp .env.example .env.local

   # On Windows PowerShell:
   Copy-Item .env.example .env.local
   ```

4. **Start the local development server:**
   ```bash
   npm run dev
   ```

Open `http://localhost:5173` in your browser.

---

## Environment Configuration

Configure the required variables in `.env.local` for development or in your Cloudflare Pages dashboard for production:

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `VITE_SUPABASE_URL` | Yes (Production) | — | HTTPS URL of your Supabase project (e.g., `https://xyz.supabase.co`). |
| `VITE_SUPABASE_ANON_KEY` | Yes (Production) | — | Public anonymous API key (`anon` key) for client-side Supabase requests. |
| `VITE_STUN_SERVERS` | No | Google STUN | Comma-separated list of STUN server URIs used for WebRTC ICE candidate discovery. |
| `VITE_ENABLE_LOCAL_FALLBACK` | No | `false` | Development-only browser-local storage fallback. **Must remain `false` in production.** |

> [!CAUTION]
> **Secret Hygiene:** All variables prefixed with `VITE_` are compiled into the client-side JavaScript bundle and are publicly visible in the browser. **Never** put Supabase `service_role` keys, database connection strings, or admin tokens in `VITE_` variables.

---

## Deployment

### 1. Cloudflare Pages Setup

1. Connect your GitHub repository to Cloudflare Pages.
2. Select the `main` branch as the production branch.
3. Configure the build parameters:
   * **Framework Preset:** `Vite`
   * **Build Command:** `npm run build`
   * **Build Output Directory:** `dist`
   * **Environment Variables:** Set `NODE_VERSION=22`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_ENABLE_LOCAL_FALLBACK=false`.
4. Deploy. The included `public/_redirects` file ensures correct client-side SPA routing for deep paths like `/room/:roomCode`.

### 2. Supabase Database Configuration

Before launching production traffic, verify your Supabase project settings:

1. **Enable Anonymous Sign-ins:** In the Supabase Dashboard, navigate to **Authentication** -> **Providers** -> **Anonymous** and enable it.
2. **Execute Migrations in Order:**
   * `supabase/migrations/20261101_init_duowatch.sql`: Creates baseline tables, indexes, and RLS policies.
   * `supabase/migrations/20261114_reconcile_legacy_production_data.sql`: Reconciles legacy rooms and participants into a private archive schema prior to installing capacity constraints.
   * `supabase/migrations/20261114_global_two_participant_capacity.sql`: Implements atomic Host creation, serialized participant admission, and heartbeat lease reclamation.
   *(Alternatively, review and execute the consolidated migration script: `supabase/migrations/20261114_zero_downtime_phase21_atomic_migration.sql`)*.

> [!WARNING]
> **Production Safety:** Never run destructive drop or recreate scripts against a production database containing active data. Verify backups and execute migrations within an approved maintenance window.

---

## Security & Privacy

* **Anonymous Identifiers:** Users are authenticated via anonymous Supabase sessions. No email addresses, phone numbers, or passwords are collected or stored.
* **Session Cryptographic Hashes:** Room operations require valid session token hashes (`p_session_token_hash`) checked against SHA-256 hashes stored in the database.
* **Row-Level Security (RLS):** Database tables strictly restrict access using PostgreSQL RLS policies tied to the authenticated user's anonymous UID.
* **Privileged SECURITY DEFINER Functions:** Sensitive operations (room creation, seat admission, participant eviction) execute through security definer functions with revoked public execution rights to prevent direct role escalation.
* **End-to-End Encrypted Media:** Audio and video streams transmitted over WebRTC are encrypted in transit using standard DTLS/SRTP protocols.
* **No Server-Side Media Storage:** Files streamed in Local Movie mode are never written to disk, cache, or cloud storage.
* **Transient Chat Log:** Messages sent via the cinema chat are broadcast via WebRTC data channels and private Realtime channels and exist only in transient browser memory.

---

## Known Limitations

* **NAT Traversal Without TURN:** DuoWatch currently utilizes STUN servers for peer discovery. In environments behind symmetric NATs or restrictive corporate firewalls, direct peer connections may fail without a dedicated TURN relay.
* **Browser Codec Compatibility:** Local movie playback relies on the browser's underlying media decoder. Standard MP4 (H.264/AAC) and WebM (VP8/VP9/Opus) are broadly supported. MKV containers or proprietary codecs (e.g., AC3 audio) vary by browser.
* **Resolution & Bandwidth:** 1080p stream transmission depends on the Host device's hardware capture performance and upstream network bandwidth (~4–6 Mbps upload recommended). Quality dynamically scales to match available network throughput.
* **Mobile Background Execution:** Mobile operating systems (iOS Safari, Android Chrome) frequently suspend background WebRTC media tracks and pause JavaScript timers when switching tabs or locking the screen.
* **YouTube Embedding Restrictions:** Certain YouTube videos with owner-enforced embedding restrictions or regional copyright blocks cannot be rendered inside third-party players.

---

## Testing

The DuoWatch codebase includes a comprehensive automated test suite covering unit logic, WebRTC stream management, cryptographic hashing, and adversarial security scenarios.

### Run Code Quality Checks

```bash
# Execute Oxlint static analysis
npm run lint

# Run the complete Vitest test suite
npm test

# Verify production build compilation and type integrity
npm run build
```

### Verified Test Baseline

```text
 ✓ tests/global-capacity.test.ts (26 tests)
 ✓ tests/security-hotfix-verification.test.ts (12 tests)
 ✓ tests/room-authorization.test.ts (5 tests)
 ✓ tests/adversarial-security.test.ts (13 tests)
 ✓ tests/cloud-integration.test.ts (9 tests)
 ✓ tests/phase19-polish-and-mobile.test.ts (21 tests)
 ✓ tests/invitation-flow.test.ts (1 test)
 ✓ tests/crypto.test.ts (3 tests)
 ✓ tests/phase16-1080p-quality.test.ts (11 tests)
 ✓ tests/phase15-8-diagnosis-and-repair.test.ts (13 tests)
 ✓ tests/youtube-sync.test.ts (8 tests)
 ✓ tests/security-audit.test.ts (4 tests)
 ✓ tests/phase15-9-voice-removal-and-p2p.test.ts (10 tests)
 ✓ tests/phase15-7-full-sync.test.ts (10 tests)
 ✓ tests/phase15-6-stabilization.test.ts (8 tests)
 ✓ tests/phase15-4-controls-repair.test.ts (9 tests)

 Test Files  16 passed (16)
      Tests  163 passed (163)
```

---

## Project Structure

```text
DuoWatch/
├── public/                 # Static assets, SVG icons, and Cloudflare SPA _redirects
│   ├── favicon.ico
│   ├── favicon.svg
│   ├── icons.svg
│   └── _redirects
├── src/
│   ├── components/         # UI components
│   │   ├── chat/           # Ephemeral text chat interface
│   │   ├── modal/          # Cinema configuration and invitation dialogs
│   │   ├── player/         # Video players (YouTube, LocalFile, ScreenShare)
│   │   ├── room/           # Room controls and participant indicators
│   │   └── Navbar.tsx      # Application header and mobile navigation
│   ├── context/            # React CinemaContext and unified state machine
│   ├── lib/                # Core platform libraries
│   │   ├── crypto.ts       # Cryptographic hashing and token generation
│   │   ├── roomService.ts  # Supabase RPC abstraction and room management
│   │   ├── supabase.ts     # Client initialization and auth state
│   │   └── webrtc.ts       # WebRTC peer connection and signaling manager
│   ├── pages/              # Primary route pages (Home, Room, Privacy, Terms)
│   └── types/              # TypeScript definitions for cinema and database
├── supabase/
│   └── migrations/         # PostgreSQL schemas, RPCs, and RLS policies
├── tests/                  # Automated test suites (163 tests across 16 files)
├── .env.example            # Environment configuration template
├── .gitignore              # Git ignore rules for builds, secrets, and caches
├── package.json            # Dependencies and npm execution scripts
├── tsconfig.json           # TypeScript configuration
└── vite.config.ts          # Vite build configuration and Tailwind integration
```

---

## License

**Copyright © 2026 Shariar Hossain Tanvir. All rights reserved.**

This repository is publicly accessible for portfolio demonstration and technical review. No permission is granted to copy, reproduce, distribute, or create derivative works from this source code without express written authorization from the owner.
