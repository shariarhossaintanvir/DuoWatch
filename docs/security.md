# DuoWatch Security Model & Threat Assessment

DuoWatch is built with a zero-trust, privacy-first architecture specifically hardened for strictly two participants.

---

## 1. Threat Matrix & Mitigations

| Threat Vector | Risk Description | DuoWatch Architectural Mitigation |
|---|---|---|
| **Unauthorized 3rd Participant** | Leaked invite link or brute force room code entry | Atomic PostgreSQL row locking (`FOR UPDATE`) + server-side participant counter. Rejects any attempt beyond 2 participants with `ROOM_FULL`. |
| **Host Impersonation** | Guest or attacker attempts to alter video playback or switch mode | Host receives a 32-byte cryptographic token stored in `sessionStorage`. Supabase only holds the SHA-256 hash. Mutative RPCs verify `owner_token_hash`. |
| **Media Eavesdropping** | Interception of video stream or voice audio in transit | WebRTC mandates DTLS-SRTP encryption for all audio/video RTP packets and SCTP over DTLS for DataChannels. Direct browser-to-browser P2P. |
| **Credential Exfiltration** | Client-side bundles exposing database administrative keys | Frontend *strictly* uses the public `anon` key. Row-Level Security (RLS) blocks all direct mutations; all writes require `SECURITY DEFINER` RPC validation. |
| **Data Retention / Subpoena Risk** | Chat logs or movie files stored on cloud servers | Zero video storage architecture: media is decoded client-side and streamed in real time. Text chat is ephemeral in memory only; zero database logs. |
| **Copyright / DRM Circumvention** | Users attempting to strip protected streams | DuoWatch utilizes the official YouTube IFrame Player API according to YouTube TOS. It does not strip ads, alter stream chunks, or bypass DRM. |

---

## 2. Cryptographic Implementation Details

### 2.1 Token Generation (`crypto.getRandomValues`)
All room codes, participant IDs, host tokens, and guest passcodes are generated using the browser's hardware-backed Web Crypto API:
```typescript
const array = new Uint8Array(32);
globalThis.crypto.getRandomValues(array);
const ownerToken = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
```

### 2.2 SHA-256 Hashing (`crypto.subtle.digest`)
Before writing to the database or passing across public signaling channels, tokens are digested with SHA-256:
```typescript
const msgBuffer = new TextEncoder().encode(token);
const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', msgBuffer);
```
Even if an attacker inspects database records, the original host token cannot be derived.

### 2.3 Strict Capacity Guard (Atomic PostgreSQL RPC)
```sql
SELECT * INTO v_room FROM public.duowatch_rooms 
WHERE room_code = p_room_code AND is_active = true AND expires_at > NOW()
FOR UPDATE; -- Row lock prevents concurrent join race condition

SELECT COUNT(*) INTO v_participant_count FROM public.duowatch_participants
WHERE room_id = v_room.id;

IF v_participant_count >= 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ROOM_FULL');
END IF;
```

---

## 3. WebRTC DTLS-SRTP Encryption

- All media (voice, captured video, audio) is packetized according to RFC 3550 and encrypted via SRTP with keys negotiated through DTLS 1.2/1.3.
- No media server (SFU/MCU) terminates the DTLS handshake; encryption is strictly peer-to-peer between Owner and Partner.
- Public STUN servers only assist with discovering reflexive IP:port bindings (NAT traversal); STUN servers never touch media or payload bytes.

---

## 4. Automated Security Verification

DuoWatch includes an automated security audit in `tests/security-audit.test.ts`:
- Verifies absence of `service_role` secrets across all source files.
- Verifies absence of HTTP file upload endpoints (`FormData`, `axios.post`).
- Verifies presence of cleanup hooks (`URL.revokeObjectURL`, `stream.getTracks().forEach(t => t.stop())`).
- Verifies public STUN configuration without paid TURN leaks.
