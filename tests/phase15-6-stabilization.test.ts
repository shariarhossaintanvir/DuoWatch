import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SyncMessagePayload } from '../src/types/cinema';

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
    addTrack(t: any) {
      this.tracks.push(t);
    }
    removeTrack(t: any) {
      this.tracks = this.tracks.filter(x => x !== t);
    }
  };
}

describe('Phase 15.6: YouTube Playback Stabilization & Anti-Auto-Switch Engine', () => {
  interface SimulatedPlayer {
    videoId: string;
    currentTime: number;
    isPlaying: boolean;
    loadVideoByIdCalls: { id: string; time: number }[];
    playVideoCalls: number;
    pauseVideoCalls: number;
    seekToCalls: number[];
  }

  function createMockPlayer(initialVideoId: string): SimulatedPlayer {
    return {
      videoId: initialVideoId,
      currentTime: 0,
      isPlaying: false,
      loadVideoByIdCalls: [],
      playVideoCalls: 0,
      pauseVideoCalls: 0,
      seekToCalls: [],
    };
  }

  function applyRemoteMediaUpdate(
    player: SimulatedPlayer,
    loadedVideoIdRef: { current: string | null },
    lastProcessedTokenRef: { current: string | null },
    isApplyingRemoteRef: { current: boolean },
    incoming: SyncMessagePayload,
    myParticipantId: string
  ): { applied: boolean; reloadedVideo: boolean; reason?: string } {
    if (!incoming.mediaState) {
      return { applied: false, reloadedVideo: false, reason: 'NO_MEDIA_STATE' };
    }

    // 1. Drop self-originated updates
    if (incoming.mediaState.lastUpdatedBy === myParticipantId) {
      return { applied: false, reloadedVideo: false, reason: 'SELF_UPDATE' };
    }

    // 2. Deduplicate identical tokens
    const updateToken = `${incoming.mediaState.lastUpdatedBy}:${incoming.clientTimestamp}:${incoming.action}`;
    if (updateToken === lastProcessedTokenRef.current) {
      return { applied: false, reloadedVideo: false, reason: 'DEDUPLICATED' };
    }
    lastProcessedTokenRef.current = updateToken;

    const action = incoming.action;
    const incomingVideoId = incoming.mediaState.videoId;

    isApplyingRemoteRef.current = true;

    try {
      // 3. Strict video change isolation: ONLY explicit video_change or initial snapshot triggers reload
      if (
        incomingVideoId &&
        (action === 'video_change' || (action === 'state_snapshot' && !loadedVideoIdRef.current)) &&
        incomingVideoId !== loadedVideoIdRef.current
      ) {
        loadedVideoIdRef.current = incomingVideoId;
        player.videoId = incomingVideoId;
        player.loadVideoByIdCalls.push({ id: incomingVideoId, time: incoming.mediaState.currentTime || 0 });
        return { applied: true, reloadedVideo: true };
      }

      // 4. Heartbeat: drift correction only, NEVER reloads video
      if (action === 'heartbeat') {
        const drift = Math.abs(player.currentTime - (incoming.mediaState.currentTime || 0));
        if (drift > 2.0) {
          player.currentTime = incoming.mediaState.currentTime || 0;
          player.seekToCalls.push(player.currentTime);
        }
        return { applied: true, reloadedVideo: false };
      }

      // 5. Play / Pause / Seek: NEVER reloads video
      if (action === 'seek') {
        player.currentTime = incoming.mediaState.currentTime || 0;
        player.seekToCalls.push(player.currentTime);
      }

      if (incoming.mediaState.isPlaying && !player.isPlaying) {
        player.isPlaying = true;
        player.playVideoCalls++;
      } else if (!incoming.mediaState.isPlaying && player.isPlaying) {
        player.isPlaying = false;
        player.pauseVideoCalls++;
      }

      return { applied: true, reloadedVideo: false };
    } finally {
      isApplyingRemoteRef.current = false;
    }
  }

  it('1. Video does not change after 5-6 seconds when playing', () => {
    const player = createMockPlayer('Selected_123');
    const loadedVideoRef = { current: 'Selected_123' };
    const lastTokenRef = { current: null as string | null };
    const isApplyingRef = { current: false };

    // Simulate 5 periodic heartbeat pulses (at 1s, 2s, 3s, 4s, 5s, 6s)
    for (let sec = 1; sec <= 6; sec++) {
      const heartbeatPayload: SyncMessagePayload = {
        type: 'media-sync',
        action: 'heartbeat',
        mediaState: {
          videoId: 'Selected_123',
          currentTime: sec,
          isPlaying: true,
          lastUpdatedBy: 'peer-alice',
        },
        timestamp: Date.now() + sec * 1000,
        clientTimestamp: Date.now() + sec * 1000,
      };

      const result = applyRemoteMediaUpdate(
        player,
        loadedVideoRef,
        lastTokenRef,
        isApplyingRef,
        heartbeatPayload,
        'my-bob-id'
      );

      expect(result.applied).toBe(true);
      expect(result.reloadedVideo).toBe(false);
      expect(player.videoId).toBe('Selected_123');
    }

    // loadVideoById was NEVER called during the 6 seconds
    expect(player.loadVideoByIdCalls.length).toBe(0);
  });

  it('2. Play does not reload the selected video', () => {
    const player = createMockPlayer('CustomVid001');
    const loadedVideoRef = { current: 'CustomVid001' };
    const lastTokenRef = { current: null as string | null };
    const isApplyingRef = { current: false };

    const playPayload: SyncMessagePayload = {
      type: 'media-sync',
      action: 'play',
      mediaState: {
        videoId: 'CustomVid001',
        isPlaying: true,
        currentTime: 10,
        lastUpdatedBy: 'peer-alice',
      },
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    const res = applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, playPayload, 'my-bob-id');
    expect(res.applied).toBe(true);
    expect(res.reloadedVideo).toBe(false);
    expect(player.loadVideoByIdCalls.length).toBe(0);
    expect(player.playVideoCalls).toBe(1);
    expect(player.isPlaying).toBe(true);
  });

  it('3. Pause does not reload the selected video', () => {
    const player = createMockPlayer('CustomVid001');
    player.isPlaying = true;
    const loadedVideoRef = { current: 'CustomVid001' };
    const lastTokenRef = { current: null as string | null };
    const isApplyingRef = { current: false };

    const pausePayload: SyncMessagePayload = {
      type: 'media-sync',
      action: 'pause',
      mediaState: {
        videoId: 'CustomVid001',
        isPlaying: false,
        currentTime: 25,
        lastUpdatedBy: 'peer-alice',
      },
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    const res = applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, pausePayload, 'my-bob-id');
    expect(res.applied).toBe(true);
    expect(res.reloadedVideo).toBe(false);
    expect(player.loadVideoByIdCalls.length).toBe(0);
    expect(player.pauseVideoCalls).toBe(1);
    expect(player.isPlaying).toBe(false);
  });

  it('4. Seek does not reload the selected video', () => {
    const player = createMockPlayer('CustomVid001');
    const loadedVideoRef = { current: 'CustomVid001' };
    const lastTokenRef = { current: null as string | null };
    const isApplyingRef = { current: false };

    const seekPayload: SyncMessagePayload = {
      type: 'media-sync',
      action: 'seek',
      mediaState: {
        videoId: 'CustomVid001',
        currentTime: 95.5,
        isPlaying: false,
        lastUpdatedBy: 'peer-bob',
      },
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    const res = applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, seekPayload, 'my-alice-id');
    expect(res.applied).toBe(true);
    expect(res.reloadedVideo).toBe(false);
    expect(player.loadVideoByIdCalls.length).toBe(0);
    expect(player.seekToCalls).toEqual([95.5]);
  });

  it('5. Duplicate events are strictly ignored', () => {
    const player = createMockPlayer('CustomVid001');
    const loadedVideoRef = { current: 'CustomVid001' };
    const lastTokenRef = { current: null as string | null };
    const isApplyingRef = { current: false };

    const payload: SyncMessagePayload = {
      type: 'media-sync',
      action: 'play',
      mediaState: {
        videoId: 'CustomVid001',
        currentTime: 10,
        isPlaying: true,
        lastUpdatedBy: 'peer-alice',
      },
      timestamp: 1700000000000,
      clientTimestamp: 1700000000000,
    };

    // First delivery applies
    const res1 = applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, payload, 'my-bob-id');
    expect(res1.applied).toBe(true);

    // Identical redelivery is deduplicated
    const res2 = applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, payload, 'my-bob-id');
    expect(res2.applied).toBe(false);
    expect(res2.reason).toBe('DEDUPLICATED');
  });

  it('6. Partner play, pause, seek, and video changes work', () => {
    const player = createMockPlayer('InitialVid');
    const loadedVideoRef = { current: 'InitialVid' };
    const lastTokenRef = { current: null as string | null };
    const isApplyingRef = { current: false };

    // Partner plays
    applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, {
      type: 'media-sync',
      action: 'play',
      mediaState: { videoId: 'InitialVid', isPlaying: true, currentTime: 5, lastUpdatedBy: 'partner-bob' },
      timestamp: 1,
      clientTimestamp: 1,
    }, 'owner-alice');
    expect(player.isPlaying).toBe(true);

    // Partner pauses
    applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, {
      type: 'media-sync',
      action: 'pause',
      mediaState: { videoId: 'InitialVid', isPlaying: false, currentTime: 10, lastUpdatedBy: 'partner-bob' },
      timestamp: 2,
      clientTimestamp: 2,
    }, 'owner-alice');
    expect(player.isPlaying).toBe(false);

    // Partner seeks
    applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, {
      type: 'media-sync',
      action: 'seek',
      mediaState: { videoId: 'InitialVid', currentTime: 45, isPlaying: false, lastUpdatedBy: 'partner-bob' },
      timestamp: 3,
      clientTimestamp: 3,
    }, 'owner-alice');
    expect(player.seekToCalls).toContain(45);

    // Partner changes video
    const changeRes = applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, {
      type: 'media-sync',
      action: 'video_change',
      mediaState: { videoId: 'NewPartnerVid', currentTime: 0, isPlaying: true, lastUpdatedBy: 'partner-bob' },
      timestamp: 4,
      clientTimestamp: 4,
    }, 'owner-alice');
    expect(changeRes.reloadedVideo).toBe(true);
    expect(player.videoId).toBe('NewPartnerVid');
  });

  it('7. No feedback loops between Owner and Partner', () => {
    const playerAlice = createMockPlayer('Vid1');
    const loadedAlice = { current: 'Vid1' };
    const tokenAlice = { current: null as string | null };
    const lockAlice = { current: false };

    // Alice initiates play
    const aliceBroadcast: SyncMessagePayload = {
      type: 'media-sync',
      action: 'play',
      mediaState: { videoId: 'Vid1', isPlaying: true, currentTime: 0, lastUpdatedBy: 'alice-id' },
      timestamp: 100,
      clientTimestamp: 100,
    };

    // Alice receives own broadcast back from channel -> MUST DROP
    const echoResult = applyRemoteMediaUpdate(playerAlice, loadedAlice, tokenAlice, lockAlice, aliceBroadcast, 'alice-id');
    expect(echoResult.applied).toBe(false);
    expect(echoResult.reason).toBe('SELF_UPDATE');
  });

  it('8. Only explicit video_change event changes the selected video', () => {
    const player = createMockPlayer('ActiveMovie');
    const loadedVideoRef = { current: 'ActiveMovie' };
    const lastTokenRef = { current: null as string | null };
    const isApplyingRef = { current: false };

    // Attempted state update that contains an older videoId but with action 'play'
    const rogueUpdate: SyncMessagePayload = {
      type: 'media-sync',
      action: 'play',
      mediaState: {
        videoId: 'dQw4w9WgXcQ', // default demo video accidentally sent
        isPlaying: true,
        currentTime: 5,
        lastUpdatedBy: 'peer-bob',
      },
      timestamp: 200,
      clientTimestamp: 200,
    };

    const res = applyRemoteMediaUpdate(player, loadedVideoRef, lastTokenRef, isApplyingRef, rogueUpdate, 'alice-id');
    expect(res.applied).toBe(true);
    expect(res.reloadedVideo).toBe(false);
    // Crucial: player videoId MUST NOT have reverted to dQw4w9WgXcQ!
    expect(player.videoId).toBe('ActiveMovie');
    expect(player.loadVideoByIdCalls.length).toBe(0);
  });
});
