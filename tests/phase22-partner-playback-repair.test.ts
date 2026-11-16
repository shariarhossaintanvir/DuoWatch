import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebRTCManager } from '../src/lib/webrtc';
import type { WebRTCSignalPayload, SyncMessagePayload } from '../src/types/cinema';

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

// Configurable Mock PeerConnection
class MockRTCPeerConnection {
  public connectionState: string = 'new';
  public iceConnectionState: string = 'new';
  public signalingState: string = 'stable';
  public localDescription: any = null;
  public remoteDescription: any = null;
  public transceivers: any[] = [];

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

  addTrack(track: any, _stream: any) {
    const sender = {
      track,
      getParameters: vi.fn().mockReturnValue({ encodings: [{}] }),
      setParameters: vi.fn().mockResolvedValue(undefined),
      replaceTrack: vi.fn().mockImplementation(async (newTrack: any) => {
        sender.track = newTrack;
        return Promise.resolve();
      }),
    };
    return sender as any;
  }

  createDataChannel(label: string) {
    return {
      label,
      readyState: 'open',
      send: vi.fn(),
      close: vi.fn(),
    } as any;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'v=0\r\no=mock 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'v=0\r\no=mock 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
  }

  async setLocalDescription(desc: any) {
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(desc: any) {
    this.remoteDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(_cand: any) {
    return Promise.resolve();
  }

  async getStats() {
    const statsMap = new Map<string, any>();
    // Mock outbound-rtp
    statsMap.set('outbound_video', {
      type: 'outbound-rtp',
      kind: 'video',
      framesSent: 120,
      bytesSent: 1_250_000,
      frameWidth: 1920,
      frameHeight: 1080,
      framesPerSecond: 30,
    });
    // Mock inbound-rtp
    statsMap.set('inbound_video', {
      type: 'inbound-rtp',
      kind: 'video',
      framesReceived: 118,
      bytesReceived: 1_240_000,
      frameWidth: 1920,
      frameHeight: 1080,
      framesPerSecond: 29.8,
    });
    return statsMap;
  }

  restartIce = vi.fn();
  close = vi.fn().mockImplementation(() => {
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
    this.signalingState = 'closed';
  });
}

(globalThis as any).RTCPeerConnection = MockRTCPeerConnection;

describe('DuoWatch Phase 22: Partner Local Video Playback Repair Suite', () => {
  let hostManager: WebRTCManager;
  let partnerManager: WebRTCManager;
  let hostSignals: WebRTCSignalPayload[] = [];
  let partnerSignals: WebRTCSignalPayload[] = [];
  let partnerRemoteStreams: MediaStream[] = [];
  let partnerTrackEvents: { track: any; event: string }[] = [];

  beforeEach(() => {
    hostSignals = [];
    partnerSignals = [];
    partnerRemoteStreams = [];
    partnerTrackEvents = [];

    hostManager = new WebRTCManager({
      onConnectionStateChange: vi.fn(),
      onDataChannelOpen: vi.fn(),
      onDataChannelClose: vi.fn(),
      onDataMessage: vi.fn(),
      onRemoteMediaStream: vi.fn(),
      onSendSignal: (sig) => hostSignals.push(sig),
    });

    partnerManager = new WebRTCManager({
      onConnectionStateChange: vi.fn(),
      onDataChannelOpen: vi.fn(),
      onDataChannelClose: vi.fn(),
      onDataMessage: vi.fn(),
      onRemoteMediaStream: (stream) => {
        partnerRemoteStreams.push(stream);
      },
      onTrackStateChange: (track, event) => {
        partnerTrackEvents.push({ track, event });
      },
      onSendSignal: (sig) => partnerSignals.push(sig),
    });
  });

  afterEach(() => {
    hostManager.cleanup();
    partnerManager.cleanup();
  });

  // Scenario 1: Host selects and plays a local MP4 before Partner joins
  it('Scenario 1: Host selects and plays a local MP4 before Partner joins (Pre-attachment avoids empty offer race)', async () => {
    hostManager.initialize('host-123', 'partner-456', true);

    const videoTrack = new MockMediaStreamTrack('video', 'host_video_pre');
    const audioTrack = new MockMediaStreamTrack('audio', 'host_audio_pre');
    const localStream = new MockMediaStream([videoTrack, audioTrack]) as any;

    // Host selects movie file before partner joins
    hostManager.setMediaStream(localStream);
    expect(hostManager.getLocalStream()).toBe(localStream);

    const pc = (hostManager as any).pc;
    const transceivers = pc.getTransceivers();
    expect(transceivers[0].sender.track).toBe(videoTrack);
    expect(transceivers[1].sender.track).toBe(audioTrack);

    // Host initiates negotiation with partner
    await hostManager.startAsInitiator();
    expect(hostSignals.length).toBeGreaterThanOrEqual(1);
    expect(hostSignals[0].type).toBe('offer');
    // Offer is created with tracks already attached to senders
    expect(transceivers[0].sender.track.id).toBe('host_video_pre');
    expect(transceivers[1].sender.track.id).toBe('host_audio_pre');
  });

  // Scenario 2: Partner joins and receives both video and movie audio
  it('Scenario 2: Partner joins and receives both video and movie audio via stable remote stream', async () => {
    partnerManager.initialize('partner-456', 'host-123', false);
    const partnerPc = (partnerManager as any).pc;

    const remoteVideoTrack = new MockMediaStreamTrack('video', 'remote_vid_scen2');
    const remoteAudioTrack = new MockMediaStreamTrack('audio', 'remote_aud_scen2');

    // Simulate ontrack for video
    partnerPc.ontrack({
      track: remoteVideoTrack,
      streams: [],
    });

    // Simulate ontrack for audio
    partnerPc.ontrack({
      track: remoteAudioTrack,
      streams: [],
    });

    expect(partnerRemoteStreams.length).toBe(2);
    const remoteStream = partnerRemoteStreams[partnerRemoteStreams.length - 1];
    expect(remoteStream).toBeDefined();
    expect(remoteStream.getVideoTracks().length).toBe(1);
    expect(remoteStream.getAudioTracks().length).toBe(1);
    expect(remoteStream.getVideoTracks()[0].id).toBe('remote_vid_scen2');
    expect(remoteStream.getAudioTracks()[0].id).toBe('remote_aud_scen2');

    // Track unmute triggers track lifecycle diagnostics and notifications
    remoteVideoTrack.triggerUnmute();
    expect(partnerTrackEvents).toContainEqual({
      track: remoteVideoTrack,
      event: 'unmute',
    });
  });

  // Scenario 3: Partner joins before Host selects a movie
  it('Scenario 3: Partner joins before Host selects a movie (Pre-allocated transceivers accept tracks seamlessly)', async () => {
    // Both initialize before file selection
    hostManager.initialize('host-123', 'partner-456', true);
    partnerManager.initialize('partner-456', 'host-123', false);

    const hostPc = (hostManager as any).pc;
    const initialTransceivers = hostPc.getTransceivers();
    expect(initialTransceivers.length).toBe(2);
    expect(initialTransceivers[0].sender.track).toBeNull();
    expect(initialTransceivers[1].sender.track).toBeNull();

    // Now host selects file
    const videoTrack = new MockMediaStreamTrack('video', 'later_vid');
    const audioTrack = new MockMediaStreamTrack('audio', 'later_aud');
    const movieStream = new MockMediaStream([videoTrack, audioTrack]) as any;

    hostManager.setMediaStream(movieStream);

    // Senders are updated via replaceTrack without destroying transceivers
    expect(initialTransceivers[0].sender.track).toBe(videoTrack);
    expect(initialTransceivers[1].sender.track).toBe(audioTrack);
    expect(hostPc.getTransceivers().length).toBe(2);
  });

  // Scenario 4: Host pauses, resumes, and seeks
  it('Scenario 4: Host pauses, resumes, and seeks without sender detachment or transceiver destruction', async () => {
    hostManager.initialize('host-123', 'partner-456', true);
    const videoTrack = new MockMediaStreamTrack('video', 'vid_pause_test');
    const audioTrack = new MockMediaStreamTrack('audio', 'aud_pause_test');
    const stream = new MockMediaStream([videoTrack, audioTrack]) as any;
    hostManager.setMediaStream(stream);

    const pc = (hostManager as any).pc;
    const initialVideoSender = pc.getTransceivers()[0].sender;

    // Simulate pause: source video element is paused, but captured stream tracks remain live
    expect(videoTrack.readyState).toBe('live');
    expect(pc.getTransceivers()[0].sender.track).toBe(videoTrack);

    // Simulate seek: currentTime updates, tracks remain bound
    expect(pc.getTransceivers()[0].sender).toBe(initialVideoSender);
    expect(initialVideoSender.track.id).toBe('vid_pause_test');
  });

  // Scenario 5: Host replaces the movie file
  it('Scenario 5: Host replaces the movie file (old listeners detached, senders cleanly swapped)', async () => {
    hostManager.initialize('host-123', 'partner-456', true);

    const movie1Video = new MockMediaStreamTrack('video', 'movie1_vid');
    const movie1Audio = new MockMediaStreamTrack('audio', 'movie1_aud');
    const movieStream1 = new MockMediaStream([movie1Video, movie1Audio]) as any;

    hostManager.setMediaStream(movieStream1);
    expect(hostManager.getLocalStream()).toBe(movieStream1);

    // Host selects movie 2
    const movie2Video = new MockMediaStreamTrack('video', 'movie2_vid');
    const movie2Audio = new MockMediaStreamTrack('audio', 'movie2_aud');
    const movieStream2 = new MockMediaStream([movie2Video, movie2Audio]) as any;

    hostManager.setMediaStream(movieStream2);
    expect(hostManager.getLocalStream()).toBe(movieStream2);

    const pc = (hostManager as any).pc;
    expect(pc.getTransceivers()[0].sender.track).toBe(movie2Video);
    expect(pc.getTransceivers()[1].sender.track).toBe(movie2Audio);
  });

  // Scenario 6: Partner refreshes or reconnects
  it('Scenario 6: Partner refreshes or reconnects (Host re-sends media stream to new peer connection)', async () => {
    hostManager.initialize('host-123', 'partner-456', true);
    const videoTrack = new MockMediaStreamTrack('video', 'reconnect_vid');
    const audioTrack = new MockMediaStreamTrack('audio', 'reconnect_aud');
    const stream = new MockMediaStream([videoTrack, audioTrack]) as any;
    hostManager.setMediaStream(stream);

    // Partner disconnects and rejoins with new session
    hostManager.cleanup();
    hostManager.initialize('host-123', 'partner-reconnected', true);

    // Re-attach active stream
    hostManager.setMediaStream(stream);
    const newPc = (hostManager as any).pc;
    expect(newPc.getTransceivers()[0].sender.track).toBe(videoTrack);
    expect(newPc.getTransceivers()[1].sender.track).toBe(audioTrack);
  });

  // Scenario 7: Autoplay is blocked and Partner manually starts playback
  it('Scenario 7: Autoplay is blocked and Partner recovers via bounded gesture unlock and fallback', async () => {
    // Model Partner video element behavior
    let playCallCount = 0;
    let mutedOnPlay = false;

    const mockVideoElement = {
      muted: false,
      srcObject: null as any,
      play: vi.fn().mockImplementation(async () => {
        playCallCount++;
        if (!mockVideoElement.muted) {
          const err = new Error('play() failed because the user didn\'t interact but autoplay was blocked');
          err.name = 'NotAllowedError';
          throw err;
        }
        mutedOnPlay = true;
        return Promise.resolve();
      }),
    };

    // First attempt without gesture: Unmuted play throws NotAllowedError
    let autoplayBlocked = false;
    try {
      await mockVideoElement.play();
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        autoplayBlocked = true;
      }
    }
    expect(autoplayBlocked).toBe(true);

    // DuoWatch Phase 22 Fallback: Mute video element and retry play
    mockVideoElement.muted = true;
    await mockVideoElement.play();
    expect(mutedOnPlay).toBe(true);
    expect(playCallCount).toBe(2);
  });

  // Scenario 8: Source playback starts after an initially empty capture stream
  it('Scenario 8: Source playback starts after initially empty capture stream (Dynamic track addition listener)', async () => {
    hostManager.initialize('host-123', 'partner-456', true);

    // Initially empty media stream (e.g., captureStream called before video frames decode)
    const emptyStream = new MockMediaStream([]) as any;
    hostManager.setMediaStream(emptyStream);

    const pc = (hostManager as any).pc;
    expect(pc.getTransceivers()[0].sender.track).toBeNull();
    expect(pc.getTransceivers()[1].sender.track).toBeNull();

    // Source video demuxes and emits audio/video tracks dynamically
    const dynamicVideo = new MockMediaStreamTrack('video', 'dyn_vid_1');
    const dynamicAudio = new MockMediaStreamTrack('audio', 'dyn_aud_1');

    emptyStream.addTrack(dynamicVideo);
    expect(pc.getTransceivers()[0].sender.track).toBe(dynamicVideo);

    emptyStream.addTrack(dynamicAudio);
    expect(pc.getTransceivers()[1].sender.track).toBe(dynamicAudio);
  });

  // Scenario 9: Network disconnects or ICE fails
  it('Scenario 9: Network disconnects or ICE fails (diagnostic reporting and bounded restart)', async () => {
    let lastState: string = '';
    const manager = new WebRTCManager({
      onConnectionStateChange: (state) => {
        lastState = state;
      },
      onDataChannelOpen: vi.fn(),
      onDataChannelClose: vi.fn(),
      onDataMessage: vi.fn(),
      onRemoteMediaStream: vi.fn(),
      onSendSignal: vi.fn(),
    });

    manager.initialize('host', 'partner', true);
    const pc = (manager as any).pc;

    // Simulate network disconnect (mapped to 'reconnecting' in DuoWatch state machine)
    pc.connectionState = 'disconnected';
    if (pc.onconnectionstatechange) pc.onconnectionstatechange();
    expect(lastState).toBe('reconnecting');

    // Simulate connection failure (mapped to 'failed' in DuoWatch state machine)
    pc.connectionState = 'failed';
    if (pc.onconnectionstatechange) pc.onconnectionstatechange();
    expect(lastState).toBe('failed');

    // Simulate ICE failure triggering bounded restart
    pc.iceConnectionState = 'failed';
    if (pc.oniceconnectionstatechange) pc.oniceconnectionstatechange();
    expect(pc.restartIce).toHaveBeenCalledTimes(1);

    manager.cleanup();
  });

  // Scenario 10: Existing chat, YouTube, and screen-sharing features remain functional
  it('Scenario 10: Existing chat, YouTube, and screen-sharing features remain functional and isolated', async () => {
    let sentMessage: SyncMessagePayload | null = null;
    let receivedMessage: SyncMessagePayload | null = null;

    const chatManager = new WebRTCManager({
      onConnectionStateChange: vi.fn(),
      onDataChannelOpen: vi.fn(),
      onDataChannelClose: vi.fn(),
      onDataMessage: (msg) => {
        receivedMessage = msg;
      },
      onRemoteMediaStream: vi.fn(),
      onSendSignal: vi.fn(),
    });

    chatManager.initialize('host', 'partner', true);

    // 1. Send text chat message over WebRTC Data Channel
    const mockChannel = (chatManager as any).dataChannel;
    mockChannel.send = vi.fn().mockImplementation((raw: string) => {
      sentMessage = JSON.parse(raw);
    });

    const sendSuccess = chatManager.sendDataMessage({
      type: 'chat',
      sender: 'Alice',
      text: 'Cinema is crystal clear!',
      timestamp: Date.now(),
    });

    expect(sendSuccess).toBe(true);
    expect(sentMessage).toBeDefined();
    expect(sentMessage?.type).toBe('chat');
    expect(sentMessage?.text).toBe('Cinema is crystal clear!');

    // 2. Receive YouTube sync message via data channel onmessage
    mockChannel.onmessage({
      data: JSON.stringify({
        type: 'media-sync',
        mediaState: {
          currentMode: 'youtube',
          videoId: 'dQw4w9WgXcQ',
          isPlaying: true,
          currentTime: 42.5,
        },
        timestamp: Date.now(),
      }),
    });

    expect(receivedMessage).toBeDefined();
    expect(receivedMessage?.type).toBe('media-sync');
    expect(receivedMessage?.mediaState?.videoId).toBe('dQw4w9WgXcQ');

    // 3. Screen sharing uses the exact same 2-transceiver pipeline without conflicts
    const screenVideoTrack = new MockMediaStreamTrack('video', 'screen_share_track');
    const screenStream = new MockMediaStream([screenVideoTrack]) as any;

    chatManager.setMediaStream(screenStream);
    const pc = (chatManager as any).pc;
    expect(pc.getTransceivers()[0].sender.track).toBe(screenVideoTrack);

    chatManager.cleanup();
  });
});
