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
        track: { kind: typeof kindOrTrack === 'string' ? kindOrTrack : kindOrTrack.kind, id: 'recv_' + Math.random() },
      };
      const transceiver = { sender, receiver, direction: init?.direction || 'sendrecv', mid: 'mid_' + this.transceivers.length };
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

    addTrack(track: any, stream: any) {
      const sender = {
        track,
        replaceTrack: vi.fn().mockImplementation(async (newTrack) => {
          sender.track = newTrack;
          return Promise.resolve();
        }),
      };
      this.senders.push(sender);
      return sender;
    }

    removeTrack(sender: any) {
      this.senders = this.senders.filter(s => s !== sender);
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

    async setLocalDescription(_desc: any) {
      return Promise.resolve();
    }

    async setRemoteDescription(_desc: any) {
      return Promise.resolve();
    }

    async addIceCandidate(_candidate: any) {
      return Promise.resolve();
    }

    close() {
      this.connectionState = 'closed';
    }
  };
}

describe('Phase 15.7: Part 1 — Canonical YouTube Identity Sync & Revision Ordering', () => {
  interface SimulatedParticipantState {
    mediaState: MediaState;
    processedEvents: Set<string>;
    loadedVideoId: string;
    loadVideoCalls: { id: string; time: number }[];
  }

  function createParticipant(role: 'owner' | 'partner', initialVideoId: string = 'dQw4w9WgXcQ'): SimulatedParticipantState {
    return {
      mediaState: {
        mode: 'youtube',
        videoId: initialVideoId,
        videoUrl: `https://www.youtube.com/watch?v=${initialVideoId}`,
        currentTime: 0,
        duration: 213,
        isPlaying: false,
        playbackRate: 1,
        lastUpdatedBy: role === 'owner' ? 'owner_1' : 'partner_2',
        clientTimestamp: Date.now(),
        revision: 0,
      },
      processedEvents: new Set<string>(),
      loadedVideoId: initialVideoId,
      loadVideoCalls: [],
    };
  }

  function applyMediaSync(participant: SimulatedParticipantState, payload: SyncMessagePayload, localParticipantId: string) {
    if (!payload.mediaState) return;
    const incoming = payload.mediaState;
    const action = payload.action;

    // Drop self broadcasts
    if (incoming.lastUpdatedBy === localParticipantId) return;

    // Deduplicate eventId
    const eventId = payload.eventId || incoming.eventId;
    if (eventId) {
      if (participant.processedEvents.has(eventId)) return;
      participant.processedEvents.add(eventId);
    }

    // Monotonic sequence / revision check: ignore older out-of-order events
    const incomingRevision = incoming.revision ?? payload.revision ?? 0;
    const currentRevision = participant.mediaState.revision || 0;
    if (incomingRevision > 0 && incomingRevision < currentRevision) {
      return;
    }

    // Video identity updates are accepted ONLY on explicit video_change OR state_snapshot
    const isVideoIdentityChange = action === 'video_change' || (action === 'state_snapshot' && Boolean(incoming.videoId));
    const newVideoId = (isVideoIdentityChange && incoming.videoId) ? incoming.videoId : participant.mediaState.videoId;
    const newVideoUrl = (isVideoIdentityChange && incoming.videoUrl)
      ? incoming.videoUrl
      : (newVideoId ? `https://www.youtube.com/watch?v=${newVideoId}` : participant.mediaState.videoUrl);

    participant.mediaState = {
      ...participant.mediaState,
      ...incoming,
      videoId: newVideoId,
      videoUrl: newVideoUrl,
      action,
      revision: Math.max(participant.mediaState.revision || 0, incomingRevision),
      eventId: eventId || participant.mediaState.eventId,
      clientTimestamp: payload.clientTimestamp || Date.now(),
    };

    // YouTube player load trigger
    const shouldLoadVideo = newVideoId &&
      newVideoId !== participant.loadedVideoId &&
      (action === 'video_change' || action === 'state_snapshot');

    if (shouldLoadVideo) {
      participant.loadedVideoId = newVideoId;
      participant.loadVideoCalls.push({ id: newVideoId, time: incoming.currentTime || 0 });
    }
  }

  it('1. Owner selects Video A: Partner receives Video A and loads it', () => {
    const owner = createParticipant('owner');
    const partner = createParticipant('partner');

    const videoA = 'jNQXAC9IVRw';
    const eventId = 'evt_1001';
    const payload: SyncMessagePayload = {
      type: 'media-sync',
      action: 'video_change',
      eventId,
      revision: 1,
      senderId: 'owner_1',
      mediaState: {
        videoId: videoA,
        videoUrl: `https://www.youtube.com/watch?v=${videoA}`,
        currentTime: 0,
        isPlaying: true,
        lastUpdatedBy: 'owner_1',
        revision: 1,
        eventId,
      },
      timestamp: Date.now(),
    };

    applyMediaSync(partner, payload, 'partner_2');

    expect(partner.mediaState.videoId).toBe(videoA);
    expect(partner.loadedVideoId).toBe(videoA);
    expect(partner.loadVideoCalls.length).toBe(1);
    expect(partner.loadVideoCalls[0].id).toBe(videoA);
  });

  it('2. Partner selects Video B: Owner receives Video B and loads it', () => {
    const owner = createParticipant('owner');
    const videoB = 'M7lc1UVf-VE';
    const eventId = 'evt_1002';
    const payload: SyncMessagePayload = {
      type: 'media-sync',
      action: 'video_change',
      eventId,
      revision: 2,
      senderId: 'partner_2',
      mediaState: {
        videoId: videoB,
        currentTime: 0,
        isPlaying: true,
        lastUpdatedBy: 'partner_2',
        revision: 2,
        eventId,
      },
      timestamp: Date.now(),
    };

    applyMediaSync(owner, payload, 'owner_1');

    expect(owner.mediaState.videoId).toBe(videoB);
    expect(owner.loadedVideoId).toBe(videoB);
    expect(owner.loadVideoCalls.length).toBe(1);
    expect(owner.loadVideoCalls[0].id).toBe(videoB);
  });

  it('3. Initial state snapshot updates Partner video identity from default to Owner active video', () => {
    // Partner enters room with default 'dQw4w9WgXcQ'
    const partner = createParticipant('partner', 'dQw4w9WgXcQ');
    const activeOwnerVideo = '9bZkp7q19f0'; // Gangnam style or other selected video

    // Owner sends state snapshot with active video
    const snapshotPayload: SyncMessagePayload = {
      type: 'media-sync',
      action: 'state_snapshot',
      eventId: 'snap_001',
      revision: 5,
      senderId: 'owner_1',
      mediaState: {
        mode: 'youtube',
        videoId: activeOwnerVideo,
        videoUrl: `https://www.youtube.com/watch?v=${activeOwnerVideo}`,
        currentTime: 35.5,
        isPlaying: true,
        lastUpdatedBy: 'owner_1',
        revision: 5,
      },
      timestamp: Date.now(),
    };

    applyMediaSync(partner, snapshotPayload, 'partner_2');

    expect(partner.mediaState.videoId).toBe(activeOwnerVideo);
    expect(partner.loadedVideoId).toBe(activeOwnerVideo);
    expect(partner.loadVideoCalls.length).toBe(1);
    expect(partner.loadVideoCalls[0].id).toBe(activeOwnerVideo);
    expect(partner.loadVideoCalls[0].time).toBe(35.5);
  });

  it('4. Stale out-of-order snapshot cannot overwrite newer video selection', () => {
    const partner = createParticipant('partner');
    partner.mediaState.revision = 10;
    partner.mediaState.videoId = 'L_LUpnjgPso';
    partner.loadedVideoId = 'L_LUpnjgPso';

    // Stale snapshot with revision 3 arrives delayed
    const staleSnapshot: SyncMessagePayload = {
      type: 'media-sync',
      action: 'state_snapshot',
      eventId: 'snap_old',
      revision: 3, // Older than 10
      senderId: 'owner_1',
      mediaState: {
        videoId: 'dQw4w9WgXcQ',
        revision: 3,
        lastUpdatedBy: 'owner_1',
      },
      timestamp: Date.now() - 5000,
    };

    applyMediaSync(partner, staleSnapshot, 'partner_2');

    // Stale snapshot was rejected
    expect(partner.mediaState.videoId).toBe('L_LUpnjgPso');
    expect(partner.loadedVideoId).toBe('L_LUpnjgPso');
    expect(partner.loadVideoCalls.length).toBe(0);
  });

  it('5. Duplicate video_change event with same eventId is rejected', () => {
    const partner = createParticipant('partner');
    const payload: SyncMessagePayload = {
      type: 'media-sync',
      action: 'video_change',
      eventId: 'evt_unique_1',
      revision: 1,
      senderId: 'owner_1',
      mediaState: {
        videoId: 'VIDEO_NEW_1',
        lastUpdatedBy: 'owner_1',
        revision: 1,
      },
      timestamp: Date.now(),
    };

    applyMediaSync(partner, payload, 'partner_2');
    expect(partner.loadVideoCalls.length).toBe(1);

    // Replay same event (e.g. from both WebRTC DataChannel and Realtime broadcast)
    applyMediaSync(partner, payload, 'partner_2');
    expect(partner.loadVideoCalls.length).toBe(1); // Dropped by eventId deduplication!
  });

  it('6. Play / Pause / Seek / Heartbeat NEVER change the active video identity', () => {
    const partner = createParticipant('partner', 'ACTIVE_VID');
    partner.mediaState.revision = 5;

    // Incoming Play with accidental/missing/default videoId
    applyMediaSync(partner, {
      type: 'media-sync',
      action: 'play',
      eventId: 'play_1',
      revision: 6,
      senderId: 'owner_1',
      mediaState: {
        isPlaying: true,
        currentTime: 10,
        videoId: 'dQw4w9WgXcQ', // Play action with wrong id must NOT change video!
        lastUpdatedBy: 'owner_1',
        revision: 6,
      },
      timestamp: Date.now(),
    }, 'partner_2');

    expect(partner.mediaState.videoId).toBe('ACTIVE_VID');
    expect(partner.loadVideoCalls.length).toBe(0);

    // Incoming Pause
    applyMediaSync(partner, {
      type: 'media-sync',
      action: 'pause',
      eventId: 'pause_1',
      revision: 7,
      senderId: 'owner_1',
      mediaState: {
        isPlaying: false,
        currentTime: 12,
        videoId: 'RANDOM_ID',
        lastUpdatedBy: 'owner_1',
        revision: 7,
      },
      timestamp: Date.now(),
    }, 'partner_2');

    expect(partner.mediaState.videoId).toBe('ACTIVE_VID');
    expect(partner.loadVideoCalls.length).toBe(0);

    // Incoming Heartbeat
    applyMediaSync(partner, {
      type: 'media-sync',
      action: 'heartbeat',
      eventId: 'hb_1',
      revision: 8,
      senderId: 'owner_1',
      mediaState: {
        currentTime: 16,
        videoId: 'ANOTHER_ID',
        lastUpdatedBy: 'owner_1',
        revision: 8,
      },
      timestamp: Date.now(),
    }, 'partner_2');

    expect(partner.mediaState.videoId).toBe('ACTIVE_VID');
    expect(partner.loadVideoCalls.length).toBe(0);
  });
});

