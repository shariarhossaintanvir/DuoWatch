# DuoWatch

**Private watch-party experience for two participants.**

DuoWatch is a lightweight, zero-cost virtual cinema built for exactly two people — an Owner (Host) and a Partner (Guest). It enables synchronized YouTube playback, peer-to-peer local video streaming, screen sharing, and real-time text chat in a private, browser-based room.

---

## Overview

Most watch-party tools require accounts, collect personal data, rely on paid subscriptions, or route private media through third-party media servers. DuoWatch was engineered to eliminate these trade-offs:

- **Strictly Two Participants:** Designed specifically for couples or friends watching together, eliminating unwanted guests and room clutter.
- **Direct Peer-to-Peer Media:** Local video files and screen shares stream directly between browsers over WebRTC. No media files are ever uploaded to a server or cloud storage bucket.
- **Zero Cost Infrastructure:** Built to operate entirely within the free tiers of Cloudflare Pages (frontend hosting) and Supabase (authentication, authorization, and signaling).
- **No Account Registration:** Participants authenticate anonymously via Supabase Auth and join using cryptographic room credentials.

---

## Features

### Synchronized YouTube Playback
- Integrated with the official YouTube IFrame Player API.
- Host-authoritative playback controls (play, pause, seek, and video changes).
- Sub-second drift detection and clock alignment across participants.
- Fallback handling with direct YouTube links for embed-restricted videos.

### Local Video File Sharing (Peer-to-Peer)
- Host can select local video files (`.mp4`, `.webm`, `.mkv`) directly from their device.
- Video streams directly from the Host's browser to the Partner's browser using `HTMLMediaElement.captureStream()` over WebRTC DTLS-SRTP.
- No file uploads, no storage fees, and zero cloud bandwidth consumption.

### Screen & Window Sharing
- Share desktop displays, application windows, or browser tabs via `navigator.mediaDevices.getDisplayMedia`.
- Captures and transmits system/tab audio where supported by the browser.
- Automatic stream termination cleanup when the sharing session ends.

### Ephemeral Text Chat & Reactions
- Real-time text messaging between participants.
- Floating cinema emoji reactions.
- Messages exist exclusively in browser memory during the active session; zero chat logs or messages are stored in any database.

### Host & Partner Session Management
- Host holds cryptographic authority over room playback mode, media selection, and room termination.
- Partner receives full playback synchronization and interactive chat participation.
- Session tokens verify participant identity across page refreshes and reconnections.
- 90-second heartbeat leases automatically release abandoned rooms and participant slots.

### Invitation-Based Joining
- Host generates a unique 6-character room code and guest passcode.
- One-click invitation links prefill room details for seamless guest onboarding.

### Responsive Desktop & Mobile Experience
- Dark cinema UI built with Tailwind CSS.
- Adaptive controls, mobile bottom sheets, and native full-screen support across viewport sizes.

### Global Two-Participant Capacity Management
- Architectural invariant: at most one active room (`GLOBAL_ACTIVE_ROOMS <= 1`) and at most two participants (`GLOBAL_ACTIVE_PARTICIPANTS <= 2`) globally.
- Sanitized public availability endpoint allows visitors to verify platform availability prior to room creation.
- *Status Note:* Implemented in application code and verified across automated test suites; live enforcement on the remote Supabase backend activates upon applying the Phase 21 database migration.

---

## Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend Framework** | React 19, TypeScript, React Router DOM v7 |
| **Styling & Icons** | Tailwind CSS v4, Lucide React |
| **Build & Tooling** | Vite, Oxlint |
| **Testing** | Vitest (15 suites, 151 unit and integration tests) |
| **Backend & Database** | Supabase Free Tier (PostgreSQL, Row-Level Security, PL/pgSQL RPCs) |
| **Authentication** | Supabase Anonymous Authentication |
| **Realtime & Signaling** | Supabase Realtime (Private Broadcast Channels) |
| **Peer-to-Peer Media** | WebRTC (`RTCPeerConnection`, `RTCDataChannel`, DTLS-SRTP) |
| **STUN Infrastructure** | Public free STUN servers (Google STUN, Twilio STUN) |
| **Hosting** | Cloudflare Pages Free Tier |

---

## Architecture

