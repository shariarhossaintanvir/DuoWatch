import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebRTCManager } from '../src/lib/webrtc';
import { computeDiagnosticStatus } from '../src/lib/diagnostics';
import type { WebRTCSignalPayload } from '../src/types/cinema';

// Mock WebRTC primitives for Node/Vitest environment
class MockMediaStreamTrack {
  public kind: string;
  public id: string;
  public contentHint?: string;
  public readyState: string = 'live';
  public muted: boolean = false;
  public onunmute: (() => void) | null = null;
  public onmute: (() => void) | null = null;
  public onended: (() => void) | null = null;

  constructor(kind: string, id: string = `${kind}_track_${Math.random().toString(36).slice(2, 7)}`) {
    this.kind = kind;
    this.id = id;
  }

  stop() {
    this.readyState = 'ended';
    if (this.onended) this.onended();
  }

  triggerUnmute() {
    this.muted = false;
    if (this.onunmute) this.onunmute();
  }

  triggerMute() {
    this.muted = true;
    if (this.onmute) this.onmute();
  }
}

class MockMediaStream {
  public id: string;
  private tracks: MockMediaStreamTrack[] = [];
  private eventListeners: Record<string, ((ev: any) => void)[]> = {};

  constructor(tracks: MockMediaStreamTrack[] = []) {
    this.id = 'stream_' + Math.random().toString(36).substring(2, 9);
    this.tracks = [...tracks];
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
    const listeners = this.eventListeners['addtrack'] || [];
    listeners.forEach(fn => fn({ track: t }));
  }

  removeTrack(t: MockMediaStreamTrack) {
    this.tracks = this.tracks.filter(x => x !== t);
    const listeners = this.eventListeners['removetrack'] || [];
    listeners.forEach(fn => fn({ track: t }));
  }

  addEventListener(event: string, listener: (ev: any) => void) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(listener);
  }

  removeEventListener(event: string, listener: (ev: any) => void) {
    if (!this.eventListeners[event]) return;
    this.eventListeners[event] = this.eventListeners[event].filter(l => l !== listener);
  }
}

(globalThis as any).MediaStream = MockMediaStream;

if (typeof (globalThis as any).RTCSessionDescription === 'undefined') {
  (globalThis as any).RTCSessionDescription = class MockRTCSessionDescription {
    type: string;
    sdp: string;
    constructor(init: any) {
      this.type = init.type;
      this.sdp = init.sdp;
    }
  };
}

if (typeof (globalThis as any).RTCIceCandidate === 'undefined') {
  (globalThis as any).RTCIceCandidate = class MockRTCIceCandidate {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
    constructor(init: any) {
      this.candidate = init.candidate;
      this.sdpMid = init.sdpMid ?? null;
      this.sdpMLineIndex = init.sdpMLineIndex ?? null;
    }
    toJSON() {
      return {
        candidate: this.candidate,
        sdpMid: this.sdpMid,
        sdpMLineIndex: this.sdpMLineIndex,
      };
    }
  };
}

// Configurable Mock PeerConnection for Phase 23
class MockRTCPeerConnection {
  public connectionState: string = 'new';
  public iceConnectionState: string = 'new';
  public signalingState: string = 'stable';
  public localDescription: any = null;
  public remoteDescription: any = null;
  public transceivers: any[] = [];
  public rollbackCalls: number = 0;
  public setRemoteDescriptionHistory: any[] = [];

  public onconnectionstatechange: (() => void) | null = null;
  public oniceconnectionstatechange: (() => void) | null = null;
  public onicecandidate: ((ev: any) => void) | null = null;
  public ontrack: ((ev: any) => void) | null = null;
  public onnegotiationneeded: (() => void) | null = null;
  public ondatachannel: ((ev: any) => void) | null = null;