describe('Phase 15.7: Part 2 & 3 — WebRTC Pre-Allocated Transceivers & Media Streaming', () => {
  let webrtc: WebRTCManager;
  let receivedRemoteMediaStream: MediaStream | null = null;
  let sentSignals: any[] = [];

  beforeEach(() => {
    receivedRemoteMediaStream = null;
    sentSignals = [];

    webrtc = new WebRTCManager({
      onConnectionStateChange: () => { },
      onDataChannelOpen: () => { },
      onDataChannelClose: () => { },
      onDataMessage: () => { },
      onRemoteMediaStream: (stream) => {
        receivedRemoteMediaStream = stream;
      },
      onSendSignal: (sig) => {
        sentSignals.push(sig);
      },
    });
  });

  it('1. initialize() pre-allocates cinema video and media audio transceivers', () => {
    webrtc.initialize('alice', 'bob', true);
    const pc = (webrtc as any).pc;
    expect(pc).toBeDefined();

    const transceivers = pc.getTransceivers();
    // 2 transceivers pre-allocated: Cinema Video and Cinema Media Audio
    expect(transceivers.length).toBe(2);

    expect(transceivers[0].direction).toBe('sendrecv');
    expect(transceivers[1].direction).toBe('sendrecv');
  });

  it('2. setMediaStream() swaps video track via replaceTrack without destroying transceiver', async () => {
    webrtc.initialize('alice', 'bob', true);
    const mockVideoTrack = { kind: 'video', id: 'vid_track_1', stop: vi.fn() };
    const mockAudioTrack = { kind: 'audio', id: 'aud_track_1', stop: vi.fn() };
    const mediaStream = new MediaStream([mockVideoTrack, mockAudioTrack]);

    webrtc.setMediaStream(mediaStream);

    const videoSender = (webrtc as any).localVideoSender;
    expect(videoSender).toBeDefined();
    expect(videoSender.replaceTrack).toHaveBeenCalledWith(mockVideoTrack);

    const audioSender = (webrtc as any).localAudioSender;
    expect(audioSender).toBeDefined();
    expect(audioSender.replaceTrack).toHaveBeenCalledWith(mockAudioTrack);
  });

  it('3. Stopping media stream via setMediaStream(null) clears tracks without tearing down peer connection', () => {
    webrtc.initialize('alice', 'bob', true);
    webrtc.setMediaStream(null);

    const videoSender = (webrtc as any).localVideoSender;
    expect(videoSender.replaceTrack).toHaveBeenCalledWith(null);

    const audioSender = (webrtc as any).localAudioSender;
    expect(audioSender.replaceTrack).toHaveBeenCalledWith(null);

    // Peer connection remains healthy and open
    const pc = (webrtc as any).pc;
    expect(pc.connectionState).not.toBe('closed');
  });

  it('4. Receiver pc.ontrack emits fresh MediaStream instance for React state update', () => {
    webrtc.initialize('bob', 'alice', false);
    const pc = (webrtc as any).pc;

    const incomingVideoTrack = { kind: 'video', id: 'remote_vid_1' };
    const event = {
      track: incomingVideoTrack,
      streams: [],
      transceiver: pc.getTransceivers()[0], // Video transceiver
    };

    pc.ontrack(event);

    expect(receivedRemoteMediaStream).toBeDefined();
    expect(receivedRemoteMediaStream).not.toBeNull();
    expect(receivedRemoteMediaStream!.getVideoTracks().length).toBe(1);
    expect(receivedRemoteMediaStream!.getVideoTracks()[0].id).toBe('remote_vid_1');
  });
});