```
                     +---------------------------------------+
                     |           Cloudflare Pages            |
                     |       (Static SPA Distribution)       |
                     +-------------------+-------------------+
                                         |
                                         v
                         +-------------------------------+
                         |        Host Browser           |
                         +---------------+---------------+
                                         |
                 +-----------------------+-----------------------+
                 |                                               |
                 | WebRTC Signaling & Heartbeats                 | Direct P2P Media
                 | (Supabase Realtime Broadcast & RPC)           | (DTLS-SRTP Streams)
                 v                                               v
+-----------------------------------+             +-------------------------------+
|         Supabase Backend          |             |       Partner Browser         |
|  - Anonymous Auth                 |             +-------------------------------+
|  - PostgreSQL RLS (Deny All Direct)             |
|  - SECURITY DEFINER RPCs          |             |
|  - Channel Access Authorization   |<------------+
|  - Global Capacity Serialization  |  WebRTC Signaling & Heartbeats
+-----------------------------------+
```

### Communication Flow
1. **Authentication:** Both Host and Partner initialize independent anonymous Supabase Auth sessions (`auth.uid()`).
2. **Room Creation:** The Host calls `duowatch_create_room`, which serializes access via `duowatch_global_state`, verifies global capacity, inserts the room record, and registers the Host atomically.
3. **Guest Admission:** The Partner calls `duowatch_join_room` with the room code and guest passcode. The database validates credentials, verifies total participant capacity (maximum 2), checks role availability, and registers the Partner.
4. **Signaling & Authorization:** Both participants subscribe to a private Supabase Realtime broadcast channel (`duowatch_room_<CODE>`). Channel access is authorized by the `duowatch_can_access_channel` database function, which verifies active membership and fresh heartbeat leases.
5. **P2P Connection:** WebRTC SDP offers, answers, and ICE candidates are exchanged over the private broadcast channel. Once established, media tracks (video and audio) stream directly peer-to-peer.
6. **Session Maintenance:** Both browsers transmit heartbeats every 25 seconds to renew their 90-second participant lease. If a lease expires, the slot is automatically reclaimed.

---

## Getting Started

### Prerequisites
- Node.js 20 or higher
- npm 10 or higher

### Installation

1. Clone the repository:
```bash
git clone https://github.com/shariarhossaintanvir/DuoWatch.git
cd DuoWatch
```

2. Install dependencies:
```bash
npm ci
```