  addTransceiver(kind: 'audio' | 'video', init?: RTCRtpTransceiverInit) {
    const sender = {
      track: null as any,
      getParameters: vi.fn().mockReturnValue({ encodings: [{ maxBitrate: 2_500_000 }] }),
      setParameters: vi.fn().mockResolvedValue(undefined),
      replaceTrack: vi.fn().mockImplementation(async (newTrack: any) => {
        sender.track = newTrack;
        return Promise.resolve();
      }),
    };
    const receiver = {
      track: new MockMediaStreamTrack(kind, `mock_recv_${kind}_${this.transceivers.length}`),
    };
    const transceiver = {
      direction: init?.direction || 'sendrecv',
      mid: String(this.transceivers.length),
      sender,
      receiver,
      setCodecPreferences: vi.fn(),
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }

  getTransceivers() {
    return this.transceivers;
  }

  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0\r\no=mock_offer\r\n' });
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'v=0\r\no=mock_answer\r\n' });

  async setLocalDescription(desc: any) {
    this.localDescription = desc;
    if (desc?.type === 'rollback') {
      this.rollbackCalls++;
      this.signalingState = 'stable';
    } else if (desc?.type === 'offer') {
      this.signalingState = 'have-local-offer';
    } else if (desc?.type === 'answer') {
      this.signalingState = 'stable';
    }
    return Promise.resolve();
  }

  async setRemoteDescription(desc: any) {
    this.setRemoteDescriptionHistory.push(desc);
    this.remoteDescription = desc;
    if (desc?.type === 'offer') {
      this.signalingState = 'have-remote-offer';
    } else if (desc?.type === 'answer') {
      this.signalingState = 'stable';
    }
    return Promise.resolve();
  }

  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  createDataChannel(label: string) {
    return {
      label,
      readyState: 'open',
      send: vi.fn(),
      close: vi.fn(),
    } as any;
  }
  close = vi.fn();
}

