# DuoWatch Phase 15.2 — Invitation Link Security Hardening Report

**Document Date:** November 2, 2026  
**Evaluation Phase:** Phase 15.2 — Invitation Link Security Hardening & Credential Protection  
**Target Environment:** Local Dev (`http://localhost:5173`) + Remote Live Supabase Cloud  
**Tested Revision:** Branch `main`  
**Security Status:** **`HARDENED & VERIFIED`**  
*(Deployment remains on hold awaiting review and explicit approval)*

---

## 1. Executive Summary & Security Rationale

During Phase 15.2, a focused security evaluation and implementation hardening was conducted on the **DuoWatch Cinema Invitation Link** mechanism.

### 1.1 The Vulnerability of Query Parameters (`?passcode=...`)
Previously, the invitation link included the guest passcode as a standard HTTP query parameter:
```text
https://duowatch.app/join?code=XXXX-XXXX&passcode=a1b2c3d4e5f67890
```
Transmitting secrets in HTTP query parameters introduces significant security and privacy exposures:
1. **HTTP Server & Proxy Log Exposure:** Query strings are transmitted in HTTP request lines across the wire. Every reverse proxy, CDN edge cache (e.g., Cloudflare, Fastly, Vercel), load balancer, and web server logs the full URL with query parameters in plaintext access logs (`access.log`).
2. **Referer Header Leakage:** When a user visits a page with query parameters, any outgoing request to external resources or third-party iframes (such as the YouTube IFrame API) can leak the full URL via the HTTP `Referer` header unless strict referrer policies are enforced.
3. **Browser History & Cache Exposure:** Web browsers persistently record full URL query strings in the local browser history database, autocomplete cache, and synced cloud profile histories.
4. **Shoulder Surfing:** The raw secret remains visibly exposed in the browser's address bar for the entire duration of the user's session.

---

## 2. Technical Architecture: URL Fragment Hardening (`#passcode=...`)

To eliminate query string exposure while preserving frictionless 1-click invitation joining, DuoWatch has transitioned to **URL Hash Fragment Credential Transport**:
```text
https://duowatch.app/join?code=XXXX-XXXX#passcode=a1b2c3d4e5f67890
```

### 2.1 Why URL Fragments are Inherently Secure
1. **Client-Side Only (RFC 3986 § 3.5):** By RFC 3986 and W3C URI standards, the hash fragment (everything following `#`) is processed **strictly by the client browser** and is **never transmitted in HTTP request lines or request headers**.
2. **Zero Server Log Exposure:** Neither edge proxies, CDN providers, hosting servers, nor backend loggers ever receive or record the passcode.
3. **Automatic Referer Stripping:** Under standard W3C Referrer Policy rules, browsers strip URL fragments prior to sending the `Referer` header. Third-party integrations (e.g., YouTube `iframe_api`) receive only the origin and path.
4. **Immediate Address Bar Sanitization:** Once the client-side JavaScript reads the credential on initial mount, it sanitizes the visible address bar using `window.history.replaceState()`, removing the secret from both the visible address bar and the current history entry.

---

## 3. Implementation Details

### 3.1 Host Invitation Modal Generation ([`src/components/room/RoomShareModal.tsx`](file:///c:/DuoWatch/src/components/room/RoomShareModal.tsx))
The 1-click invitation link now formats the public identifier (`code`) as a query parameter and the secret credential (`guestPasscode`) as a hash fragment:
```typescript
const origin = window.location.origin;
const inviteUrl = `${origin}/join?code=${encodeURIComponent(session.roomCode)}${
  session.guestPasscode ? `#passcode=${encodeURIComponent(session.guestPasscode)}` : ''
}`;
```
- **Zero Exposure of Host Credentials:** Neither `ownerToken` nor `sessionToken` is ever placed into the invitation link or modal elements.
- **Copy Controls:** The host can click **"Copy"** on the 1-click invitation link, or copy the Room Code and Guest Passcode independently.

### 3.2 Safe Credential Extraction & URL Sanitization ([`src/pages/JoinRoomPage.tsx`](file:///c:/DuoWatch/src/pages/JoinRoomPage.tsx))
On the guest join page:
1. **Dual Extraction Strategy:**
   ```typescript
   function extractPasscodeFromUrl(hash: string, searchParams: URLSearchParams): string {
     // 1. Prioritize hash fragment (modern secure format: #passcode=... or raw hash)
     if (hash) {
       const clean = hash.replace(/^#/, '').trim();
       if (clean.startsWith('passcode=')) {
         const params = new URLSearchParams(clean);
         const val = params.get('passcode');
         if (val) return val.trim();
       } else if (clean.length >= 16) {
         return clean;
       }
     }
     // 2. Fallback to query parameter (backward compatibility)
     const queryVal = searchParams.get('passcode');
     if (queryVal) return queryVal.trim();

     return '';
   }
   ```
2. **Immediate Address Bar Sanitization:**
   ```typescript
   if (typeof window !== 'undefined' && (hash || searchParams.has('passcode'))) {
     const activeCode = (codeParam || roomCode || '').toUpperCase();
     const sanitizedUrl = `${window.location.pathname}${activeCode ? `?code=${encodeURIComponent(activeCode)}` : ''}`;
     window.history.replaceState(null, '', sanitizedUrl);
   }
   ```
   - **Result:** Within milliseconds of page load, `#passcode=...` (and any legacy `&passcode=...`) disappears from the visible browser URL bar, leaving only `/join?code=XXXX-XXXX`.
