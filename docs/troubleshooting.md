# DuoWatch Troubleshooting & Diagnostic Guide

Common troubleshooting scenarios and actionable steps to resolve playback, audio, and connectivity issues.

---

## 1. WebRTC & P2P Connectivity Issues

### Symptom: Connection status stays on "Connecting..." or shows "Failed"
- **Cause 1: Symmetric NAT / Enterprise Firewall**: Both devices are behind restrictive networks (e.g. university eduroam or office VPN) that block direct STUN binding.
  - **Fix**: Disconnect from VPN. Connect at least one device to standard home Wi-Fi or a mobile personal hotspot.
- **Cause 2: Signaling Not Reachable**: Supabase environment variables are missing or incorrect in production.
  - **Fix**: Check your browser developer console (`F12`). If you are running locally without Supabase keys, ensure `VITE_ENABLE_LOCAL_FALLBACK=true` is set in your `.env`.

---

## 2. Audio & Microphone Issues

### Symptom: Voice chat has an echo or feedback loop
- **Cause**: Microphone picking up audio from computer speakers.
  - **Fix 1**: Use headphones or earphones.
  - **Fix 2**: In Settings (`Sliders` icon), ensure that **Echo Cancellation** and **Noise Suppression** are active (enabled by default in DuoWatch).
  - **Fix 3**: In Mode C (Screen Sharing), the host's local screen preview is automatically muted to prevent hearing their own audio twice.

### Symptom: Microphone permission denied or no audio meter activity
- **Cause**: Browser blocked microphone access.
  - **Fix**: Click the padlock / tune icon in the browser address bar, set **Microphone** to **Allow**, and reload the page. Open the Settings modal in DuoWatch to test your input level on the live meter.

---

## 3. Local Movie Streaming (Mode B) Issues

### Symptom: Host sees video, but Partner only sees a black screen or spinning loader
- **Cause 1: Unsupported Video Codec**: The video file uses an exotic container or proprietary audio codec (e.g. DTS audio or HEVC video) that your browser cannot stream over WebRTC.
  - **Fix**: Use standard H.264 video with AAC audio inside an `.mp4` container. Free software like HandBrake can re-encode any video to Web-friendly MP4 in a few clicks.
- **Cause 2: Browser Lacks `captureStream` Support**:
  - **Fix**: Use modern desktop Google Chrome, Microsoft Edge, Brave, or Mozilla Firefox.

---

## 4. YouTube Mode (Mode A) Issues

### Symptom: "The video owner does not allow embedded playback outside YouTube"
- **Cause**: The publisher marked this specific video with embedding restrictions (YouTube API error 101/150).
  - **Fix**: DuoWatch displays an **"Open on YouTube"** button to view the link directly. To continue watching together in DuoWatch, the host can paste a different YouTube link or switch to Mode C (Screen Sharing).

### Symptom: Video drifts out of sync by several seconds
- **Cause**: Temporary network packet loss or background buffering.
  - **Fix**: DuoWatch's drift engine automatically corrects clock offsets greater than 0.75 seconds. The host can also click Pause and Play once to broadcast an immediate resynchronization packet.

---

## 5. Room & Capacity Errors

### Symptom: "This private cinema room is full (capacity strictly limited to 2 participants)"
- **Cause 1: Legitimate 2-Person Limit**: Two active participants are already inside the cinema room.
- **Cause 2: Ghost Session**: You refreshed the page or closed the tab without clicking "Leave Room", and the database has not yet purged the previous connection heartbeat.
  - **Fix**: Wait 90 seconds for the database heartbeat cleaner to expire the stale session, or rejoin using the same display name and browser.

---

## 6. How to Run Diagnostics Locally

1. Open DevTools in Chrome/Edge: press `F12` or `Ctrl + Shift + I`.
2. Inspect the **Console** tab for WebRTC state events:
   - `[WebRTC] ICE Connection State: connected`
   - `[Signaling] Peer joined: Host / Partner`
3. Check WebRTC internals in Chrome by navigating to `chrome://webrtc-internals/` to inspect live DTLS-SRTP packet send/receive rates, RTT graphs, and candidate pairs.
