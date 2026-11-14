import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebRTCManager } from '../src/lib/webrtc';
import type { SyncMessagePayload, WebRTCSignalPayload } from '../src/types/cinema';

// Mock WebRTC environment
if (typeof globalThis.MediaStream === 'undefined') {
  (globalThis as any).MediaStream = class MockMediaStream {
    private tracks: any[] = [];
    constructor(tracks: any[] = []) {
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
    addTrack(t: any) {
      this.tracks.push(t);
    }
    removeTrack(t: any) {
      this.tracks = this.tracks.filter(x => x !== t);
    }
  };
}

if (typeof globalThis.RTCSessionDescription === 'undefined') {
  (globalThis as any).RTCSessionDescription = class MockRTCSessionDescription {
    type: string;
    sdp: string;
    constructor(init: any) {
      this.type = init.type;
      this.sdp = init.sdp;
    }
  };
}

if (typeof globalThis.RTCIceCandidate === 'undefined') {
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

if (typeof globalThis.RTCPeerConnection === 'undefined') {
  (globalThis as any).RTCPeerConnection = class MockRTCPeerConnection {
    public connectionState: string = 'new';
    public iceConnectionState: string = 'new';
    public signalingState: string = 'stable';
    public remoteDescription: any = null;
    public localDescription: any = null;
    private transceivers: any[] = [];

    public onconnectionstatechange: (() => void) | null = null;
    public oniceconnectionstatechange: (() => void) | null = null;
    public onicecandidate: ((event: any) => void) | null = null;
    public ontrack: ((event: any) => void) | null = null;
    public onnegotiationneeded: (() => void) | null = null;
    public ondatachannel: ((event: any) => void) | null = null;

    addTransceiver(kind: 'audio' | 'video', init?: RTCRtpTransceiverInit) {
      const senderTrack = null;
      const receiverTrack = { kind, id: `mock_recv_${kind}_${this.transceivers.length}` };
      const sender = {
        track: senderTrack,
        replaceTrack: vi.fn().mockImplementation(async (t: any) => {
          sender.track = t;
        }),
      };
      const transceiver = {
        direction: init?.direction || 'sendrecv',
        mid: String(this.transceivers.length),
        sender,
        receiver: { track: receiverTrack },
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
        replaceTrack: vi.fn().mockImplementation(async (t: any) => {
          sender.track = t;
        }),
      };
      return sender as any;
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

    async addIceCandidate(_candidate: any) {
      return;
    }

    createDataChannel(label: string, _options?: any) {
      return {
        label,
        readyState: 'open',
        send: vi.fn(),
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
      } as any;
    }

    restartIce = vi.fn();
    close = vi.fn().mockImplementation(() => {
      this.connectionState = 'closed';
      this.iceConnectionState = 'closed';
      this.signalingState = 'closed';
    });
  };
}

describe('Phase 15.9: Voice Removal, Chat Preservation & P2P Stream Architecture', () => {
  let manager: WebRTCManager;
  let connectionStateChanges: string[] = [];
  let sentSignals: WebRTCSignalPayload[] = [];
  let receivedDataMessages: SyncMessagePayload[] = [];
  let remoteMediaStreamReceived: MediaStream | null = null;

  beforeEach(() => {
    connectionStateChanges = [];
    sentSignals = [];
    receivedDataMessages = [];
    remoteMediaStreamReceived = null;

    manager = new WebRTCManager({
      onConnectionStateChange: (status) => connectionStateChanges.push(status),
      onDataChannelOpen: vi.fn(),
      onDataChannelClose: vi.fn(),
      onDataMessage: (data) => receivedDataMessages.push(data),
      onRemoteMediaStream: (stream) => {
        remoteMediaStreamReceived = stream;
      },
      onSendSignal: (sig) => sentSignals.push(sig),
    });
  });

  describe('A. Complete Voice Removal & Clean 2-Transceiver WebRTC Pipeline', () => {
    it('1. WebRTCManager allocates exactly 2 transceivers (Video and Media Audio)', () => {
      manager.initialize('host-alice', 'guest-bob', true);
      const pc = (manager as any).pc;
      expect(pc).toBeDefined();

      const transceivers = pc.getTransceivers();
      // Exactly 2 transceivers: Video (for cinema/screen) and Media Audio (for movie/tab audio)
      expect(transceivers.length).toBe(2);

      // Transceiver 0: Video
      expect(transceivers[0].receiver.track.kind).toBe('video');
      expect(transceivers[0].direction).toBe('sendrecv');

      // Transceiver 1: Audio (Media Audio)
      expect(transceivers[1].receiver.track.kind).toBe('audio');
      expect(transceivers[1].direction).toBe('sendrecv');

      // Voice methods must not exist
      expect((manager as any).setVoiceTrack).toBeUndefined();
      expect((manager as any).localVoiceSender).toBeUndefined();
    });

    it('2. createOffer() is cleanly invoked without legacy voice constraints', async () => {
      manager.initialize('host-alice', 'guest-bob', true);
      const pc = (manager as any).pc;
      const createOfferSpy = vi.spyOn(pc, 'createOffer');

      await manager.startAsInitiator();

      expect(createOfferSpy).toHaveBeenCalledWith();
      expect(sentSignals.length).toBe(1);
      expect(sentSignals[0].type).toBe('offer');
    });
  });

  describe('B. Chat & DataChannel Communication Preservation', () => {
    it('1. Sends and receives chat messages over DataChannel seamlessly', () => {
      manager.initialize('host-alice', 'guest-bob', true);
      const dataChannel = (manager as any).dataChannel;
      expect(dataChannel).toBeDefined();

      const chatPayload: SyncMessagePayload = {
        type: 'chat-message',
        chatMessage: {
          id: 'chat_msg_1',
          senderId: 'host-alice',
          senderName: 'Alice (Host)',
          role: 'owner',
          text: 'Welcome to DuoWatch!',
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };

      const sent = manager.sendDataMessage(chatPayload);
      expect(sent).toBe(true);
      expect(dataChannel.send).toHaveBeenCalledWith(JSON.stringify(chatPayload));

      // Simulate incoming chat message on dataChannel
      dataChannel.onmessage({
        data: JSON.stringify(chatPayload),
      });

      expect(receivedDataMessages.length).toBe(1);
      expect(receivedDataMessages[0].chatMessage?.text).toBe('Welcome to DuoWatch!');
    });

    it('2. Sends and receives floating emoji reactions over DataChannel', () => {
      manager.initialize('host-alice', 'guest-bob', true);
      const dataChannel = (manager as any).dataChannel;

      const reactionPayload: SyncMessagePayload = {
        type: 'emoji-reaction',
        reaction: {
          emoji: '❤️',
          senderName: 'Bob',
        },
        timestamp: Date.now(),
      };

      manager.sendDataMessage(reactionPayload);
      expect(dataChannel.send).toHaveBeenCalledWith(JSON.stringify(reactionPayload));

      dataChannel.onmessage({
        data: JSON.stringify(reactionPayload),
      });

      expect(receivedDataMessages.length).toBe(1);
      expect(receivedDataMessages[0].reaction?.emoji).toBe('❤️');
    });
  });

  describe('C. Peer Connection Preservation & Anti-Destruction Fix', () => {
    it('1. Redundant initialize() calls during presence sync do NOT destroy active peer connection', () => {
      manager.initialize('guest-bob', 'host-alice', false);
      const originalPc = (manager as any).pc;

      // Simulate offer arriving and connection moving to 'have-remote-offer'
      originalPc.signalingState = 'have-remote-offer';

      // Supabase presence event triggers redundant initialize call
      manager.initialize('guest-bob', 'host-alice', false);
      const currentPc = (manager as any).pc;

      // The in-flight peer connection was safely preserved!
      expect(currentPc).toBe(originalPc);
      expect(originalPc.close).not.toHaveBeenCalled();
    });

    it('2. Early-arriving ICE candidates before PC is initialized are stored in queue', async () => {
      const candidateInit = { candidate: 'candidate:early 1 UDP 2122260223 10.0.0.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };

      // Candidate arrives before initialize() is called
      await manager.handleSignal({
        type: 'candidate',
        candidate: candidateInit,
        senderId: 'host-alice',
      });

      const queue = (manager as any).iceCandidateQueue;
      expect(queue.length).toBe(1);
      expect(queue[0]).toEqual(candidateInit);

      // Now initialize and receive offer: candidate should be processed
      manager.initialize('guest-bob', 'host-alice', false);
      const pc = (manager as any).pc;
      // Ensure mock pc has remoteDescription set when setRemoteDescription runs
      const origSetRemote = pc.setRemoteDescription.bind(pc);
      pc.setRemoteDescription = vi.fn().mockImplementation(async (desc: any) => {
        pc.remoteDescription = desc;
        return origSetRemote(desc);
      });
      const addIceSpy = vi.spyOn(pc, 'addIceCandidate');

      await manager.handleSignal({
        type: 'offer',
        sdp: { type: 'offer', sdp: 'mock sdp' } as any,
        senderId: 'host-alice',
      });

      expect(addIceSpy).toHaveBeenCalled();
      expect((manager as any).iceCandidateQueue.length).toBe(0);
    });

    it('3. Bounded ICE restart stops after 2 attempts to prevent chat spam', () => {
      manager.initialize('host-alice', 'guest-bob', true);
      const pc = (manager as any).pc;

      // First failure triggers restart 1
      pc.iceConnectionState = 'failed';
      pc.oniceconnectionstatechange();
      expect(pc.restartIce).toHaveBeenCalledTimes(1);

      // Second failure triggers restart 2
      pc.iceConnectionState = 'failed';
      pc.oniceconnectionstatechange();
      expect(pc.restartIce).toHaveBeenCalledTimes(2);

      // Third failure halts restarts and transitions to 'failed' without looping
      pc.iceConnectionState = 'failed';
      pc.oniceconnectionstatechange();
      expect(pc.restartIce).toHaveBeenCalledTimes(2); // Did NOT increment again!
      expect(connectionStateChanges).toContain('failed');
    });
  });

  describe('D. Local Video & Screen Sharing Delivery Pipeline', () => {
    it('1. setMediaStream replaces both video and audio tracks cleanly', () => {
      manager.initialize('host-alice', 'guest-bob', true);
      const videoTrack = { kind: 'video', id: 'movie_vid' } as any;
      const audioTrack = { kind: 'audio', id: 'movie_aud' } as any;
      const movieStream = new (globalThis as any).MediaStream([videoTrack, audioTrack]);

      manager.setMediaStream(movieStream);

      const pc = (manager as any).pc;
      const videoSender = pc.getTransceivers()[0].sender;
      const audioSender = pc.getTransceivers()[1].sender;

      expect(videoSender.replaceTrack).toHaveBeenCalledWith(videoTrack);
      expect(audioSender.replaceTrack).toHaveBeenCalledWith(audioTrack);
    });

    it('2. setMediaStream(null) clears senders without destroying the connection', () => {
      manager.initialize('host-alice', 'guest-bob', true);
      manager.setMediaStream(null);

      const pc = (manager as any).pc;
      const videoSender = pc.getTransceivers()[0].sender;
      const audioSender = pc.getTransceivers()[1].sender;

      expect(videoSender.replaceTrack).toHaveBeenCalledWith(null);
      expect(audioSender.replaceTrack).toHaveBeenCalledWith(null);
      expect(pc.connectionState).not.toBe('closed');
    });

    it('3. ontrack emits updated MediaStream for both video and audio tracks', () => {
      manager.initialize('guest-bob', 'host-alice', false);
      const pc = (manager as any).pc;

      const remoteVid = { kind: 'video', id: 'remote_vid_live' };
      pc.ontrack({ track: remoteVid, streams: [], transceiver: pc.getTransceivers()[0] });

      expect(remoteMediaStreamReceived).toBeDefined();
      expect(remoteMediaStreamReceived!.getVideoTracks().length).toBe(1);

      const remoteAud = { kind: 'audio', id: 'remote_aud_live' };
      pc.ontrack({ track: remoteAud, streams: [], transceiver: pc.getTransceivers()[1] });

      expect(remoteMediaStreamReceived!.getAudioTracks().length).toBe(1);
    });
  });
});