3. Configure environment variables:
```bash
cp .env.example .env
```
Populate `.env` with your Supabase credentials (see [Environment Variables](#environment-variables)). For local development without a Supabase project, set `VITE_ENABLE_LOCAL_FALLBACK=true`.

4. Start the development server:
```bash
npm run dev
```

5. Open `http://localhost:5173` in your browser.

---

## Environment Variables

DuoWatch uses the following client-side environment variables prefixed with `VITE_`:

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes (Production) | Your Supabase project URL (e.g., `https://your-project.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Yes (Production) | Your Supabase public `anon` API key (JWT format) |
| `VITE_STUN_SERVERS` | No | Comma-separated list of STUN server URIs. Defaults to Google and Twilio public STUN. |
| `VITE_ENABLE_LOCAL_FALLBACK` | No | Set to `'true'` only for local offline development using browser `BroadcastChannel`. Must be `'false'` in production. |

> **Security Notice:** Never provide a `service_role` key, database password, or secret token to `VITE_SUPABASE_ANON_KEY` or any client environment variable. DuoWatch strictly operates using the public `anon` key. All privileged mutations are secured by server-side PostgreSQL functions.

---

## Security & Privacy

- **Public Source Code:** The codebase is open for inspection. No secrets, credentials, or private keys are stored in version control.
- **Private Room Access:** Rooms are identified by unguessable room codes and protected by SHA-256 hashed guest passcodes. DuoWatch maintains no public room directory.
- **Strict Row-Level Security (RLS):** All direct client table queries (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on `duowatch_rooms`, `duowatch_participants`, and `duowatch_global_state` are denied by RLS policies (`USING (false)`). Clients interact solely through parameter-validated `SECURITY DEFINER` functions.
- **Fixed Search Path:** All PostgreSQL stored procedures enforce `SET search_path = ''` to prevent search-path injection vulnerabilities.
- **Identity Binding:** Participant sessions are cryptographically bound to the caller's authenticated `auth.uid()`. An attacker cannot impersonate another participant or hijack a session slot.
- **Server-Side Capacity Enforcement:** Global capacity and two-participant limits are enforced inside serialized database transactions holding row-level locks, preventing race conditions.
- **Peer-to-Peer Media Transmission:** Media streams for local video files and screen sharing are transmitted directly between browsers via WebRTC with DTLS-SRTP encryption. Media frames never pass through or get stored on Supabase or Cloudflare servers.
- **Privacy Boundaries:** Signaling metadata (SDP offers, answers, ICE candidates) traverses Supabase Realtime broadcast channels. Signaling messages are encrypted in transit via TLS. DuoWatch does not implement end-to-end encryption for signaling metadata beyond standard transport security; room passcodes should be shared only with trusted participants.

---

## Deployment

### 1. Supabase Backend Setup
1. Create a free project at [supabase.com](https://supabase.com).
2. Navigate to **Project Settings > API** to obtain your Project URL and public `anon` key.
3. In the Supabase SQL Editor, execute the database migration scripts in order:
   - `supabase/migrations/20261101_init_duowatch.sql` (Initial schema and RLS policies)
   - `supabase/migrations/20261114_global_two_participant_capacity.sql` (Global capacity and concurrency locks)
4. Ensure **Anonymous Sign-ins** are enabled under **Authentication > Providers > Anonymous**.
5. Enable Realtime on the `duowatch_rooms` table if real-time state synchronization is desired.

### 2. Cloudflare Pages Setup
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) and navigate to **Workers & Pages > Create application > Pages > Connect to Git**.
2. Select the `DuoWatch` repository and set the production branch to `main`.
3. Configure the build settings:
   - **Framework preset:** `Vite` (or `None`)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Under **Settings > Environment variables**, add:
   - `VITE_SUPABASE_URL` = `<your-supabase-project-url>`
   - `VITE_SUPABASE_ANON_KEY` = `<your-supabase-public-anon-key>`
   - `VITE_ENABLE_LOCAL_FALLBACK` = `false`
5. Deploy. Cloudflare Pages provides automatic HTTPS and uses `public/_redirects` for Single Page Application routing.

---

## Testing

The project includes an extensive test suite verifying cryptographic operations, room authorization, capacity enforcement, YouTube synchronization, and security invariants.

```bash
# Run all automated tests
npm test

# Run linter
npm run lint

# Compile TypeScript and build production bundle
npm run build
```

### Test Scope
- **Unit Tests:** Cryptographic token generation, SHA-256 hashing, YouTube drift compensation, time synchronization.
- **Authorization & Security:** Validates that non-hosts cannot alter media state, invalid passcodes are rejected, expired sessions are denied, and third participants receive `ROOM_FULL`.
- **Global Capacity:** Verifies atomic room creation, singleton row-locking, lease expiry reclamation, fail-closed availability checks, and role uniqueness.
- **Static Analysis:** Validates zero leaked credentials, absence of paid TURN dependencies, and compliance with zero-cost architecture constraints.

---

## Known Limitations

- **NAT & Firewall Traversal:** DuoWatch uses public STUN servers for WebRTC peer connection negotiation. In network configurations involving symmetric NATs or strict corporate firewalls, direct peer connections may fail without a TURN relay.
- **Browser Compatibility for Local File Streaming:** Local video streaming requires browser support for `HTMLMediaElement.captureStream()` or `mozCaptureStream()`. Supported on Chromium-based browsers (Chrome, Edge, Brave, Opera) and Firefox. Not supported on iOS Safari.
- **Video Codec Support:** Local file playback depends on the Host and Partner browsers sharing support for the video container and codec (typically H.264, VP8, VP9, or AV1 in MP4 or WebM containers). Unsupported codecs (e.g., HEVC/H.265 on certain platforms or AC3 audio) will not decode.
- **Mobile Backgrounding:** Mobile operating systems may throttle or suspend WebRTC connections and WebSocket heartbeats when the browser tab is minimized or the screen is locked.
- **Free Tier Constraints:** Operates within Supabase Free Tier quotas (concurrent Realtime connections and monthly active users).
- **Voice Communication:** Voice and microphone transmission are intentionally excluded to maintain audio clarity, prevent echo feedback, and ensure consistent video audio synchronization.

---

## Project Status

- **Codebase:** Fully implemented with React 19, TypeScript, Tailwind CSS, and WebRTC.
- **Automated Tests:** 15 test suites passing (151 of 151 tests).
- **Production Build:** Clean compilation with Vite and TypeScript (`tsc -b && vite build`).
- **Production Deployment:** Configured for Cloudflare Pages and Supabase Free Tier. Production database migration staged in `supabase/migrations/` awaiting owner deployment approval.

---

## License

All rights reserved. Proprietary software — see repository owner for licensing and usage inquiries.
