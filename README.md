<h1 align="center">DuoWatch</h1>

<p align="center"><strong>A private cinema for two people.</strong></p>
<p align="center">Watch YouTube together, stream a local movie, or share your screen.<br>One room. One host. One partner.</p>
<p align="center">
  <a href="https://duowatch.pages.dev">Website</a> ·
  <a href="#features">Features</a> ·
  <a href="#run-locally">Run locally</a> ·
  <a href="#deployment">Deployment</a>
</p>

---

> **Launch status:** The frontend is published from `main`, but the production Supabase capacity migration is still pending review and verification. Room creation may be unavailable until the backend rollout is complete. A successful frontend deployment is not a completed production launch.

## Features

| Experience | How it works |
| --- | --- |
| **YouTube together** | Synchronize playback, seeking, and video changes between two browsers. |
| **Local movie streaming** | Play a file on the host device and send its captured audio/video to the partner over WebRTC, without uploading the movie. |
| **Screen sharing** | Share a desktop, window, or browser tab, with audio where the browser permits it. |
| **Private text chat** | Exchange messages during the session without a persistent chat history in the application database. |
| **Invitation-based access** | Join with a room invitation and participant credentials. |
| **Session recovery** | Heartbeats and session credentials support reconnecting and reclaiming abandoned slots. |

DuoWatch is designed for **one active room and at most two admitted participants across the platform**, not unlimited separate rooms. The database-side global limit requires the Phase 21 migration before it can be relied on in production.

Microphone and voice-chat features are intentionally not included.

## How it fits together

```text
                    Cloudflare Pages
                    React + TypeScript
                           |
                 +---------+---------+
                 |                   |
            Host browser       Partner browser
                 |                   |
                 +---- WebRTC -------+
                 |   media + data    |
                 |                   |
                 +---- Supabase -----+
                      Anonymous Auth
                      PostgreSQL RPCs
                      Private Realtime
```

Cloudflare Pages serves the website. Supabase handles anonymous identity, room state, authorization, and signaling. When a direct WebRTC connection succeeds, local movie and screen-share media travel between the two browsers rather than through application file storage.

## Technology

| Layer | Stack |
| --- | --- |
| Frontend | React 19, TypeScript, React Router |
| Interface | Tailwind CSS 4, Lucide |
| Build | Vite 8 |
| Backend | Supabase Auth, PostgreSQL, RLS, Realtime |
| Media | WebRTC, YouTube IFrame Player API |
| Tests | Vitest, Oxlint, TypeScript |
| Hosting | Cloudflare Pages |

The architecture targets free service tiers. Free-tier quotas, browser support, and network conditions still apply.

## Run locally

**Requirements:** Node.js 22 LTS (recommended) and npm.

```bash
git clone https://github.com/shariarhossaintanvir/DuoWatch.git
cd DuoWatch
npm ci
cp .env.example .env.local
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp` if needed.

Set the environment values in `.env.local`, then open the local address printed by Vite. The optional browser-only fallback is for development; it does **not** provide globally enforced capacity across devices.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase public anonymous/publishable client key |
| `VITE_STUN_SERVERS` | Optional comma-separated STUN server URLs |
| `VITE_ENABLE_LOCAL_FALLBACK` | Development-only local fallback; set to `false` in production |

**Never put a Supabase service-role key, database password, or other secret into a `VITE_` variable.** Vite exposes these variables to the browser. Local `.env` files are excluded from Git; `.env.example` contains placeholders only.

## Deployment

### 1. Supabase

Enable **Anonymous Sign-ins** in Supabase Authentication. Review the SQL in `supabase/migrations/` before applying it:

| Migration | Purpose |
| --- | --- |
| `20261101_init_duowatch.sql` | Baseline schema and access controls |
| `20261114_reconcile_legacy_production_data.sql` | Reconcile existing legacy records before global constraints |
| `20261114_global_two_participant_capacity.sql` | Global room capacity, serialized admission, and related RPCs |

**Existing databases require special care.** Do not blindly rerun the baseline migration or execute the reconciliation/capacity scripts without a backup, compatibility review, and approved rollout plan. The production migration has not been completed as of this README update.

### 2. Cloudflare Pages

Connect this repository to Cloudflare Pages with these build settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 22 |

Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Pages build environment, and set `VITE_ENABLE_LOCAL_FALLBACK=false`. Redeploy after changing build-time variables. The `public/_redirects` file supports SPA deep links.

### 3. Verify on real devices

After an approved backend rollout, verify the complete flow using separate browsers or devices:

1. Create a room as Host.
2. Join as Partner using the invitation.
3. Confirm a third participant cannot join.
4. Test YouTube playback synchronization and chat.
5. Test local movie video **and audio**, plus screen sharing.
6. Test leaving, reconnecting, and room expiration.

Do not infer WebRTC or database readiness from a successful static build alone.

## Development checks

```bash
npm run lint
npm test
npm run build
```

Automated tests cover important application paths, but mocked tests do not replace real PostgreSQL concurrency tests or two-device network testing.

## Security and privacy

- Rooms use invitation credentials and server-validated participant sessions.
- Supabase RLS and database functions are intended to enforce authorization; review deployed policies and grants before production use.
- Local movies are not uploaded to Supabase or Cloudflare by the application.
- WebRTC media is encrypted in transit. Supabase Realtime carries signaling metadata.
- Text chat is designed to be ephemeral, rather than saved as a persistent message history.
- The app includes its own **Privacy Policy** and **Terms & Conditions** pages.

A public source repository does not make private rooms public. It also does not replace secure backend configuration.

## Limitations

- **No TURN relay:** Strict NATs and restrictive networks may prevent a direct peer connection.
- **Browser codecs:** MP4 with H.264/AAC is generally the most practical local-video choice; MKV and other formats vary by browser.
- **Resolution:** 1080p depends on the source, capture support, device performance, and host upload bandwidth. It is not guaranteed.
- **Mobile browsers:** Background tabs may pause heartbeats or media. Screen capture is primarily a desktop-host feature.
- **YouTube:** Videos whose owners disable embedding cannot be played inside DuoWatch.

## Repository layout

```text
src/                 Application and UI
src/lib/             Room services, Supabase, WebRTC, signaling
src/components/      Player, chat, and room components
supabase/migrations/ Database schema and RPC migrations
tests/               Automated tests
scripts/             Verification utilities
public/              Static assets and SPA routing
```

## License

**All rights reserved.** This repository is public for source inspection; no license to copy, redistribute, or reuse the code is granted by default.