3. **Visual Password Masking on Join Page:**
   - The passcode input on the join page is masked by default (`type="password"`).
   - An interactive `Eye` / `EyeOff` button allows the guest to toggle visibility if they wish to verify or edit their passcode.

---

## 4. Regression & Verification Test Evidence

All automated security and regression test suites were executed against the codebase:

### 4.1 Automated Invitation Flow Test ([`tests/invitation-flow.test.ts`](file:///c:/DuoWatch/tests/invitation-flow.test.ts))
```text
 RUN  v5.0.5 C:/DuoWatch

 ✓ tests/invitation-flow.test.ts (1 test) 7631ms
   ✓ Host Invitation Flow & Passcode Verification (1)
     ✓ complete host-to-guest invitation flow with secure passcode display and join validation 7616ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  12.28s
```
**Verified Checkpoints:**
- [x] Host creates private cinema room; 32-hex (16-byte) `guestPasscode` is generated.
- [x] Host joins as `'owner'`; `guestPasscode` is preserved in the active `RoomSession` and `sessionStorage`.
- [x] Invitation link is constructed as `/join?code=XXXX-XXXX#passcode=<guestPasscode>`.
- [x] Passcode **never** appears in query parameters (`?passcode=` or `&passcode=`).
- [x] Neither `ownerToken` nor `sessionToken` appears in the invitation URL.
- [x] Safe extraction logic extracts the passcode from the hash fragment.
- [x] Backward compatibility: Legacy URLs with `?passcode=...` are extracted cleanly.
- [x] Guest Bob joins with extracted passcode and is granted role `'partner'`.
- [x] Guest Bob does **not** receive host's `ownerToken`.
- [x] Adversary attempting to use guest passcode to claim `'owner'` role is rejected.
- [x] Third participant attempting to join full room is rejected with `'ROOM_FULL'`.

### 4.2 Full Core Regression Suite
```text
 RUN  v5.0.5 C:/DuoWatch

 ✓ tests/crypto.test.ts (3 tests) 110ms
 ✓ tests/security-audit.test.ts (4 tests) 89ms
 ✓ tests/youtube-sync.test.ts (8 tests) 220ms
 ✓ tests/invitation-flow.test.ts (1 test) 5825ms
 ✓ tests/room-authorization.test.ts (5 tests) 8219ms

 Test Files  5 passed (5)
      Tests  21 passed (21)
   Duration  11.06s
```

### 4.3 Live Supabase Cloud Integration Suite
```text
 RUN  v5.0.5 C:/DuoWatch

 ✓ tests/cloud-integration.test.ts (9 tests) 10583ms
   ✓ Real Supabase Cloud Integration & Live Security Verification Suite (9)
     ✓ TASK 3: Verify anonymous Supabase Auth works against actual cloud project 1820ms
     ✓ TASK 4: Test duowatch_create_room against remote PostgreSQL 1219ms
     ✓ TASK 5: Test duowatch_join_room with two independent anonymous identities 907ms
     ✓ TASK 7: Verify unauthorized RPC calls fail 1547ms
     ✓ TASK 8 & 10: Test Supabase Presence and Room Heartbeats 730ms
     ✓ TASK 8 & 9: Verify Private Realtime Channel Authorization & Broadcast Delivery 2579ms
     ✓ TASK 19: Clean up test rooms and sessions safely 1186ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  15.89s
```

### 4.4 Production Build Verification
```text
> duowatch@0.0.0 build
> tsc -b && vite build

vite v8.3.5 building client environment for production...
transforming...
✓ 2121 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   1.41 kB │ gzip:   0.72 kB
dist/assets/index-EmPi4o-A.css   45.84 kB │ gzip:   8.38 kB
dist/assets/index-BAnxM_7q.js   597.58 kB │ gzip: 167.29 kB
✓ built in 10.13s
```

---

## 5. Strict Protection Compliance Review

| Protection Requirement | Status | Verification Detail |
| :--- | :---: | :--- |
| **No Supabase DB Schema Changes** | **COMPLIANT** | No tables, columns, or types modified. |
| **No RLS / RPC Modifications** | **COMPLIANT** | Existing PostgreSQL functions and RLS policies untouched. |
| **No Auth Configuration Changes** | **COMPLIANT** | Supabase anonymous auth provider settings intact. |
| **No Credential Invalidation** | **COMPLIANT** | Room codes, token hashes, and active sessions remain 100% valid. |
| **No Secret / Token Exposure** | **COMPLIANT** | `ownerToken` and `sessionToken` omitted from URLs and client views. |
| **No Console Logging of Secrets** | **COMPLIANT** | Zero logging of passcodes or sensitive tokens. |
| **No Git Pushes / No Deployment** | **COMPLIANT** | No Git commits pushed; production deployment remains on hold. |

---

## 6. Pre-Deployment Risk Assessment & Status

### Final Status: **`READY WITH DOCUMENTED RISKS`**

1. **Invitation Link Security Posture:**
   - **Resolved Risk:** Passcodes are no longer exposed in HTTP request lines, server access logs, or referer headers.
   - **User Experience:** One-click joining remains completely functional.
   - **Address Bar Hygiene:** Fragments are scrubbed immediately from the visible address bar.
2. **Remaining Documented Risks:**
   - **WebRTC STUN Constraint:** As documented in Phase 15, WebRTC P2P direct audio connections operate without a TURN relay. Users behind restrictive corporate VPNs or symmetric cellular NATs will not establish direct P2P audio, though YouTube synchronization and text chat remain operational via Supabase Realtime fallback.

**All Phase 15.2 objectives have been completed and verified. Awaiting your review and explicit approval.**
