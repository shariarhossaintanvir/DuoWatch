# Known Limitations & Technical Disclosures

In adherence to the **$0 Zero-Cost First** mandate, DuoWatch relies on direct peer-to-peer browser technologies and public free-tier infrastructure. The following technical and environmental boundaries must be noted.

---

## 1. NAT & Firewall Traversal (STUN vs. TURN)

- **Architecture Choice**: DuoWatch uses public, free Google and Twilio STUN servers (`stun.l.google.com:19302`, `global.stun.twilio.com:3478`). We do not include or contract paid TURN relay services.
- **The Symmetric NAT Boundary**:
  - Direct P2P connects smoothly across standard residential broadband, home Wi-Fi, and mobile 4G/5G connections (Full Cone, Restricted Cone, and Port-Restricted Cone NATs).
  - However, if **both** participants are behind **Symmetric NATs** or restrictive enterprise firewalls (common in corporate offices, universities, and banks), STUN alone cannot discover a direct port mapping.
- **Zero-Cost Fallback**:
  - If a connection fails with `Connection State: failed`, switch one of the devices to a home Wi-Fi connection, personal mobile hotspot, or standard residential network.

---

## 2. Browser Codec Compatibility (Local Movie Streaming)

- In **Mode B (Local File Streaming)**, videos are decoded client-side by the host's web browser:
  - **Universally Supported**: `.mp4` (H.264 video + AAC audio), `.webm` (VP8/VP9 video + Opus audio), `.ogg`.
  - **Variable Support**: `.mkv` files containerized with H.264/AAC work in modern Chromium/Firefox. `.mkv` files with proprietary audio (such as AC3 or DTS) or legacy codecs (MPEG-2, DivX, XviD) cannot be decoded natively by browser engines.
- **Recommendation**: If a video plays without sound or displays a decoding error, convert the container using free open-source tools (e.g. HandBrake or ffmpeg) to standard H.264/AAC MP4.

---

## 3. Mobile Device & Browser Platform Boundaries

- **Screen Sharing (`getDisplayMedia`)**:
  - Screen sharing is natively restricted by Apple iOS (Safari/Chrome for iOS) and Android mobile operating systems. Mode C (Screen Sharing) is supported on desktop platforms (Windows, macOS, Linux, ChromeOS). Mobile participants can still receive and view the host's screen share in real time.
- **iOS Autoplay Restrictions**:
  - WebKit on iOS requires a user touch interaction (such as tapping the screen or unmute button) before unmuted remote audio can play.
- **Background Tab Throttling**:
  - Mobile browsers aggressively throttle timers and WebRTC frame rates when the browser tab is minimized or sent to the background. Keep the cinema tab active for uninterrupted streaming.

---

## 4. YouTube Embedding Restrictions

- Content owners on YouTube can selectively restrict embedding outside youtube.com (YouTube API error code `101` or `150`).
- DuoWatch strictly respects YouTube’s terms and cannot force playback of restricted videos. When encountered, DuoWatch displays a helpful notice with a one-click button to open the video directly on YouTube.

---

## 5. Upstream Bandwidth & Resolution Disclaimer

- WebRTC media streaming relies on the Host's **upload bandwidth**.
- While local file streaming and screen sharing adaptively adjust resolution and bitrates using WebRTC congestion control, we explicitly **do not guarantee 1080p or 4K streaming** on connections with slow upstream bandwidth (< 5 Mbps upload).
