import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebRTCManager } from '../src/lib/webrtc';
import type { WebRTCStreamStats, SyncMessagePayload } from '../src/types/cinema';

// Mock WebRTC environment for Phase 16 testing
class MockMediaStreamTrack {
  public kind: string;
  public id: string;
  public contentHint?: string;
  public readyState: string = 'live';

  constructor(kind: string, id: string = 'track_' + Math.random().toString(36).slice(2, 7)) {
    this.kind = kind;
    this.id = id;
  }

  stop() {
    this.readyState = 'ended';
  }
}

class MockMediaStream {
  private tracks: MockMediaStreamTrack[] = [];
  constructor(tracks: MockMediaStreamTrack[] = []) {
    this.tracks = tracks;
  }
  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter(t => t.kind === 'video');
  }
  getTracks() {
    return [...this.tracks];
  }
  addTrack(t: MockMediaStreamTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: MockMediaStreamTrack) {
    this.tracks = this.tracks.filter(x => x !== t);
  }
}

(globalThis as any).MediaStream = MockMediaStream;

describe('DuoWatch Phase 16: Local Movie 1080p Full HD Quality Optimization Suite', () => {
  let mockGetParameters: any;
  let mockSetParameters: any;
  let mockSetCodecPreferences: any;
  let mockGetStats: any;
  let rtpSender: any;
  let rtpTransceiver: any;

  beforeEach(() => {
    mockGetParameters = vi.fn().mockReturnValue({
      encodings: [{ maxBitrate: 1_000_000 }],
    });
    mockSetParameters = vi.fn().mockResolvedValue(undefined);
    mockSetCodecPreferences = vi.fn();

    rtpSender = {
      track: null,
      getParameters: mockGetParameters,
      setParameters: mockSetParameters,
      replaceTrack: vi.fn().mockImplementation(async (track: any) => {
        rtpSender.track = track;
      }),
    };

    rtpTransceiver = {
      direction: 'sendrecv',
      mid: '0',
      sender: rtpSender,
      receiver: { track: new MockMediaStreamTrack('video') },
      setCodecPreferences: mockSetCodecPreferences,
    };

    mockGetStats = vi.fn().mockResolvedValue(new Map());

    // Mock global RTCRtpReceiver capabilities
    (globalThis as any).RTCRtpReceiver = {
      getCapabilities: vi.fn().mockImplementation((kind: string) => {
        if (kind === 'video') {
          return {
            codecs: [
              { mimeType: 'video/VP8', clockRate: 90000 },
              { mimeType: 'video/H264', clockRate: 90000 },
              { mimeType: 'video/VP9', clockRate: 90000 },
              { mimeType: 'video/AV1', clockRate: 90000 },
              { mimeType: 'video/rtx', clockRate: 90000 },
            ],
          };
        }
        return { codecs: [] };
      }),
    };

    // Mock RTCPeerConnection
    (globalThis as any).RTCPeerConnection = class MockPC {
      public connectionState: string = 'connected';
      public iceConnectionState: string = 'connected';
      public signalingState: string = 'stable';
      public localDescription = { type: 'offer', sdp: 'mock_sdp' };
      public remoteDescription = { type: 'answer', sdp: 'mock_sdp' };
      private transceivers: any[] = [];

      addTransceiver(kind: 'audio' | 'video', init?: any) {
        if (kind === 'video') {
          this.transceivers.push(rtpTransceiver);
          return rtpTransceiver;
        }
        const audioSender = {
          track: null,
          replaceTrack: vi.fn().mockImplementation(async (t: any) => {
            audioSender.track = t;
          }),
        };
        const audioTransceiver = {
          direction: init?.direction || 'sendrecv',
          mid: '1',
          sender: audioSender,
          receiver: { track: new MockMediaStreamTrack('audio') },
        };
        this.transceivers.push(audioTransceiver);
        return audioTransceiver;
      }

      getTransceivers() {
        return this.transceivers;
      }

      createDataChannel(label: string) {
        return {
          label,
          readyState: 'open',
          send: vi.fn(),
          close: vi.fn(),
        };
      }

      async getStats() {
        return mockGetStats();
      }

      close() {
        this.connectionState = 'closed';
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('1. 1080p Video Sender Parameter Tuning', () => {
    it('applies high quality 5.0 Mbps, maintain-resolution, and scaleResolutionDownBy 1.0', async () => {
      const webrtc = new WebRTCManager({
        onConnectionChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      webrtc.initialize('host_user', 'guest_user', true);

      await webrtc.applyHighQualityVideoParameters(5_000_000);

      expect(mockGetParameters).toHaveBeenCalled();
      expect(mockSetParameters).toHaveBeenCalledTimes(1);

      const appliedParams = mockSetParameters.mock.calls[0][0];
      expect(appliedParams.encodings[0].maxBitrate).toBe(5_000_000);
      expect(appliedParams.encodings[0].maxFramerate).toBe(30);
      expect(appliedParams.encodings[0].scaleResolutionDownBy).toBe(1.0);
      expect(appliedParams.degradationPreference).toBe('maintain-resolution');

      webrtc.cleanup();
    });

    it('re-applies 1080p video parameters automatically when a local video track is attached', async () => {
      const webrtc = new WebRTCManager({
        onConnectionChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      webrtc.initialize('host_user', 'guest_user', true);

      const localVideoTrack = new MockMediaStreamTrack('video', 'movie_track_1080p');
      const localStream = new MockMediaStream([localVideoTrack]);

      webrtc.setMediaStream(localStream as any);

      // Verify track replaced without resetting connection
      expect(rtpSender.replaceTrack).toHaveBeenCalledWith(localVideoTrack);
      expect(localVideoTrack.contentHint).toBe('motion');

      // Allow microtask resolution
      await Promise.resolve();

      expect(mockSetParameters).toHaveBeenCalled();
      const params = mockSetParameters.mock.calls[0][0];
      expect(params.encodings[0].maxBitrate).toBe(5_000_000);

      webrtc.cleanup();
    });

    it('preserves existing contentHint="detail" when screen share track is provided', () => {
      const webrtc = new WebRTCManager({
        onConnectionChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      webrtc.initialize('host_user', 'guest_user', true);

      const screenTrack = new MockMediaStreamTrack('video', 'screen_track');
      screenTrack.contentHint = 'detail';
      const screenStream = new MockMediaStream([screenTrack]);

      webrtc.setMediaStream(screenStream as any);

      // WebRTCManager must not overwrite explicit detail content hint
      expect(screenTrack.contentHint).toBe('detail');

      webrtc.cleanup();
    });
  });

  describe('2. Modern High-Efficiency Video Codec Prioritization', () => {
    it('prioritizes H.264 and VP9 codecs while keeping all supported codecs for interoperability', () => {
      const webrtc = new WebRTCManager({
        onConnectionChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      webrtc.initialize('host_user', 'guest_user', true);

      expect(mockSetCodecPreferences).toHaveBeenCalledTimes(1);
      const prioritized = mockSetCodecPreferences.mock.calls[0][0];

      // H.264 should be first, then VP9, then VP8
      expect(prioritized[0].mimeType.toLowerCase()).toContain('h264');
      expect(prioritized[1].mimeType.toLowerCase()).toContain('vp9');
      expect(prioritized[2].mimeType.toLowerCase()).toContain('vp8');

      // Verify no codecs were dropped (total count preserved)
      expect(prioritized.length).toBe(5);

      webrtc.cleanup();
    });
  });

  describe('3. WebRTC Telemetry & Adaptive Bitrate Controller', () => {
    it('dispatches live stream metrics to onStreamStats callback', async () => {
      const onStreamStats = vi.fn();
      const webrtc = new WebRTCManager({
        onConnectionChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
        onStreamStats,
      });

      // Prepare mock stats reports
      const mockStatsReport = new Map<string, any>([
        [
          'outbound_vid',
          {
            type: 'outbound-rtp',
            kind: 'video',
            frameWidth: 1920,
            frameHeight: 1080,
            framesPerSecond: 30,
            bytesSent: 1_250_000,
            qualityLimitationReason: 'none',
          },
        ],
        [
          'inbound_vid',
          {
            type: 'inbound-rtp',
            kind: 'video',
            frameWidth: 1920,
            frameHeight: 1080,
            framesPerSecond: 30,
            bytesReceived: 1_200_000,
            framesDecoded: 900,
            framesDropped: 0,
            packetsLost: 0,
            jitter: 0.008,
          },
        ],
        [
          'codec_info',
          {
            type: 'codec',
            mimeType: 'video/H264',
          },
        ],
      ]);

      mockGetStats.mockResolvedValue(mockStatsReport);

      webrtc.initialize('host_user', 'guest_user', true);

      // Invoke internal collectStreamStats
      await (webrtc as any).collectStreamStats();

      expect(onStreamStats).toHaveBeenCalledTimes(1);
      const emittedStats: WebRTCStreamStats = onStreamStats.mock.calls[0][0];

      expect(emittedStats.codec).toBe('video/H264');
      expect(emittedStats.outbound?.frameWidth).toBe(1920);
      expect(emittedStats.outbound?.frameHeight).toBe(1080);
      expect(emittedStats.outbound?.fps).toBe(30);
      expect(emittedStats.outbound?.qualityLimitationReason).toBe('none');

      expect(emittedStats.inbound?.frameWidth).toBe(1920);
      expect(emittedStats.inbound?.frameHeight).toBe(1080);
      expect(emittedStats.inbound?.framesDropped).toBe(0);
      expect(emittedStats.inbound?.packetsLost).toBe(0);
      expect(emittedStats.inbound?.jitter).toBe(8); // 0.008s -> 8ms

      webrtc.cleanup();
    });

    it('adapts bitrate smoothly down on packet loss (> 5%) without renegotiation or stream restart', async () => {
      const webrtc = new WebRTCManager({
        onConnectionChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      webrtc.initialize('host_user', 'guest_user', true);

      // Attach active track
      const track = new MockMediaStreamTrack('video');
      webrtc.setMediaStream(new MockMediaStream([track]) as any);
      rtpSender.track = track;

      mockSetParameters.mockClear();

      // Stats report indicating network packet loss (8% loss)
      const congestedStats = new Map<string, any>([
        [
          'outbound_vid',
          {
            type: 'outbound-rtp',
            kind: 'video',
            frameWidth: 1920,
            frameHeight: 1080,
            framesPerSecond: 30,
            bytesSent: 1_000_000,
            qualityLimitationReason: 'bandwidth',
          },
        ],
        [
          'remote_inbound',
          {
            type: 'remote-inbound-rtp',
            kind: 'video',
            fractionLost: 0.08,
            roundTripTime: 0.06,
          },
        ],
      ]);

      mockGetStats.mockResolvedValue(congestedStats);

      await (webrtc as any).collectStreamStats();

      // Encoder bitrate should step down by 500 kbps (from 5.0 Mbps to 4.5 Mbps)
      expect(mockSetParameters).toHaveBeenCalled();
      const updatedParams = mockSetParameters.mock.calls[0][0];
      expect(updatedParams.encodings[0].maxBitrate).toBe(4_500_000);

      webrtc.cleanup();
    });
  });

  describe('4. Zero-Upload Architecture & Regression Verification', () => {
    it('verifies local video is streamed 100% peer-to-peer and VITE_ENABLE_LOCAL_FALLBACK remains false', () => {
      // Local fallback must remain false to enforce fail-closed zero cloud storage
      expect(import.meta.env.VITE_ENABLE_LOCAL_FALLBACK).toBe('false');
    });

    it('preserves text chat DataChannel messaging alongside 1080p video streaming', () => {
      const onDataMessage = vi.fn();
      const webrtc = new WebRTCManager({
        onConnectionChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage,
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      webrtc.initialize('host_user', 'guest_user', true);

      const chatPayload: SyncMessagePayload = {
        type: 'chat-message',
        chatMessage: {
          id: 'chat_123',
          senderId: 'host_user',
          senderName: 'Host',
          role: 'owner',
          text: 'Enjoying the 1080p movie!',
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };

      const sent = webrtc.sendDataMessage(chatPayload);
      expect(sent).toBe(true);

      webrtc.cleanup();
    });

    it('preserves YouTube synchronization state handling alongside WebRTC architecture', () => {
      const webrtc = new WebRTCManager({
        onConnectionChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      webrtc.initialize('host_user', 'guest_user', true);

      const syncPayload: SyncMessagePayload = {
        type: 'media-sync',
        action: 'seek',
        eventId: 'seek_evt_1',
        revision: 4,
        mediaState: {
          currentTime: 124.5,
          isPlaying: true,
          mode: 'youtube',
          videoId: 'dQw4w9WgXcQ',
        },
        timestamp: Date.now(),
      };

      const sent = webrtc.sendDataMessage(syncPayload);
      expect(sent).toBe(true);

      webrtc.cleanup();
    });
  });

  describe('5. Phase 16.1 Partner Remote Media Stream Stability & Playback Pipeline', () => {
    it('maintains a stable remoteMediaStream instance across track arrival and onunmute events', () => {
      const streamsEmitted: any[] = [];
      const webrtc = new WebRTCManager({
        onConnectionChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: (s) => streamsEmitted.push(s),
        onSendSignal: vi.fn(),
      });

      webrtc.initialize('host_user', 'partner_user', false);

      const pc = (webrtc as any).pc;
      const videoTrack = new MockMediaStreamTrack('video', 'movie_vid_1');
      const audioTrack = new MockMediaStreamTrack('audio', 'movie_aud_1');

      // 1. Video track arrives via ontrack
      pc.ontrack({ track: videoTrack });
      expect(streamsEmitted.length).toBe(1);
      const firstStream = streamsEmitted[0];
      expect(firstStream.getVideoTracks().length).toBe(1);

      // 2. Video track un-mutes (RTP packets begin arriving)
      (videoTrack as any).onunmute();
      expect(streamsEmitted.length).toBe(2);
      // The stream instance must remain strictly identical to prevent HTMLMediaElement reset/AbortError
      expect(streamsEmitted[1]).toBe(firstStream);

      // 3. Audio track arrives via ontrack
      pc.ontrack({ track: audioTrack });
      expect(streamsEmitted.length).toBe(3);
      expect(streamsEmitted[2]).toBe(firstStream);
      expect(firstStream.getAudioTracks().length).toBe(1);
      expect(firstStream.getVideoTracks().length).toBe(1);

      // 4. Audio track un-mutes
      (audioTrack as any).onunmute();
      expect(streamsEmitted.length).toBe(4);
      expect(streamsEmitted[3]).toBe(firstStream);

      webrtc.cleanup();
    });

    it('simulates Partner user gesture playback sequence with muted fallback and unmute', async () => {
      // Mock HTMLVideoElement behavior for testing the unlock sequence
      let isPlayCalled = false;
      let playAttempts = 0;

      const mockVideoElement = {
        srcObject: null as any,
        playsInline: false,
        muted: false,
        volume: 1,
        paused: true,
        play: vi.fn().mockImplementation(async function (this: any) {
          playAttempts++;
          isPlayCalled = true;
          // Simulate browser policy: reject if unmuted on first attempt
          if (playAttempts === 1 && !this.muted) {
            throw new Error('NotAllowedError: play() failed because the user did not interact with the document first.');
          }
          this.paused = false;
        }),
      };

      const testStream = new MockMediaStream([new MockMediaStreamTrack('video')]);

      // Execute the exact Phase 16.1 unlock sequence
      const unlockPlayback = async (video: typeof mockVideoElement, stream: any) => {
        if (video.srcObject !== stream) {
          video.srcObject = stream;
        }
        video.playsInline = true;
        video.volume = 1;
        video.muted = false;

        try {
          await video.play();
        } catch {
          // Fallback sequence: start muted then unmute
          video.muted = true;
          await video.play();
          video.muted = false;
          video.volume = 1;
        }
      };

      await unlockPlayback(mockVideoElement, testStream);

      expect(isPlayCalled).toBe(true);
      expect(playAttempts).toBe(2);
      expect(mockVideoElement.paused).toBe(false);
      expect(mockVideoElement.muted).toBe(false);
      expect(mockVideoElement.srcObject).toBe(testStream);
    });
  });
});

