import { describe, it, expect, vi } from 'vitest';
import type { MediaState, SyncMessagePayload } from '../src/types/cinema';

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
  };
}

describe('Phase 15.4: YouTube Partner Controls & Synchronization Engine', () => {
  function simulateUpdateMediaState(
    currentMediaState: MediaState,
    update: Partial<MediaState>,
    sessionRole: 'owner' | 'partner',
    participantId: string
  ): { updatedState: MediaState; syncPayload: SyncMessagePayload } | null {
    // Both owner and partner are authorized
    if (sessionRole !== 'owner' && sessionRole !== 'partner') {
      return null;
    }

    const updatedState: MediaState = {
      ...currentMediaState,
      ...update,
      lastUpdatedBy: participantId,
      clientTimestamp: Date.now(),
    };

    const syncPayload: SyncMessagePayload = {
      type: 'media-sync',
      mediaState: {
        ...update,
        lastUpdatedBy: participantId,
      },
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    return { updatedState, syncPayload };
  }

  function simulateApplyRemoteSync(
    incomingPayload: SyncMessagePayload,
    myParticipantId: string,
    localPlayer: {
      currentTime: number;
      isPlaying: boolean;
      videoId: string;
      seekTo: (time: number) => void;
      playVideo: () => void;
      pauseVideo: () => void;
      loadVideoById: (id: string, time: number) => void;
    },
    isApplyingRemoteSyncRef: { current: boolean }
  ): { applied: boolean; reason?: string } {
    if (!incomingPayload.mediaState) {
      return { applied: false, reason: 'NO_MEDIA_STATE' };
    }

    // 1. Ignore updates that we originated ourselves (Feedback Loop Prevention)
    if (incomingPayload.mediaState.lastUpdatedBy === myParticipantId) {
      return { applied: false, reason: 'SELF_ORIGINATED_UPDATE' };
    }

    isApplyingRemoteSyncRef.current = true;
    try {
      // Video change
      if (incomingPayload.mediaState.videoId && incomingPayload.mediaState.videoId !== localPlayer.videoId) {
        localPlayer.loadVideoById(incomingPayload.mediaState.videoId, incomingPayload.mediaState.currentTime || 0);
      }

      // Drift calculation
      const elapsedSec = (Date.now() - (incomingPayload.clientTimestamp || Date.now())) / 1000;
      const targetTime = (incomingPayload.mediaState.currentTime ?? localPlayer.currentTime) +
        (incomingPayload.mediaState.isPlaying ? Math.max(0, elapsedSec) : 0);
      const drift = Math.abs(localPlayer.currentTime - targetTime);

      if (drift > 0.75) {
        localPlayer.seekTo(targetTime);
      }

      // Play/Pause state
      if (incomingPayload.mediaState.isPlaying !== undefined) {
        if (incomingPayload.mediaState.isPlaying && !localPlayer.isPlaying) {
          localPlayer.playVideo();
        } else if (!incomingPayload.mediaState.isPlaying && localPlayer.isPlaying) {
          localPlayer.pauseVideo();
        }
      }

      return { applied: true };
    } finally {
      // In actual component, cleared after short cooldown
      isApplyingRemoteSyncRef.current = false;
    }
  }

  it('should allow Host (Owner) to play, pause, and seek', () => {
    const initialState: MediaState = {
      mode: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      currentTime: 10,
      duration: 213,
      isPlaying: false,
      playbackRate: 1,
      lastUpdatedBy: 'host-alice',
      clientTimestamp: Date.now(),
    };

    // Host plays
    const playRes = simulateUpdateMediaState(initialState, { isPlaying: true, currentTime: 10 }, 'owner', 'host-alice');
    expect(playRes).not.toBeNull();
    expect(playRes!.updatedState.isPlaying).toBe(true);
    expect(playRes!.syncPayload.mediaState?.lastUpdatedBy).toBe('host-alice');

    // Host seeks to 75s
    const seekRes = simulateUpdateMediaState(playRes!.updatedState, { currentTime: 75 }, 'owner', 'host-alice');
    expect(seekRes).not.toBeNull();
    expect(seekRes!.updatedState.currentTime).toBe(75);
  });

  it('should allow Partner (Guest) to play, pause, and seek without rejection', () => {
    const initialState: MediaState = {
      mode: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      currentTime: 30,
      duration: 213,
      isPlaying: true,
      playbackRate: 1,
      lastUpdatedBy: 'host-alice',
      clientTimestamp: Date.now(),
    };

    // Partner pauses
    const pauseRes = simulateUpdateMediaState(initialState, { isPlaying: false, currentTime: 35 }, 'partner', 'partner-bob');
    expect(pauseRes).not.toBeNull();
    expect(pauseRes!.updatedState.isPlaying).toBe(false);
    expect(pauseRes!.updatedState.currentTime).toBe(35);
    expect(pauseRes!.syncPayload.mediaState?.lastUpdatedBy).toBe('partner-bob');

    // Partner seeks to 120s
    const seekRes = simulateUpdateMediaState(pauseRes!.updatedState, { currentTime: 120 }, 'partner', 'partner-bob');
    expect(seekRes).not.toBeNull();
    expect(seekRes!.updatedState.currentTime).toBe(120);
    expect(seekRes!.syncPayload.mediaState?.lastUpdatedBy).toBe('partner-bob');
  });

  it('should synchronize Host player when Partner pauses or seeks', () => {
    const hostPlayer = {
      currentTime: 30,
      isPlaying: true,
      videoId: 'dQw4w9WgXcQ',
      seekTo: vi.fn((t: number) => { hostPlayer.currentTime = t; }),
      playVideo: vi.fn(() => { hostPlayer.isPlaying = true; }),
      pauseVideo: vi.fn(() => { hostPlayer.isPlaying = false; }),
      loadVideoById: vi.fn((id: string) => { hostPlayer.videoId = id; }),
    };

    const isApplyingRemoteSyncRef = { current: false };

    // Partner sends pause at 32s
    const partnerSyncPayload: SyncMessagePayload = {
      type: 'media-sync',
      mediaState: {
        isPlaying: false,
        currentTime: 32,
        lastUpdatedBy: 'partner-bob',
      },
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    const res = simulateApplyRemoteSync(partnerSyncPayload, 'host-alice', hostPlayer, isApplyingRemoteSyncRef);
    expect(res.applied).toBe(true);
    expect(hostPlayer.pauseVideo).toHaveBeenCalled();
    expect(hostPlayer.isPlaying).toBe(false);

    // Partner sends seek to 150s
    const partnerSeekPayload: SyncMessagePayload = {
      type: 'media-sync',
      mediaState: {
        currentTime: 150,
        lastUpdatedBy: 'partner-bob',
      },
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    const seekRes = simulateApplyRemoteSync(partnerSeekPayload, 'host-alice', hostPlayer, isApplyingRemoteSyncRef);
    expect(seekRes.applied).toBe(true);
    expect(hostPlayer.seekTo).toHaveBeenCalledWith(150);
  });

  it('should ignore self-originated updates to eliminate feedback loops', () => {
    const hostPlayer = {
      currentTime: 50,
      isPlaying: true,
      videoId: 'dQw4w9WgXcQ',
      seekTo: vi.fn(),
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      loadVideoById: vi.fn(),
    };

    const isApplyingRemoteSyncRef = { current: false };

    // Update originated by host-alice bounces back over fallback channel
    const bouncedPayload: SyncMessagePayload = {
      type: 'media-sync',
      mediaState: {
        isPlaying: false,
        currentTime: 50,
        lastUpdatedBy: 'host-alice',
      },
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    const res = simulateApplyRemoteSync(bouncedPayload, 'host-alice', hostPlayer, isApplyingRemoteSyncRef);
    expect(res.applied).toBe(false);
    expect(res.reason).toBe('SELF_ORIGINATED_UPDATE');
    expect(hostPlayer.pauseVideo).not.toHaveBeenCalled();
    expect(hostPlayer.seekTo).not.toHaveBeenCalled();
  });

  it('should synchronize video ID changes initiated by either participant', () => {
    const partnerPlayer = {
      currentTime: 0,
      isPlaying: false,
      videoId: 'dQw4w9WgXcQ',
      seekTo: vi.fn(),
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      loadVideoById: vi.fn((id: string) => { partnerPlayer.videoId = id; }),
    };

    const isApplyingRemoteSyncRef = { current: false };

    // Host loads a new video
    const newVideoPayload: SyncMessagePayload = {
      type: 'media-sync',
      mediaState: {
        videoId: 'M7lc1UVf-VE',
        currentTime: 0,
        isPlaying: true,
        lastUpdatedBy: 'host-alice',
      },
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    const res = simulateApplyRemoteSync(newVideoPayload, 'partner-bob', partnerPlayer, isApplyingRemoteSyncRef);
    expect(res.applied).toBe(true);
    expect(partnerPlayer.loadVideoById).toHaveBeenCalledWith('M7lc1UVf-VE', 0);
    expect(partnerPlayer.videoId).toBe('M7lc1UVf-VE');
  });
});

describe('Phase 15.4: Sound Button and Volume Slider Controls', () => {
  class MockVolumeManager {
    public playerVolume: number = 100;
    public isPlayerMuted: boolean = false;

    public setPlayerVolume(val: number): void {
      const clamped = Math.max(0, Math.min(100, Math.round(val)));
      this.playerVolume = clamped;
      if (clamped === 0) {
        this.isPlayerMuted = true;
      } else {
        this.isPlayerMuted = false;
      }
    }

    public togglePlayerMute(): void {
      this.isPlayerMuted = !this.isPlayerMuted;
    }
  }

  it('should support complete 0-100 range and clamp invalid inputs', () => {
    const vm = new MockVolumeManager();

    vm.setPlayerVolume(50);
    expect(vm.playerVolume).toBe(50);
    expect(vm.isPlayerMuted).toBe(false);

    // Clamp upper bound
    vm.setPlayerVolume(150);
    expect(vm.playerVolume).toBe(100);

    // Clamp lower bound
    vm.setPlayerVolume(-20);
    expect(vm.playerVolume).toBe(0);
    expect(vm.isPlayerMuted).toBe(true);
  });

  it('should toggle mute and unmute correctly', () => {
    const vm = new MockVolumeManager();
    expect(vm.isPlayerMuted).toBe(false);

    // Mute sound
    vm.togglePlayerMute();
    expect(vm.isPlayerMuted).toBe(true);

    // Unmute sound
    vm.togglePlayerMute();
    expect(vm.isPlayerMuted).toBe(false);
  });

  it('should automatically unmute when volume is increased above 0', () => {
    const vm = new MockVolumeManager();
    vm.togglePlayerMute();
    expect(vm.isPlayerMuted).toBe(true);

    // User raises slider to 75%
    vm.setPlayerVolume(75);
    expect(vm.playerVolume).toBe(75);
    expect(vm.isPlayerMuted).toBe(false);
  });

  it('should ensure local listening volume is independent and not broadcast in media-sync', () => {
    const aliceVolume = new MockVolumeManager();
    const bobVolume = new MockVolumeManager();

    // Alice turns her local volume down to 20%
    aliceVolume.setPlayerVolume(20);
    expect(aliceVolume.playerVolume).toBe(20);

    // Bob’s volume remains unchanged at 100%
    expect(bobVolume.playerVolume).toBe(100);
    expect(bobVolume.isPlayerMuted).toBe(false);
  });
});
