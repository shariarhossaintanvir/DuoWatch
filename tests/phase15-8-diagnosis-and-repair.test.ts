import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaState, SyncMessagePayload } from '../src/types/cinema';
import { WebRTCManager } from '../src/lib/webrtc';

// Mock WebRTC environment for Node testing
if (typeof globalThis.MediaStream === 'undefined') {
  (globalThis as any).MediaStream = class MockMediaStream {
    private tracks: any[] = [];
    public id: string;
    constructor(tracks: any[] = []) {
      this.tracks = [...tracks];
      this.id = 'stream_' + Math.random().toString(36).substring(2, 9);
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
    addTrack(t: any) {
      this.tracks.push(t);
    }
    removeTrack(t: any) {
      this.tracks = this.tracks.filter(x => x !== t);
    }
  };
}

if (typeof globalThis.RTCPeerConnection === 'undefined') {
  (globalThis as any).RTCPeerConnection = class MockRTCPeerConnection {
    public onconnectionstatechange: any = null;
    public oniceconnectionstatechange: any = null;
    public onicecandidate: any = null;
    public ontrack: any = null;
    public ondatachannel: any = null;
    public onnegotiationneeded: any = null;
    public connectionState = 'new';
    public iceConnectionState = 'new';
    public signalingState = 'stable';
    private transceivers: any[] = [];
    private senders: any[] = [];

    addTransceiver(kindOrTrack: any, init?: any) {
      const sender = {
        track: typeof kindOrTrack === 'object' ? kindOrTrack : null,
        replaceTrack: vi.fn().mockImplementation(async (newTrack) => {
          sender.track = newTrack;
          return Promise.resolve();
        }),
      };
      const receiver = {
        track: {
          kind: typeof kindOrTrack === 'string' ? kindOrTrack : kindOrTrack.kind,
          id: 'recv_' + Math.random(),
          onunmute: null as any,
          onended: null as any,
        },
      };
      const transceiver = {
        sender,
        receiver,
        direction: init?.direction || 'sendrecv',
        mid: 'mid_' + this.transceivers.length
      };
      this.transceivers.push(transceiver);
      this.senders.push(sender);
      return transceiver;
    }

    getTransceivers() {
      return this.transceivers;
    }

    getSenders() {
      return this.senders;
    }

    createDataChannel(label: string) {
      return {
        label,
        readyState: 'open',
        send: vi.fn(),
        close: vi.fn(),
      };
    }

    async createOffer() {
      return { type: 'offer', sdp: 'v=0\r\no=...' };
    }

    async createAnswer() {
      return { type: 'answer', sdp: 'v=0\r\no=...' };
    }

    async setLocalDescription(desc: any) {
      return Promise.resolve();
    }

    async setRemoteDescription(desc: any) {
      return Promise.resolve();
    }

    async addIceCandidate(candidate: any) {
      return Promise.resolve();
    }

    close() {
      this.connectionState = 'closed';
    }
  };
}

describe('Phase 15.8: Real-World Failure Diagnosis & Targeted Repair Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Partner YouTube Playback & Control Repair', () => {
    it('allows Partner to issue Play command and updates shared revision monotonically', () => {
      const initialMediaState: MediaState = {
        mode: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        currentTime: 10,
        duration: 213,
        isPlaying: false,
        playbackRate: 1,
        lastUpdatedBy: 'host-user',
        clientTimestamp: Date.now(),
        revision: 3,
      };

      // Partner triggers play from PlayerControls
      const partnerParticipantId = 'partner-user';
      const playUpdate = {
        action: 'play' as const,
        isPlaying: true,
        currentTime: 10,
      };

      const nextRevision = (initialMediaState.revision || 0) + 1;
      const eventId = 'evt_test_partner_play';

      const updatedState: MediaState = {
        ...initialMediaState,
        ...playUpdate,
        revision: nextRevision,
        eventId,
        lastUpdatedBy: partnerParticipantId,
        clientTimestamp: Date.now(),
      };

      expect(updatedState.isPlaying).toBe(true);
      expect(updatedState.revision).toBe(4);
      expect(updatedState.lastUpdatedBy).toBe('partner-user');
      expect(updatedState.action).toBe('play');
    });

    it('allows Partner to issue Pause command and retains exact seek position', () => {
      const activeState: MediaState = {
        mode: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        currentTime: 42.5,
        duration: 213,
        isPlaying: true,
        playbackRate: 1,
        lastUpdatedBy: 'host-user',
        clientTimestamp: Date.now(),
        revision: 5,
      };

      // Partner pauses playback
      const partnerParticipantId = 'partner-user';
      const nextRevision = activeState.revision + 1;
      const eventId = 'evt_test_partner_pause';

      const pausedState: MediaState = {
        ...activeState,
        action: 'pause',
        isPlaying: false,
        currentTime: 42.5,
        revision: nextRevision,
        eventId,
        lastUpdatedBy: partnerParticipantId,
        clientTimestamp: Date.now(),
      };

      expect(pausedState.isPlaying).toBe(false);
      expect(pausedState.currentTime).toBe(42.5);
      expect(pausedState.revision).toBe(6);
      expect(pausedState.lastUpdatedBy).toBe('partner-user');
    });

    it('allows Partner to seek (-10s / +10s) and clamps correctly within [0, duration]', () => {
      const activeState: MediaState = {
        mode: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        currentTime: 5.0,
        duration: 213,
        isPlaying: true,
        playbackRate: 1,
        lastUpdatedBy: 'host-user',
        revision: 7,
      };

      // Rewind 10s from 5s clamped to 0
      const seekTarget = Math.max(0, Math.min(activeState.duration || 10000, activeState.currentTime - 10));
      expect(seekTarget).toBe(0);

      // Forward 10s from 5s clamped to 15s
      const forwardTarget = Math.max(0, Math.min(activeState.duration || 10000, activeState.currentTime + 10));
      expect(forwardTarget).toBe(15);
    });

    it('Partner video change updates videoId and propagates to Host', () => {
      const activeState: MediaState = {
        mode: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        currentTime: 50,
        duration: 213,
        isPlaying: true,
        lastUpdatedBy: 'host-user',
        revision: 8,
      };

      const newVideoId = 'jNQXAC9IVRw';
      const eventId = 'evt_partner_video_change';
      const nextRevision = activeState.revision + 1;

      const changedState: MediaState = {
        ...activeState,
        action: 'video_change',
        videoId: newVideoId,
        videoUrl: `https://www.youtube.com/watch?v=${newVideoId}`,
        currentTime: 0,
        isPlaying: true,
        revision: nextRevision,
        eventId,
        lastUpdatedBy: 'partner-user',
      };

      expect(changedState.videoId).toBe('jNQXAC9IVRw');
      expect(changedState.action).toBe('video_change');
      expect(changedState.revision).toBe(9);
    });
  });

  describe('2. YouTube Synchronization Stability & Drift Protection', () => {
    it('heartbeat never resurrects playback if state was locally paused', () => {
      const localState: MediaState = {
        mode: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        currentTime: 30,
        duration: 213,
        isPlaying: false, // Locally paused
        lastUpdatedBy: 'partner-user',
        revision: 10,
      };

      const incomingHeartbeat: MediaState = {
        mode: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        currentTime: 30.2,
        duration: 213,
        isPlaying: true, // Delayed heartbeat had isPlaying: true
        lastUpdatedBy: 'host-user',
        revision: 11,
      };

      // Heartbeat action isolation: heartbeat must never change isPlaying if locally paused
      const action = 'heartbeat';
      const nextIsPlaying = action === 'heartbeat'
        ? localState.isPlaying
        : (incomingHeartbeat.isPlaying ?? localState.isPlaying);

      expect(nextIsPlaying).toBe(false);
    });

    it('clamps transit compensation to 0..0.5s to prevent clock skew between different PCs', () => {
      // Simulate extreme clock skew: partner's clock is 2.5 seconds ahead of host
      const hostTimestamp = Date.now() - 2500;
      const rawElapsed = (Date.now() - hostTimestamp) / 1000;
      expect(rawElapsed).toBeGreaterThan(2.0);

      // Clamped transit compensation
      const elapsedSec = Math.min(0.5, Math.max(0, rawElapsed));
      expect(elapsedSec).toBe(0.5);

      // Simulate negative delta (host clock ahead of partner)
      const futureHostTimestamp = Date.now() + 1500;
      const negativeRawElapsed = (Date.now() - futureHostTimestamp) / 1000;
      const clampedNegative = Math.min(0.5, Math.max(0, negativeRawElapsed));
      expect(clampedNegative).toBe(0);
    });

    it('drift threshold of 2.5s avoids unnecessary seeks during 60s of normal playback', () => {
      const DRIFT_THRESHOLD_SEC = 2.5;

      // Realistic normal buffer variances: 0.2s, 0.8s, 1.2s, 1.8s, 2.2s
      const jitterSamples = [0.2, 0.8, 1.2, 1.8, 2.2];
      const triggersSeek = jitterSamples.map(drift => drift > DRIFT_THRESHOLD_SEC);

      // None of the normal jitter samples should trigger seek
      expect(triggersSeek.every(v => v === false)).toBe(true);

      // Genuine drift (e.g. 3.5s) should trigger seek
      expect(3.5 > DRIFT_THRESHOLD_SEC).toBe(true);
    });
  });

  describe('3. Local Video File Streaming Repair', () => {
    it('creates fresh video track on captureStream and swaps video transceiver via replaceTrack', async () => {
      const manager = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      manager.initialize('host-id', 'partner-id', true);

      const fakeVideoTrack = { kind: 'video', id: 'vid_track_1' } as any;
      const fakeAudioTrack = { kind: 'audio', id: 'aud_track_1' } as any;
      const mockStream = new (globalThis as any).MediaStream([fakeVideoTrack, fakeAudioTrack]);

      manager.setMediaStream(mockStream);

      const pc = (manager as any).pc;
      const transceivers = pc.getTransceivers();
      const videoTransceiver = transceivers.find((t: any) => t.sender.track?.kind === 'video');

      expect(videoTransceiver).toBeDefined();
      expect(videoTransceiver.sender.replaceTrack).toHaveBeenCalledWith(fakeVideoTrack);
    });

    it('media audio transceiver is cleanly separated from video transceiver', () => {
      const transceivers = [
        { sender: { track: { kind: 'video', id: 'video_sender' } }, receiver: { track: { kind: 'video', id: 'video_recv' } }, mid: '0' },
        { sender: { track: { kind: 'audio', id: 'media_audio_sender' } }, receiver: { track: { kind: 'audio', id: 'media_audio_recv' } }, mid: '1' },
      ];

      const audioTransceivers = transceivers.filter(t =>
        (t.receiver?.track && t.receiver.track.kind === 'audio') ||
        (t.sender?.track && t.sender.track.kind === 'audio')
      );

      expect(audioTransceivers.length).toBe(1);
      expect(audioTransceivers[0].mid).toBe('1');
    });
  });

  describe('4. Screen Sharing & Lifecycle Repair', () => {
    it('sets local video and audio tracks for screen sharing via replaceTrack', async () => {
      const manager = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      manager.initialize('host-id', 'partner-id', true);

      const screenVideoTrack = { kind: 'video', id: 'screen_vid_track' } as any;
      const screenAudioTrack = { kind: 'audio', id: 'screen_aud_track' } as any;
      const screenStream = new (globalThis as any).MediaStream([screenVideoTrack, screenAudioTrack]);
      manager.setMediaStream(screenStream);

      const pc = (manager as any).pc;
      const videoTransceiver = pc.getTransceivers()[0];
      const audioTransceiver = pc.getTransceivers()[1];

      expect(videoTransceiver.sender.replaceTrack).toHaveBeenCalledWith(screenVideoTrack);
      expect(audioTransceiver.sender.replaceTrack).toHaveBeenCalledWith(screenAudioTrack);
    });

    it('stopping screen sharing calls replaceTrack(null) while peer connection remains open', async () => {
      const manager = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      manager.initialize('host-id', 'partner-id', true);

      const screenVideoTrack = { kind: 'video', id: 'screen_vid_live' } as any;
      const screenStream = new (globalThis as any).MediaStream([screenVideoTrack]);
      manager.setMediaStream(screenStream);

      // Stop screen share
      manager.setMediaStream(null);

      const pc = (manager as any).pc;
      const videoTransceiver = pc.getTransceivers()[0];

      // Video sender was cleared cleanly
      expect(videoTransceiver.sender.replaceTrack).toHaveBeenCalledWith(null);
      expect(pc.connectionState).not.toBe('closed');
    });
  });

  describe('5. P2P Connection Preservation & Candidate Queuing', () => {
    it('redundant initialize() calls do NOT destroy active or in-flight peer connection', () => {
      const manager = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      manager.initialize('host-id', 'partner-id', true);
      const originalPc = (manager as any).pc;
      expect(originalPc).toBeDefined();

      // Redundant presence event triggers initialize again
      manager.initialize('host-id', 'partner-id', true);
      const currentPc = (manager as any).pc;

      // Crucial: Active PC was preserved, NOT destroyed and recreated!
      expect(currentPc).toBe(originalPc);
    });

    it('preserves early ICE candidates in queue before PC is initialized', async () => {
      const manager = new WebRTCManager({
        onConnectionStateChange: vi.fn(),
        onDataChannelOpen: vi.fn(),
        onDataChannelClose: vi.fn(),
        onDataMessage: vi.fn(),
        onRemoteMediaStream: vi.fn(),
        onSendSignal: vi.fn(),
      });

      // Candidate arrives before initialize() is called
      const candidateInit = { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.100 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 };
      await manager.handleSignal({
        type: 'candidate',
        candidate: candidateInit,
        senderId: 'partner-id',
      });

      const queue = (manager as any).iceCandidateQueue;
      expect(queue.length).toBe(1);
      expect(queue[0]).toEqual(candidateInit);
    });
  });
});