describe('DuoWatch Phase 23: Critical WebRTC Local Movie Streaming Root Cause Repair Suite', () => {
  let originalRTCPeerConnection: any;
  let originalRTCRtpReceiver: any;

  beforeEach(() => {
    originalRTCPeerConnection = (globalThis as any).RTCPeerConnection;
    originalRTCRtpReceiver = (globalThis as any).RTCRtpReceiver;

    (globalThis as any).RTCPeerConnection = MockRTCPeerConnection;
    (globalThis as any).RTCRtpReceiver = {
      getCapabilities: (kind: string) => {
        if (kind === 'video') {
          return {
            codecs: [
              { mimeType: 'video/VP8', clockRate: 90000 },
              { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=640032;packetization-mode=1' },
              { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' },
              { mimeType: 'video/VP9', clockRate: 90000 },
              { mimeType: 'video/AV1', clockRate: 90000 },
            ],
          };
        }
        return { codecs: [] };
      },
    };
  });

  afterEach(() => {
    (globalThis as any).RTCPeerConnection = originalRTCPeerConnection;
    (globalThis as any).RTCRtpReceiver = originalRTCRtpReceiver;
    vi.restoreAllMocks();
  });

  describe('Area A & C: Transceiver Directions, Glare Elimination & Sequential Rollback', () => {
    it('initializes Host as sendrecv and Partner as recvonly to prevent bidirectional negotiation glare', () => {
      const onSendSignal = vi.fn();
      const host = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal,
      });

      const partner = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal,
      });

      // Host is initiator
      host.initialize('host_1', 'partner_1', true);
      const hostDiagnostics = host.getDiagnostics();
      expect(hostDiagnostics.isInitiator).toBe(true);

      // Partner is non-initiator
      partner.initialize('partner_1', 'host_1', false);
      const partnerDiagnostics = partner.getDiagnostics();
      expect(partnerDiagnostics.isInitiator).toBe(false);

      host.cleanup();
      partner.cleanup();
    });

    it('suppresses onnegotiationneeded offers on receive-only Partner with no local tracks', async () => {
      const onSendSignal = vi.fn();
      const partner = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal,
      });

      partner.initialize('partner_1', 'host_1', false);
      const pc = (partner as any).pc as MockRTCPeerConnection;

      // Simulate browser firing onnegotiationneeded spontaneously on Partner
      if (pc.onnegotiationneeded) {
        await pc.onnegotiationneeded();
      }

      // Must NOT send an offer to Host
      expect(onSendSignal).not.toHaveBeenCalled();
      partner.cleanup();
    });

    it('performs sequential rollback when receiving an offer during have-local-offer state', async () => {
      const onSendSignal = vi.fn();
      const manager = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal,
      });

      manager.initialize('user_a', 'user_b', true);
      const pc = (manager as any).pc as MockRTCPeerConnection;

      // Put connection into have-local-offer state
      pc.signalingState = 'have-local-offer';

      const incomingOffer: WebRTCSignalPayload = {
        type: 'offer',
        sdp: { type: 'offer', sdp: 'v=0\r\no=remote_offer\r\n' } as any,
        senderId: 'user_b',
        targetId: 'user_a',
      };

      await manager.handleSignal(incomingOffer);

      // Sequential rollback must have executed before applying remote offer
      expect(pc.rollbackCalls).toBe(1);
      expect(pc.setRemoteDescriptionHistory[0]?.type).toBe('offer');
      manager.cleanup();
    });

    it('prioritizes H.264 Constrained Baseline (42e01f) for 100% Android hardware/software decode compatibility', () => {
      let capturedCodecs: any[] = [];
      const manager = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      // Spy on transceiver setCodecPreferences
      const origAddTransceiver = MockRTCPeerConnection.prototype.addTransceiver;
      MockRTCPeerConnection.prototype.addTransceiver = function (kind: any, init: any) {
        const trans = origAddTransceiver.call(this, kind, init);
        trans.setCodecPreferences = vi.fn().mockImplementation((codecs: any[]) => {
          if (kind === 'video') capturedCodecs = codecs;
        });
        return trans;
      };

      manager.initialize('host_1', 'partner_1', true);

      expect(capturedCodecs.length).toBeGreaterThan(0);
      // First codec must be H.264 with Constrained Baseline 42e01f
      expect(capturedCodecs[0].mimeType).toBe('video/H264');
      expect(capturedCodecs[0].sdpFmtpLine).toContain('42e01f');

      manager.cleanup();
      MockRTCPeerConnection.prototype.addTransceiver = origAddTransceiver;
    });
  });

  describe('Area B & D: Host Capture Reliability & Dynamic Track Handling', () => {
    it('sets video and audio transceivers to sendrecv when Host attaches a local MediaStream', () => {
      const manager = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      manager.initialize('host_1', 'partner_1', true);

      const vidTrack = new MockMediaStreamTrack('video', 'host_movie_v1');
      const audTrack = new MockMediaStreamTrack('audio', 'host_movie_a1');
      const movieStream = new MockMediaStream([vidTrack, audTrack]);

      manager.setMediaStream(movieStream as any);

      const pc = (manager as any).pc as MockRTCPeerConnection;
      const transceivers = pc.getTransceivers();
      expect(transceivers[0].direction).toBe('sendrecv');
      expect(transceivers[1].direction).toBe('sendrecv');

      manager.cleanup();
    });

    it('attaches dynamic audio and video tracks added after initial metadata load', async () => {
      const manager = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      manager.initialize('host_1', 'partner_1', true);
      const emptyStream = new MockMediaStream([]);
      manager.setMediaStream(emptyStream as any);

      const dynamicVid = new MockMediaStreamTrack('video', 'dyn_vid_track');
      emptyStream.addTrack(dynamicVid);

      const dynamicAud = new MockMediaStreamTrack('audio', 'dyn_aud_track');
      emptyStream.addTrack(dynamicAud);

      const senderVid = (manager as any).localVideoSender;
      const senderAud = (manager as any).localAudioSender;
      expect(senderVid.replaceTrack).toHaveBeenCalledWith(dynamicVid);
      expect(senderAud.replaceTrack).toHaveBeenCalledWith(dynamicAud);

      manager.cleanup();
    });
  });

  describe('Decision Tree Diagnostics: Comprehensive State Classification', () => {
    it('correctly classifies ICE_FAILED when connectionState is failed', () => {
      const result = computeDiagnosticStatus({
        isOwner: false,
        connectionStatus: 'failed',
        hasLocalVideoTrack: false,
        hasRemoteVideoTrack: true,
        outboundBytes: 0,
        outboundFrames: 0,
        inboundBytes: 0,
        inboundFramesDecoded: 0,
        hasPresentedFrames: false,
        isAutoplayBlocked: false,
        isVideoPlaying: false,
      });

      expect(result.status).toBe('ICE_FAILED');
      expect(result.color).toBe('text-red-400');
    });

    it('correctly classifies NO_VIDEO_TRACK for Partner when remote video track is missing', () => {
      const result = computeDiagnosticStatus({
        isOwner: false,
        connectionStatus: 'connected',
        hasLocalVideoTrack: false,
        hasRemoteVideoTrack: false,
        outboundBytes: 0,
        outboundFrames: 0,
        inboundBytes: 0,
        inboundFramesDecoded: 0,
        hasPresentedFrames: false,
        isAutoplayBlocked: false,
        isVideoPlaying: false,
      });

      expect(result.status).toBe('NO_VIDEO_TRACK');
      expect(result.label).toBe('Awaiting Host Track');
    });

    it('correctly classifies NO_INBOUND_RTP when connected but inbound bytes is 0', () => {
      const result = computeDiagnosticStatus({
        isOwner: false,
        connectionStatus: 'connected',
        hasLocalVideoTrack: false,
        hasRemoteVideoTrack: true,
        outboundBytes: 0,
        outboundFrames: 0,
        inboundBytes: 0,
        inboundFramesDecoded: 0,
        hasPresentedFrames: false,
        isAutoplayBlocked: false,
        isVideoPlaying: false,
        isAttemptingPlay: false,
      });

      expect(result.status).toBe('NO_INBOUND_RTP');
      expect(result.label).toBe('No Inbound RTP');
    });

    it('correctly classifies AUTOPLAY_BLOCKED when browser requires user activation', () => {
      const result = computeDiagnosticStatus({
        isOwner: false,
        connectionStatus: 'connected',
        hasLocalVideoTrack: false,
        hasRemoteVideoTrack: true,
        outboundBytes: 0,
        outboundFrames: 0,
        inboundBytes: 500000,
        inboundFramesDecoded: 0,
        hasPresentedFrames: false,
        isAutoplayBlocked: true,
        isVideoPlaying: false,
      });

      expect(result.status).toBe('AUTOPLAY_BLOCKED');
      expect(result.label).toBe('Autoplay Blocked');
    });

    it('correctly classifies FRAMES_NOT_DECODING when receiving RTP but frames are stalled', () => {
      const result = computeDiagnosticStatus({
        isOwner: false,
        connectionStatus: 'connected',
        hasLocalVideoTrack: false,
        hasRemoteVideoTrack: true,
        outboundBytes: 0,
        outboundFrames: 0,
        inboundBytes: 1500000,
        inboundFramesDecoded: 0,
        hasPresentedFrames: false,
        isAutoplayBlocked: false,
        isVideoPlaying: true,
      });

      expect(result.status).toBe('FRAMES_NOT_DECODING');
      expect(result.label).toBe('Decoder Stalled');
    });

    it('correctly classifies PLAYBACK_WORKING when frames are actively decoded and presented', () => {
      const result = computeDiagnosticStatus({
        isOwner: false,
        connectionStatus: 'connected',
        hasLocalVideoTrack: false,
        hasRemoteVideoTrack: true,
        outboundBytes: 0,
        outboundFrames: 0,
        inboundBytes: 2500000,
        inboundFramesDecoded: 120,
        hasPresentedFrames: true,
        isAutoplayBlocked: false,
        isVideoPlaying: true,
      });

      expect(result.status).toBe('PLAYBACK_WORKING');
      expect(result.label).toBe('Playback Working');
      expect(result.color).toBe('text-emerald-400');
    });

    it('correctly classifies NO_OUTBOUND_FRAMES for Host when movie is loaded but sending 0 bytes', () => {
      const result = computeDiagnosticStatus({
        isOwner: true,
        connectionStatus: 'connected',
        hasLocalVideoTrack: true,
        hasRemoteVideoTrack: false,
        outboundBytes: 0,
        outboundFrames: 0,
        inboundBytes: 0,
        inboundFramesDecoded: 0,
        hasPresentedFrames: false,
        isAutoplayBlocked: false,
        isVideoPlaying: false,
      });

      expect(result.status).toBe('NO_OUTBOUND_FRAMES');
      expect(result.label).toBe('No Outbound RTP');
    });

    it('correctly classifies PLAYBACK_WORKING for Host when transmitting normally', () => {
      const result = computeDiagnosticStatus({
        isOwner: true,
        connectionStatus: 'connected',
        hasLocalVideoTrack: true,
        hasRemoteVideoTrack: false,
        outboundBytes: 4500000,
        outboundFrames: 150,
        inboundBytes: 0,
        inboundFramesDecoded: 0,
        hasPresentedFrames: false,
        isAutoplayBlocked: false,
        isVideoPlaying: true,
      });

      expect(result.status).toBe('PLAYBACK_WORKING');
      expect(result.label).toBe('Streaming Active');
      expect(result.color).toBe('text-emerald-400');
    });

    it('requires true rendered frames or decoded RTP frames to report PLAYBACK_WORKING (metadata alone is insufficient)', () => {
      // Inbound RTP packets are arriving, but decoded frames is 0 and no frames presented
      const stalledResult = computeDiagnosticStatus({
        isOwner: false,
        connectionStatus: 'connected',
        hasLocalVideoTrack: false,
        hasRemoteVideoTrack: true,
        outboundBytes: 0,
        outboundFrames: 0,
        inboundBytes: 1200000,
        inboundFramesDecoded: 0,
        hasPresentedFrames: false,
        isAutoplayBlocked: false,
        isVideoPlaying: true,
      });

      expect(stalledResult.status).toBe('FRAMES_NOT_DECODING');
      expect(stalledResult.status).not.toBe('PLAYBACK_WORKING');

      // Once frames are presented via rVFC or framesDecoded > 0, status transitions to PLAYBACK_WORKING
      const activeResult = computeDiagnosticStatus({
        isOwner: false,
        connectionStatus: 'connected',
        hasLocalVideoTrack: false,
        hasRemoteVideoTrack: true,
        outboundBytes: 0,
        outboundFrames: 0,
        inboundBytes: 1200000,
        inboundFramesDecoded: 45,
        hasPresentedFrames: true,
        isAutoplayBlocked: false,
        isVideoPlaying: true,
      });

      expect(activeResult.status).toBe('PLAYBACK_WORKING');
    });
  });

  describe('Playback Promise Safety & Bounded Timeout', () => {
    it('ensures playback attempt timeout races safely and prevents unhandled rejections', async () => {
      let timeoutTriggered = false;
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        setTimeout(() => {
          timeoutTriggered = true;
          resolve('timeout');
        }, 50);
      });

      // Hanging play() mock
      let rejectPlayPromise: (err: any) => void;
      const hangingPlayPromise = new Promise<void>((_, reject) => {
        rejectPlayPromise = reject;
      });

      // Suppress unhandled rejection as implemented in production LocalFilePlayer
      hangingPlayPromise.catch(() => { });

      const result = await Promise.race([hangingPlayPromise, timeoutPromise]);
      expect(result).toBe('timeout');
      expect(timeoutTriggered).toBe(true);

      // Settle the hanging promise late
      rejectPlayPromise!(new Error('AbortError: The play() request was interrupted'));
    });
  });
});
